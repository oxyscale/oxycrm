// ============================================================
// Gmail Sync Service
// Monitors the Gmail sent folder and auto-logs emails to leads.
// Runs on a 60-second interval after server startup.
// ============================================================

import { google } from 'googleapis';
import pino from 'pino';
import { getAuthenticatedClient, isAuthenticated } from './google-calendar.js';
import { getDb } from '../db/index.js';

const logger = pino({ name: 'gmail-sync-service' });

// ── State ───────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ── Core sync logic ─────────────────────────────────────────

/**
 * Fetches recent sent AND received emails from Gmail (last ~2 minutes).
 * For each email, checks if any sender/recipient email matches a lead in the database.
 * If match found, creates an emails_sent record and an activity record.
 * Excludes emails to/from @oxyscale.ai (internal).
 */
export async function syncSentEmails(): Promise<{ matched: number; total: number }> {
  const db = getDb();

  // Get authenticated Gmail client
  const auth = getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Get user's email for direction detection
  let myEmail = '';
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    myEmail = profile.data.emailAddress?.toLowerCase() || '';
  } catch {
    logger.warn('Could not fetch Gmail profile — direction detection may be inaccurate');
  }

  // Fetch recent messages (sent AND received, last ~2 minutes)
  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: 'newer_than:2m',
    maxResults: 30,
  });

  const messages = listResponse.data.messages || [];

  if (messages.length === 0) {
    return { matched: 0, total: 0 };
  }

  let matched = 0;

  // Prepare statements for reuse
  const findLeadByEmail = db.prepare('SELECT id, name, company FROM leads WHERE LOWER(email) = ?');
  const checkDuplicate = db.prepare('SELECT id FROM emails_sent WHERE gmail_message_id = ?');
  const insertEmail = db.prepare(`
    INSERT INTO emails_sent (lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction)
    VALUES (?, ?, ?, ?, ?, ?, 'gmail', ?)
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activities (lead_id, type, title, description, metadata)
    VALUES (?, 'email', ?, ?, ?)
  `);

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      // Check if we already logged this message
      const existing = checkDuplicate.get(msg.id);
      if (existing) continue;

      // Fetch message headers (include Cc for George's emails)
      const msgResponse = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['To', 'From', 'Cc', 'Subject', 'Date'],
      });

      const headers = msgResponse.data.payload?.headers || [];
      const toHeader = headers.find((h) => h.name === 'To')?.value || '';
      const ccHeader = headers.find((h) => h.name === 'Cc')?.value || '';
      const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
      const snippet = msgResponse.data.snippet || null;

      const recipientEmails = parseEmailAddresses(toHeader);
      const ccEmails = parseEmailAddresses(ccHeader);
      const allRecipients = [...recipientEmails, ...ccEmails];
      const senderEmails = parseEmailAddresses(fromHeader);
      const senderEmail = senderEmails[0] || '';

      // Treat emails from any @oxyscale.ai address as "sent" (includes George's emails)
      const isSent = senderEmail === myEmail || senderEmail.endsWith('@oxyscale.ai');

      if (isSent) {
        // SENT email — match To and CC recipients against leads
        for (const recipientEmail of allRecipients) {
          if (recipientEmail.endsWith('@oxyscale.ai')) continue;

          const lead = findLeadByEmail.get(recipientEmail.toLowerCase()) as
            | { id: number; name: string; company: string | null }
            | undefined;

          if (!lead) continue;

          insertEmail.run(lead.id, recipientEmail, senderEmail, subject, snippet, msg.id, 'sent');

          const activityTitle = `Email sent: ${subject}`;
          const activityDesc = snippet ? snippet.slice(0, 200) : null;
          const metadata = JSON.stringify({ gmailMessageId: msg.id, toAddress: recipientEmail, from: senderEmail, source: 'gmail' });
          insertActivity.run(lead.id, activityTitle, activityDesc, metadata);

          matched++;
          logger.info({ leadId: lead.id, leadName: lead.name, subject, direction: 'sent' }, 'Auto-logged Gmail sent email');
        }
      } else {
        // RECEIVED email — match sender against leads
        const lead = findLeadByEmail.get(senderEmail.toLowerCase()) as
          | { id: number; name: string; company: string | null }
          | undefined;

        if (!lead) continue;

        const toAddress = recipientEmails[0] || myEmail;
        insertEmail.run(lead.id, toAddress, senderEmail, subject, snippet, msg.id, 'received');

        const activityTitle = `Email received: ${subject}`;
        const activityDesc = snippet ? snippet.slice(0, 200) : null;
        const metadata = JSON.stringify({ gmailMessageId: msg.id, fromAddress: senderEmail, source: 'gmail' });
        insertActivity.run(lead.id, activityTitle, activityDesc, metadata);

        matched++;
        logger.info({ leadId: lead.id, leadName: lead.name, subject, direction: 'received' }, 'Auto-logged Gmail received email');
      }
    } catch (msgErr) {
      logger.warn({ messageId: msg.id, err: msgErr }, 'Failed to process Gmail message — skipping');
    }
  }

  if (matched > 0) {
    logger.info({ matched, total: messages.length }, 'Gmail sync complete — matched emails to leads');
  }

  return { matched, total: messages.length };
}

// ── Sync loop control ───────────────────────────────────────

/**
 * Starts the background sync loop. Runs every 60 seconds.
 * Call this once on server startup. Safe to call multiple times
 * (will not create duplicate intervals).
 */
export function startGmailSync(): void {
  if (syncInterval) {
    logger.info('Gmail sync is already running');
    return;
  }

  logger.info('Starting Gmail sync loop (every 60 seconds)');
  isRunning = true;

  // Run immediately on start, then every 60 seconds
  runSync();
  syncInterval = setInterval(runSync, 60_000);
}

/**
 * Stops the background sync loop.
 */
export function stopGmailSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    isRunning = false;
    logger.info('Gmail sync loop stopped');
  }
}

/**
 * Returns whether the sync loop is currently active.
 */
export function isGmailSyncRunning(): boolean {
  return isRunning;
}

// ── Internal helpers ────────────────────────────────────────

/**
 * Runs a single sync cycle with full error handling.
 * Never throws — logs errors and returns gracefully.
 */
async function runSync(): Promise<void> {
  try {
    // Check auth before attempting sync
    if (!isAuthenticated()) {
      logger.debug('Gmail sync skipped — Google not authenticated');
      return;
    }

    await syncSentEmails();
  } catch (err: unknown) {
    // Log and continue — never crash the server
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, 'Gmail sync cycle failed — will retry next cycle');
  }
}

/**
 * Parses email addresses from a To header value.
 * Handles formats like:
 *   "Jordan Bell <jordan@example.com>, jane@example.com"
 *   "jordan@example.com"
 */
function parseEmailAddresses(toHeader: string): string[] {
  const emails: string[] = [];
  // Split on commas (handles multiple recipients)
  const parts = toHeader.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    // Check for "Name <email>" format
    const angleMatch = trimmed.match(/<([^>]+)>/);
    if (angleMatch) {
      emails.push(angleMatch[1].trim().toLowerCase());
    } else if (trimmed.includes('@')) {
      // Plain email address
      emails.push(trimmed.toLowerCase());
    }
  }
  return emails;
}
