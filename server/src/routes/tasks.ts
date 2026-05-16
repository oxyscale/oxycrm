// ============================================================
// Tasks Routes — /api/tasks and /api/leads/:leadId/tasks
//
// A task is a scheduled follow-up attached to a lead. When created,
// we also (best-effort) drop a Google Calendar event on the user's
// primary calendar so it appears in their normal day view alongside
// every other commitment.
//
// Calendar push is best-effort — if Google isn't connected or the API
// fails, the task still saves and we just log the error.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { createEvent } from '../services/google-calendar.js';
import pino from 'pino';

const logger = pino({ name: 'tasks-routes' });
const router = Router();

// Format a YYYY-MM-DD date as "17th of May 2026" — used in activity
// timeline descriptions so it reads like a sentence, not a SQL date.
function formatDueDateLong(yyyymmdd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return yyyymmdd;
  const [, year, month, day] = match;
  const d = parseInt(day, 10);
  const monthName = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, d))
    .toLocaleDateString('en-AU', { month: 'long', timeZone: 'UTC' });
  // Ordinal suffix for the day number (1st, 2nd, 3rd, 4th ... 21st ... 31st).
  const suffix =
    d % 100 >= 11 && d % 100 <= 13 ? 'th'
    : d % 10 === 1 ? 'st'
    : d % 10 === 2 ? 'nd'
    : d % 10 === 3 ? 'rd'
    : 'th';
  return `${d}${suffix} of ${monthName} ${year}`;
}

// ============================================================
// Types + mappers
// ============================================================

interface TaskRow {
  id: number;
  lead_id: number;
  label: string;
  due_date: string;
  google_calendar_event_id: string | null;
  completed: number;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: number;
  leadId: number;
  label: string;
  dueDate: string;
  googleCalendarEventId: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    leadId: row.lead_id,
    label: row.label,
    dueDate: row.due_date,
    googleCalendarEventId: row.google_calendar_event_id,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Validation
// ============================================================

const createTaskSchema = z.object({
  label: z.string().min(1, 'Task label is required').max(200),
  // Date-only string. Anchor the calendar event to 9am local time on this day
  // so it shows up as a morning reminder rather than midnight.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
});

const updateTaskSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completed: z.boolean().optional(),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/leads/:leadId/tasks
 * Returns all tasks for a lead, ordered by due date (soonest first,
 * incomplete first within the same date).
 */
router.get('/leads/:leadId/tasks', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE lead_id = ?
      ORDER BY completed ASC, due_date ASC, created_at ASC
    `).all(leadId) as TaskRow[];

    res.json(rows.map(mapTaskRow));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/leads/:leadId/tasks
 * Creates a task on a lead. Best-effort drops a calendar event too.
 *
 * Body: { label: string, dueDate: 'YYYY-MM-DD' }
 */
router.post('/leads/:leadId/tasks', async (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const payload = createTaskSchema.parse(req.body);

    const lead = db.prepare(
      'SELECT id, name, company, phone, email FROM leads WHERE id = ?'
    ).get(leadId) as
      | { id: number; name: string; company: string | null; phone: string; email: string | null }
      | undefined;
    if (!lead) {
      throw new ApiError(404, 'Lead not found');
    }

    // Insert the task first (no calendar id yet).
    const insert = db.prepare(`
      INSERT INTO tasks (lead_id, label, due_date)
      VALUES (?, ?, ?)
    `).run(leadId, payload.label, payload.dueDate);
    const taskId = insert.lastInsertRowid as number;

    // Best-effort: create the calendar event. If Google isn't connected
    // (or anything else fails) we just log — task creation still succeeds.
    let calendarEventId: string | null = null;
    let calendarLink: string | null = null;
    try {
      // Anchor to 9am local Sydney time, 30-minute event window.
      const startTime = `${payload.dueDate}T09:00:00`;
      const endTime = `${payload.dueDate}T09:30:00`;

      const descLines: string[] = [];
      descLines.push(`Lead: ${lead.name}`);
      if (lead.company) descLines.push(`Company: ${lead.company}`);
      if (lead.phone) descLines.push(`Phone: ${lead.phone}`);
      if (lead.email) descLines.push(`Email: ${lead.email}`);
      descLines.push('');
      descLines.push(`Open in OxyCRM: https://oxycrm-production.up.railway.app/leads/${leadId}`);

      const event = await createEvent({
        summary: `${payload.label} — ${lead.name}`,
        description: descLines.join('\n'),
        startTime,
        endTime,
        timezone: 'Australia/Sydney',
      });
      calendarEventId = event.eventId || null;
      calendarLink = event.htmlLink || null;

      if (calendarEventId) {
        db.prepare('UPDATE tasks SET google_calendar_event_id = ? WHERE id = ?')
          .run(calendarEventId, taskId);
      }
    } catch (err) {
      logger.warn(
        { leadId, taskId, err: err instanceof Error ? err.message : err },
        'Calendar event creation failed for task — task saved without calendar mirror'
      );
    }

    // Mirror as a follow-up date on the lead so it surfaces in the
    // existing Pipeline > Follow-ups view (only if the new date is sooner
    // than what's already there, or there's nothing there).
    const existingFollowUp = (db.prepare(
      'SELECT follow_up_date FROM leads WHERE id = ?'
    ).get(leadId) as { follow_up_date: string | null }).follow_up_date;
    if (!existingFollowUp || payload.dueDate < existingFollowUp) {
      db.prepare("UPDATE leads SET follow_up_date = ?, updated_at = datetime('now') WHERE id = ?")
        .run(payload.dueDate, leadId);
    }

    // Drop an activity row so the timeline shows the task creation
    db.prepare(`
      INSERT INTO activities (lead_id, type, title, description, created_at)
      VALUES (?, 'meeting', ?, ?, datetime('now'))
    `).run(
      leadId,
      `Task scheduled: ${payload.label}`,
      `Due ${formatDueDateLong(payload.dueDate)}${calendarEventId ? ' (added to Google Calendar)' : ''}`
    );

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
    logger.info(
      { leadId, taskId, dueDate: payload.dueDate, calendarEventId },
      'Task created'
    );
    res.status(201).json({
      ...mapTaskRow(row),
      calendarLink,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tasks/:id — update label, due date, or completion status.
 */
router.patch('/tasks/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid task ID');
    }

    const updates = updateTaskSchema.parse(req.body);
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.label !== undefined) {
      setClauses.push('label = @label');
      params.label = updates.label;
    }
    if (updates.dueDate !== undefined) {
      setClauses.push('due_date = @dueDate');
      params.dueDate = updates.dueDate;
    }
    if (updates.completed !== undefined) {
      setClauses.push('completed = @completed');
      params.completed = updates.completed ? 1 : 0;
    }
    if (setClauses.length === 0) {
      throw new ApiError(400, 'No fields to update');
    }
    setClauses.push("updated_at = datetime('now')");

    const result = db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    if (result.changes === 0) {
      throw new ApiError(404, 'Task not found');
    }

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    res.json(mapTaskRow(row));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tasks/:id
 */
router.delete('/tasks/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid task ID');
    }

    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new ApiError(404, 'Task not found');
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
