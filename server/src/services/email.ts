// ============================================================
// Email Service — Resend Integration
// Sends branded HTML emails via the Resend API
// ============================================================

import { Resend } from 'resend';
import pino from 'pino';

const logger = pino({ name: 'email-service' });

// ── Resend client (lazy-initialized) ─────────────────────────

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set. Cannot send emails.');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// ── Types ───────────────────────────────────────────────────

interface SendEmailParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  fromName?: string;
  fromAddress?: string;
}

interface SendEmailResult {
  messageId: string;
}

// ============================================================
// Send email
// ============================================================

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const fromName = params.fromName || process.env.EMAIL_FROM_NAME || 'OxyScale';
  const fromAddress = params.fromAddress || process.env.EMAIL_FROM_ADDRESS || 'jordan@oxyscale.ai';
  const { to, cc, bcc, subject, textBody, htmlBody } = params;

  const from = `${fromName} <${fromAddress}>`;

  // Parse comma-separated email strings into arrays
  const ccList = cc ? cc.split(',').map((e) => e.trim()).filter(Boolean) : undefined;
  const bccList = bcc ? bcc.split(',').map((e) => e.trim()).filter(Boolean) : undefined;

  // If Resend isn't configured, save locally but skip sending
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn({ to, subject }, 'RESEND_API_KEY not set — email saved locally but not sent');
    return { messageId: `local-${Date.now()}` };
  }

  logger.info({ to, cc: ccList, bcc: bccList, subject, from }, 'Sending email via Resend');

  try {
    const resend = getResend();
    const response = await resend.emails.send({
      from,
      to,
      cc: ccList,
      bcc: bccList,
      subject,
      text: textBody,
      ...(htmlBody ? { html: htmlBody } : {}),
      tags: [
        { name: 'source', value: 'oxyscale-dialler' },
        { name: 'type', value: 'follow-up' },
      ],
    });

    if (response.error) {
      logger.error({ error: response.error, to, subject }, 'Resend API returned an error');
      throw new Error(`Resend error: ${response.error.message}`);
    }

    const messageId = response.data?.id ?? 'unknown';
    logger.info({ messageId, to, subject }, 'Email sent successfully');

    return { messageId };
  } catch (error) {
    logger.error({ error, to, subject }, 'Failed to send email via Resend');
    throw error;
  }
}
