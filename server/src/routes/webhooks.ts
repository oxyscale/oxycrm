// ============================================================
// Webhooks router — public-by-design endpoints called by external
// services (not browsers). Each handler verifies its own signature
// before doing any work — there's no session cookie to lean on.
//
// Resend (email events): email.delivered, email.opened, email.clicked,
// email.bounced. Updates engagement counters on the matching
// emails_sent row, keyed by Resend's email_id (stored in the legacy
// `gmail_message_id` column).
// ============================================================

import { Router } from 'express';
import crypto from 'node:crypto';
import pino from 'pino';
import { getDb } from '../db/index.js';

const logger = pino({ name: 'webhooks' });
const router = Router();

// Raw request body for HMAC verification is stashed onto req.rawBody by
// the global JSON parser's `verify` callback in index.ts. Webhook
// handlers read it from there.

interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    to?: string[] | string;
    [k: string]: unknown;
  };
}

/**
 * Verify a Svix-style webhook signature (Resend uses Svix).
 *
 * Sign payload: `${svix-id}.${svix-timestamp}.${rawBody}`
 * Algorithm: HMAC-SHA256 with the secret key.
 * Secret format: `whsec_<base64-key>`. We strip the prefix and decode.
 *
 * Header `svix-signature` may contain multiple space-separated entries
 * each prefixed with `v1,`. We accept if any current-version entry
 * matches.
 */
function verifySvixSignature(
  rawBody: Buffer,
  svixId: string,
  svixTimestamp: string,
  svixSignatureHeader: string,
  secret: string,
): boolean {
  // Strip the whsec_ prefix; the rest is base64.
  const cleanSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(cleanSecret, 'base64');
  } catch {
    return false;
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', key).update(signedPayload).digest('base64');

  // Parse "v1,<sig> v1,<sig>" — accept if any v1 signature matches.
  const presented = svixSignatureHeader
    .split(' ')
    .map((entry) => entry.split(',', 2))
    .filter(([version]) => version === 'v1')
    .map(([, sig]) => sig?.trim())
    .filter(Boolean) as string[];

  if (presented.length === 0) return false;

  const expectedBuf = Buffer.from(expected);
  return presented.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

router.post('/resend', (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = (req as { rawBody?: Buffer }).rawBody;

  // Signature verification is mandatory in production. In dev we allow
  // unsigned requests so the route can be exercised without setting up
  // ngrok + a real webhook secret.
  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      logger.error('RESEND_WEBHOOK_SECRET not configured — rejecting webhook in production');
      res.status(503).json({ error: 'Webhook receiver not configured' });
      return;
    }

    const svixId = req.header('svix-id');
    const svixTimestamp = req.header('svix-timestamp');
    const svixSignature = req.header('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn('Missing Svix headers on Resend webhook');
      res.status(400).json({ error: 'Missing signature headers' });
      return;
    }

    // Reject replays of old (or future-dated) webhook deliveries.
    // Svix recommends a 5-minute tolerance window. The timestamp
    // header is Unix seconds.
    const tsSeconds = parseInt(svixTimestamp, 10);
    if (!Number.isFinite(tsSeconds)) {
      logger.warn({ svixTimestamp }, 'Resend webhook timestamp not numeric');
      res.status(400).json({ error: 'Invalid timestamp' });
      return;
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - tsSeconds);
    if (ageSeconds > 300) {
      logger.warn({ ageSeconds }, 'Resend webhook timestamp outside 5-min replay window');
      res.status(401).json({ error: 'Timestamp out of range' });
      return;
    }

    if (!rawBody) {
      logger.error('Resend webhook missing rawBody — verify callback not running');
      res.status(500).json({ error: 'Misconfigured' });
      return;
    }

    const ok = verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, secret);
    if (!ok) {
      logger.warn('Resend webhook signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const payload = req.body as ResendWebhookPayload;
  const emailId = payload?.data?.email_id;
  if (!emailId) {
    logger.warn({ type: payload.type }, 'Resend webhook missing data.email_id');
    res.status(400).json({ error: 'Missing email_id' });
    return;
  }

  try {
    const db = getDb();
    const now = new Date().toISOString();
    const row = db
      .prepare('SELECT id FROM emails_sent WHERE gmail_message_id = ?')
      .get(emailId) as { id: number } | undefined;

    if (!row) {
      // Match-miss is expected for events on emails sent before tracking
      // was enabled, and for emails sent from outside this dialler.
      logger.info({ emailId, type: payload.type }, 'Resend event for unknown email — ignoring');
      res.json({ ok: true });
      return;
    }

    switch (payload.type) {
      case 'email.delivered':
        db.prepare(
          `UPDATE emails_sent SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?`,
        ).run(now, row.id);
        break;

      case 'email.opened':
        db.prepare(
          `UPDATE emails_sent
             SET opened_at = COALESCE(opened_at, ?),
                 last_opened_at = ?,
                 open_count = open_count + 1
             WHERE id = ?`,
        ).run(now, now, row.id);
        break;

      case 'email.clicked':
        db.prepare(
          `UPDATE emails_sent
             SET clicked_at = COALESCE(clicked_at, ?),
                 last_clicked_at = ?,
                 click_count = click_count + 1
             WHERE id = ?`,
        ).run(now, now, row.id);
        break;

      case 'email.bounced':
        db.prepare(
          `UPDATE emails_sent SET bounced_at = COALESCE(bounced_at, ?) WHERE id = ?`,
        ).run(now, row.id);
        break;

      case 'email.complained':
        logger.warn({ emailId, row: row.id }, 'Spam complaint received');
        break;

      default:
        // sent / scheduled / etc — informational, no state to update.
        break;
    }

    logger.info({ emailId, type: payload.type, emailRowId: row.id }, 'Resend event processed');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, emailId, type: payload.type }, 'Resend webhook processing failed');
    res.status(500).json({ error: 'Processing failed' });
  }
});

export default router;
