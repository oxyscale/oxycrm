// ============================================================
// Categories Routes — /api/categories
//
// Managed list of lead categories. Used as dropdown values when
// creating or editing leads. New categories are added via the
// Settings page; this keeps the list clean and prevents typos.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import pino from 'pino';

const logger = pino({ name: 'categories-routes' });
const router = Router();

// ── Types ──────────────────────────────────────────────────

interface CategoryRow {
  id: number;
  name: string;
  created_at: string;
  lead_count?: number;
}

// ── GET /api/categories — list all categories ──────────────
// Returns lead_count so the Settings UI can show "Property Styling · 12 leads"
// and decide whether the trash-icon confirm modal needs the "also delete leads"
// option.

router.get('/', (_req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.id, c.name, c.created_at,
        (SELECT COUNT(*) FROM leads WHERE LOWER(leads.category) = LOWER(c.name)) AS lead_count
      FROM categories c
      ORDER BY c.name ASC
    `).all() as CategoryRow[];

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/categories — create a category ──────────────

const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(80),
});

router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const { name } = createCategorySchema.parse(req.body);

    // Check for duplicates (COLLATE NOCASE handles case-insensitive uniqueness).
    const existing = db.prepare(
      'SELECT id FROM categories WHERE name = ?'
    ).get(name) as { id: number } | undefined;

    if (existing) {
      throw new ApiError(409, `Category "${name}" already exists`);
    }

    const result = db.prepare(
      'INSERT INTO categories (name) VALUES (?)'
    ).run(name);

    const row = db.prepare(
      'SELECT id, name, created_at FROM categories WHERE id = ?'
    ).get(result.lastInsertRowid) as CategoryRow;

    logger.info({ id: row.id, name: row.name }, 'Category created');
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/categories/:id — delete a category ─────────
//
// Default: deletes the category from the managed list only. Any leads
// that still carry this string in their `category` field keep it (they
// just lose the dropdown entry).
//
// With ?deleteLeads=true: also deletes every lead whose `category`
// matches this category's name (case-insensitive). Cascades through FK
// (call_logs, notes, tasks, activities, emails_sent, projects) so no
// orphan rows are left behind. Irreversible.

router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid category ID');
    }

    const cat = db.prepare('SELECT id, name FROM categories WHERE id = ?')
      .get(id) as { id: number; name: string } | undefined;
    if (!cat) {
      throw new ApiError(404, 'Category not found');
    }

    const deleteLeads = req.query.deleteLeads === 'true' || req.query.deleteLeads === '1';

    let leadsDeleted = 0;
    const tx = db.transaction(() => {
      if (deleteLeads) {
        const r = db.prepare(
          'DELETE FROM leads WHERE LOWER(category) = LOWER(?)',
        ).run(cat.name);
        leadsDeleted = r.changes;
      }
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    tx();

    logger.info({ id, name: cat.name, leadsDeleted, deleteLeads }, 'Category deleted');
    res.json({ name: cat.name, leadsDeleted });
  } catch (err) {
    next(err);
  }
});

export default router;
