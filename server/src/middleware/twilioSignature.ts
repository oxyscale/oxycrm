// ============================================================
// Twilio webhook signature verification middleware.
// Twilio signs every webhook with HMAC-SHA1 using your auth token.
// Without this check, anyone can POST fake events to /voice,
// /recording-status, /incoming and trigger transcription, AI calls,
// or pollute the call log.
//
// Skipped automatically when TWILIO_AUTH_TOKEN is missing (dev/local
// without Twilio config) so the app still boots for non-call work.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import pino from 'pino';

const logger = pino({ name: 'twilio-signature' });

export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn('TWILIO_AUTH_TOKEN not set — webhook signature check SKIPPED');
    return next();
  }

  const signature = req.header('X-Twilio-Signature');
  if (!signature) {
    logger.warn({ path: req.path }, 'Twilio webhook missing X-Twilio-Signature header');
    res.status(403).send('Missing signature');
    return;
  }

  // Reconstruct the URL Twilio used to compute the signature. Behind
  // Railway's proxy, req.protocol is "http" — use x-forwarded-proto
  // when present so the validation matches.
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  const url = `${proto}://${host}${req.originalUrl}`;

  // Twilio signs the form-encoded body for POST webhooks. Express's
  // urlencoded parser has already decoded it back to req.body — pass
  // that object straight to validateRequest.
  const params = (req.body && typeof req.body === 'object') ? (req.body as Record<string, string>) : {};

  const ok = twilio.validateRequest(authToken, signature, url, params);
  if (!ok) {
    logger.warn({ path: req.path, url }, 'Twilio webhook signature failed validation');
    res.status(403).send('Invalid signature');
    return;
  }

  next();
}
