// ============================================================
// Lead Sources Routes — /api/lead-sources
//
// Managed list of lead sources — the CHANNEL a lead arrived through
// (Cold call, Meta ad, Miller-Leith network, ...). Deliberately
// separate from `categories`, which is the INDUSTRY the business
// operates in. One channel brings in leads across many industries,
// so collapsing the two made the data unfilterable.
//
// Mirrors the categories route: curated in Settings so the dropdown
// stays clean and free of typo variants.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import pino from 'pino';

const logger = pino({ name: 'lead-sources-routes' });
const router = Router();

// ── Types ──────────────────────────────────────────────────

interface LeadSourceRow {
  id: number;
  name: string;
  created_at: string;
  lead_count?: number;
}

// ── GET /api/lead-sources — list all sources ───────────────
// Returns lead_count so Settings can show "Cold call · 1,180 leads"
// and warn before deleting a source that's actually in use.

router.get('/', (_req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.id, s.name, s.created_at,
        (SELECT COUNT(*) FROM leads WHERE LOWER(leads.lead_source) = LOWER(s.name)) AS lead_count
      FROM lead_sources s
      ORDER BY s.name ASC
    `).all() as LeadSourceRow[];

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/lead-sources — create a source ───────────────

const createSourceSchema = z.object({
  name: z.string().min(1, 'Source name is required').max(80),
});

router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const { name } = createSourceSchema.parse(req.body);
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, 'Source name is required');

    // COLLATE NOCASE on the column handles case-insensitive uniqueness.
    const existing = db.prepare(
      'SELECT id FROM lead_sources WHERE name = ?'
    ).get(trimmed) as { id: number } | undefined;

    if (existing) {
      throw new ApiError(409, `Lead source "${trimmed}" already exists`);
    }

    const result = db.prepare(
      'INSERT INTO lead_sources (name) VALUES (?)'
    ).run(trimmed);

    const row = db.prepare(
      'SELECT id, name, created_at FROM lead_sources WHERE id = ?'
    ).get(result.lastInsertRowid) as LeadSourceRow;

    logger.info({ id: row.id, name: row.name }, 'Lead source created');
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/lead-sources/:id — rename a source ──────────
//
// Renames the managed entry AND re-stamps every lead currently
// carrying the old string, so a rename never orphans historical data
// (which is exactly what would break the source breakdown on Reports).

const renameSourceSchema = z.object({
  name: z.string().min(1, 'Source name is required').max(80),
});

router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid lead source ID');

    const { name } = renameSourceSchema.parse(req.body);
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, 'Source name is required');

    const existing = db.prepare('SELECT id, name FROM lead_sources WHERE id = ?')
      .get(id) as { id: number; name: string } | undefined;
    if (!existing) throw new ApiError(404, 'Lead source not found');

    const clash = db.prepare(
      'SELECT id FROM lead_sources WHERE name = ? AND id != ?'
    ).get(trimmed, id) as { id: number } | undefined;
    if (clash) throw new ApiError(409, `Lead source "${trimmed}" already exists`);

    let leadsUpdated = 0;
    const tx = db.transaction(() => {
      db.prepare('UPDATE lead_sources SET name = ? WHERE id = ?').run(trimmed, id);
      const r = db.prepare(
        'UPDATE leads SET lead_source = ? WHERE LOWER(lead_source) = LOWER(?)',
      ).run(trimmed, existing.name);
      leadsUpdated = r.changes;
    });
    tx();

    logger.info({ id, from: existing.name, to: trimmed, leadsUpdated }, 'Lead source renamed');
    res.json({ id, name: trimmed, leadsUpdated });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/lead-sources/:id — delete a source ─────────
//
// Removes the entry from the managed list. Leads keep whatever string
// they already carry (they just lose the dropdown option), so this is
// never destructive to lead data — unlike the categories equivalent,
// there is deliberately no "also delete leads" option here. Deleting a
// channel should never delete the leads that came through it.

router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid lead source ID');

    const src = db.prepare('SELECT id, name FROM lead_sources WHERE id = ?')
      .get(id) as { id: number; name: string } | undefined;
    if (!src) throw new ApiError(404, 'Lead source not found');

    const inUse = db.prepare(
      'SELECT COUNT(*) AS n FROM leads WHERE LOWER(lead_source) = LOWER(?)',
    ).get(src.name) as { n: number };

    db.prepare('DELETE FROM lead_sources WHERE id = ?').run(id);

    logger.info({ id, name: src.name, leadsStillTagged: inUse.n }, 'Lead source deleted');
    res.json({ name: src.name, leadsStillTagged: inUse.n });
  } catch (err) {
    next(err);
  }
});

export default router;
