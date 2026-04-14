// ============================================================
// Projects Routes — /api/projects
// CRUD for projects and their tasks
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Project, ProjectTask, ProjectStatus } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'projects-routes' });
const router = Router();

// ============================================================
// Row mappers
// ============================================================

interface ProjectRow {
  id: number;
  lead_id: number | null;
  name: string;
  client_name: string;
  status: string;
  value: number;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectTaskRow {
  id: number;
  project_id: number;
  title: string;
  completed: number;
  created_at: string;
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    clientName: row.client_name,
    status: row.status as ProjectStatus,
    value: row.value,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskRow(row: ProjectTaskRow): ProjectTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
  };
}

// ============================================================
// Validation schemas
// ============================================================

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  clientName: z.string().min(1, 'Client name is required'),
  leadId: z.number().int().positive().optional(),
  value: z.number().min(0).optional(),
  description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  status: z.enum(['onboarding', 'in_progress', 'review', 'complete']).optional(),
  value: z.number().min(0).optional(),
  description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  completed: z.boolean().optional(),
});

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/projects
 * Lists all projects, optionally filtered by status.
 * Includes task counts (total, completed).
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { status } = req.query;

    let query = `
      SELECT p.*,
        COUNT(pt.id) AS task_count,
        SUM(CASE WHEN pt.completed = 1 THEN 1 ELSE 0 END) AS completed_count
      FROM projects p
      LEFT JOIN project_tasks pt ON pt.project_id = p.id
    `;
    const params: Record<string, string> = {};

    if (status && typeof status === 'string') {
      query += ' WHERE p.status = @status';
      params.status = status;
    }

    query += ' GROUP BY p.id ORDER BY p.created_at DESC';

    const rows = db.prepare(query).all(params) as (ProjectRow & { task_count: number; completed_count: number })[];

    const projects = rows.map((row) => ({
      ...mapProjectRow(row),
      taskCount: row.task_count,
      completedTaskCount: row.completed_count ?? 0,
    }));

    logger.info({ count: projects.length, status }, 'Fetched projects');
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:id
 * Returns a single project with all its tasks.
 */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid project ID');
    }

    const projectRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!projectRow) {
      throw new ApiError(404, 'Project not found');
    }

    const taskRows = db.prepare(
      'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at ASC'
    ).all(id) as ProjectTaskRow[];

    const project = mapProjectRow(projectRow);
    project.tasks = taskRows.map(mapTaskRow);

    res.json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects
 * Creates a new project. If leadId is provided, also creates an activity on the lead.
 */
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const payload = createProjectSchema.parse(req.body);
    const now = new Date().toISOString();

    const createProject = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO projects (lead_id, name, client_name, status, value, description, start_date, created_at, updated_at)
        VALUES (?, ?, ?, 'onboarding', ?, ?, ?, ?, ?)
      `).run(
        payload.leadId ?? null,
        payload.name,
        payload.clientName,
        payload.value ?? 0,
        payload.description ?? null,
        payload.startDate ?? null,
        now,
        now,
      );

      // If linked to a lead, create an activity and mark converted
      if (payload.leadId) {
        db.prepare(`
          INSERT INTO activities (lead_id, type, title, description, created_at)
          VALUES (?, 'stage_change', 'Converted to project', ?, ?)
        `).run(payload.leadId, `Project: ${payload.name}`, now);

        db.prepare('UPDATE leads SET converted_to_project = 1, updated_at = ? WHERE id = ?')
          .run(now, payload.leadId);
      }

      return result.lastInsertRowid;
    });

    const projectId = createProject();

    const projectRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow;
    const project = mapProjectRow(projectRow);
    project.tasks = [];

    logger.info({ projectId: project.id, leadId: payload.leadId }, 'Project created');
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/projects/:id
 * Updates project fields.
 */
router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid project ID');
    }

    const updates = updateProjectSchema.parse(req.body);

    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Project not found');
    }

    const setClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (updates.name !== undefined) {
      setClauses.push('name = @name');
      params.name = updates.name;
    }
    if (updates.clientName !== undefined) {
      setClauses.push('client_name = @clientName');
      params.clientName = updates.clientName;
    }
    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.value !== undefined) {
      setClauses.push('value = @value');
      params.value = updates.value;
    }
    if (updates.description !== undefined) {
      setClauses.push('description = @description');
      params.description = updates.description;
    }
    if (updates.startDate !== undefined) {
      setClauses.push('start_date = @startDate');
      params.startDate = updates.startDate;
    }
    if (updates.endDate !== undefined) {
      setClauses.push('end_date = @endDate');
      params.endDate = updates.endDate;
    }

    if (setClauses.length === 0) {
      throw new ApiError(400, 'No valid fields to update');
    }

    setClauses.push("updated_at = datetime('now')");
    params.id = id;

    db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    const updatedRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
    res.json(mapProjectRow(updatedRow));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/projects/:id
 * Deletes a project and all its tasks.
 */
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      throw new ApiError(400, 'Invalid project ID');
    }

    const deleteProject = db.transaction(() => {
      // Delete tasks first
      db.prepare('DELETE FROM project_tasks WHERE project_id = ?').run(id);
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return result.changes;
    });

    const changes = deleteProject();
    if (changes === 0) {
      throw new ApiError(404, 'Project not found');
    }

    logger.info({ projectId: id }, 'Project deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:id/tasks
 * Adds a task to a project.
 */
router.post('/:id/tasks', (req, res, next) => {
  try {
    const db = getDb();
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
      throw new ApiError(400, 'Invalid project ID');
    }

    const payload = createTaskSchema.parse(req.body);

    // Check project exists
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      throw new ApiError(404, 'Project not found');
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO project_tasks (project_id, title, completed, created_at)
      VALUES (?, ?, 0, ?)
    `).run(projectId, payload.title, now);

    const taskRow = db.prepare('SELECT * FROM project_tasks WHERE id = ?')
      .get(result.lastInsertRowid) as ProjectTaskRow;
    const task = mapTaskRow(taskRow);

    logger.info({ taskId: task.id, projectId }, 'Task created');
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/projects/:id/tasks/:taskId
 * Updates a task (toggle completed, rename).
 */
router.patch('/:id/tasks/:taskId', (req, res, next) => {
  try {
    const db = getDb();
    const projectId = parseInt(req.params.id, 10);
    const taskId = parseInt(req.params.taskId, 10);

    if (isNaN(projectId) || isNaN(taskId)) {
      throw new ApiError(400, 'Invalid project or task ID');
    }

    const updates = updateTaskSchema.parse(req.body);

    const existing = db.prepare(
      'SELECT * FROM project_tasks WHERE id = ? AND project_id = ?'
    ).get(taskId, projectId) as ProjectTaskRow | undefined;

    if (!existing) {
      throw new ApiError(404, 'Task not found');
    }

    const setClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      setClauses.push('title = @title');
      params.title = updates.title;
    }
    if (updates.completed !== undefined) {
      setClauses.push('completed = @completed');
      params.completed = updates.completed ? 1 : 0;
    }

    if (setClauses.length === 0) {
      throw new ApiError(400, 'No valid fields to update');
    }

    params.id = taskId;
    db.prepare(`UPDATE project_tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    const updatedRow = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(taskId) as ProjectTaskRow;
    res.json(mapTaskRow(updatedRow));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/projects/:id/tasks/:taskId
 * Deletes a task.
 */
router.delete('/:id/tasks/:taskId', (req, res, next) => {
  try {
    const db = getDb();
    const projectId = parseInt(req.params.id, 10);
    const taskId = parseInt(req.params.taskId, 10);

    if (isNaN(projectId) || isNaN(taskId)) {
      throw new ApiError(400, 'Invalid project or task ID');
    }

    const result = db.prepare(
      'DELETE FROM project_tasks WHERE id = ? AND project_id = ?'
    ).run(taskId, projectId);

    if (result.changes === 0) {
      throw new ApiError(404, 'Task not found');
    }

    logger.info({ taskId, projectId }, 'Task deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
