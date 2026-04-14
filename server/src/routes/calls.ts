// ============================================================
// Calls Routes — /api/calls
// Manages call log records (read and create)
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { CallLog } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'calls-routes' });
const router = Router();

// ============================================================
// Row mapper
// ============================================================

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

const createCallLogSchema = z.object({
  leadId: z.number().int().positive(),
  duration: z.number().int().min(0).nullable().optional(),
  transcript: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  keyTopics: z.array(z.string()).optional(),
  actionItems: z.array(z.string()).optional(),
  sentiment: z.string().nullable().optional(),
  disposition: z.enum(['no_answer', 'voicemail', 'not_interested', 'interested', 'wrong_number']),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/calls/stats
 * Returns aggregated call statistics for dashboard display.
 * Supports period filtering: today, week, month, all
 */
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();
    const period = (req.query.period as string) || 'today';

    let dateFilter = '';
    switch (period) {
      case 'today':
        dateFilter = "AND date(created_at) = date('now')";
        break;
      case 'week':
        dateFilter = "AND created_at >= datetime('now', '-7 days')";
        break;
      case 'month':
        dateFilter = "AND created_at >= datetime('now', '-30 days')";
        break;
      case 'all':
        dateFilter = '';
        break;
      default:
        dateFilter = "AND date(created_at) = date('now')";
    }

    // Total calls
    const totalRow = db.prepare(
      `SELECT COUNT(*) as total FROM call_logs WHERE 1=1 ${dateFilter}`
    ).get() as { total: number };

    // Calls by disposition
    const dispositionRows = db.prepare(
      `SELECT disposition, COUNT(*) as count FROM call_logs WHERE 1=1 ${dateFilter} GROUP BY disposition`
    ).all() as { disposition: string; count: number }[];

    const byDisposition: Record<string, number> = {};
    for (const row of dispositionRows) {
      byDisposition[row.disposition] = row.count;
    }

    // Average call duration (only connected calls with duration > 0)
    const avgRow = db.prepare(
      `SELECT AVG(duration) as avg_duration FROM call_logs WHERE duration > 0 ${dateFilter}`
    ).get() as { avg_duration: number | null };

    // Calls by hour (for best time analysis)
    const hourlyRows = db.prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count,
       SUM(CASE WHEN disposition IN ('interested') THEN 1 ELSE 0 END) as interested_count
       FROM call_logs WHERE 1=1 ${dateFilter}
       GROUP BY hour ORDER BY hour`
    ).all() as { hour: number; count: number; interested_count: number }[];

    // Total answered (interested + not_interested = actually spoke to someone)
    const answered = (byDisposition['interested'] || 0) + (byDisposition['not_interested'] || 0);
    const connectRate = totalRow.total > 0 ? Math.round((answered / totalRow.total) * 100) : 0;
    const interestedRate = answered > 0 ? Math.round(((byDisposition['interested'] || 0) / answered) * 100) : 0;

    // Best hour for connects
    let bestHour: number | null = null;
    let bestHourRate = 0;
    for (const h of hourlyRows) {
      if (h.count >= 2) { // Only consider hours with enough data
        const rate = h.interested_count / h.count;
        if (rate > bestHourRate) {
          bestHourRate = rate;
          bestHour = h.hour;
        }
      }
    }

    const stats = {
      totalCalls: totalRow.total,
      answered,
      noAnswer: byDisposition['no_answer'] || 0,
      voicemails: byDisposition['voicemail'] || 0,
      interested: byDisposition['interested'] || 0,
      notInterested: byDisposition['not_interested'] || 0,
      connectRate,
      interestedRate,
      avgDuration: avgRow.avg_duration ? Math.round(avgRow.avg_duration) : 0,
      bestHour,
      hourlyBreakdown: hourlyRows,
    };

    logger.info({ period, totalCalls: stats.totalCalls }, 'Stats fetched');
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/calls/lead/:leadId
 * Returns all call logs for a specific lead, ordered by most recent first.
 * Used to display call history on the dialler screen for callback leads.
 */
router.get('/lead/:leadId', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);

    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId);
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    const rows = db
      .prepare('SELECT * FROM call_logs WHERE lead_id = ? ORDER BY created_at DESC')
      .all(leadId) as CallLogRow[];

    const callLogs = rows.map(mapCallLogRow);

    logger.info({ leadId, count: callLogs.length }, 'Fetched call logs for lead');
    res.json(callLogs);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/calls
 * Creates a call log record manually.
 * Normally call logs are created by the disposition endpoint,
 * but this endpoint exists for flexibility (e.g. manual notes, testing).
 */
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const data = createCallLogSchema.parse(req.body);

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(data.leadId);
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    const result = db.prepare(`
      INSERT INTO call_logs (lead_id, duration, transcript, summary, key_topics, action_items, sentiment, disposition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.leadId,
      data.duration ?? null,
      data.transcript ?? null,
      data.summary ?? null,
      data.keyTopics ? JSON.stringify(data.keyTopics) : null,
      data.actionItems ? JSON.stringify(data.actionItems) : null,
      data.sentiment ?? null,
      data.disposition,
    );

    const created = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(result.lastInsertRowid) as CallLogRow;

    logger.info({ callLogId: created.id, leadId: data.leadId, disposition: data.disposition }, 'Call log created');
    res.status(201).json(mapCallLogRow(created));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/calls/:id/disposition
 * Changes the disposition on an existing call log.
 * Used when the user accidentally clicks the wrong disposition.
 * Also updates the lead's pipeline stage.
 *
 * Body: { disposition: 'no_answer' | 'voicemail' | 'not_interested' | 'interested' | 'wrong_number' }
 */
router.patch('/:id/disposition', async (req, res, next) => {
  try {
    const db = getDb();
    const callId = parseInt(req.params.id, 10);

    if (isNaN(callId)) {
      throw new ApiError(400, 'Invalid call log ID');
    }

    const { disposition } = req.body;
    const validDispositions = ['no_answer', 'voicemail', 'not_interested', 'interested', 'wrong_number'];

    if (!disposition || !validDispositions.includes(disposition)) {
      throw new ApiError(400, `Disposition must be one of: ${validDispositions.join(', ')}`);
    }

    // Get the call log
    const callRow = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(callId) as CallLogRow | undefined;
    if (!callRow) {
      throw new ApiError(404, 'Call log not found');
    }

    const oldDisposition = callRow.disposition;

    // Update the call log disposition
    db.prepare("UPDATE call_logs SET disposition = ?, created_at = created_at WHERE id = ?")
      .run(disposition, callId);

    // Get the lead so we can update local status
    const leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(callRow.lead_id) as {
      id: number;
      status: string;
    } | undefined;

    if (leadRow) {
      // Update local lead status based on new disposition
      if (disposition === 'wrong_number') {
        // Delete the lead entirely
        db.prepare('DELETE FROM call_logs WHERE lead_id = ?').run(leadRow.id);
        db.prepare('DELETE FROM leads WHERE id = ?').run(leadRow.id);
        logger.info({ leadId: leadRow.id, callId }, 'Lead deleted via re-disposition — wrong number');
      } else if (disposition === 'interested' || disposition === 'not_interested') {
        db.prepare("UPDATE leads SET status = 'called', updated_at = datetime('now') WHERE id = ?")
          .run(leadRow.id);
      } else if (disposition === 'no_answer' || disposition === 'voicemail') {
        // Put back in queue if it was previously marked as called
        if (leadRow.status === 'called') {
          const maxPos = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM leads').get() as { max_pos: number }).max_pos;
          db.prepare("UPDATE leads SET status = 'not_called', queue_position = ?, updated_at = datetime('now') WHERE id = ?")
            .run(maxPos + 1, leadRow.id);
        }
      }
    }

    // Return the updated call log
    const updatedRow = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(callId) as CallLogRow;
    logger.info({ callId, oldDisposition, newDisposition: disposition }, 'Call disposition changed');
    res.json(mapCallLogRow(updatedRow));
  } catch (err) {
    next(err);
  }
});

export default router;
