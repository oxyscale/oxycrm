// ============================================================
// Email Drafts Routes — /api/email-drafts
// The "Email Bank" — AI-generated follow-up email drafts awaiting review.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { sendEmail } from '../services/email.js';
import { buildEmailSignature } from '../services/emailSignature.js';
import { buildBrandedEmailHtml } from '../services/emailTemplate.js';
import {
  summariseAndPersistCall,
  draftAndStoreEmailForCall,
} from '../services/ai-summary.js';
import pino from 'pino';

const logger = pino({ name: 'email-drafts-routes' });
const router = Router();

// ── Row mapping ────────────────────────────────────────────────

interface DraftRow {
  id: number;
  lead_id: number;
  call_log_id: number | null;
  disposition: string;
  to_email: string | null;
  cc_email: string | null;
  subject: string | null;
  body: string | null;
  suggested_stage: string | null;
  status: string;
  generated_at: string | null;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface DraftRowWithLead extends DraftRow {
  lead_name: string;
  lead_company: string | null;
  lead_phone: string;
  lead_category: string | null;
}

function mapDraft(row: DraftRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    callLogId: row.call_log_id,
    disposition: row.disposition as 'interested' | 'voicemail',
    toEmail: row.to_email,
    ccEmail: row.cc_email,
    subject: row.subject,
    body: row.body,
    suggestedStage: (row.suggested_stage || 'follow_up') as 'follow_up' | 'call_booked',
    status: row.status as 'pending' | 'ready' | 'sent' | 'discarded' | 'failed',
    generatedAt: row.generated_at,
    sentAt: row.sent_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDraftWithLead(row: DraftRowWithLead) {
  return {
    ...mapDraft(row),
    leadName: row.lead_name,
    leadCompany: row.lead_company,
    leadPhone: row.lead_phone,
    leadCategory: row.lead_category,
  };
}

// ── Stale-pending sweep ───────────────────────────────────────
// Any draft stuck in 'pending' for more than 15 minutes is marked
// 'failed' so the team knows to retry or handle it manually.
//
// Only runs once every 5 min at most — earlier the sweep ran on every
// /api/email-drafts GET, so a polling page hit Jordan's DB ~12x/min
// for no reason. Tracked via a module-local timestamp.
let lastSweepAt = 0;
const SWEEP_MIN_INTERVAL_MS = 5 * 60_000;

function sweepStalePendings(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return;
  lastSweepAt = now;

  const db = getDb();
  const cutoff = new Date(now - 15 * 60_000).toISOString();
  const result = db
    .prepare(
      `UPDATE email_drafts
       SET status = 'failed',
           error_message = COALESCE(error_message, 'Transcript never arrived — draft timed out'),
           updated_at = ?
       WHERE status = 'pending' AND created_at < ?`,
    )
    .run(new Date().toISOString(), cutoff);
  if (result.changes > 0) {
    logger.warn({ swept: result.changes }, 'Swept stale pending email drafts to failed');
  }
}

// ── GET /api/email-drafts — list ──────────────────────────────

router.get('/', (req, res, next) => {
  try {
    sweepStalePendings();
    const db = getDb();
    const status = typeof req.query.status === 'string' ? req.query.status : null;

    const statusClause = status && status !== 'all'
      ? 'WHERE d.status = @status'
      : "WHERE d.status IN ('pending', 'ready', 'failed')"; // hide sent/discarded by default

    const rows = db
      .prepare(
        `SELECT d.*,
                l.name AS lead_name, l.company AS lead_company,
                l.phone AS lead_phone, l.category AS lead_category
         FROM email_drafts d
         JOIN leads l ON l.id = d.lead_id
         ${statusClause}
         ORDER BY
           CASE d.status
             WHEN 'ready' THEN 0
             WHEN 'pending' THEN 1
             WHEN 'failed' THEN 2
             ELSE 3
           END,
           d.created_at DESC`,
      )
      .all(status && status !== 'all' ? { status } : {}) as DraftRowWithLead[];

    const stats = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'sent' AND sent_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS sent_last_24h
         FROM email_drafts`,
      )
      .get() as { ready: number; pending: number; failed: number; sent_last_24h: number };

    res.json({
      drafts: rows.map(mapDraftWithLead),
      stats: {
        ready: stats.ready || 0,
        pending: stats.pending || 0,
        failed: stats.failed || 0,
        sentLast24h: stats.sent_last_24h || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/email-drafts/:id — single draft ──────────────────

router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const db = getDb();
    const row = db
      .prepare(
        `SELECT d.*,
                l.name AS lead_name, l.company AS lead_company,
                l.phone AS lead_phone, l.category AS lead_category
         FROM email_drafts d
         JOIN leads l ON l.id = d.lead_id
         WHERE d.id = ?`,
      )
      .get(id) as DraftRowWithLead | undefined;

    if (!row) throw new ApiError(404, 'Email draft not found');
    res.json(mapDraftWithLead(row));
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/email-drafts/:id — edit draft fields ───────────

const patchSchema = z.object({
  toEmail: z.string().email().nullable().optional().or(z.literal('')),
  ccEmail: z.string().nullable().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  suggestedStage: z.enum(['follow_up', 'call_booked']).optional(),
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const updates = patchSchema.parse(req.body);
    const db = getDb();

    const existing = db
      .prepare('SELECT status FROM email_drafts WHERE id = ?')
      .get(id) as { status: string } | undefined;
    if (!existing) throw new ApiError(404, 'Email draft not found');
    if (existing.status === 'sent') {
      throw new ApiError(409, 'Cannot edit a sent draft');
    }

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.toEmail !== undefined) {
      setClauses.push('to_email = @toEmail');
      params.toEmail = updates.toEmail || null;
    }
    if (updates.ccEmail !== undefined) {
      setClauses.push('cc_email = @ccEmail');
      params.ccEmail = updates.ccEmail || null;
    }
    if (updates.subject !== undefined) {
      setClauses.push('subject = @subject');
      params.subject = updates.subject;
    }
    if (updates.body !== undefined) {
      setClauses.push('body = @body');
      params.body = updates.body;
    }
    if (updates.suggestedStage !== undefined) {
      setClauses.push('suggested_stage = @suggestedStage');
      params.suggestedStage = updates.suggestedStage;
    }

    if (setClauses.length === 0) {
      throw new ApiError(400, 'No fields provided');
    }

    setClauses.push("updated_at = datetime('now')");

    db.prepare(`UPDATE email_drafts SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    const updated = db
      .prepare('SELECT * FROM email_drafts WHERE id = ?')
      .get(id) as DraftRow;
    res.json(mapDraft(updated));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/email-drafts/:id/send — send + mark ─────────────

router.post('/:id/send', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const db = getDb();

    const draft = db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id) as DraftRow | undefined;
    if (!draft) throw new ApiError(404, 'Email draft not found');
    if (draft.status !== 'ready') {
      throw new ApiError(409, `Draft is in status '${draft.status}' — only 'ready' drafts can be sent`);
    }
    if (!draft.to_email || !draft.subject || !draft.body) {
      throw new ApiError(400, 'Missing to_email, subject, or body');
    }

    // Identity = the logged-in user. The draft was generated for the
    // person who made the call, but at send time we use whoever is
    // actually clicking Send (they own the outgoing message).
    const user = req.user!;

    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value;

    const companyName = settings.company_name || 'OxyScale';
    const websiteUrl = settings.website_url || 'https://oxyscale.ai';

    const lead = db.prepare('SELECT name FROM leads WHERE id = ?').get(draft.lead_id) as { name: string } | undefined;
    const recipientName = lead?.name?.split(' ')[0] || 'there';

    const signature = buildEmailSignature({
      sender_name: user.name,
      sender_title: user.title,
      sender_phone: user.phone,
      company_name: companyName,
      website_url: websiteUrl,
      calendly_link: user.calendlyLink,
    });

    const htmlBody = buildBrandedEmailHtml({
      body: draft.body,
      recipientName,
      senderName: user.name,
      signOff: user.signOff,
      signature,
    });

    const result = await sendEmail({
      to: draft.to_email,
      cc: draft.cc_email || undefined,
      subject: draft.subject,
      textBody: draft.body,
      htmlBody,
      fromName: user.name,
      fromAddress: user.senderEmail,
    });

    // Log sent email + activity + update pipeline stage + mark draft sent.
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO emails_sent (lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'dialler', 'sent', ?)
      `).run(draft.lead_id, draft.to_email, user.senderEmail, draft.subject, draft.body, result.messageId || null, now);

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'email', 'Email sent', ?, ?)
      `).run(draft.lead_id, `To: ${draft.to_email} — ${draft.subject}`, now);

      // Move lead to the suggested pipeline stage (follow_up or call_booked)
      const stage = draft.suggested_stage || 'follow_up';
      db.prepare("UPDATE leads SET pipeline_stage = ?, updated_at = ? WHERE id = ?")
        .run(stage, now, draft.lead_id);

      // Mark draft sent
      db.prepare(
        "UPDATE email_drafts SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?",
      ).run(now, now, draft.id);
    })();

    logger.info({ draftId: id, leadId: draft.lead_id, messageId: result.messageId }, 'Email draft sent from bank');
    res.json({ success: true, messageId: result.messageId });
  } catch (err) {
    logger.error({ err }, 'Send from email bank failed');
    next(err);
  }
});

// ── POST /api/email-drafts/:id/retry — re-trigger generation ───

router.post('/:id/retry', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const db = getDb();
    const draft = db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id) as DraftRow | undefined;
    if (!draft) throw new ApiError(404, 'Email draft not found');
    if (!draft.call_log_id) {
      throw new ApiError(400, 'Draft has no call_log — cannot regenerate');
    }
    if (draft.status === 'sent') {
      throw new ApiError(409, 'Cannot retry a sent draft');
    }

    // Flip back to pending + clear error; the chain will update it.
    db.prepare(
      `UPDATE email_drafts SET status = 'pending', error_message = NULL, updated_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), id);

    const callLogId = draft.call_log_id;
    const leadId = draft.lead_id;

    res.json({ success: true });

    // Run the chain after responding so the client doesn't wait.
    (async () => {
      await summariseAndPersistCall(callLogId, leadId);
      await draftAndStoreEmailForCall(callLogId, leadId);
    })().catch((err) => {
      logger.error({ err, draftId: id }, 'Retry chain failed');
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/email-drafts/:id — discard ────────────────────

router.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');
    const db = getDb();
    const result = db
      .prepare(
        "UPDATE email_drafts SET status = 'discarded', updated_at = ? WHERE id = ? AND status != 'sent'",
      )
      .run(new Date().toISOString(), id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Draft not found or already sent');
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
