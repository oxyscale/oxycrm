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

interface EmailAttachment {
  filename: string;
  content: Buffer;
}

interface SendEmailParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  fromName?: string;
  fromAddress?: string;
  attachments?: EmailAttachment[];
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

  // Parse comma-separated email strings into arrays.
  //
  // `to` was missed here while cc and bcc were handled, which held up
  // for as long as every send went to one person: joining a single
  // address with commas gives back that address. The first send to a
  // list handed Resend one string containing five addresses, which is
  // not a valid recipient, and it refused the lot.
  const toList = to.split(',').map((e) => e.trim()).filter(Boolean);
  const ccList = cc ? cc.split(',').map((e) => e.trim()).filter(Boolean) : undefined;
  const bccList = bcc ? bcc.split(',').map((e) => e.trim()).filter(Boolean) : undefined;

  if (toList.length === 0) {
    throw new Error('No recipient address supplied');
  }

  // If Resend isn't configured: in production, hard-fail so a missing
  // key never silently masquerades as a successful send. In dev,
  // return a stub so the rest of the flow can be exercised.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY is not set — refusing to fake a send in production');
    }
    logger.warn({ to, subject }, 'RESEND_API_KEY not set — email NOT sent (dev stub)');
    return { messageId: `dev-stub-${Date.now()}` };
  }

  logger.info({ to: toList, cc: ccList, bcc: bccList, subject, from }, 'Sending email via Resend');

  try {
    const resend = getResend();
    const resendAttachments = params.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    }));

    const response = await resend.emails.send({
      from,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      text: textBody,
      ...(htmlBody ? { html: htmlBody } : {}),
      ...(resendAttachments && resendAttachments.length > 0 ? { attachments: resendAttachments } : {}),
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
