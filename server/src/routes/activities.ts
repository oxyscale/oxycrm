// ============================================================
// Activities Routes — /api/activities
// Activity timeline for leads and the dashboard
// ============================================================

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Activity } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'activities-routes' });
const router = Router();

// ============================================================
// Row mapper
// ============================================================

interface ActivityRow {
  id: number;
  lead_id: number;
  type: string;
  title: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
}

function mapActivityRow(row: ActivityRow): Activity {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.type as Activity['type'],
    title: row.title,
    description: row.description,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/activities/lead/:leadId
 * Returns all activities for a lead, newest first, with pagination.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/lead/:leadId', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);

    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const rows = db.prepare(`
      SELECT * FROM activities
      WHERE lead_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(leadId, limit, offset) as ActivityRow[];

    // Get total count for pagination
    const countRow = db.prepare(
      'SELECT COUNT(*) AS total FROM activities WHERE lead_id = ?'
    ).get(leadId) as { total: number };

    const activities = rows.map(mapActivityRow);

    logger.info({ leadId, count: activities.length, total: countRow.total }, 'Fetched activities for lead');
    res.json({
      activities,
      total: countRow.total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/activities/recent
 * Returns the most recent activities across all leads (for dashboard).
 * Returns up to 20 activities with lead name attached.
 */
router.get('/recent', (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);

    const rows = db.prepare(`
      SELECT a.*, l.name AS lead_name, l.company AS lead_company
      FROM activities a
      LEFT JOIN leads l ON l.id = a.lead_id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(limit) as (ActivityRow & { lead_name: string | null; lead_company: string | null })[];

    const activities = rows.map((row) => ({
      ...mapActivityRow(row),
      leadName: row.lead_name,
      leadCompany: row.lead_company,
    }));

    logger.info({ count: activities.length }, 'Fetched recent activities');
    res.json(activities);
  } catch (err) {
    next(err);
  }
});

export default router;
