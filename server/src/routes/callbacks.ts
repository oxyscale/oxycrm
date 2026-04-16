// ============================================================
// Callbacks Routes — /api/callbacks
// Manages scheduled callback reminders for leads
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Lead, CallLog, Callback, CallbackWithLead } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'callbacks-routes' });
const router = Router();

// ============================================================
// Row types and mappers
// ============================================================

interface CallbackRow {
  id: number;
  lead_id: number;
  callback_date: string;
  notes: string | null;
  completed: number;
  created_at: string;
}

interface CallbackWithLeadRow extends CallbackRow {
  // Lead columns (prefixed with l_)
  l_id: number;
  l_name: string;
  l_company: string | null;
  l_phone: string;
  l_email: string | null;
  l_website: string | null;
  l_lead_type: string;
  l_category: string | null;
  l_status: string;
  l_unanswered_calls: number;
  l_voicemail_left: number;
  l_voicemail_date: string | null;
  l_consolidated_summary: string | null;
  l_company_info: string | null;
  l_monday_item_id: string | null;
  l_pipeline_stage: string;
  l_temperature: string | null;
  l_converted_to_project: number;
  l_follow_up_date: string | null;
  l_queue_position: number;
  l_last_called_at: string | null;
  l_created_at: string;
  l_updated_at: string;
  // Last call log columns (prefixed with cl_) — may be null
  cl_id: number | null;
  cl_lead_id: number | null;
  cl_duration: number | null;
  cl_transcript: string | null;
  cl_summary: string | null;
  cl_key_topics: string | null;
  cl_action_items: string | null;
  cl_sentiment: string | null;
  cl_disposition: string | null;
  cl_created_at: string | null;
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

function mapCallbackRow(row: CallbackRow): Callback {
  return {
    id: row.id,
    leadId: row.lead_id,
    callbackDate: row.callback_date,
    notes: row.notes,
    completed: row.completed === 1,
    createdAt: row.created_at,
  };
}

function mapCallbackWithLeadRow(row: CallbackWithLeadRow): CallbackWithLead {
  const lead: Lead = {
    id: row.l_id,
    name: row.l_name,
    company: row.l_company,
    phone: row.l_phone,
    email: row.l_email,
    website: row.l_website,
    leadType: row.l_lead_type as Lead['leadType'],
    category: row.l_category,
    status: row.l_status as Lead['status'],
    unansweredCalls: row.l_unanswered_calls,
    voicemailLeft: row.l_voicemail_left === 1,
    voicemailDate: row.l_voicemail_date,
    consolidatedSummary: row.l_consolidated_summary,
    companyInfo: row.l_company_info,
    mondayItemId: row.l_monday_item_id,
    pipelineStage: row.l_pipeline_stage as Lead['pipelineStage'],
    temperature: (row.l_temperature as Lead['temperature']) ?? null,
    convertedToProject: row.l_converted_to_project === 1,
    followUpDate: row.l_follow_up_date,
    queuePosition: row.l_queue_position,
    lastCalledAt: row.l_last_called_at,
    createdAt: row.l_created_at,
    updatedAt: row.l_updated_at,
  };

  let lastCallLog: CallLog | null = null;
  if (row.cl_id !== null) {
    lastCallLog = {
      id: row.cl_id,
      leadId: row.cl_lead_id!,
      duration: row.cl_duration,
      transcript: row.cl_transcript,
      summary: row.cl_summary,
      keyTopics: safeJsonParse<string[]>(row.cl_key_topics, []),
      actionItems: safeJsonParse<string[]>(row.cl_action_items, []),
      sentiment: row.cl_sentiment,
      disposition: row.cl_disposition as CallLog['disposition'],
      createdAt: row.cl_created_at!,
    };
  }

  return {
    id: row.id,
    leadId: row.lead_id,
    callbackDate: row.callback_date,
    notes: row.notes,
    completed: row.completed === 1,
    createdAt: row.created_at,
    lead,
    lastCallLog,
  };
}

// ============================================================
// Validation schemas
// ============================================================

const createCallbackSchema = z.object({
  leadId: z.number().int().positive(),
  callbackDate: z.string().min(1, 'callbackDate is required').refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'callbackDate must be a valid date string' }
  ),
  notes: z.string().optional(),
});

const updateCallbackSchema = z.object({
  completed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  callbackDate: z.string().optional(),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/callbacks/today
 * Returns today's incomplete callbacks with full lead info and the last call log.
 * Uses a LEFT JOIN to get the most recent call_log per lead.
 */
router.get('/today', (req, res, next) => {
  try {
    const db = getDb();

    // Get today's date in YYYY-MM-DD format (matches how callback_date is stored)
    const today = new Date().toISOString().split('T')[0];

    const rows = db.prepare(`
      SELECT
        cb.id, cb.lead_id, cb.callback_date, cb.notes, cb.completed, cb.created_at,
        l.id as l_id, l.name as l_name, l.company as l_company, l.phone as l_phone,
        l.email as l_email, l.website as l_website, l.lead_type as l_lead_type, l.category as l_category,
        l.status as l_status, l.unanswered_calls as l_unanswered_calls,
        l.voicemail_left as l_voicemail_left, l.voicemail_date as l_voicemail_date,
        l.consolidated_summary as l_consolidated_summary, l.company_info as l_company_info,
        l.monday_item_id as l_monday_item_id,
        l.pipeline_stage as l_pipeline_stage, l.temperature as l_temperature,
        l.converted_to_project as l_converted_to_project,
        l.queue_position as l_queue_position,
        l.last_called_at as l_last_called_at, l.created_at as l_created_at,
        l.updated_at as l_updated_at,
        cl.id as cl_id, cl.lead_id as cl_lead_id, cl.duration as cl_duration,
        cl.transcript as cl_transcript, cl.summary as cl_summary,
        cl.key_topics as cl_key_topics, cl.action_items as cl_action_items,
        cl.sentiment as cl_sentiment, cl.disposition as cl_disposition,
        cl.created_at as cl_created_at
      FROM callbacks cb
      INNER JOIN leads l ON l.id = cb.lead_id
      LEFT JOIN call_logs cl ON cl.id = (
        SELECT id FROM call_logs WHERE lead_id = cb.lead_id ORDER BY created_at DESC LIMIT 1
      )
      WHERE cb.callback_date LIKE ? || '%'
        AND cb.completed = 0
      ORDER BY cb.callback_date ASC
    `).all(today) as CallbackWithLeadRow[];

    const callbacks = rows.map(mapCallbackWithLeadRow);

    logger.info({ count: callbacks.length, date: today }, 'Fetched today callbacks');
    res.json(callbacks);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/callbacks
 * Creates a new callback reminder for a lead.
 */
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const data = createCallbackSchema.parse(req.body);

    // Verify the lead exists
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(data.leadId);
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    const result = db.prepare(
      'INSERT INTO callbacks (lead_id, callback_date, notes) VALUES (?, ?, ?)'
    ).run(data.leadId, data.callbackDate, data.notes || null);

    const created = db.prepare('SELECT * FROM callbacks WHERE id = ?').get(result.lastInsertRowid) as CallbackRow;

    logger.info({ callbackId: created.id, leadId: data.leadId, date: data.callbackDate }, 'Callback created');
    res.status(201).json(mapCallbackRow(created));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/callbacks/:id
 * Updates a callback (mark as completed, change notes, reschedule).
 */
router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid callback ID');
    }

    const updates = updateCallbackSchema.parse(req.body);

    const existing = db.prepare('SELECT * FROM callbacks WHERE id = ?').get(id) as CallbackRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Callback not found');
    }

    const setClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (updates.completed !== undefined) {
      setClauses.push('completed = @completed');
      params.completed = updates.completed ? 1 : 0;
    }
    if (updates.notes !== undefined) {
      setClauses.push('notes = @notes');
      params.notes = updates.notes;
    }
    if (updates.callbackDate !== undefined) {
      setClauses.push('callback_date = @callbackDate');
      params.callbackDate = updates.callbackDate;
    }

    if (setClauses.length === 0) {
      throw new ApiError(400, 'No valid fields to update');
    }

    params.id = id;
    db.prepare(`UPDATE callbacks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    const updatedRow = db.prepare('SELECT * FROM callbacks WHERE id = ?').get(id) as CallbackRow;
    res.json(mapCallbackRow(updatedRow));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/callbacks/:id
 * Deletes a callback.
 */
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid callback ID');
    }

    const result = db.prepare('DELETE FROM callbacks WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Callback not found');
    }

    logger.info({ callbackId: id }, 'Callback deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
