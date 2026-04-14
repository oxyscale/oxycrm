// ============================================================
// Notes Routes — /api/notes
// CRUD operations for standalone notes on leads
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Note } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'notes-routes' });
const router = Router();

// ============================================================
// Row mapper — convert snake_case DB rows to camelCase types
// ============================================================

interface NoteRow {
  id: number;
  lead_id: number;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function mapNoteRow(row: NoteRow): Note {
  return {
    id: row.id,
    leadId: row.lead_id,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Validation schemas
// ============================================================

const createNoteSchema = z.object({
  leadId: z.number().int().positive(),
  content: z.string().min(1, 'Note content is required'),
});

const updateNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/notes/lead/:leadId
 * Returns all notes for a lead, newest first.
 */
router.get('/lead/:leadId', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);

    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const rows = db.prepare(
      'SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC'
    ).all(leadId) as NoteRow[];

    const notes = rows.map(mapNoteRow);

    logger.info({ leadId, count: notes.length }, 'Fetched notes for lead');
    res.json(notes);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notes
 * Creates a new note and an associated activity record.
 */
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const payload = createNoteSchema.parse(req.body);

    // Check lead exists
    const leadExists = db.prepare('SELECT id FROM leads WHERE id = ?').get(payload.leadId);
    if (!leadExists) {
      throw new ApiError(404, 'Lead not found');
    }

    const now = new Date().toISOString();

    const createNote = db.transaction(() => {
      // Insert the note
      const result = db.prepare(`
        INSERT INTO notes (lead_id, content, created_by, created_at, updated_at)
        VALUES (?, ?, 'jordan', ?, ?)
      `).run(payload.leadId, payload.content, now, now);

      // Create an activity record
      const snippet = payload.content.length > 80
        ? payload.content.substring(0, 80) + '...'
        : payload.content;

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'note', 'Note added', ?, ?)
      `).run(payload.leadId, snippet, now);

      return result.lastInsertRowid;
    });

    const noteId = createNote();

    const noteRow = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as NoteRow;
    const note = mapNoteRow(noteRow);

    logger.info({ noteId: note.id, leadId: payload.leadId }, 'Note created');
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/notes/:id
 * Updates note content and sets updated_at.
 */
router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid note ID');
    }

    const payload = updateNoteSchema.parse(req.body);

    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Note not found');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(payload.content, now, id);

    const updatedRow = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
    const note = mapNoteRow(updatedRow);

    logger.info({ noteId: id }, 'Note updated');
    res.json(note);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/notes/:id
 * Deletes a note.
 */
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid note ID');
    }

    const result = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Note not found');
    }

    logger.info({ noteId: id }, 'Note deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
