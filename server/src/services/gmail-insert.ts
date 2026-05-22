// ============================================================
// Gmail Insert Service
// After sending an email via Resend, inserts a copy into the
// user's Gmail Sent folder so it appears alongside their regular
// sent messages. Uses the Gmail API's messages.insert endpoint.
// ============================================================

import { google } from 'googleapis';
import pino from 'pino';
import { getAuthenticatedClient, isAuthenticated } from './google-calendar.js';

const logger = pino({ name: 'gmail-insert' });

// ── Types ───────────────────────────────────────────────────

interface InsertParams {
  from: string;       // "Jordan Bell <jordan@oxyscale.ai>"
  to: string;         // recipient email
  cc?: string;        // optional CC
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: { filename: string; content: Buffer }[];
}

// ── MIME message builder ────────────────────────────────────

/**
 * Builds an RFC 2822 MIME message string. Handles:
 *   - multipart/alternative (text + HTML) when no attachments
 *   - multipart/mixed (alternative + attachments) when attachments present
 */
function buildMimeMessage(params: InsertParams): string {
  const { from, to, cc, subject, textBody, htmlBody, attachments } = params;
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mixedBoundary = `mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const date = new Date().toUTCString();

  // RFC 2047 encode subject if it contains non-ASCII
  const encodedSubject = /[^\x20-\x7E]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    : subject;

  let headers = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
  ];

  const altPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(textBody).toString('base64'),
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(htmlBody).toString('base64'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  if (attachments && attachments.length > 0) {
    // multipart/mixed wrapping multipart/alternative + attachments
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

    const attachmentParts = attachments.map((att) => {
      const mimeType = guessMimeType(att.filename);
      return [
        `--${mixedBoundary}`,
        `Content-Type: ${mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        '',
        att.content.toString('base64'),
      ].join('\r\n');
    });

    return [
      headers.join('\r\n'),
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      altPart,
      '',
      ...attachmentParts,
      '',
      `--${mixedBoundary}--`,
    ].join('\r\n');
  }

  // No attachments — just multipart/alternative
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  return [headers.join('\r\n'), '', altPart].join('\r\n');
}

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}

// ── Base64url encoding (Gmail API requirement) ──────────────

function base64url(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Public API ──────────────────────────────────────────────

/**
 * Inserts a copy of a sent email into Gmail's Sent folder.
 * Returns the Gmail message ID on success, or null if Google
 * isn't authenticated or the insert fails (non-fatal — the email
 * was already sent via Resend).
 */
export async function insertIntoGmailSent(params: InsertParams): Promise<string | null> {
  try {
    if (!isAuthenticated()) {
      logger.debug('Skipping Gmail Sent insert — Google not authenticated');
      return null;
    }

    const auth = getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const raw = base64url(buildMimeMessage(params));

    const response = await gmail.users.messages.insert({
      userId: 'me',
      requestBody: {
        raw,
        labelIds: ['SENT'],
      },
    });

    const gmailId = response.data.id || null;
    logger.info({ gmailId, to: params.to, subject: params.subject }, 'Inserted email copy into Gmail Sent folder');
    return gmailId;
  } catch (err) {
    // Non-fatal — the email was already sent via Resend. Log and move on.
    logger.warn({ err, to: params.to, subject: params.subject }, 'Failed to insert email into Gmail Sent folder — email was still sent via Resend');
    return null;
  }
}
