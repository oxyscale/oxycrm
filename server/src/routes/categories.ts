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
}

// ── GET /api/categories — list all categories ──────────────

router.get('/', (_req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, name, created_at FROM categories ORDER BY name ASC'
    ).all() as CategoryRow[];

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

router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid category ID');
    }

    const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Category not found');
    }

    logger.info({ id }, 'Category deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
