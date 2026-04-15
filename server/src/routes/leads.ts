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

const logger = pino({ name: 'leads-routes' });
const router = Router();

// Multer setup — store uploaded CSV in memory
const upload = multer({ storage: multer.memoryStorage() });

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
  pipeline_stage: string;
  temperature: string | null;
  converted_to_project: number;
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
    pipelineStage: row.pipeline_stage as PipelineStage,
    temperature: (row.temperature as Temperature) ?? null,
    convertedToProject: row.converted_to_project === 1,
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
  twilioCallSid: z.string().optional(),
  callbackDate: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'callbackDate must be a valid date string' }
  ).optional(),
  callbackNotes: z.string().optional(),
});

const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(1, 'Phone is required'),
  company: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  temperature: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
  pipelineStage: z.enum(['new_lead', 'follow_up', 'call_booked', 'negotiation', 'won', 'lost']).optional(),
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
  pipelineStage: z.enum(['new_lead', 'follow_up', 'call_booked', 'negotiation', 'won', 'lost']).optional(),
  temperature: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
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
    const { status, leadType, category } = req.query;

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

    query += ' ORDER BY queue_position ASC';

    const rows = db.prepare(query).all(params) as LeadRow[];
    const leads = rows.map(mapLeadRow);

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
    const rows = db.prepare(
      "SELECT DISTINCT category FROM leads WHERE category IS NOT NULL AND category != '' ORDER BY category ASC"
    ).all() as { category: string }[];

    const categories = rows.map((r) => r.category);
    res.json(categories);
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

    // Search by phone number (partial match from the end — handles country code differences)
    const rows = db.prepare(`
      SELECT * FROM leads
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE @pattern
      ORDER BY updated_at DESC
      LIMIT 10
    `).all({ pattern: `%${cleanPhone}%` }) as LeadRow[];

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
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

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
        phone: payload.phone,
        company: payload.company ?? null,
        email: payload.email ?? null,
        website: payload.website ?? null,
        category: payload.category ?? null,
        pipelineStage: payload.pipelineStage ?? 'new_lead',
        temperature: payload.temperature ?? null,
        queuePosition: maxPosRow.max_pos + 1,
        now,
      });

      const leadId = result.lastInsertRowid as number;

      // Create activity record
      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'stage_change', 'Lead created', ?, ?)
      `).run(leadId, payload.company ? `${payload.name} at ${payload.company}` : payload.name, now);

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

    // Optional category override — applies to all leads in this batch
    const categoryOverride = (req.body.category as string)?.trim() || null;

    // Parse the CSV from the uploaded buffer
    const csvContent = req.file.buffer.toString('utf-8');
    let records: Record<string, string>[];

    try {
      records = parse(csvContent, {
        columns: true,        // Use first row as headers
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new ApiError(400, 'Invalid CSV format');
    }

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

    // Use a transaction for bulk insert performance and position consistency
    const insertAll = db.transaction(() => {
      // Read max position inside transaction to prevent duplicate positions
      const maxPosRow = db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number };
      let currentPos = maxPosRow.max_pos;

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const name = row.name?.trim();
        const phone = row.phone?.trim();

        // Name is required — phone can be empty (user may have email/website to find it later)
        if (!name) {
          result.skipped++;
          result.errors.push(`Row ${i + 2}: Missing required field (name)`);
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

        insertStmt.run({
          name,
          company: row.company?.trim() || null,
          phone: phone || null,
          email: row.email?.trim() || null,
          website: row.website?.trim() || null,
          leadType,
          category: categoryOverride || row.category?.trim() || null,
          queuePosition: currentPos,
        });

        result.imported++;
      }
    });

    insertAll();

    logger.info({ imported: result.imported, skipped: result.skipped, duplicates: result.duplicates }, 'CSV import complete');
    res.status(201).json({ ...result, duplicateLeads });
  } catch (err) {
    next(err);
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

    const threshold = parseInt(process.env.UNANSWERED_CALL_THRESHOLD || '3', 10);
    const now = new Date().toISOString();

    // Run disposition logic in a transaction to keep data consistent
    // All reads and writes happen inside the transaction to prevent race conditions
    const processDisposition = db.transaction(() => {
      // Re-fetch lead inside transaction for data consistency
      const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
      if (!leadRow) {
        throw new ApiError(404, 'Lead not found');
      }

      // Always create a call log record (with Twilio CallSid for transcript matching)
      // If client didn't capture CallSid, look it up from call_sessions by phone number
      let callSid = payload.twilioCallSid || null;
      if (!callSid && leadRow.phone) {
        // Try to find CallSid from call_sessions using the lead's phone number
        const phone = leadRow.phone;
        const e164Phone = phone.startsWith('+61') ? phone
          : phone.startsWith('0') ? '+61' + phone.substring(1)
          : phone.startsWith('61') ? '+' + phone
          : '+61' + phone;

        const session = db.prepare(`
          SELECT call_sid FROM call_sessions
          WHERE phone_to = ?
          AND created_at >= datetime('now', '-10 minutes')
          ORDER BY created_at DESC
          LIMIT 1
        `).get(e164Phone) as { call_sid: string } | undefined;

        if (session) {
          callSid = session.call_sid;
          logger.info({ leadId: id, callSid, phone: e164Phone }, 'Resolved CallSid from call_sessions');
        }
      }

      // Check if there's a pending transcript from Twilio recording
      let transcript = payload.transcript;
      if (callSid) {
        const pending = db.prepare('SELECT transcript FROM pending_transcripts WHERE call_sid = ?').get(callSid) as { transcript: string } | undefined;
        if (pending && pending.transcript) {
          transcript = pending.transcript;
          db.prepare('DELETE FROM pending_transcripts WHERE call_sid = ?').run(callSid);
          logger.info({ leadId: id, callSid }, 'Used pending transcript from Twilio recording');
        }
      }

      db.prepare(`
        INSERT INTO call_logs (lead_id, duration, transcript, disposition, twilio_call_sid, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, payload.callDuration, transcript, payload.disposition, callSid, now);

      // Update last_called_at timestamp
      db.prepare('UPDATE leads SET last_called_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);

      switch (payload.disposition) {
        case 'no_answer': {
          const newCount = leadRow.unanswered_calls + 1;
          if (newCount >= threshold) {
            db.prepare('UPDATE leads SET unanswered_calls = ?, status = ?, updated_at = ? WHERE id = ?')
              .run(newCount, 'called', now, id);
            logger.info({ leadId: id, unansweredCalls: newCount }, 'Lead marked called after exceeding unanswered threshold');
          } else {
            // Get max position inside transaction to prevent duplicate positions
            const maxPos = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number }).max_pos;
            db.prepare('UPDATE leads SET unanswered_calls = ?, status = ?, queue_position = ?, updated_at = ? WHERE id = ?')
              .run(newCount, 'not_called', maxPos + 1, now, id);
          }
          break;
        }

        case 'voicemail': {
          const newCount = leadRow.unanswered_calls + 1;
          if (newCount >= threshold) {
            db.prepare('UPDATE leads SET unanswered_calls = ?, voicemail_left = 1, voicemail_date = ?, status = ?, updated_at = ? WHERE id = ?')
              .run(newCount, now, 'called', now, id);
            logger.info({ leadId: id, unansweredCalls: newCount }, 'Lead marked called (voicemail) after exceeding unanswered threshold');
          } else {
            const maxPos = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number }).max_pos;
            db.prepare('UPDATE leads SET unanswered_calls = ?, voicemail_left = 1, voicemail_date = ?, status = ?, queue_position = ?, updated_at = ? WHERE id = ?')
              .run(newCount, now, 'not_called', maxPos + 1, now, id);
          }
          break;
        }

        case 'not_interested': {
          db.prepare('UPDATE leads SET status = ?, pipeline_stage = ?, updated_at = ? WHERE id = ?')
            .run('called', 'not_interested', now, id);
          break;
        }

        case 'interested': {
          db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?')
            .run('called', now, id);

          // If a callback was requested, create a callback record
          if (payload.callbackDate) {
            db.prepare('INSERT INTO callbacks (lead_id, callback_date, notes) VALUES (?, ?, ?)')
              .run(id, payload.callbackDate, payload.callbackNotes || null);
          }
          break;
        }

        case 'wrong_number': {
          // Delete the lead entirely — wrong number means it's useless
          db.prepare('DELETE FROM call_logs WHERE lead_id = ?').run(id);
          db.prepare('DELETE FROM leads WHERE id = ?').run(id);
          logger.info({ leadId: id }, 'Lead deleted — wrong number');
          break;
        }
      }
    });

    processDisposition();

    // For wrong_number, the lead has been deleted — return a simple confirmation
    if (payload.disposition === 'wrong_number') {
      logger.info({ leadId: id, disposition: payload.disposition }, 'Disposition processed (lead deleted)');
      res.json({ deleted: true, id });
      return;
    }

    // Return the updated lead
    const updatedRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow;
    const updatedLead = mapLeadRow(updatedRow);

    logger.info({ leadId: id, disposition: payload.disposition }, 'Disposition processed');
    res.json(updatedLead);
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
      SELECT id, lead_id, to_address, from_address, subject, body_snippet, gmail_message_id, source, direction, created_at
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

export default router;
