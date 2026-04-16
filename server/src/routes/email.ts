// ============================================================
// Email Routes — /api/email
// Handles sending follow-up emails after interested calls
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { sendEmail } from '../services/email.js';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import pino from 'pino';

const logger = pino({ name: 'email-routes' });
const router = Router();

// ============================================================
// Validation schemas
// ============================================================

const sendEmailSchema = z.object({
  leadId: z.number().int().positive(),
  to: z.string().email('Invalid email address'),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  pipelineStage: z.enum(['follow_up', 'call_booked']),
  attachments: z.array(z.string()).optional(),
});

// ============================================================
// POST /api/email/send — Send a follow-up email
// ============================================================

router.post('/send', async (req, res, next) => {
  try {
    const payload = sendEmailSchema.parse(req.body);

    logger.info(
      { leadId: payload.leadId, to: payload.to, pipelineStage: payload.pipelineStage },
      'Processing email send request'
    );

    const result = await sendEmail({
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      textBody: payload.body,
    });

    logger.info(
      { leadId: payload.leadId, messageId: result.messageId },
      'Email sent successfully'
    );

    // Record the sent email and create an activity
    try {
      const db = getDb();
      const now = new Date().toISOString();
      // Store the FULL email body so it can be viewed later on the profile page
      const bodySnippet = payload.body;

      db.transaction(() => {
        db.prepare(`
          INSERT INTO emails_sent (lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction, created_at)
          VALUES (?, ?, 'jordan@oxyscale.ai', ?, ?, ?, 'dialler', 'sent', ?)
        `).run(payload.leadId, payload.to, payload.subject, bodySnippet, result.messageId || null, now);

        db.prepare(`
          INSERT INTO activities (lead_id, type, title, description, created_at)
          VALUES (?, 'email', 'Email sent', ?, ?)
        `).run(payload.leadId, `To: ${payload.to} — ${payload.subject}`, now);
      })();
    } catch (dbErr) {
      // Log but don't fail the request — the email was already sent
      logger.error({ error: dbErr }, 'Failed to record email in database');
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(error);
    }
    logger.error({ error }, 'Failed to send email');
    next(new ApiError(500, 'Failed to send email'));
  }
});

export default router;
