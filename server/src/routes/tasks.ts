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
import { createEvent, findEventByTitlePrefix, updateEvent } from '../services/google-calendar.js';
import { todayInSydney } from '../util/dates.js';
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
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskWithLeadRow extends TaskRow {
  lead_name: string;
  lead_company: string | null;
}

interface Task {
  id: number;
  leadId: number;
  label: string;
  dueDate: string;
  googleCalendarEventId: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskWithLead extends Task {
  leadName: string;
  leadCompany: string | null;
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    leadId: row.lead_id,
    label: row.label,
    dueDate: row.due_date,
    googleCalendarEventId: row.google_calendar_event_id,
    completed: row.completed === 1,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskWithLeadRow(row: TaskWithLeadRow): TaskWithLead {
  return {
    ...mapTaskRow(row),
    leadName: row.lead_name,
    leadCompany: row.lead_company,
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

    // Best-effort: create (or append to) a calendar event. If Google
    // isn't connected or the API fails, the task still saves.
    let calendarEventId: string | null = null;
    let calendarLink: string | null = null;
    try {
      const isTouchBase = payload.label.toLowerCase() === 'touch base';

      // Build a description block for this lead.
      // Order: OxyCRM link → latest note → contact info.
      const latestNote = db.prepare(
        'SELECT content FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(leadId) as { content: string } | undefined;

      const leadBlock: string[] = [];
      leadBlock.push(`--- ${lead.name}${lead.company ? ` (${lead.company})` : ''} ---`);
      leadBlock.push(`Open in OxyCRM: https://oxycrm-production.up.railway.app/leads/${leadId}`);
      if (latestNote?.content) {
        leadBlock.push(`Note: ${latestNote.content}`);
      }
      if (lead.phone) leadBlock.push(`Phone: ${lead.phone}`);
      if (lead.email) leadBlock.push(`Email: ${lead.email}`);

      // ── Touch Base consolidation ──────────────────────────
      // If this is a Touch Base task, look for an existing Touch Base
      // event on the same day. If found, append this lead to it instead
      // of creating a second event.
      if (isTouchBase) {
        const existing = await findEventByTitlePrefix(
          payload.dueDate,
          'Touch Base',
          'Australia/Sydney'
        );

        if (existing) {
          // Count how many lead blocks are already in the description
          const existingBlocks = (existing.description.match(/^---\s/gm) || []).length;
          const newCount = existingBlocks + 1;

          const updatedDescription = existing.description.trim() + '\n\n' + leadBlock.join('\n');
          const updatedSummary = `Touch Base — ${newCount} leads`;

          await updateEvent(existing.eventId, {
            summary: updatedSummary,
            description: updatedDescription,
          });

          calendarEventId = existing.eventId;

          if (calendarEventId) {
            db.prepare('UPDATE tasks SET google_calendar_event_id = ? WHERE id = ?')
              .run(calendarEventId, taskId);
          }

          logger.info(
            { leadId, taskId, eventId: existing.eventId, leadCount: newCount },
            'Appended lead to existing Touch Base calendar event'
          );
        } else {
          // No existing Touch Base event — create one.
          const startTime = `${payload.dueDate}T09:00:00`;
          const endTime = `${payload.dueDate}T09:30:00`;

          const event = await createEvent({
            summary: `Touch Base — ${lead.name}`,
            description: leadBlock.join('\n'),
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
        }
      } else {
        // ── Regular (non-Touch Base) task ──────────────────
        const startTime = `${payload.dueDate}T09:00:00`;
        const endTime = `${payload.dueDate}T09:30:00`;

        const descLines: string[] = [];
        descLines.push(`Open in OxyCRM: https://oxycrm-production.up.railway.app/leads/${leadId}`);
        if (latestNote?.content) {
          descLines.push('');
          descLines.push(`Latest note: ${latestNote.content}`);
        }
        descLines.push('');
        descLines.push(`Lead: ${lead.name}`);
        if (lead.company) descLines.push(`Company: ${lead.company}`);
        if (lead.phone) descLines.push(`Phone: ${lead.phone}`);
        if (lead.email) descLines.push(`Email: ${lead.email}`);

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
 * GET /api/tasks — global task list with lead info.
 * Returns all tasks, ordered by: incomplete first (overdue, then upcoming),
 * then completed (most recent first).
 */
router.get('/tasks', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*, l.name AS lead_name, l.company AS lead_company
      FROM tasks t
      JOIN leads l ON l.id = t.lead_id
      ORDER BY t.completed ASC, t.due_date ASC, t.created_at ASC
    `).all() as TaskWithLeadRow[];

    res.json(rows.map(mapTaskWithLeadRow));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tasks/stats — quick counts for the Tasks page header.
 */
router.get('/tasks/stats', (req, res, next) => {
  try {
    const db = getDb();
    const today = todayInSydney();

    const overdue = (db.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE completed = 0 AND due_date < ?'
    ).get(today) as { n: number }).n;

    const dueToday = (db.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE completed = 0 AND due_date = ?'
    ).get(today) as { n: number }).n;

    const upcoming = (db.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE completed = 0 AND due_date > ?'
    ).get(today) as { n: number }).n;

    const completedTotal = (db.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE completed = 1'
    ).get() as { n: number }).n;

    res.json({ overdue, dueToday, upcoming, completedTotal });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tasks/:id/complete — toggle task completion.
 * Sets completed=1 and completed_at=now, or unsets both.
 * Also logs an activity on the lead.
 */
router.patch('/tasks/:id/complete', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid task ID');
    }

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) {
      throw new ApiError(404, 'Task not found');
    }

    const wasCompleted = row.completed === 1;
    if (wasCompleted) {
      // Un-complete
      db.prepare(`
        UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
    } else {
      // Complete
      db.prepare(`
        UPDATE tasks SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(id);

      // Activity log
      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'meeting', ?, ?, datetime('now'))
      `).run(
        row.lead_id,
        `Task completed: ${row.label}`,
        `Was due ${formatDueDateLong(row.due_date)}`
      );
    }

    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    logger.info({ taskId: id, completed: !wasCompleted }, 'Task completion toggled');
    res.json(mapTaskRow(updated));
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
      // Set completed_at when marking complete, clear when unmarking
      if (updates.completed) {
        setClauses.push("completed_at = datetime('now')");
      } else {
        setClauses.push('completed_at = NULL');
      }
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

// ============================================================
// Calendar backfill — push unsync'd tasks to Google Calendar
//
// Called after an OAuth reconnect so tasks created while the
// calendar was disconnected still make it onto the calendar.
// Only processes incomplete tasks with a due date >= today that
// have no google_calendar_event_id yet.
// ============================================================

export async function backfillCalendarEvents(): Promise<{ synced: number; failed: number }> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Find all incomplete tasks that never made it to Google Calendar.
  const unsyncedTasks = db.prepare(`
    SELECT t.id, t.lead_id, t.label, t.due_date,
           l.name AS lead_name, l.company, l.phone, l.email
    FROM tasks t
    JOIN leads l ON l.id = t.lead_id
    WHERE t.google_calendar_event_id IS NULL
      AND t.completed = 0
      AND t.due_date >= ?
    ORDER BY t.due_date ASC
  `).all(today) as Array<{
    id: number;
    lead_id: number;
    label: string;
    due_date: string;
    lead_name: string;
    company: string | null;
    phone: string;
    email: string | null;
  }>;

  if (unsyncedTasks.length === 0) {
    logger.info('Calendar backfill: no unsynced tasks to push');
    return { synced: 0, failed: 0 };
  }

  logger.info({ count: unsyncedTasks.length }, 'Calendar backfill: pushing unsynced tasks');

  let synced = 0;
  let failed = 0;

  for (const task of unsyncedTasks) {
    try {
      const isTouchBase = task.label.toLowerCase() === 'touch base';

      // Fetch the latest note for this lead.
      const latestNote = db.prepare(
        'SELECT content FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(task.lead_id) as { content: string } | undefined;

      if (isTouchBase) {
        // ── Touch Base — consolidate into a single event per day ──
        const leadBlock: string[] = [];
        leadBlock.push(`--- ${task.lead_name}${task.company ? ` (${task.company})` : ''} ---`);
        leadBlock.push(`Open in OxyCRM: https://oxycrm-production.up.railway.app/leads/${task.lead_id}`);
        if (latestNote?.content) leadBlock.push(`Note: ${latestNote.content}`);
        if (task.phone) leadBlock.push(`Phone: ${task.phone}`);
        if (task.email) leadBlock.push(`Email: ${task.email}`);

        const existing = await findEventByTitlePrefix(
          task.due_date,
          'Touch Base',
          'Australia/Sydney'
        );

        if (existing) {
          const existingBlocks = (existing.description.match(/^---\s/gm) || []).length;
          const newCount = existingBlocks + 1;
          await updateEvent(existing.eventId, {
            summary: `Touch Base — ${newCount} leads`,
            description: existing.description.trim() + '\n\n' + leadBlock.join('\n'),
          });
          db.prepare('UPDATE tasks SET google_calendar_event_id = ? WHERE id = ?')
            .run(existing.eventId, task.id);
        } else {
          const event = await createEvent({
            summary: `Touch Base — ${task.lead_name}`,
            description: leadBlock.join('\n'),
            startTime: `${task.due_date}T09:00:00`,
            endTime: `${task.due_date}T09:30:00`,
            timezone: 'Australia/Sydney',
          });
          if (event.eventId) {
            db.prepare('UPDATE tasks SET google_calendar_event_id = ? WHERE id = ?')
              .run(event.eventId, task.id);
          }
        }
      } else {
        // ── Regular task — one event per task ──
        const descLines: string[] = [];
        descLines.push(`Open in OxyCRM: https://oxycrm-production.up.railway.app/leads/${task.lead_id}`);
        if (latestNote?.content) {
          descLines.push('');
          descLines.push(`Latest note: ${latestNote.content}`);
        }
        descLines.push('');
        descLines.push(`Lead: ${task.lead_name}`);
        if (task.company) descLines.push(`Company: ${task.company}`);
        if (task.phone) descLines.push(`Phone: ${task.phone}`);
        if (task.email) descLines.push(`Email: ${task.email}`);

        const event = await createEvent({
          summary: `${task.label} — ${task.lead_name}`,
          description: descLines.join('\n'),
          startTime: `${task.due_date}T09:00:00`,
          endTime: `${task.due_date}T09:30:00`,
          timezone: 'Australia/Sydney',
        });
        if (event.eventId) {
          db.prepare('UPDATE tasks SET google_calendar_event_id = ? WHERE id = ?')
            .run(event.eventId, task.id);
        }
      }

      synced++;
    } catch (err) {
      failed++;
      logger.warn(
        { taskId: task.id, leadId: task.lead_id, err: err instanceof Error ? err.message : err },
        'Calendar backfill: failed to push task'
      );
    }
  }

  logger.info({ synced, failed }, 'Calendar backfill complete');
  return { synced, failed };
}

export default router;
