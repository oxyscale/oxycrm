// ============================================================
// Leads Routes — /api/leads
// Handles lead CRUD, CSV import, disposition, and queue cycling
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Lead, CallLog, ImportResult, DispositionPayload, DuplicateLead, PipelineStage, Temperature } from '../../../shared/types.js';
import pino from 'pino';
// summariseAndPersistCall / draftAndStoreEmailForCall were used for the
// Whisper-on-Twilio-recording path. Manual transcript flow doesn't need them.

const logger = pino({ name: 'leads-routes' });
const router = Router();

// Multer setup — store uploaded CSV in memory.
// 10 MB cap so a hostile client cannot exhaust server RAM with a
// giant upload. A typical CSV with ~50k leads is well under 5 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ============================================================
// Row mappers — convert snake_case DB rows to camelCase types
// ============================================================

interface LeadRow {
  id: number;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  lead_type: string;
  category: string | null;
  status: string;
  unanswered_calls: number;
  voicemail_left: number;
  voicemail_date: string | null;
  consolidated_summary: string | null;
  company_info: string | null;
  monday_item_id: string | null;
  pipeline_stage: string | null;
  temperature: string | null;
  converted_to_project: number;
  follow_up_date: string | null;
  deal_value: number;
  manually_contacted: number;
  queue_position: number;
  last_called_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CallLogRow {
  id: number;
  lead_id: number;
  duration: number | null;
  transcript: string | null;
  summary: string | null;
  key_topics: string | null;
  action_items: string | null;
  sentiment: string | null;
  disposition: string;
  created_at: string;
}

/** Maps a raw DB lead row to the camelCase Lead type */
function mapLeadRow(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    website: row.website,
    leadType: row.lead_type as Lead['leadType'],
    category: row.category,
    status: row.status as Lead['status'],
    unansweredCalls: row.unanswered_calls,
    voicemailLeft: row.voicemail_left === 1,
    voicemailDate: row.voicemail_date,
    consolidatedSummary: row.consolidated_summary,
    companyInfo: row.company_info,
    mondayItemId: row.monday_item_id,
    pipelineStage: (row.pipeline_stage as PipelineStage | null) ?? null,
    temperature: (row.temperature as Temperature) ?? null,
    convertedToProject: row.converted_to_project === 1,
    followUpDate: row.follow_up_date,
    dealValue: row.deal_value ?? 0,
    manuallyContacted: row.manually_contacted === 1,
    queuePosition: row.queue_position,
    lastCalledAt: row.last_called_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Safely parse a JSON string, returning a fallback on failure */
function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Maps a raw DB call_log row to the camelCase CallLog type */
function mapCallLogRow(row: CallLogRow): CallLog {
  return {
    id: row.id,
    leadId: row.lead_id,
    duration: row.duration,
    transcript: row.transcript,
    summary: row.summary,
    keyTopics: safeJsonParse<string[]>(row.key_topics, []),
    actionItems: safeJsonParse<string[]>(row.action_items, []),
    sentiment: row.sentiment,
    disposition: row.disposition as CallLog['disposition'],
    createdAt: row.created_at,
  };
}

// ============================================================
// Validation schemas
// ============================================================

const dispositionSchema = z.object({
  leadId: z.number().int().positive(),
  disposition: z.enum(['no_answer', 'voicemail', 'not_interested', 'interested', 'wrong_number']),
  callDuration: z.number().int().min(0),
  transcript: z.string(),
  callbackDate: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'callbackDate must be a valid date string' }
  ).optional(),
  callbackNotes: z.string().optional(),
  followUpDate: z.string().nullable().optional(),
});

const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  temperature: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
  // null = no tier assigned; lead lives in Leads only, hidden from kanban.
  pipelineStage: z.enum(['pulse', 'tier_1', 'tier_2', 'tier_3', 'won', 'lost']).nullable().optional(),
});

const updateLeadSchema = z.object({
  status: z.enum(['not_called', 'called']).optional(),
  name: z.string().min(1).optional(),
  company: z.string().nullable().optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  consolidatedSummary: z.string().nullable().optional(),
  companyInfo: z.string().nullable().optional(),
  // null = no tier assigned; lead lives in Leads only, hidden from kanban.
  pipelineStage: z.enum(['pulse', 'tier_1', 'tier_2', 'tier_3', 'won', 'lost']).nullable().optional(),
  temperature: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
  followUpDate: z.string().nullable().optional(),
  dealValue: z.number().min(0).optional(),
  manuallyContacted: z.boolean().optional(),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/leads
 * Returns all leads, optionally filtered by status, leadType, or category.
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { status, leadType, category, contacted } = req.query;

    let query = 'SELECT * FROM leads WHERE 1=1';
    const params: Record<string, string> = {};

    if (status && typeof status === 'string') {
      query += ' AND status = @status';
      params.status = status;
    }
    if (leadType && typeof leadType === 'string') {
      query += ' AND lead_type = @leadType';
      params.leadType = leadType;
    }
    if (category && typeof category === 'string') {
      query += ' AND category = @category';
      params.category = category;
    }

    // Contacted filter: a lead is "contacted" if it has any notes,
    // emails, call logs, or tasks, OR if manually_contacted is set,
    // OR if the lead is in Pulse (pulse = spoken to by definition).
    if (contacted === 'true') {
      query += ` AND (
        leads.pipeline_stage = 'pulse'
        OR leads.manually_contacted = 1
        OR EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = leads.id)
        OR EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = leads.id)
        OR EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = leads.id)
        OR EXISTS (SELECT 1 FROM tasks WHERE tasks.lead_id = leads.id)
      )`;
    } else if (contacted === 'false') {
      // NULL-safe pulse check: pipeline_stage IS NULL OR != 'pulse'.
      // Plain `!= 'pulse'` evaluates to NULL for NULL-stage leads which
      // SQL treats as FALSE in WHERE — so leads with no tier (the
      // default for new leads) would silently fall out of this filter.
      query += ` AND (leads.pipeline_stage IS NULL OR leads.pipeline_stage != 'pulse')
        AND COALESCE(leads.manually_contacted, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = leads.id)
        AND NOT EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = leads.id)
        AND NOT EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = leads.id)
        AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.lead_id = leads.id)`;
    }

    query += ' ORDER BY queue_position ASC';

    const rows = db.prepare(query).all(params) as LeadRow[];
    const leads = rows.map(mapLeadRow);

    // Compute "contacted" flag for each lead so the frontend can
    // show a pill without making extra queries per lead.
    // Pulse leads are always contacted by definition.
    const contactedStmt = db.prepare(`
      SELECT CASE WHEN (
        ? = 1
        OR ? = 1
        OR EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = ?)
        OR EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = ?)
        OR EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = ?)
        OR EXISTS (SELECT 1 FROM tasks WHERE tasks.lead_id = ?)
      ) THEN 1 ELSE 0 END AS contacted
    `);

    for (const lead of leads) {
      const mc = lead.manuallyContacted ? 1 : 0;
      const isPulse = lead.pipelineStage === 'pulse' ? 1 : 0;
      const result = contactedStmt.get(mc, isPulse, lead.id, lead.id, lead.id, lead.id) as { contacted: number };
      lead.contacted = result.contacted === 1;
    }

    logger.info({ count: leads.length, filters: { status, leadType, category } }, 'Fetched leads');
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leads/categories
 * Returns a list of distinct categories from all leads.
 */
router.get('/categories', (req, res, next) => {
  try {
    const db = getDb();
    // Pull from the managed categories table (Settings > Categories).
    // Falls back to DISTINCT from leads if the table is empty, so
    // existing data isn't invisible before categories are set up.
    const managed = db.prepare(
      'SELECT name FROM categories ORDER BY name ASC'
    ).all() as { name: string }[];

    if (managed.length > 0) {
      res.json(managed.map((r) => r.name));
      return;
    }

    // Fallback: derive from existing lead data.
    const rows = db.prepare(
      "SELECT DISTINCT category FROM leads WHERE category IS NOT NULL AND category != '' ORDER BY category ASC"
    ).all() as { category: string }[];
    res.json(rows.map((r) => r.category));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/categories/rename
 * Bulk-renames a category. All leads where category = `from` are updated to category = `to`.
 * Useful for merging duplicates (e.g. "Styling" -> "Property Styling").
 * Body: { from: string, to: string }
 */
const renameCategorySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

router.post('/categories/rename', (req, res, next) => {
  try {
    const db = getDb();
    const { from, to } = renameCategorySchema.parse(req.body);

    const result = db.prepare(
      "UPDATE leads SET category = @to, updated_at = datetime('now') WHERE category = @from"
    ).run({ from, to });

    logger.info({ from, to, updated: result.changes }, 'Category renamed in bulk');
    res.json({ from, to, updated: result.changes });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/reset-pipeline
 * Bulk-clears leads from the kanban by setting pipeline_stage = NULL.
 * Won/Lost rows are preserved by default (they're completed deals).
 *
 * Body: { preserveWonLost?: boolean } — defaults to true.
 *
 * Returns { updated: number } so the UI can confirm what happened.
 *
 * Cleared leads still exist — they're visible in /leads, just hidden
 * from the kanban. Jordan re-places them via the lead profile tier
 * dropdown.
 */
const resetPipelineSchema = z.object({
  preserveWonLost: z.boolean().optional().default(true),
});

router.post('/reset-pipeline', (req, res, next) => {
  try {
    const db = getDb();
    const { preserveWonLost } = resetPipelineSchema.parse(req.body ?? {});

    // Pre-count what we're about to touch so we can return a useful number
    // even when nothing actually changes.
    const where = preserveWonLost
      ? "(pipeline_stage IS NULL OR pipeline_stage NOT IN ('won', 'lost'))"
      : '1=1';

    const beforeRow = db.prepare(
      `SELECT COUNT(*) AS n FROM leads WHERE ${where}`
    ).get() as { n: number };

    // Only touch rows that actually have a stage — NULL ones are already cleared.
    const result = db.prepare(
      `UPDATE leads
       SET pipeline_stage = NULL,
           updated_at = datetime('now')
       WHERE ${where}
         AND pipeline_stage IS NOT NULL`
    ).run();

    logger.info(
      { affected: result.changes, preserveWonLost, eligible: beforeRow.n },
      'Pipeline bulk reset (set NULL)',
    );

    res.json({
      updated: result.changes,
      eligible: beforeRow.n,
      preserveWonLost,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/undo-import
 *
 * Accepts the SAME CSV used in a previous import and deletes every
 * lead whose phone matches one in the file. Use case: Jordan dumps a
 * 1000-row Apify scrape into the CRM, decides it's mostly junk, wants
 * the whole batch gone. He re-uploads the original CSV; we match by
 * phone (last 9 digits, country-code normalised) and delete.
 *
 * Two modes via `?dryRun=true`:
 *   - dryRun: returns matched count + a sample of names, no deletion.
 *   - real:   deletes matching leads (cascades via FK).
 *
 * Returns { matched, deleted, sample[] } so the UI can preview the
 * impact before committing.
 */
router.post('/undo-import', upload.single('file'), (req, res, next) => {
  try {
    const db = getDb();
    if (!req.file) {
      throw new ApiError(400, 'No CSV file uploaded');
    }

    const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';

    // Same parse pipeline as the main importer — strip BOM, parse CSV,
    // normalise headers to snake_case.
    const csvContent = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    let records: Record<string, string>[];
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (csvErr) {
      logger.error({ err: csvErr }, 'Undo-import CSV parse failed');
      throw new ApiError(400, 'Invalid CSV format');
    }

    records = records.map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const snake = k.trim()
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .toLowerCase()
          .replace(/[\s-]+/g, '_');
        out[snake] = v;
      }
      return out;
    });

    // Build two match sets from the CSV:
    //   - phoneKeys: last 9 digits of every populated phone column.
    //     Country-code-agnostic (+61 / 0 / no-prefix all collapse).
    //   - nameKeys: lowercased trimmed business name for rows with NO
    //     usable phone. Catches Apify scrape rows that came in with just
    //     a name + address (no phone) and would otherwise be invisible
    //     to a phone-only match.
    const phoneKeys = new Set<string>();
    const nameKeys = new Set<string>();
    for (const row of records) {
      const rawPhone = (
        row.phone
        || row.phone_unformatted
        || row.phone_number
        || row.phonenumber
        || row.mobile
        || row.mobile_number
        || row.mobile_phone
        || row.tel
        || row.contact_number
        || row.contact_phone
        || row.cell
        || row.cell_phone
        || ''
      );
      const digits = String(rawPhone).replace(/\D/g, '');
      if (digits.length >= 9) {
        phoneKeys.add(digits.slice(-9));
        continue; // phone is the stronger signal — don't dilute name set
      }

      // Phone unusable. Fall back to the row's name field (same alias
      // ladder the importer uses). Skips rows with no usable name too.
      const rawName = (
        row.name
        || row.title
        || row.business_name
        || row.contact_name
        || row.contact
        || row.lead
        || row.lead_name
        || row.full_name
        || row.fullname
        || row.client
        || row.client_name
        || row.person
        || row.prospect
        || row.who
        || ''
      );
      const nameKey = String(rawName).trim().toLowerCase();
      if (nameKey.length >= 2) {
        nameKeys.add(nameKey);
      }
    }

    if (phoneKeys.size === 0 && nameKeys.size === 0) {
      throw new ApiError(
        400,
        'Couldn\'t find any phone numbers or names in the CSV to match against. Nothing to undo.',
      );
    }

    // Build the same normalised key for every existing lead and find
    // those whose key is in the CSV's set. Each match is then classified
    // as DELETABLE (untouched scrape row — safe to remove) or PROTECTED
    // (has been worked since import — leave it alone). The protection
    // rules are intentionally broad: any sign Jordan has done ANYTHING
    // with the lead means it stays. This is the safety net so re-uploading
    // a CSV can never accidentally wipe a real client whose phone happens
    // to be in the file.
    // Pull EVERY lead — not just phone-bearing ones — so the name-key
    // fallback can catch no-phone scrape rows.
    const allLeads = db.prepare(`
      SELECT
        l.id,
        l.name,
        l.phone,
        l.pipeline_stage,
        l.manually_contacted,
        l.consolidated_summary,
        l.deal_value,
        (SELECT COUNT(*) FROM notes        WHERE notes.lead_id        = l.id) AS notes_count,
        (SELECT COUNT(*) FROM tasks        WHERE tasks.lead_id        = l.id) AS tasks_count,
        (SELECT COUNT(*) FROM call_logs    WHERE call_logs.lead_id    = l.id) AS calls_count,
        (SELECT COUNT(*) FROM emails_sent  WHERE emails_sent.lead_id  = l.id) AS emails_count,
        (SELECT COUNT(*) FROM activities   WHERE activities.lead_id   = l.id) AS activities_count
      FROM leads l
    `).all() as {
      id: number; name: string; phone: string;
      pipeline_stage: string | null;
      manually_contacted: number;
      consolidated_summary: string | null;
      deal_value: number;
      notes_count: number; tasks_count: number; calls_count: number;
      emails_count: number; activities_count: number;
    }[];

    interface MatchRow {
      id: number; name: string; phone: string;
      protectedReason: string | null;
    }

    function protectionReason(lead: typeof allLeads[number]): string | null {
      // Lead is in any pipeline tier = intentional placement by Jordan.
      if (lead.pipeline_stage !== null) {
        return `In ${lead.pipeline_stage.replace('_', ' ')}`;
      }
      if (lead.manually_contacted === 1) return 'Marked contacted';
      if (lead.deal_value > 0) return `Has deal value $${lead.deal_value}`;
      if (lead.consolidated_summary && lead.consolidated_summary.trim().length > 0) {
        return 'Has consolidated summary';
      }
      if (lead.notes_count > 0)      return `${lead.notes_count} note(s)`;
      if (lead.tasks_count > 0)      return `${lead.tasks_count} task(s)`;
      if (lead.calls_count > 0)      return `${lead.calls_count} call log(s)`;
      if (lead.emails_count > 0)     return `${lead.emails_count} email(s)`;
      if (lead.activities_count > 0) return `${lead.activities_count} activity row(s)`;
      return null;
    }

    const deletable: MatchRow[] = [];
    const protectedRows: MatchRow[] = [];
    const seenIds = new Set<number>();

    function classify(lead: typeof allLeads[number]) {
      if (seenIds.has(lead.id)) return;
      seenIds.add(lead.id);
      const reason = protectionReason(lead);
      const row: MatchRow = {
        id: lead.id, name: lead.name, phone: lead.phone, protectedReason: reason,
      };
      if (reason) protectedRows.push(row);
      else deletable.push(row);
    }

    for (const lead of allLeads) {
      // Try phone match first (strongest signal).
      const phone = lead.phone || '';
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 9 && phoneKeys.has(digits.slice(-9))) {
        classify(lead);
        continue;
      }
      // Fallback: name match for leads whose CSV row didn't have a phone.
      // Lowercased + trimmed, must be >=2 chars to avoid silly matches.
      const nameKey = (lead.name || '').trim().toLowerCase();
      if (nameKey.length >= 2 && nameKeys.has(nameKey)) {
        classify(lead);
      }
    }

    const matched = deletable.length + protectedRows.length;

    if (dryRun) {
      logger.info(
        { csvRows: records.length, csvPhones: phoneKeys.size, matched, deletable: deletable.length, protected: protectedRows.length },
        'Undo-import dry-run',
      );
      res.json({
        dryRun: true,
        csvRows: records.length,
        csvPhonesFound: phoneKeys.size,
        matched,
        protected: protectedRows.length,
        toDelete: deletable.length,
        deleted: 0,
        sample: deletable.slice(0, 20).map((m) => ({ id: m.id, name: m.name, phone: m.phone })),
        protectedSample: protectedRows.slice(0, 10).map((m) => ({
          id: m.id, name: m.name, phone: m.phone, reason: m.protectedReason,
        })),
      });
      return;
    }

    // Real deletion — ONLY the deletable set. Protected rows never go
    // near the DELETE statement, so even a malformed match list can't
    // touch them. ON DELETE CASCADE handles call_logs/notes/etc on the
    // deletable rows.
    const deleteStmt = db.prepare('DELETE FROM leads WHERE id = ?');
    let deleted = 0;
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) {
        const r = deleteStmt.run(id);
        deleted += r.changes;
      }
    });
    tx(deletable.map((m) => m.id));

    logger.info(
      { csvRows: records.length, matched, deleted, protected: protectedRows.length },
      'Undo-import complete',
    );
    res.json({
      dryRun: false,
      csvRows: records.length,
      csvPhonesFound: phoneKeys.size,
      matched,
      protected: protectedRows.length,
      toDelete: deletable.length,
      deleted,
      sample: deletable.slice(0, 20).map((m) => ({ id: m.id, name: m.name, phone: m.phone })),
      protectedSample: protectedRows.slice(0, 10).map((m) => ({
        id: m.id, name: m.name, phone: m.phone, reason: m.protectedReason,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/sanitize-categories
 *
 * Sets `category = NULL` on every lead whose category isn't in the
 * managed `categories` table (case-insensitive). Cleans up junk
 * categories injected by raw CSV / Apify imports so the Leads page
 * dropdown can stay limited to Jordan's curated list.
 *
 * Idempotent. Returns the number of rows cleaned.
 */
router.post('/sanitize-categories', (_req, res, next) => {
  try {
    const db = getDb();

    const managed = db.prepare('SELECT name FROM categories').all() as { name: string }[];
    if (managed.length === 0) {
      throw new ApiError(400, 'No managed categories exist — add at least one in Settings first');
    }

    // Build a case-insensitive set of valid category names.
    const valid = new Set(managed.map((r) => r.name.toLowerCase()));

    // SQLite has no SETOF in WHERE — pull candidate rows into JS, filter,
    // then null out the affected ones in a single transaction.
    const candidates = db.prepare(
      "SELECT id, category FROM leads WHERE category IS NOT NULL AND category != ''",
    ).all() as { id: number; category: string }[];

    const toClean = candidates.filter((l) => !valid.has(l.category.toLowerCase()));

    if (toClean.length === 0) {
      logger.info('Category sanitisation: nothing to clean');
      res.json({ cleaned: 0 });
      return;
    }

    const cleanStmt = db.prepare(
      "UPDATE leads SET category = NULL, updated_at = datetime('now') WHERE id = ?",
    );
    const tx = db.transaction((ids: number[]) => {
      let n = 0;
      for (const id of ids) {
        const r = cleanStmt.run(id);
        n += r.changes;
      }
      return n;
    });
    const cleaned = tx(toClean.map((l) => l.id));

    logger.info({ cleaned, sampleSkipped: toClean.slice(0, 5).map((l) => l.category) }, 'Unmanaged categories nulled out');
    res.json({ cleaned });
  } catch (err) {
    next(err);
  }
});

// POST /api/leads/delete-all — REMOVED.
// Wiping every lead at once is pure footgun, no realistic use case on a
// production CRM with real contacts. Removed at Jordan's request.

/**
 * POST /api/leads/dedupe
 * Finds and merges duplicate leads.
 *
 * Strategy:
 *   - Group by normalised phone number when phone is present.
 *   - Group by lowercased name+company when phone is missing/empty.
 *   - In each group with >1 lead, pick a survivor (most call_logs, then oldest).
 *   - Reassign all child rows (call_logs, notes, activities, emails_sent,
 *     callbacks, projects) to the survivor, then delete the duplicates.
 *
 * Body: { dryRun?: boolean } — defaults to false. When true, returns the
 *       groups that WOULD be merged without changing any data.
 */
const dedupeSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

interface DedupeGroupRow {
  group_key: string;
  ids: string;
  names: string;
  phones: string;
}

router.post('/dedupe', (req, res, next) => {
  try {
    const db = getDb();
    const { dryRun } = dedupeSchema.parse(req.body || {});

    // Normalise every phone in JS: strip non-digits, then take the last 9 digits
    // (AU mobiles are 9 digits after the leading 0 / +61, so this collapses
    //  +61 409 136 833, 0409 136 833, 61409136833 etc to the same key).
    const allLeads = db.prepare(`
      SELECT id, name, COALESCE(company, '') AS company, COALESCE(phone, '') AS phone
      FROM leads
    `).all() as { id: number; name: string; company: string; phone: string }[];

    const buckets = new Map<string, { ids: number[]; names: string[]; phones: string[] }>();
    for (const lead of allLeads) {
      const digits = (lead.phone || '').replace(/\D/g, '');
      let key: string;
      if (digits.length >= 9) {
        key = `phone:${digits.slice(-9)}`;
      } else {
        // No usable phone — fall back to name+company match
        const name = (lead.name || '').trim().toLowerCase();
        const company = (lead.company || '').trim().toLowerCase();
        if (!name) continue; // nothing to match on
        key = `name:${name}|${company}`;
      }
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { ids: [], names: [], phones: [] };
        buckets.set(key, bucket);
      }
      bucket.ids.push(lead.id);
      bucket.names.push(lead.name);
      bucket.phones.push(lead.phone);
    }

    // Convert to the Plan-input shape and keep only groups with >1 lead.
    const allGroups: DedupeGroupRow[] = Array.from(buckets.entries())
      .filter(([, b]) => b.ids.length > 1)
      .map(([key, b]) => ({
        group_key: key,
        ids: b.ids.join(','),
        names: b.names.join('||'),
        phones: b.phones.join('||'),
      }));

    // ── Pass 3: business-name-as-name duplicates ──────────────
    // CSV / scrape imports often put the BUSINESS NAME in the `name`
    // field when there's no individual contact. So you end up with
    // "Method Recruitment" / "Method Recruitment" alongside the real
    // person "Kate Shute" / "Method Recruitment" at the same company.
    // The phone numbers differ (one's a head-office, one's Kate's
    // mobile), so the existing phone-key pass misses them.
    //
    // Strategy per company:
    //   - Find ungrouped leads where name == company (business-only)
    //   - Find the SINGLE best ungrouped real-person lead at the same
    //     company (highest activity score, tie-break by oldest)
    //   - Group all the biz-only leads with that one real person — so
    //     the biz duplicate folds INTO the real person on merge
    //   - If there's no real person, group the biz-only leads together
    //   - Importantly: we never pull >1 real person into a group, so
    //     two genuine contacts at the same company never get merged
    //     against each other
    const alreadyGroupedIds = new Set<number>();
    for (const g of allGroups) {
      for (const id of g.ids.split(',').map((s) => parseInt(s, 10))) {
        if (!isNaN(id)) alreadyGroupedIds.add(id);
      }
    }

    interface AllLeadInfo { id: number; name: string; company: string }
    const ungrouped: AllLeadInfo[] = allLeads
      .filter((l) => !alreadyGroupedIds.has(l.id))
      .map((l) => ({
        id: l.id,
        name: (l.name || '').trim(),
        company: (l.company || '').trim(),
      }));

    // Index ungrouped leads by their company (case-insensitive).
    const byCompany = new Map<string, { biz: AllLeadInfo[]; people: AllLeadInfo[] }>();
    for (const l of ungrouped) {
      if (!l.company) continue;
      const ck = l.company.toLowerCase();
      let entry = byCompany.get(ck);
      if (!entry) {
        entry = { biz: [], people: [] };
        byCompany.set(ck, entry);
      }
      if (l.name && l.name.toLowerCase() === ck) {
        entry.biz.push(l);
      } else if (l.name) {
        entry.people.push(l);
      }
    }

    // Lightweight activity-score query — same shape as pickSurvivor below.
    const scoreLead = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM notes WHERE lead_id = @id)
        + (SELECT COUNT(*) FROM tasks WHERE lead_id = @id)
        + (SELECT COUNT(*) FROM emails_sent WHERE lead_id = @id)
        + (SELECT COUNT(*) FROM call_logs WHERE lead_id = @id)
        + (SELECT COUNT(*) FROM activities WHERE lead_id = @id) AS score
    `);

    for (const [companyKey, { biz, people }] of byCompany.entries()) {
      if (biz.length === 0) continue;

      // Pick at most ONE real person to receive the biz dupes. Score
      // them, pick the highest. Oldest id tie-break.
      let target: AllLeadInfo | null = null;
      if (people.length > 0) {
        let bestScore = -1;
        for (const p of people) {
          const row = scoreLead.get({ id: p.id }) as { score: number } | undefined;
          const s = row?.score ?? 0;
          if (s > bestScore || (s === bestScore && target && p.id < target.id)) {
            bestScore = s;
            target = p;
          }
          if (target === null) target = p; // seed
        }
      }

      const groupIds: number[] = [...biz.map((b) => b.id)];
      const groupNames: string[] = [...biz.map((b) => b.name)];
      if (target) {
        groupIds.push(target.id);
        groupNames.push(target.name);
      }

      // Only push if it's an actual duplicate (>1 lead in group)
      if (groupIds.length > 1) {
        allGroups.push({
          group_key: `biz:${companyKey}`,
          ids: groupIds.join(','),
          names: groupNames.join('||'),
          phones: '',
        });
      }
    }

    // For each group, pick the survivor: lead with the HIGHEST total
    // activity across notes + tasks + emails + call_logs + activity rows.
    // This protects rich leads — a row with lots of notes but no calls
    // beats a row with one call and nothing else. Manually_contacted +
    // pulse stage count as 1 point each so an explicit "I've touched
    // this" beats a blank duplicate.
    // Ties broken by oldest id (most established record).
    interface Plan {
      groupKey: string;
      survivorId: number;
      survivorScore: number;
      duplicateIds: number[];
      sample: { name: string; phone: string };
    }

    const pickSurvivor = db.prepare(`
      SELECT l.id,
        (
          (SELECT COUNT(*) FROM notes WHERE lead_id = l.id)
          + (SELECT COUNT(*) FROM tasks WHERE lead_id = l.id)
          + (SELECT COUNT(*) FROM emails_sent WHERE lead_id = l.id)
          + (SELECT COUNT(*) FROM call_logs WHERE lead_id = l.id)
          + (SELECT COUNT(*) FROM activities WHERE lead_id = l.id)
          + CASE WHEN l.manually_contacted = 1 THEN 1 ELSE 0 END
          + CASE WHEN l.pipeline_stage = 'pulse' THEN 1 ELSE 0 END
          + CASE WHEN l.deal_value > 0 THEN 1 ELSE 0 END
          + CASE WHEN l.consolidated_summary IS NOT NULL AND l.consolidated_summary != '' THEN 1 ELSE 0 END
        ) AS score
      FROM leads l
      WHERE l.id IN (SELECT value FROM json_each(@ids))
      ORDER BY score DESC, l.id ASC
      LIMIT 1
    `);

    const plans: Plan[] = allGroups.map((g) => {
      const ids = g.ids.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
      const survivor = pickSurvivor.get({ ids: JSON.stringify(ids) }) as { id: number; score: number } | undefined;
      const survivorId = survivor?.id ?? ids[0];
      const survivorScore = survivor?.score ?? 0;
      const duplicateIds = ids.filter((id) => id !== survivorId);
      const firstName = g.names.split('||')[0] || '';
      const firstPhone = g.phones.split('||')[0] || '';
      return {
        groupKey: g.group_key,
        survivorId,
        survivorScore,
        duplicateIds,
        sample: { name: firstName, phone: firstPhone },
      };
    });

    if (dryRun) {
      const totalDuplicates = plans.reduce((sum, p) => sum + p.duplicateIds.length, 0);
      logger.info({ groups: plans.length, totalDuplicates }, 'Dedupe dry-run');
      res.json({
        dryRun: true,
        groups: plans.length,
        totalDuplicatesToDelete: totalDuplicates,
        plans: plans.slice(0, 50), // cap response size
      });
      return;
    }

    // Execute the merge in a single transaction. For each plan: reassign all
    // FK children to survivor, then delete duplicates.
    const reassignAndDelete = db.transaction((planList: Plan[]) => {
      const tables = ['call_logs', 'notes', 'activities', 'emails_sent', 'callbacks', 'projects'];
      let leadsDeleted = 0;
      let rowsReassigned = 0;

      for (const plan of planList) {
        for (const dupId of plan.duplicateIds) {
          for (const table of tables) {
            const r = db.prepare(`UPDATE ${table} SET lead_id = ? WHERE lead_id = ?`)
              .run(plan.survivorId, dupId);
            rowsReassigned += r.changes;
          }
          const del = db.prepare('DELETE FROM leads WHERE id = ?').run(dupId);
          leadsDeleted += del.changes;
        }
      }

      return { leadsDeleted, rowsReassigned };
    });

    const { leadsDeleted, rowsReassigned } = reassignAndDelete(plans);

    logger.info(
      { groups: plans.length, leadsDeleted, rowsReassigned },
      'Dedupe complete'
    );
    res.json({
      dryRun: false,
      groups: plans.length,
      leadsDeleted,
      rowsReassigned,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leads/search
 * Searches for leads by phone number (partial match) OR by general text query.
 *
 * Query params:
 *   phone — search by phone number (partial match, existing behaviour)
 *   q     — general text search across name, company, phone, email
 *
 * At least one of `phone` or `q` must be provided.
 * Returns matching leads with their last call log.
 */
router.get('/search', (req, res, next) => {
  try {
    const db = getDb();
    const { phone, q } = req.query;

    // General text search takes priority when provided
    if (q && typeof q === 'string' && q.trim().length >= 2) {
      const searchTerm = `%${q.trim()}%`;

      const rows = db.prepare(`
        SELECT * FROM leads
        WHERE name LIKE @term COLLATE NOCASE
          OR company LIKE @term COLLATE NOCASE
          OR phone LIKE @term
          OR email LIKE @term COLLATE NOCASE
        ORDER BY updated_at DESC
        LIMIT 20
      `).all({ term: searchTerm }) as LeadRow[];

      const results = rows.map((row) => {
        const lead = mapLeadRow(row);
        const lastLog = db.prepare(
          'SELECT * FROM call_logs WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(row.id) as CallLogRow | undefined;

        return {
          ...lead,
          lastCallLog: lastLog ? mapCallLogRow(lastLog) : null,
        };
      });

      logger.info({ query: q.trim(), matches: results.length }, 'Lead text search');
      res.json(results);
      return;
    }

    // Fall back to phone-only search (existing behaviour)
    if (!phone || typeof phone !== 'string' || phone.length < 3) {
      throw new ApiError(400, 'Provide a "q" param (min 2 chars) or a "phone" param (min 3 chars)');
    }

    // Strip non-digit characters and validate
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    if (cleanPhone.length < 3) {
      throw new ApiError(400, 'Phone query must contain at least 3 digits');
    }
    // Escape SQL LIKE wildcards in user input. Without this, an attacker
    // could pass "%" or "_" to enumerate phone numbers via LIKE patterns.
    const sanitized = cleanPhone.replace(/[%_]/g, '');

    // Search by phone number (partial match from the end — handles country code differences)
    const rows = db.prepare(`
      SELECT * FROM leads
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE @pattern
      ORDER BY updated_at DESC
      LIMIT 10
    `).all({ pattern: `%${sanitized}%` }) as LeadRow[];

    // For each matching lead, get their latest call log
    const results = rows.map((row) => {
      const lead = mapLeadRow(row);
      const lastLog = db.prepare(
        'SELECT * FROM call_logs WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(row.id) as CallLogRow | undefined;

      return {
        ...lead,
        lastCallLog: lastLog ? mapCallLogRow(lastLog) : null,
      };
    });

    logger.info({ phone: cleanPhone, matches: results.length }, 'Lead phone search');
    res.json(results);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leads/:id
 * Returns a single lead by ID, including call history, notes count, call count, and latest activity.
 */
router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      // Non-numeric path segment — fall through to the next matching
      // route. This is what lets later routes like /duplicate-flags
      // work even though they're declared after this generic /:id
      // handler in the file. Without this, "duplicate-flags" gets
      // parsed as an id, isNaN catches it, the previous code threw 400
      // and the client silently failed to fetch the flags.
      return next();
    }

    const db = getDb();

    const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
    if (!leadRow) {
      throw new ApiError(404, 'Lead not found');
    }

    const callLogRows = db
      .prepare('SELECT * FROM call_logs WHERE lead_id = ? ORDER BY created_at DESC')
      .all(id) as CallLogRow[];

    // Notes count
    const notesCountRow = db.prepare(
      'SELECT COUNT(*) AS count FROM notes WHERE lead_id = ?'
    ).get(id) as { count: number };

    // Call count
    const callCountRow = db.prepare(
      'SELECT COUNT(*) AS count FROM call_logs WHERE lead_id = ?'
    ).get(id) as { count: number };

    // Latest activity
    const latestActivity = db.prepare(
      'SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(id) as { id: number; lead_id: number; type: string; title: string; description: string | null; metadata: string | null; created_at: string } | undefined;

    const lead = mapLeadRow(leadRow);
    const callLogs = callLogRows.map(mapCallLogRow);

    // Compute contacted flag (includes manual override + pulse = always contacted)
    const contactedResult = db.prepare(`
      SELECT CASE WHEN (
        ? = 1
        OR ? = 1
        OR EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = ?)
        OR EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = ?)
        OR EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = ?)
        OR EXISTS (SELECT 1 FROM tasks WHERE tasks.lead_id = ?)
      ) THEN 1 ELSE 0 END AS contacted
    `).get(lead.manuallyContacted ? 1 : 0, lead.pipelineStage === 'pulse' ? 1 : 0, id, id, id, id) as { contacted: number };
    lead.contacted = contactedResult.contacted === 1;

    res.json({
      ...lead,
      callLogs,
      notesCount: notesCountRow.count,
      callCount: callCountRow.count,
      latestActivity: latestActivity
        ? {
            id: latestActivity.id,
            leadId: latestActivity.lead_id,
            type: latestActivity.type,
            title: latestActivity.title,
            description: latestActivity.description,
            metadata: latestActivity.metadata,
            createdAt: latestActivity.created_at,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads
 * Creates a single lead directly (not via CSV).
 */
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const payload = createLeadSchema.parse(req.body);
    const now = new Date().toISOString();

    // Category required and must already exist in the managed list. No
    // more inline category creation — keeps the managed list curated.
    if (!payload.category || !payload.category.trim()) {
      throw new ApiError(400, 'Category is required. Pick one from Settings > Categories.');
    }
    const categoryRow = db.prepare(
      'SELECT name FROM categories WHERE LOWER(name) = LOWER(?)',
    ).get(payload.category.trim()) as { name: string } | undefined;
    if (!categoryRow) {
      throw new ApiError(
        400,
        `Category "${payload.category}" doesn't exist. Add it in Settings > Categories first.`,
      );
    }
    // Normalise to the canonical capitalisation from the managed list
    // (case-insensitive match means user could type "recruitment" and we
    // want it stored as "Recruitment").
    const canonicalCategory = categoryRow.name;

    const createLead = db.transaction(() => {
      // Get next queue position
      const maxPosRow = db.prepare(
        'SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads'
      ).get() as { max_pos: number };

      const result = db.prepare(`
        INSERT INTO leads (name, phone, company, email, website, category, lead_type, status, pipeline_stage, temperature, queue_position, created_at, updated_at)
        VALUES (@name, @phone, @company, @email, @website, @category, 'new', 'not_called', @pipelineStage, @temperature, @queuePosition, @now, @now)
      `).run({
        name: payload.name,
        phone: payload.phone || '',
        company: payload.company ?? null,
        email: payload.email ?? null,
        website: payload.website ?? null,
        category: canonicalCategory,
        // null = no tier yet. Jordan places leads into a tier manually
        // from the lead profile dropdown.
        pipelineStage: payload.pipelineStage ?? null,
        temperature: payload.temperature ?? null,
        queuePosition: maxPosRow.max_pos + 1,
        now,
      });

      const leadId = result.lastInsertRowid as number;

      // Run dup detection against the rest of the lead book — same logic
      // as the CSV importer, applied per-row to manually-created leads.
      // Any match shows up as a pill on /leads.
      const existingForDup = db.prepare(`
        SELECT l.id, l.name, COALESCE(l.company, '') AS company,
               COALESCE(l.phone, '') AS phone, l.email, l.website,
               l.pipeline_stage, l.manually_contacted,
               l.consolidated_summary, l.deal_value,
               0 AS notes_count, 0 AS tasks_count, 0 AS calls_count,
               0 AS emails_count, 0 AS activities_count
        FROM leads l
        WHERE l.id != ?
      `).all(leadId) as ScanLead[];

      const newLead: ScanLead = {
        id: leadId,
        name: payload.name,
        company: payload.company ?? '',
        phone: payload.phone || '',
        email: payload.email ?? null,
        website: payload.website ?? null,
        pipeline_stage: payload.pipelineStage ?? null,
        manually_contacted: 0,
        consolidated_summary: null,
        deal_value: 0,
        notes_count: 0, tasks_count: 0, calls_count: 0,
        emails_count: 0, activities_count: 0,
      };

      const insertFlag = db.prepare(`
        INSERT INTO duplicate_flags
          (suspect_lead_id, target_lead_id, confidence, reasons, detected_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT (suspect_lead_id, target_lead_id) DO NOTHING
      `);

      for (const existing of existingForDup) {
        const match = matchPair(newLead, existing);
        if (!match) continue;
        insertFlag.run(leadId, existing.id, match.confidence, JSON.stringify(match.reasons));
      }

      // Create activity record. Attribution captured so the activity
      // feed can show who added the lead.
      const actor = req.user?.name || null;
      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at, created_by)
        VALUES (?, 'stage_change', 'Lead created', ?, ?, ?)
      `).run(leadId, payload.company ? `${payload.name} at ${payload.company}` : payload.name, now, actor);

      return leadId;
    });

    const leadId = createLead();

    const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow;
    const lead = mapLeadRow(leadRow);

    logger.info({ leadId: lead.id, name: lead.name }, 'Lead created');
    res.status(201).json(lead);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/import
 * Accepts a CSV file upload and imports leads into the database.
 * CSV must have columns: name, company, phone, email, category
 * Also accepts a `leadType` field in the body ('new' or 'callback').
 */
router.post('/import', upload.single('file'), (req, res, next) => {
  try {
    const db = getDb();

    if (!req.file) {
      throw new ApiError(400, 'No CSV file uploaded');
    }

    const leadType = (req.body.leadType as string) || 'new';
    if (leadType !== 'new' && leadType !== 'callback') {
      throw new ApiError(400, 'leadType must be "new" or "callback"');
    }

    // Category is REQUIRED on every import and must already exist in the
    // managed categories list. No more inline category creation — Jordan
    // wants categories created up-front in Settings > Categories, so the
    // managed list stays curated and the dropdown stays clean.
    const categoryOverride = (req.body.category as string)?.trim() || null;
    if (!categoryOverride) {
      throw new ApiError(400, 'Category is required. Pick one from Settings > Categories.');
    }
    const categoryExists = db.prepare(
      'SELECT 1 FROM categories WHERE LOWER(name) = LOWER(?)',
    ).get(categoryOverride) as { 1: number } | undefined;
    if (!categoryExists) {
      throw new ApiError(
        400,
        `Category "${categoryOverride}" doesn't exist. Add it in Settings > Categories first, then re-upload.`,
      );
    }

    // Parse the CSV from the uploaded buffer, stripping BOM if present
    const csvContent = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    let records: Record<string, string>[];

    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (csvErr) {
      logger.error({ err: csvErr }, 'CSV parse failed');
      throw new ApiError(400, 'Invalid CSV format');
    }

    // Normalise column headers to snake_case so "Name", "Phone Number",
    // "categoryName" (Apify camelCase) etc. all map to the same lookup
    // keys. Order matters: split camelCase BEFORE lowercasing.
    records = records.map((row) => {
      const normalised: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        const snake = key
          .trim()
          // Insert _ at every camelCase boundary: "categoryName" -> "category_Name"
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          // Then lowercase + collapse any whitespace / dashes to _
          .toLowerCase()
          .replace(/[\s-]+/g, '_');
        normalised[snake] = value;
      }
      return normalised;
    });

    logger.info({ rowCount: records.length, sampleKeys: records[0] ? Object.keys(records[0]) : [] }, 'CSV parsed');

    const result: ImportResult = { imported: 0, skipped: 0, duplicates: 0, errors: [] };
    const duplicateLeads: DuplicateLead[] = [];

    const insertStmt = db.prepare(`
      INSERT INTO leads (name, company, phone, email, website, lead_type, category, status, queue_position)
      VALUES (@name, @company, @phone, @email, @website, @leadType, @category, 'not_called', @queuePosition)
    `);

    // Prepared statement for checking duplicates by phone number
    const findDuplicateStmt = db.prepare(`
      SELECT l.*, COUNT(cl.id) as call_count
      FROM leads l
      LEFT JOIN call_logs cl ON cl.lead_id = l.id
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(l.phone, ' ', ''), '-', ''), '(', ''), ')', '')
        = REPLACE(REPLACE(REPLACE(REPLACE(@phone, ' ', ''), '-', ''), '(', ''), ')', '')
      GROUP BY l.id
      LIMIT 1
    `);

    // Pre-build a snapshot of every existing lead BEFORE the import
    // transaction starts. This is the dup-detection corpus: any newly-
    // inserted row gets checked against this snapshot, and if a match
    // fires a flag pill appears on the Leads page. The new rows
    // themselves are NOT checked against each other — within-CSV dups
    // are a separate concern (use Undo to remove the whole batch if
    // the scrape was bad).
    const existingLeadsForDup = db.prepare(`
      SELECT l.id, l.name, COALESCE(l.company, '') AS company,
             COALESCE(l.phone, '') AS phone, l.email, l.website,
             l.pipeline_stage, l.manually_contacted,
             l.consolidated_summary, l.deal_value,
             0 AS notes_count, 0 AS tasks_count, 0 AS calls_count,
             0 AS emails_count, 0 AS activities_count
      FROM leads l
    `).all() as ScanLead[];

    const insertFlagStmt = db.prepare(`
      INSERT INTO duplicate_flags
        (suspect_lead_id, target_lead_id, confidence, reasons, detected_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT (suspect_lead_id, target_lead_id) DO NOTHING
    `);

    let flagsInserted = 0;

    // Use a transaction for bulk insert performance and position consistency
    const insertAll = db.transaction(() => {
      // Read max position inside transaction to prevent duplicate positions
      const maxPosRow = db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number };
      let currentPos = maxPosRow.max_pos;

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        // Support a wide range of CSV column-name conventions. Headers
        // are already lowercased + snake_cased by the normaliser above
        // (camelCase like 'categoryName' becomes 'category_name').
        // Order: most specific match first.
        let name = (
          row.name
          || row.title                  // Apify Google Places scraper
          || row.business_name
          || row.contact_name
          || row.contact
          || row.lead
          || row.lead_name
          || row.full_name
          || row.fullname
          || row.client
          || row.client_name
          || row.person
          || row.prospect
          || row.who
          || ''
        )?.trim();

        // Fallback: combine first + last name (or given + surname / etc.)
        if (!name) {
          const first = (row.first_name || row.firstname || row.given_name || row.first || '')?.trim();
          const last = (row.last_name || row.lastname || row.surname || row.family_name || row.last || '')?.trim();
          if (first || last) {
            name = `${first} ${last}`.trim();
          }
        }

        const phone = (
          row.phone
          || row.phone_unformatted      // Apify
          || row.phone_number
          || row.phonenumber
          || row.telephone
          || row.mobile
          || row.mobile_number
          || row.mobile_phone
          || row.tel
          || row.contact_number
          || row.contact_phone
          || row.cell
          || row.cell_phone
          || ''
        )?.trim();

        // Name is required — phone can be empty (user may have email/website to find it later)
        if (!name) {
          result.skipped++;
          // Surface the actual headers in the first error so the user can
          // see which column in their CSV holds the name and rename it.
          if (result.errors.length === 0) {
            const headers = Object.keys(row).join(', ');
            result.errors.push(
              `No name column detected. Your CSV's columns are: [${headers}]. ` +
              `Rename one of them to "name" (or use "first_name" + "last_name") and re-upload.`
            );
          }
          continue;
        }

        // Check for duplicate phone number (only if phone is provided)
        const existing = phone ? findDuplicateStmt.get({ phone }) as (LeadRow & { call_count: number }) | undefined : undefined;
        if (existing) {
          result.duplicates++;
          duplicateLeads.push({
            id: existing.id,
            name: existing.name,
            phone: existing.phone,
            status: existing.status as Lead['status'],
            lastCalledAt: existing.last_called_at,
            callCount: existing.call_count,
          });
          // Still import but flag the new one as a duplicate in the lead name
          // so it's visible in the UI
        }

        currentPos++;

        // Apify Google Places scrapers put a comma-separated string in
        // 'emails' — take the first one.
        let email = (
          row.email
          || row.email_address
          || row.e_mail
          || row.contact_email
          || ''
        ).trim();
        if (!email && row.emails) {
          email = String(row.emails).split(/[,;]/)[0]?.trim() || '';
        }

        const website = (
          row.website
          || row.website_url           // Apify
          || row.websiteurl
          || row.web
          || row.url
          || row.homepage
          || row.site
          || ''
        ).trim();

        // Google Maps url, not the business website — only use as last resort.
        const fallbackUrl = (row.google_maps_url || row.maps_url || '').trim();

        // Resolve every per-row value once so we can also use them for
        // the dup-detection check below without re-running the alias ladder.
        const companyValue = (
          row.company
          || row.company_name
          || row.organisation
          || row.organization
          || row.business
          || row.business_name
          || ''
        ).trim() || null;
        const phoneValue = phone || '';
        const emailValue = email || null;
        const websiteValue = website || fallbackUrl || null;
        // Category is locked to the batch override (validated against
        // managed categories at the top of this handler). The CSV's own
        // category column is ignored — Jordan picked the category at
        // upload time and that's the source of truth.
        const categoryValue = categoryOverride;

        const insertResult = insertStmt.run({
          name,
          company: companyValue,
          phone: phoneValue,
          email: emailValue,
          website: websiteValue,
          leadType,
          category: categoryValue,
          queuePosition: currentPos,
        });

        const insertedId = Number(insertResult.lastInsertRowid);

        // Run dup detection against existing leads (snapshot pre-import).
        // Any match becomes a flag pill on /leads. Never auto-merges —
        // Jordan picks Fold / Dismiss / Open per row.
        const newLead: ScanLead = {
          id: insertedId,
          name,
          company: companyValue ?? '',
          phone: phoneValue,
          email: emailValue,
          website: websiteValue,
          pipeline_stage: null,
          manually_contacted: 0,
          consolidated_summary: null,
          deal_value: 0,
          notes_count: 0,
          tasks_count: 0,
          calls_count: 0,
          emails_count: 0,
          activities_count: 0,
        };

        for (const existing of existingLeadsForDup) {
          const match = matchPair(newLead, existing);
          if (!match) continue;
          // New lead is always the suspect (zero activity), the existing
          // lead is always the target. Fold on the pill collapses the
          // suspect into the target with field-level safety.
          insertFlagStmt.run(
            insertedId,
            existing.id,
            match.confidence,
            JSON.stringify(match.reasons),
          );
          flagsInserted++;
        }

        result.imported++;
      }
    });

    insertAll();

    logger.info(
      { imported: result.imported, skipped: result.skipped, duplicates: result.duplicates, flagsInserted },
      'CSV import complete',
    );
    res.status(201).json({ ...result, duplicateLeads, flaggedAsDuplicate: flagsInserted });
  } catch (err) {
    const msg = (err as Error).message || 'Unknown error';
    logger.error({ err, message: msg, stack: (err as Error).stack }, 'CSV import failed');
    // Surface the actual error to the client so Jordan can report it
    if (err instanceof ApiError) {
      next(err);
    } else {
      res.status(500).json({ error: `Import failed: ${msg}` });
    }
  }
});

/**
 * POST /api/leads/:id/disposition
 * Handles what happens after a call ends.
 * Creates a call_log record and updates the lead based on disposition type.
 */
router.post('/:id/disposition', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    // Validate the request body
    const payload = dispositionSchema.parse(req.body) as DispositionPayload;

    // wrong_number deletes the lead, so a follow-up date would be
    // discarded silently. Reject up-front so the client knows.
    if (payload.disposition === 'wrong_number' && payload.followUpDate) {
      throw new ApiError(400, 'wrong_number deletes the lead — a follow-up date cannot be set');
    }

    // Consecutive-no-answer threshold before a never-answered lead is retired to the "five_strikes" pipeline stage.
    // Leads that have EVER had an answered call (interested / not_interested disposition) are immune to this rule
    // and stay in the cycler indefinitely — a long-term relationship missing a few calls must not be retired.
    const threshold = parseInt(process.env.UNANSWERED_CALL_THRESHOLD || '5', 10);
    const now = new Date().toISOString();

    // Run disposition logic in a transaction to keep data consistent
    // All reads and writes happen inside the transaction to prevent race conditions.
    // Captures the inserted call_log id so the client can PATCH the AI summary back
    // onto this specific call row once Claude returns.
    let createdCallLogId: number | null = null;
    const processDisposition = db.transaction(() => {
      // Re-fetch lead inside transaction for data consistency
      const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
      if (!leadRow) {
        throw new ApiError(404, 'Lead not found');
      }

      // Tag the call (and the pending draft) with whoever's logged in.
      // The post-call AI draft path later reads this to decide whose
      // voice and signature the email should be in.
      const userId = req.user?.id ?? null;
      const transcript = payload.transcript;

      // call_sessions / pending_transcripts / twilio_call_sid were legacy
      // Twilio plumbing. We still pass NULL for the column so the existing
      // schema is preserved, but no lookup happens anymore.
      const insertResult = db.prepare(`
        INSERT INTO call_logs (lead_id, user_id, duration, transcript, disposition, twilio_call_sid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, payload.callDuration, transcript, payload.disposition, null, now);
      createdCallLogId = Number(insertResult.lastInsertRowid);

      // Email Bank: for dispositions that warrant a follow-up email, insert a
      // pending draft row. The actual email content is filled in later by the
      // post-Whisper chain (draftAndStoreEmailForCall) once the real transcript
      // is available. Jordan never has to wait.
      if (payload.disposition === 'interested' || payload.disposition === 'voicemail') {
        try {
          db.prepare(`
            INSERT INTO email_drafts (lead_id, call_log_id, user_id, disposition, to_email, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
          `).run(id, createdCallLogId, userId, payload.disposition, leadRow.email, now, now);
        } catch (draftErr) {
          // UNIQUE(call_log_id) collision or other — log but don't fail the disposition.
          logger.warn(
            { leadId: id, callLogId: createdCallLogId, error: draftErr instanceof Error ? draftErr.message : String(draftErr) },
            'Failed to create email_drafts row (non-blocking)',
          );
        }
      }

      // Update last_called_at timestamp
      db.prepare('UPDATE leads SET last_called_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);

      // Pipeline simplification (May 2026): the disposition flow no longer
      // moves leads between stages — the user owns tier placement manually.
      // The disposition still records the call, updates status, increments
      // unanswered counters, and (for wrong_number) deletes the lead.
      // Strike-system retirement now sends leads to 'lost' instead of the
      // retired 'five_strikes' stage.
      const answeredRow = db.prepare(`
        SELECT COUNT(*) as c FROM call_logs
        WHERE lead_id = ? AND disposition IN ('interested', 'not_interested')
      `).get(id) as { c: number };
      const hasEverAnswered = answeredRow.c > 0;

      switch (payload.disposition) {
        case 'no_answer': {
          const newCount = leadRow.unanswered_calls + 1;
          if (!hasEverAnswered && newCount >= threshold) {
            db.prepare(
              `UPDATE leads
               SET unanswered_calls = ?, status = ?, pipeline_stage = ?, updated_at = ?
               WHERE id = ?`
            ).run(newCount, 'called', 'lost', now, id);
            logger.info({ leadId: id, unansweredCalls: newCount, threshold }, 'Lead moved to lost after unanswered threshold');
          } else {
            const maxPos = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number }).max_pos;
            db.prepare('UPDATE leads SET unanswered_calls = ?, status = ?, queue_position = ?, updated_at = ? WHERE id = ?')
              .run(newCount, 'not_called', maxPos + 1, now, id);
          }
          break;
        }

        case 'voicemail': {
          const newCount = leadRow.unanswered_calls + 1;
          if (!hasEverAnswered && newCount >= threshold) {
            db.prepare(
              `UPDATE leads
               SET unanswered_calls = ?, voicemail_left = 1, voicemail_date = ?, status = ?, pipeline_stage = ?, updated_at = ?
               WHERE id = ?`
            ).run(newCount, now, 'called', 'lost', now, id);
            logger.info({ leadId: id, unansweredCalls: newCount, threshold }, 'Lead moved to lost after voicemail threshold');
          } else {
            const maxPos = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number }).max_pos;
            db.prepare(
              `UPDATE leads
               SET unanswered_calls = ?, voicemail_left = 1, voicemail_date = ?, status = ?, queue_position = ?, updated_at = ?
               WHERE id = ?`
            ).run(newCount, now, 'not_called', maxPos + 1, now, id);
          }
          break;
        }

        case 'not_interested': {
          db.prepare('UPDATE leads SET status = ?, pipeline_stage = ?, updated_at = ? WHERE id = ?')
            .run('called', 'lost', now, id);
          break;
        }

        case 'interested': {
          // Don't change tier — let the user move them to Tier 1/2 manually.
          db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?')
            .run('called', now, id);

          if (payload.callbackDate) {
            db.prepare('INSERT INTO callbacks (lead_id, callback_date, notes) VALUES (?, ?, ?)')
              .run(id, payload.callbackDate, payload.callbackNotes || null);
          }
          break;
        }

        case 'wrong_number': {
          db.prepare('DELETE FROM call_logs WHERE lead_id = ?').run(id);
          db.prepare('DELETE FROM leads WHERE id = ?').run(id);
          logger.info({ leadId: id }, 'Lead deleted — wrong number');
          break;
        }
      }

      // Follow-up date is set as-is — pipeline stage no longer changes
      // automatically (the auto-move to 'follow_up' is gone with the stage).
      if (payload.followUpDate && payload.disposition !== 'wrong_number') {
        db.prepare('UPDATE leads SET follow_up_date = ? WHERE id = ?')
          .run(payload.followUpDate, id);
      }
    });

    // BEGIN IMMEDIATE acquires a RESERVED write lock at transaction
    // start. Without this, two simultaneous dispositions on the same
    // lead can both read the row, both compute new positions, and one
    // write silently overwrites the other (lost-update race). With
    // immediate, the second transaction queues until the first commits.
    processDisposition.immediate();

    // For wrong_number, the lead has been deleted — return a simple confirmation
    if (payload.disposition === 'wrong_number') {
      logger.info({ leadId: id, disposition: payload.disposition }, 'Disposition processed (lead deleted)');
      res.json({ deleted: true, id });
      return;
    }

    // Return the updated lead + the id of the call_log we just created so the
    // client can PATCH the AI summary back onto this call after Claude returns.
    const updatedRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow;
    const updatedLead = mapLeadRow(updatedRow);

    logger.info({ leadId: id, disposition: payload.disposition, callLogId: createdCallLogId }, 'Disposition processed');
    res.json({ ...updatedLead, callLogId: createdCallLogId });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/leads/:id
 * Partially updates a lead. Used to update lead fields
 * or to update other fields.
 */
router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const updates = updateLeadSchema.parse(req.body);

    // Check lead exists
    const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Lead not found');
    }

    // Build dynamic UPDATE statement from provided fields
    const setClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.name !== undefined) {
      setClauses.push('name = @name');
      params.name = updates.name;
    }
    if (updates.company !== undefined) {
      setClauses.push('company = @company');
      params.company = updates.company;
    }
    if (updates.phone !== undefined) {
      setClauses.push('phone = @phone');
      params.phone = updates.phone;
    }
    if (updates.email !== undefined) {
      setClauses.push('email = @email');
      params.email = updates.email;
    }
    if (updates.website !== undefined) {
      setClauses.push('website = @website');
      params.website = updates.website;
    }
    if (updates.category !== undefined) {
      setClauses.push('category = @category');
      params.category = updates.category;
    }
    if (updates.consolidatedSummary !== undefined) {
      setClauses.push('consolidated_summary = @consolidatedSummary');
      params.consolidatedSummary = updates.consolidatedSummary;
    }
    if (updates.companyInfo !== undefined) {
      setClauses.push('company_info = @companyInfo');
      params.companyInfo = updates.companyInfo;
    }
    if (updates.pipelineStage !== undefined) {
      setClauses.push('pipeline_stage = @pipelineStage');
      params.pipelineStage = updates.pipelineStage;
    }
    if (updates.temperature !== undefined) {
      setClauses.push('temperature = @temperature');
      params.temperature = updates.temperature;
    }
    if (updates.followUpDate !== undefined) {
      setClauses.push('follow_up_date = @followUpDate');
      params.followUpDate = updates.followUpDate;
    }
    if (updates.dealValue !== undefined) {
      setClauses.push('deal_value = @dealValue');
      params.dealValue = updates.dealValue;
    }
    if (updates.manuallyContacted !== undefined) {
      setClauses.push('manually_contacted = @manuallyContacted');
      params.manuallyContacted = updates.manuallyContacted ? 1 : 0;
    }

    if (setClauses.length === 0) {
      throw new ApiError(400, 'No valid fields to update');
    }

    // Always update the updated_at timestamp
    setClauses.push("updated_at = datetime('now')");
    params.id = id;

    db.prepare(`UPDATE leads SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    const updatedRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow;
    res.json(mapLeadRow(updatedRow));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leads/:id/emails
 * Returns all emails sent to/from this lead, ordered by most recent first.
 */
router.get('/:id/emails', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    const rows = db.prepare(`
      SELECT id, lead_id, to_address, from_address, subject, body_snippet, gmail_message_id,
             source, direction, created_at,
             delivered_at, opened_at, last_opened_at, open_count,
             clicked_at, last_clicked_at, click_count, bounced_at
      FROM emails_sent
      WHERE lead_id = ?
      ORDER BY created_at DESC
    `).all(id) as Array<{
      id: number;
      lead_id: number;
      to_address: string;
      from_address: string | null;
      subject: string;
      body_snippet: string | null;
      gmail_message_id: string | null;
      source: string;
      direction: string;
      created_at: string;
      delivered_at: string | null;
      opened_at: string | null;
      last_opened_at: string | null;
      open_count: number;
      clicked_at: string | null;
      last_clicked_at: string | null;
      click_count: number;
      bounced_at: string | null;
    }>;

    const emails = rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      toAddress: r.to_address,
      fromAddress: r.from_address,
      subject: r.subject,
      bodySnippet: r.body_snippet,
      gmailMessageId: r.gmail_message_id,
      source: r.source,
      direction: r.direction || 'sent',
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
      openedAt: r.opened_at,
      lastOpenedAt: r.last_opened_at,
      openCount: r.open_count,
      clickedAt: r.clicked_at,
      lastClickedAt: r.last_clicked_at,
      clickCount: r.click_count,
      bouncedAt: r.bounced_at,
    }));

    logger.info({ leadId: id, count: emails.length }, 'Fetched emails for lead');
    res.json(emails);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/leads/:id
 * Removes a lead from the database entirely.
 */
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const result = db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Lead not found');
    }

    logger.info({ leadId: id }, 'Lead deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:id/transcripts
 * Saves a manually-dictated call transcript onto a lead. Inserts a
 * call_log row with disposition='interested' and the dictated content
 * as the transcript. Bypasses the disposition state-machine entirely
 * (no tier change, no status change, no strike counter, no queue
 * reordering) — this is just a record of "I had a conversation,
 * here's what was said".
 */
const transcriptSchema = z.object({
  transcript: z.string().min(1, 'Transcript text is required'),
  durationMinutes: z.number().min(0).optional(),
});

router.post('/:id/transcripts', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const payload = transcriptSchema.parse(req.body);
    const lead = db.prepare('SELECT id, name FROM leads WHERE id = ?').get(id) as
      | { id: number; name: string } | undefined;
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    const durationSeconds = payload.durationMinutes
      ? Math.max(0, Math.round(payload.durationMinutes * 60))
      : 0;
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO call_logs (lead_id, duration, transcript, disposition, created_at)
      VALUES (?, ?, ?, 'interested', ?)
    `).run(id, durationSeconds, payload.transcript, now);

    // Update last_called_at so the profile reflects "I just spoke to them"
    db.prepare("UPDATE leads SET last_called_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);

    // Activity timeline entry
    db.prepare(`
      INSERT INTO activities (lead_id, type, title, description, created_at)
      VALUES (?, 'call', 'Transcript saved', ?, ?)
    `).run(id, payload.transcript.slice(0, 200), now);

    logger.info({ leadId: id, callLogId: result.lastInsertRowid }, 'Manual transcript saved');

    res.status(201).json({
      callLogId: result.lastInsertRowid,
      leadId: id,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/next
 * Returns the next uncalled lead from the queue (lowest queue_position with status='not_called').
 * Returns 404 if no uncalled leads remain.
 */
router.post('/next', (req, res, next) => {
  try {
    const db = getDb();
    const { category } = req.body || {};

    // Find the next uncalled lead, optionally filtered by category
    let query = "SELECT * FROM leads WHERE status = 'not_called'";
    const params: Record<string, string> = {};

    if (category && typeof category === 'string' && category !== 'all') {
      query += ' AND category = @category';
      params.category = category;
    }

    query += ' ORDER BY queue_position ASC LIMIT 1';

    const nextRow = db.prepare(query).get(params) as LeadRow | undefined;

    if (!nextRow) {
      throw new ApiError(404, 'No leads remaining in queue');
    }

    const lead = mapLeadRow(nextRow);

    // Also fetch call history for callback leads
    let callLogs: CallLog[] = [];
    if (lead.leadType === 'callback') {
      const logRows = db
        .prepare('SELECT * FROM call_logs WHERE lead_id = ? ORDER BY created_at DESC')
        .all(lead.id) as CallLogRow[];
      callLogs = logRows.map(mapCallLogRow);
    }

    logger.info({ leadId: lead.id, leadName: lead.name }, 'Next lead activated');
    res.json({ ...lead, callLogs });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Duplicate scan + flag management
//
// Builds an inline-pill duplicate-detection system Jordan can work
// through on the Leads page. Match signals (any one fires a flag):
//
//   HIGH confidence:
//     - phone last-9 digits match
//     - email exact match (case-insensitive)
//     - website / email domain root match (e.g. dixonappointments)
//
//   MEDIUM confidence:
//     - name token overlap after stripping business noise words
//     - company token overlap
//     - cross-field: lead A's name tokens overlap lead B's company
//       tokens (or vice versa) — catches the "biz-name scrape row vs
//       real person at that company" case
//
// Suspect / target roles are decided by activity score (notes + tasks
// + call logs + emails + activities + tier + manually_contacted +
// deal_value). Higher score = target (kept on fold). Lower = suspect
// (folded into target).
//
// Dismissals are persisted, so re-running the scan respects "Jordan
// already said these two aren't duplicates."
// ============================================================

// Noise words stripped from names/companies before token comparison.
// These add no identifying signal — every recruitment business has them.
const NOISE_WORDS = new Set([
  'recruitment', 'recruiting', 'agency', 'agencies', 'employment',
  'services', 'service', 'group', 'holdings', 'partners', 'partner',
  'pty', 'ltd', 'llc', 'inc', 'corp', 'corporation', 'limited',
  'incorporated', 'enterprises', 'industries', 'solutions', 'systems',
  'international', 'global', 'national', 'co', 'the', 'and', 'of',
  'for', 'in', 'at', 'on', 'with',
  'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'canberra',
  'australia', 'australian', 'au', 'victoria', 'vic', 'nsw',
  'queensland', 'qld', 'wa', 'sa', 'tas', 'act', 'nt',
  'it', 'marketing', 'finance', 'sales', 'accounting', 'admin',
  'administration', 'support', 'operations', 'hr', 'logistics',
  'construction', 'engineering', 'executive', 'search', 'network',
  'office', 'centre', 'center', 'company', 'companies', 'business',
  'consulting', 'consultancy', 'consultants', 'consultant',
  'staffing', 'talent', 'people', 'careers', 'career', 'jobs', 'job',
  'professional', 'professionals',
]);

function normalizeTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !NOISE_WORDS.has(t)),
  );
}

function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

function domainRoot(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.toLowerCase().match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\./);
  return m && m[1].length >= 3 ? m[1] : null;
}

function emailDomainRoot(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = email.toLowerCase().match(/@([a-z0-9-]+)\./);
  return m && m[1].length >= 3 ? m[1] : null;
}

interface ScanLead {
  id: number;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  pipeline_stage: string | null;
  manually_contacted: number;
  consolidated_summary: string | null;
  deal_value: number;
  notes_count: number;
  tasks_count: number;
  calls_count: number;
  emails_count: number;
  activities_count: number;
}

/**
 * Activity score — higher = more "worked." Drives suspect vs target
 * assignment (target stays, suspect folds into it).
 */
function activityScore(lead: ScanLead): number {
  return (
    lead.notes_count
    + lead.tasks_count
    + lead.calls_count
    + lead.emails_count
    + lead.activities_count
    + (lead.manually_contacted === 1 ? 1 : 0)
    + (lead.pipeline_stage ? 2 : 0)
    + (lead.deal_value > 0 ? 1 : 0)
    + (lead.consolidated_summary && lead.consolidated_summary.trim() ? 1 : 0)
  );
}

/**
 * Compute the match reasons + confidence between two leads. Returns
 * null if they don't match on any signal.
 */
function matchPair(a: ScanLead, b: ScanLead): { reasons: string[]; confidence: 'high' | 'medium' } | null {
  const reasons: string[] = [];
  let highConfidence = false;

  // HIGH: phone last-9 match.
  const pa = phoneKey(a.phone);
  const pb = phoneKey(b.phone);
  if (pa && pb && pa === pb) {
    reasons.push('Same phone number');
    highConfidence = true;
  }

  // HIGH: email exact match.
  const ea = a.email?.trim().toLowerCase();
  const eb = b.email?.trim().toLowerCase();
  if (ea && eb && ea === eb) {
    reasons.push('Same email address');
    highConfidence = true;
  }

  // HIGH: website OR email domain root match.
  const da = domainRoot(a.website) || emailDomainRoot(a.email);
  const db = domainRoot(b.website) || emailDomainRoot(b.email);
  if (da && db && da === db) {
    reasons.push(`Same domain (${da})`);
    highConfidence = true;
  }

  // MEDIUM: token-based match. STRICT version — designed to avoid the
  // first-name/last-name false positives that blew up the v1 scan
  // (4878 flags on 1187 leads).
  //
  // Two conditions must both hold:
  //   (1) Subset containment — one lead's combined name+company tokens
  //       must be FULLY contained in the other's. So "Smaart Recruitment"
  //       {smaart} ⊆ "James Whitcombe at Smaart Recruitment"
  //       {james, whitcombe, smaart} ✓. But "Robert Half" {robert, half}
  //       vs "Robert Smith" {robert, smith} → neither is a subset of the
  //       other → no false match on the shared first name.
  //
  //   (2) At least one of the matching tokens must appear in a COMPANY
  //       field on either side. Filters out coincidental name-only
  //       overlaps (two strangers sharing a first or surname). The biz-
  //       row use case still works because the real-person lead has the
  //       business identifier in its company field.
  const nameTokensA = normalizeTokens(a.name);
  const nameTokensB = normalizeTokens(b.name);
  const compTokensA = normalizeTokens(a.company);
  const compTokensB = normalizeTokens(b.company);

  const allA = new Set<string>([...nameTokensA, ...compTokensA]);
  const allB = new Set<string>([...nameTokensB, ...compTokensB]);

  const sharedTokens = [...allA].filter((t) => allB.has(t));

  if (sharedTokens.length === 0) {
    return highConfidence ? { reasons, confidence: 'high' } : null;
  }

  // Subset check — smaller side must be entirely contained in larger.
  // Using ≤ on size lets ties go either way; both pass when sets are equal.
  const smaller = allA.size <= allB.size ? allA : allB;
  const larger = allA.size <= allB.size ? allB : allA;
  const isSubset = [...smaller].every((t) => larger.has(t));

  if (!isSubset) {
    return highConfidence ? { reasons, confidence: 'high' } : null;
  }

  // Company-field requirement — at least one shared token must appear
  // in the COMPANY field of A or B. Two leads sharing only a first/last
  // name (e.g. "Robert" appearing in both names) won't fire.
  const anyCompanyMatch = sharedTokens.some(
    (t) => compTokensA.has(t) || compTokensB.has(t),
  );

  if (!anyCompanyMatch) {
    return highConfidence ? { reasons, confidence: 'high' } : null;
  }

  // Both conditions met — medium confidence is justified.
  if (!highConfidence) {
    reasons.push(`Shared identifier: ${sharedTokens.slice(0, 3).join(', ')}`);
  }

  return {
    reasons,
    confidence: highConfidence ? 'high' : 'medium',
  };
}

/**
 * POST /api/leads/scan-duplicates
 *
 * Walks the lead set, finds candidate duplicate pairs, upserts them
 * into duplicate_flags. Respects existing dismissals (re-discovered
 * pairs with dismissed_at set stay dismissed).
 *
 * Skips pairs where BOTH leads have business activity — never
 * suggests merging two real contacts against each other. The pair
 * has to have a clear suspect (untouched scrape row) and a clear
 * target (worked lead) OR both be untouched.
 */
router.post('/scan-duplicates', (_req, res, next) => {
  try {
    const db = getDb();

    const leads = db.prepare(`
      SELECT
        l.id, l.name, COALESCE(l.company, '') AS company,
        COALESCE(l.phone, '') AS phone,
        l.email, l.website,
        l.pipeline_stage, l.manually_contacted,
        l.consolidated_summary, l.deal_value,
        (SELECT COUNT(*) FROM notes        WHERE notes.lead_id        = l.id) AS notes_count,
        (SELECT COUNT(*) FROM tasks        WHERE tasks.lead_id        = l.id) AS tasks_count,
        (SELECT COUNT(*) FROM call_logs    WHERE call_logs.lead_id    = l.id) AS calls_count,
        (SELECT COUNT(*) FROM emails_sent  WHERE emails_sent.lead_id  = l.id) AS emails_count,
        (SELECT COUNT(*) FROM activities   WHERE activities.lead_id   = l.id) AS activities_count
      FROM leads l
    `).all() as ScanLead[];

    // Build inverted indices so we only compare pairs that share at
    // least one signal. Each lead's id goes into every bucket it
    // belongs to; pair candidates are then "any two ids that share a
    // bucket."
    const buckets = new Map<string, number[]>();
    const addToBucket = (key: string, id: number) => {
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(id);
    };

    const leadById = new Map<number, ScanLead>();
    for (const lead of leads) {
      leadById.set(lead.id, lead);

      const pk = phoneKey(lead.phone);
      if (pk) addToBucket(`phone:${pk}`, lead.id);

      const ek = lead.email?.trim().toLowerCase();
      if (ek) addToBucket(`email:${ek}`, lead.id);

      const dk = domainRoot(lead.website) || emailDomainRoot(lead.email);
      if (dk) addToBucket(`domain:${dk}`, lead.id);

      const tokens = new Set<string>([
        ...normalizeTokens(lead.name),
        ...normalizeTokens(lead.company),
      ]);
      for (const t of tokens) addToBucket(`token:${t}`, lead.id);
    }

    // Walk every bucket; any pair sharing a bucket is a candidate.
    // Use a Set keyed by "min,max" to dedupe pairs that share multiple
    // buckets (we re-run matchPair for the full reason list anyway).
    const candidatePairs = new Set<string>();
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue;
      // Skip extremely common token buckets — if more than 50 leads
      // share a single token, it's a stopword we missed (or a brand
      // term used across a category) and pairing all of them would
      // explode the result set. Stronger signals (phone/email/domain)
      // are always small buckets, so this only kicks in on tokens.
      if (ids.length > 50) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = Math.min(ids[i], ids[j]);
          const b = Math.max(ids[i], ids[j]);
          candidatePairs.add(`${a},${b}`);
        }
      }
    }

    // Existing dismissals — preserve so we don't re-flag dismissed pairs.
    const dismissed = new Set<string>(
      (db.prepare(
        'SELECT suspect_lead_id, target_lead_id FROM duplicate_flags WHERE dismissed_at IS NOT NULL',
      ).all() as { suspect_lead_id: number; target_lead_id: number }[])
        .map((r) => `${r.suspect_lead_id},${r.target_lead_id}`),
    );

    // Clear existing ACTIVE flags before re-populating (dismissals stay).
    db.prepare('DELETE FROM duplicate_flags WHERE dismissed_at IS NULL').run();

    const upsert = db.prepare(`
      INSERT INTO duplicate_flags
        (suspect_lead_id, target_lead_id, confidence, reasons, detected_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT (suspect_lead_id, target_lead_id) DO NOTHING
    `);

    let inserted = 0;
    let dismissedSkipped = 0;
    let twoTouchedSkipped = 0;

    const tx = db.transaction(() => {
      for (const key of candidatePairs) {
        const [aId, bId] = key.split(',').map((s) => parseInt(s, 10));
        const a = leadById.get(aId);
        const b = leadById.get(bId);
        if (!a || !b) continue;

        const match = matchPair(a, b);
        if (!match) continue;

        // Decide suspect / target by activity score. Target = higher.
        const sa = activityScore(a);
        const sb = activityScore(b);

        // Safety: never suggest merging two leads that BOTH have
        // meaningful activity. That would risk losing real client
        // history if the user clicks Fold. The dedupe-as-cleanup
        // story is "kill the scrape clutter," not "merge clients."
        const aTouched = sa > 0;
        const bTouched = sb > 0;
        if (aTouched && bTouched) {
          twoTouchedSkipped++;
          continue;
        }

        const targetId = sb > sa ? bId : aId;
        const suspectId = targetId === bId ? aId : bId;

        // Honour dismissals — both directions, since the original flag
        // might have been recorded the other way around.
        if (
          dismissed.has(`${suspectId},${targetId}`)
          || dismissed.has(`${targetId},${suspectId}`)
        ) {
          dismissedSkipped++;
          continue;
        }

        upsert.run(
          suspectId,
          targetId,
          match.confidence,
          JSON.stringify(match.reasons),
        );
        inserted++;
      }
    });
    tx();

    logger.info({ inserted, dismissedSkipped, twoTouchedSkipped, candidates: candidatePairs.size }, 'Duplicate scan complete');
    res.json({ flagged: inserted, dismissedSkipped, twoTouchedSkipped });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leads/duplicate-flags
 *
 * Returns active flags with both leads' summary info, ordered by
 * confidence DESC then detection date. Used by the Leads page to
 * render inline "Likely duplicate of X" pills.
 */
router.get('/duplicate-flags', (_req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        f.suspect_lead_id, f.target_lead_id, f.confidence, f.reasons,
        f.detected_at,
        s.name AS s_name, s.company AS s_company, s.phone AS s_phone,
        t.name AS t_name, t.company AS t_company, t.phone AS t_phone,
        t.email AS t_email, t.website AS t_website
      FROM duplicate_flags f
      JOIN leads s ON s.id = f.suspect_lead_id
      JOIN leads t ON t.id = f.target_lead_id
      WHERE f.dismissed_at IS NULL
      ORDER BY
        CASE f.confidence WHEN 'high' THEN 0 ELSE 1 END,
        f.detected_at DESC
    `).all() as Array<{
      suspect_lead_id: number; target_lead_id: number;
      confidence: string; reasons: string; detected_at: string;
      s_name: string; s_company: string | null; s_phone: string;
      t_name: string; t_company: string | null; t_phone: string;
      t_email: string | null; t_website: string | null;
    }>;

    res.json(rows.map((r) => ({
      suspectId: r.suspect_lead_id,
      targetId: r.target_lead_id,
      confidence: r.confidence,
      reasons: safeJsonParse<string[]>(r.reasons, []),
      detectedAt: r.detected_at,
      suspect: { id: r.suspect_lead_id, name: r.s_name, company: r.s_company, phone: r.s_phone },
      target: {
        id: r.target_lead_id, name: r.t_name, company: r.t_company,
        phone: r.t_phone, email: r.t_email, website: r.t_website,
      },
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:suspectId/fold-into/:targetId
 *
 * Safe field-level merge: target keeps every populated field, suspect
 * only contributes to fields where target is empty. Then reassign all
 * activity (call_logs, notes, tasks, emails_sent, activities, projects,
 * callbacks, email_drafts) and delete the suspect row.
 *
 * The target's existing mobile is NEVER overwritten by a head-office
 * switchboard, the target's personal email NEVER replaced by an info@
 * address, etc. This is the protection Jordan asked for repeatedly.
 */
router.post('/:suspectId/fold-into/:targetId', (req, res, next) => {
  try {
    const db = getDb();
    const suspectId = parseInt(req.params.suspectId, 10);
    const targetId = parseInt(req.params.targetId, 10);
    if (isNaN(suspectId) || isNaN(targetId) || suspectId === targetId) {
      throw new ApiError(400, 'Invalid suspect/target ids');
    }

    const target = db.prepare('SELECT * FROM leads WHERE id = ?').get(targetId) as LeadRow | undefined;
    const suspect = db.prepare('SELECT * FROM leads WHERE id = ?').get(suspectId) as LeadRow | undefined;
    if (!target || !suspect) {
      throw new ApiError(404, 'Lead not found');
    }

    // Compute the field-level updates target needs. Only fields that
    // are blank/null on target get filled from suspect. Nothing on
    // target ever gets overwritten with a suspect value.
    const updates: Record<string, unknown> = {};
    const fillIfEmpty = (field: keyof LeadRow, value: unknown) => {
      const current = target[field];
      const targetEmpty =
        current === null
        || current === undefined
        || (typeof current === 'string' && current.trim() === '');
      const suspectHasValue =
        value !== null
        && value !== undefined
        && !(typeof value === 'string' && (value as string).trim() === '');
      if (targetEmpty && suspectHasValue) {
        updates[field] = value;
      }
    };

    fillIfEmpty('phone', suspect.phone);
    fillIfEmpty('email', suspect.email);
    fillIfEmpty('website', suspect.website);
    fillIfEmpty('company', suspect.company);
    fillIfEmpty('category', suspect.category);
    fillIfEmpty('company_info', suspect.company_info);

    const reassignTables = [
      'call_logs', 'notes', 'tasks', 'activities', 'emails_sent',
      'projects', 'callbacks', 'email_drafts',
    ];

    let rowsReassigned = 0;

    const tx = db.transaction(() => {
      // 1) Reassign every child row.
      for (const table of reassignTables) {
        const r = db.prepare(`UPDATE ${table} SET lead_id = ? WHERE lead_id = ?`).run(targetId, suspectId);
        rowsReassigned += r.changes;
      }

      // 2) Apply the field-level fills to target.
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id: targetId };
      for (const [field, value] of Object.entries(updates)) {
        setClauses.push(`${field} = @${field}`);
        params[field] = value;
      }
      if (setClauses.length > 0) {
        setClauses.push("updated_at = datetime('now')");
        db.prepare(`UPDATE leads SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
      }

      // 3) Drop any remaining duplicate_flags that reference the suspect
      //    (FK cascade handles this on DELETE, but be explicit).
      db.prepare('DELETE FROM duplicate_flags WHERE suspect_lead_id = ? OR target_lead_id = ?')
        .run(suspectId, suspectId);

      // 4) Delete the suspect row.
      db.prepare('DELETE FROM leads WHERE id = ?').run(suspectId);
    });
    tx();

    logger.info({ suspectId, targetId, fieldsFilled: Object.keys(updates), rowsReassigned }, 'Lead folded');
    res.json({
      success: true,
      survivorId: targetId,
      fieldsFilled: Object.keys(updates),
      rowsReassigned,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:suspectId/dismiss-duplicate-of/:targetId
 *
 * "These two aren't a duplicate, leave me alone." Sets dismissed_at on
 * the flag so future scans skip the pair. Lead rows are untouched.
 */
router.post('/:suspectId/dismiss-duplicate-of/:targetId', (req, res, next) => {
  try {
    const db = getDb();
    const suspectId = parseInt(req.params.suspectId, 10);
    const targetId = parseInt(req.params.targetId, 10);
    if (isNaN(suspectId) || isNaN(targetId)) {
      throw new ApiError(400, 'Invalid suspect/target ids');
    }

    // Upsert so we always have a row to mark dismissed even if the
    // pair was inserted in the reverse order.
    db.prepare(`
      INSERT INTO duplicate_flags
        (suspect_lead_id, target_lead_id, confidence, reasons, detected_at, dismissed_at)
      VALUES (?, ?, 'medium', '[]', datetime('now'), datetime('now'))
      ON CONFLICT (suspect_lead_id, target_lead_id) DO UPDATE SET
        dismissed_at = datetime('now')
    `).run(suspectId, targetId);

    // Same pair flagged in the other direction (target→suspect rather
    // than suspect→target) — dismiss that too if it exists.
    db.prepare(`
      UPDATE duplicate_flags SET dismissed_at = datetime('now')
      WHERE suspect_lead_id = ? AND target_lead_id = ?
    `).run(targetId, suspectId);

    logger.info({ suspectId, targetId }, 'Duplicate flag dismissed');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
