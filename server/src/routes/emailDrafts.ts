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
import { buildBrandedEmailHtml, buildPlainEmailHtml } from '../services/emailTemplate.js';
import { insertIntoGmailSent } from '../services/gmail-insert.js';
import {
  summariseAndPersistCall,
  draftAndStoreEmailForCall,
  getCategoryCta,
  getSecondaryCta,
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
  include_after_call_header: number;
  include_capabilities: number;
  include_book_a_call: number;
  include_secondary_doc: number;
  plain_text_mode: number;
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
    suggestedStage: row.suggested_stage || 'follow_up',
    status: row.status as 'pending' | 'ready' | 'sent' | 'discarded' | 'failed',
    generatedAt: row.generated_at,
    sentAt: row.sent_at,
    errorMessage: row.error_message,
    includeAfterCallHeader: !!row.include_after_call_header,
    includeCapabilities: !!row.include_capabilities,
    includeSecondaryDoc: !!row.include_secondary_doc,
    includeBookACall: !!row.include_book_a_call,
    plainTextMode: !!row.plain_text_mode,
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
    /** Whether the lead's category has a CTA URL configured. The
     *  capabilities-document toggle is only meaningful when this is true. */
    categoryHasCta: !!getCategoryCta(row.lead_category),
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

// ── POST /api/email-drafts — create a manual draft ───────────
// Used from the Compose Email page to save a draft to the Email Bank
// instead of sending immediately.

const createDraftSchema = z.object({
  leadId: z.number().int().positive(),
  toEmail: z.string().email().optional().or(z.literal('')),
  ccEmail: z.string().optional(),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  attachments: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    contentBase64: z.string(),
  })).optional(),
});

router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const payload = createDraftSchema.parse(req.body);

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(payload.leadId);
    if (!lead) throw new ApiError(404, 'Lead not found');

    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO email_drafts (lead_id, call_log_id, disposition, to_email, cc_email, subject, body,
        suggested_stage, status, generated_at, include_after_call_header, include_capabilities, include_book_a_call,
        created_at, updated_at)
      VALUES (?, NULL, 'interested', ?, ?, ?, ?, 'follow_up', 'ready', ?, 0, 0, 1, ?, ?)
    `).run(
      payload.leadId,
      payload.toEmail || null,
      payload.ccEmail || null,
      payload.subject,
      payload.body,
      now, now, now,
    );

    const draftId = insert.lastInsertRowid as number;

    // Save attachments if any
    if (payload.attachments && payload.attachments.length > 0) {
      const attachInsert = db.prepare(`
        INSERT INTO draft_attachments (draft_id, filename, mime_type, size, content_base64)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const att of payload.attachments) {
        const sizeBytes = Math.ceil(att.contentBase64.length * 3 / 4);
        attachInsert.run(draftId, att.filename, att.mimeType, sizeBytes, att.contentBase64);
      }
    }

    // Log activity
    db.prepare(`
      INSERT INTO activities (lead_id, type, title, description, created_at, created_by)
      VALUES (?, 'email', 'Email draft saved', ?, ?, ?)
    `).run(payload.leadId, `Subject: ${payload.subject}`, now, req.user?.name || 'System');

    const row = db.prepare(`
      SELECT d.*, l.name AS lead_name, l.company AS lead_company,
             l.phone AS lead_phone, l.category AS lead_category
      FROM email_drafts d
      JOIN leads l ON l.id = d.lead_id
      WHERE d.id = ?
    `).get(draftId) as DraftRowWithLead;

    logger.info({ draftId, leadId: payload.leadId }, 'Manual email draft created');
    res.status(201).json(mapDraftWithLead(row));
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
  includeAfterCallHeader: z.boolean().optional(),
  includeCapabilities: z.boolean().optional(),
  includeSecondaryDoc: z.boolean().optional(),
  includeBookACall: z.boolean().optional(),
  plainTextMode: z.boolean().optional(),
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
    if (updates.includeAfterCallHeader !== undefined) {
      setClauses.push('include_after_call_header = @includeAfterCallHeader');
      params.includeAfterCallHeader = updates.includeAfterCallHeader ? 1 : 0;
    }
    if (updates.includeCapabilities !== undefined) {
      setClauses.push('include_capabilities = @includeCapabilities');
      params.includeCapabilities = updates.includeCapabilities ? 1 : 0;
    }
    if (updates.includeSecondaryDoc !== undefined) {
      setClauses.push('include_secondary_doc = @includeSecondaryDoc');
      params.includeSecondaryDoc = updates.includeSecondaryDoc ? 1 : 0;
    }
    if (updates.includeBookACall !== undefined) {
      setClauses.push('include_book_a_call = @includeBookACall');
      params.includeBookACall = updates.includeBookACall ? 1 : 0;
    }
    if (updates.plainTextMode !== undefined) {
      setClauses.push('plain_text_mode = @plainTextMode');
      params.plainTextMode = updates.plainTextMode ? 1 : 0;
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

// ── POST /api/email-drafts/:id/preview — live HTML preview ────
//
// Renders the same HTML the recipient will see, given the current edit
// state passed in the body. Lets the Email Bank UI show a live iframe
// preview that updates as Jordan types or toggles checkboxes.
//
// Single source of truth: uses buildBrandedEmailHtml — same code path
// as /send. No drift possible.

const previewSchema = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
  includeAfterCallHeader: z.boolean().optional(),
  includeCapabilities: z.boolean().optional(),
  includeSecondaryDoc: z.boolean().optional(),
  includeBookACall: z.boolean().optional(),
  plainTextMode: z.boolean().optional(),
});

router.post('/:id/preview', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const overrides = previewSchema.parse(req.body);
    const db = getDb();

    const draft = db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id) as DraftRow | undefined;
    if (!draft) throw new ApiError(404, 'Email draft not found');

    const lead = db
      .prepare('SELECT name, company, category FROM leads WHERE id = ?')
      .get(draft.lead_id) as { name: string; company: string | null; category: string | null } | undefined;
    if (!lead) throw new ApiError(404, 'Lead not found');

    const user = req.user!;

    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value;
    const companyName = settings.company_name || 'OxyScale';
    const websiteUrl = settings.website_url || 'https://oxyscale.ai';

    const recipientName = lead.name.split(' ')[0] || 'there';
    const recipientCompany = lead.company || undefined;

    const signature = buildEmailSignature({
      sender_name: user.name,
      sender_title: user.title,
      sender_phone: user.phone,
      company_name: companyName,
      website_url: websiteUrl,
      calendly_link: user.calendlyLink,
    });

    // Apply overrides on top of the persisted draft state.
    const body = overrides.body ?? draft.body ?? '';
    const includeHeader = overrides.includeAfterCallHeader ?? !!draft.include_after_call_header;
    const includeCaps = overrides.includeCapabilities ?? !!draft.include_capabilities;
    const includeSecondary = overrides.includeSecondaryDoc ?? !!draft.include_secondary_doc;
    const includeBook = overrides.includeBookACall ?? !!draft.include_book_a_call;
    const plainMode = overrides.plainTextMode ?? !!draft.plain_text_mode;

    // Primary slot — recruitment-specific hook (info.oxyscale.ai by
    // default). Pulls per-category override if configured, otherwise
    // the universal default from settings.
    const categoryCta = lead.category ? getCategoryCta(lead.category) : null;
    const capabilitiesCta = includeCaps && categoryCta
      ? {
          url: categoryCta.url,
          label: categoryCta.label,
          intro: categoryCta.intro,
          kicker: 'Recruitment Capabilities',
        }
      : null;
    // Secondary slot — broad capabilities doc (details.oxyscale.ai by
    // default). Independent of category — same URL for every lead unless
    // Jordan changes the setting.
    const secondaryCfg = includeSecondary ? getSecondaryCta() : null;
    const secondaryCta = secondaryCfg
      ? {
          url: secondaryCfg.url,
          label: secondaryCfg.label,
          intro: secondaryCfg.intro,
          kicker: 'Capabilities Document',
        }
      : null;
    const renderParams = {
      body,
      recipientName,
      recipientCompany,
      senderName: user.name,
      // Sign-off comes from Settings > Email Preferences first (the
      // value Jordan can edit in the UI). Falls back to the per-user
      // seed value if the global setting isn't configured.
      signOff: settings.email_sign_off?.trim() || user.signOff || 'Kind regards',
      signature,
      mode: (includeHeader ? 'post-call' : 'standard') as 'post-call' | 'standard',
      capabilitiesCta,
      secondaryCta,
      // Book-a-call CTA block removed — the email signature already
      // contains a "Book a call" button linking to Calendly.
      bookACallUrl: null,
    };
    // Plain text mode strips the branded shell — just body + sig +
    // optional CTA. Branded mode is the full OxyScale-styled template.
    const html = plainMode
      ? buildPlainEmailHtml(renderParams)
      : buildBrandedEmailHtml(renderParams);

    res.json({ html });
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

    const lead = db
      .prepare('SELECT name, company, category FROM leads WHERE id = ?')
      .get(draft.lead_id) as { name: string; company: string | null; category: string | null } | undefined;
    const recipientName = lead?.name?.split(' ')[0] || 'there';
    const recipientCompany = lead?.company || undefined;

    const signature = buildEmailSignature({
      sender_name: user.name,
      sender_title: user.title,
      sender_phone: user.phone,
      company_name: companyName,
      website_url: websiteUrl,
      calendly_link: user.calendlyLink,
    });

    // Resolve CTA context from toggles. Primary capabilities slot =
    // recruitment hook (info.oxyscale.ai). Secondary slot = broad
    // capabilities doc (details.oxyscale.ai). Both can be on
    // independently. Book-a-call URL stays null — the email signature
    // already contains a Book-a-call button linking to Calendly.
    const categoryCta = lead?.category ? getCategoryCta(lead.category) : null;
    const capabilitiesCta = draft.include_capabilities && categoryCta
      ? {
          url: categoryCta.url,
          label: categoryCta.label,
          intro: categoryCta.intro,
          kicker: 'Recruitment Capabilities',
        }
      : null;
    const secondaryCfg = draft.include_secondary_doc ? getSecondaryCta() : null;
    const secondaryCta = secondaryCfg
      ? {
          url: secondaryCfg.url,
          label: secondaryCfg.label,
          intro: secondaryCfg.intro,
          kicker: 'Capabilities Document',
        }
      : null;
    const sendParams = {
      body: draft.body,
      recipientName,
      recipientCompany,
      senderName: user.name,
      // Sign-off comes from Settings > Email Preferences first (the
      // value Jordan can edit in the UI). Falls back to the per-user
      // seed value if the global setting isn't configured.
      signOff: settings.email_sign_off?.trim() || user.signOff || 'Kind regards',
      signature,
      mode: (draft.include_after_call_header ? 'post-call' : 'standard') as 'post-call' | 'standard',
      capabilitiesCta,
      secondaryCta,
      // Book-a-call CTA block removed — the email signature already
      // contains a "Book a call" button linking to Calendly.
      bookACallUrl: null,
    };
    // Plain text mode strips the branded shell — just body + sig +
    // optional CTA. Branded mode is the full OxyScale-styled template.
    const htmlBody = draft.plain_text_mode
      ? buildPlainEmailHtml(sendParams)
      : buildBrandedEmailHtml(sendParams);

    // Load attachments for this draft (if any)
    const attachmentRows = db.prepare(
      'SELECT filename, mime_type, content_base64 FROM draft_attachments WHERE draft_id = ?'
    ).all(id) as { filename: string; mime_type: string; content_base64: string }[];

    const emailAttachments = attachmentRows.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content_base64, 'base64'),
    }));

    const result = await sendEmail({
      to: draft.to_email,
      cc: draft.cc_email || undefined,
      subject: draft.subject,
      textBody: draft.body,
      htmlBody,
      fromName: user.name,
      fromAddress: user.senderEmail,
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
    });

    // Log sent email + activity + update pipeline stage + mark draft sent.
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO emails_sent (lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'dialler', 'sent', ?)
      `).run(draft.lead_id, draft.to_email, user.senderEmail, draft.subject, draft.body, result.messageId || null, now);

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at, created_by)
        VALUES (?, 'email', 'Email sent', ?, ?, ?)
      `).run(draft.lead_id, `To: ${draft.to_email} — ${draft.subject}`, now, user.name);

      // Pipeline stage management is manual — sending an email no longer
      // auto-moves the lead to a tier.

      // Mark draft sent
      db.prepare(
        "UPDATE email_drafts SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?",
      ).run(now, now, draft.id);
    })();

    logger.info({ draftId: id, leadId: draft.lead_id, messageId: result.messageId }, 'Email draft sent from bank');

    // Insert a copy into Gmail's Sent folder (non-blocking, non-fatal).
    // This lets Jordan see dialler-sent emails in his Gmail inbox.
    insertIntoGmailSent({
      from: `${user.name} <${user.senderEmail}>`,
      to: draft.to_email,
      cc: draft.cc_email || undefined,
      subject: draft.subject,
      textBody: draft.body,
      htmlBody,
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
    }).then((gmailCopyId) => {
      if (gmailCopyId) {
        // Store the Gmail message ID so gmail-sync skips this message
        try {
          db.prepare('UPDATE emails_sent SET gmail_copy_id = ? WHERE gmail_message_id = ? AND source = ?')
            .run(gmailCopyId, result.messageId, 'dialler');
        } catch (dbErr) {
          logger.warn({ dbErr }, 'Failed to store gmail_copy_id — dedup may log a duplicate');
        }
      }
    }).catch(() => { /* already logged inside insertIntoGmailSent */ });

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

// ── GET /api/email-drafts/:id/attachments — list attachments ──

router.get('/:id/attachments', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const db = getDb();
    const draft = db.prepare('SELECT id FROM email_drafts WHERE id = ?').get(id);
    if (!draft) throw new ApiError(404, 'Email draft not found');

    // Return metadata only — never send base64 content in list responses.
    const rows = db.prepare(
      'SELECT id, draft_id, filename, mime_type, size, created_at FROM draft_attachments WHERE draft_id = ? ORDER BY created_at ASC'
    ).all(id) as Array<{
      id: number; draft_id: number; filename: string;
      mime_type: string; size: number; created_at: string;
    }>;

    res.json(rows.map((r) => ({
      id: r.id,
      draftId: r.draft_id,
      filename: r.filename,
      mimeType: r.mime_type,
      size: r.size,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/email-drafts/:id/attachments — add attachment ───

const addAttachmentSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
});

router.post('/:id/attachments', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid draft ID');

    const payload = addAttachmentSchema.parse(req.body);
    const db = getDb();

    const draft = db.prepare('SELECT id, status FROM email_drafts WHERE id = ?').get(id) as { id: number; status: string } | undefined;
    if (!draft) throw new ApiError(404, 'Email draft not found');
    if (draft.status === 'sent') throw new ApiError(409, 'Cannot add attachments to a sent draft');

    const sizeBytes = Math.ceil(payload.contentBase64.length * 3 / 4);

    const result = db.prepare(`
      INSERT INTO draft_attachments (draft_id, filename, mime_type, size, content_base64)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, payload.filename, payload.mimeType, sizeBytes, payload.contentBase64);

    logger.info({ draftId: id, filename: payload.filename, size: sizeBytes }, 'Attachment added to draft');

    res.status(201).json({
      id: result.lastInsertRowid as number,
      draftId: id,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: sizeBytes,
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/email-drafts/:id/attachments/:attachmentId ────

router.delete('/:id/attachments/:attachmentId', (req, res, next) => {
  try {
    const draftId = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);
    if (isNaN(draftId) || isNaN(attachmentId)) throw new ApiError(400, 'Invalid ID');

    const db = getDb();

    const draft = db.prepare('SELECT status FROM email_drafts WHERE id = ?').get(draftId) as { status: string } | undefined;
    if (!draft) throw new ApiError(404, 'Email draft not found');
    if (draft.status === 'sent') throw new ApiError(409, 'Cannot remove attachments from a sent draft');

    const result = db.prepare(
      'DELETE FROM draft_attachments WHERE id = ? AND draft_id = ?'
    ).run(attachmentId, draftId);

    if (result.changes === 0) throw new ApiError(404, 'Attachment not found');

    logger.info({ draftId, attachmentId }, 'Attachment removed from draft');
    res.json({ success: true });
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
