/**
 * One-time script: Scan Gmail sent AND received emails, match to leads.
 * Run with: npx tsx src/scripts/scan-gmail-history.ts
 */

import { google } from 'googleapis';
import { getAuthenticatedClient, isAuthenticated } from '../services/google-calendar.js';
import { getDb } from '../db/index.js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  console.log('=== Gmail Historical Scan (Sent + Received) ===\n');

  if (!isAuthenticated()) {
    console.error('Google is not authenticated. Please authenticate first via the app.');
    process.exit(1);
  }

  const db = getDb();
  const auth = getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Build lookup map of lead emails
  const leads = db.prepare(
    "SELECT id, name, company, email FROM leads WHERE email IS NOT NULL AND email != ''"
  ).all() as Array<{ id: number; name: string; company: string | null; email: string }>;

  const emailToLead = new Map<string, { id: number; name: string; company: string | null }>();
  for (const lead of leads) {
    const emails = lead.email.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    for (const email of emails) {
      emailToLead.set(email, { id: lead.id, name: lead.name, company: lead.company });
    }
  }

  console.log(`Loaded ${emailToLead.size} unique lead email addresses from ${leads.length} leads\n`);

  // Get user's own email address for direction detection
  const profileResponse = await gmail.users.getProfile({ userId: 'me' });
  const myEmail = profileResponse.data.emailAddress?.toLowerCase() || '';
  console.log(`My email: ${myEmail}\n`);

  // Prepare DB statements
  const checkDuplicate = db.prepare('SELECT id FROM emails_sent WHERE gmail_message_id = ?');
  const insertEmail = db.prepare(`
    INSERT INTO emails_sent (lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'gmail', ?, ?)
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activities (lead_id, type, title, description, metadata, created_at)
    VALUES (?, 'email', ?, ?, ?, ?)
  `);

  let matchedSent = 0;
  let matchedReceived = 0;
  let totalProcessed = 0;

  // Scan both sent AND received emails
  // We search broadly — any email involving a lead email address
  const queries = [
    { q: 'in:sent', label: 'SENT' },
    { q: 'in:inbox', label: 'RECEIVED' },
  ];

  for (const { q, label } of queries) {
    let pageToken: string | undefined;
    let pageNum = 0;

    console.log(`\n--- Scanning ${label} emails ---`);

    do {
      pageNum++;
      console.log(`  Fetching page ${pageNum}...`);

      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 100,
        pageToken,
      });

      const messages = listResponse.data.messages || [];
      pageToken = listResponse.data.nextPageToken || undefined;

      console.log(`  Got ${messages.length} messages (nextPage: ${pageToken ? 'yes' : 'no'})`);

      for (const msg of messages) {
        if (!msg.id) continue;
        totalProcessed++;

        try {
          // Skip if already logged
          const existing = checkDuplicate.get(msg.id);
          if (existing) continue;

          // Fetch full message
          const msgResponse = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          });

          const headers = msgResponse.data.payload?.headers || [];
          const toHeader = headers.find((h) => h.name === 'To')?.value || '';
          const ccHeader = headers.find((h) => h.name === 'Cc')?.value || '';
          const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
          const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
          const dateHeader = headers.find((h) => h.name === 'Date')?.value;

          const recipientEmails = parseEmailAddresses(toHeader);
          const ccEmails = parseEmailAddresses(ccHeader);
          const allRecipients = [...recipientEmails, ...ccEmails];
          const senderEmails = parseEmailAddresses(fromHeader);
          const senderEmail = senderEmails[0] || '';

          // Treat emails from any @oxyscale.ai address as "sent" (includes George's emails)
          const isSent = senderEmail === myEmail || senderEmail.endsWith('@oxyscale.ai');

          if (isSent) {
            // SENT: match To + CC recipients against leads
            for (const recipientEmail of allRecipients) {
              if (recipientEmail.endsWith('@oxyscale.ai')) continue;

              const lead = emailToLead.get(recipientEmail);
              if (!lead) continue;

              const bodyText = extractBodyText(msgResponse.data.payload);
              const bodySnippet = bodyText ? bodyText.slice(0, 500) : msgResponse.data.snippet || null;
              const createdAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

              insertEmail.run(lead.id, recipientEmail, senderEmail, subject, bodySnippet, msg.id, 'sent', createdAt);

              const activityTitle = `Email sent: ${subject}`;
              const activityDesc = bodySnippet ? bodySnippet.slice(0, 200) : null;
              const metadata = JSON.stringify({ gmailMessageId: msg.id, toAddress: recipientEmail, source: 'gmail_historical_scan' });
              insertActivity.run(lead.id, activityTitle, activityDesc, metadata, createdAt);

              matchedSent++;
              console.log(`    SENT MATCH: ${lead.name} (${recipientEmail}) — ${subject}`);
            }
          } else {
            // RECEIVED: match sender against leads
            const lead = emailToLead.get(senderEmail);
            if (lead) {
              const bodyText = extractBodyText(msgResponse.data.payload);
              const bodySnippet = bodyText ? bodyText.slice(0, 500) : msgResponse.data.snippet || null;
              const createdAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
              const toAddress = recipientEmails[0] || myEmail;

              insertEmail.run(lead.id, toAddress, senderEmail, subject, bodySnippet, msg.id, 'received', createdAt);

              const activityTitle = `Email received: ${subject}`;
              const activityDesc = bodySnippet ? bodySnippet.slice(0, 200) : null;
              const metadata = JSON.stringify({ gmailMessageId: msg.id, fromAddress: senderEmail, source: 'gmail_historical_scan' });
              insertActivity.run(lead.id, activityTitle, activityDesc, metadata, createdAt);

              matchedReceived++;
              console.log(`    RECEIVED MATCH: ${lead.name} (${senderEmail}) — ${subject}`);
            }
          }
        } catch (msgErr) {
          console.warn(`  Failed to process message ${msg.id}: ${(msgErr as Error).message}`);
        }
      }

      // Rate limiting
      if (pageToken) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } while (pageToken && pageNum < 10); // Cap at 10 pages per folder (~1000 emails)
  }

  console.log(`\n=== Scan Complete ===`);
  console.log(`Total messages processed: ${totalProcessed}`);
  console.log(`Sent emails matched: ${matchedSent}`);
  console.log(`Received emails matched: ${matchedReceived}`);
  console.log(`Total matched: ${matchedSent + matchedReceived}`);
}

function parseEmailAddresses(header: string): string[] {
  const emails: string[] = [];
  const parts = header.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    const angleMatch = trimmed.match(/<([^>]+)>/);
    if (angleMatch) {
      emails.push(angleMatch[1].trim().toLowerCase());
    } else if (trimmed.includes('@')) {
      emails.push(trimmed.toLowerCase());
    }
  }
  return emails;
}

function extractBodyText(payload: any): string | null {
  if (!payload) return null;

  if (payload.body?.data) {
    const mimeType = payload.mimeType || '';
    if (mimeType === 'text/plain' || mimeType === 'text/html') {
      const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      return mimeType === 'text/html' ? stripHtml(decoded) : decoded;
    }
  }

  if (payload.parts) {
    const plainPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      return Buffer.from(plainPart.body.data, 'base64url').toString('utf-8');
    }

    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return stripHtml(Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8'));
    }

    for (const part of payload.parts) {
      if (part.parts) {
        const result = extractBodyText(part);
        if (result) return result;
      }
    }
  }

  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
