// ============================================================
// Pipeline Routes — /api/pipeline
// Pipeline view, stage/temperature changes, and stats
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Lead, PipelineStage, Temperature } from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'pipeline-routes' });
const router = Router();

// ============================================================
// Row mapper (reuse the same Lead row shape as leads.ts)
// ============================================================

interface LeadRow {
  id: number;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  lead_type: string;
  category: string | null;
  status: string;
  unanswered_calls: number;
  voicemail_left: number;
  voicemail_date: string | null;
  consolidated_summary: string | null;
  company_info: string | null;
  monday_item_id: string | null;
  pipeline_stage: string;
  temperature: string | null;
  converted_to_project: number;
  queue_position: number;
  last_called_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapLeadRow(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    website: row.website,
    leadType: row.lead_type as Lead['leadType'],
    category: row.category,
    status: row.status as Lead['status'],
    unansweredCalls: row.unanswered_calls,
    voicemailLeft: row.voicemail_left === 1,
    voicemailDate: row.voicemail_date,
    consolidatedSummary: row.consolidated_summary,
    companyInfo: row.company_info,
    mondayItemId: row.monday_item_id,
    pipelineStage: row.pipeline_stage as PipelineStage,
    temperature: (row.temperature as Temperature) ?? null,
    convertedToProject: row.converted_to_project === 1,
    queuePosition: row.queue_position,
    lastCalledAt: row.last_called_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Validation schemas
// ============================================================

const PIPELINE_STAGES: [PipelineStage, ...PipelineStage[]] = [
  'new_lead', 'follow_up', 'call_booked', 'negotiation', 'won', 'lost', 'not_interested',
];

const TEMPERATURES: [Temperature, ...Temperature[]] = ['hot', 'warm', 'cold'];

const updateStageSchema = z.object({
  stage: z.enum(PIPELINE_STAGES),
});

const updateTemperatureSchema = z.object({
  temperature: z.enum(TEMPERATURES).nullable(),
});

// ============================================================
// Helper: human-readable stage names
// ============================================================

const stageLabels: Record<PipelineStage, string> = {
  new_lead: 'New Lead',
  follow_up: 'Follow Up',
  call_booked: 'Call Booked',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  not_interested: 'Not Interested',
};

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/pipeline
 * Returns leads grouped by pipeline_stage with counts.
 * Optional filters: temperature, category
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { temperature, category } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: Record<string, string> = {};

    if (temperature && typeof temperature === 'string') {
      whereClause += ' AND temperature = @temperature';
      params.temperature = temperature;
    }
    if (category && typeof category === 'string') {
      whereClause += ' AND category = @category';
      params.category = category;
    }

    // Get counts per stage
    const countRows = db.prepare(`
      SELECT pipeline_stage, COUNT(*) AS count
      FROM leads ${whereClause}
      GROUP BY pipeline_stage
    `).all(params) as { pipeline_stage: string; count: number }[];

    const counts: Record<string, number> = {};
    for (const row of countRows) {
      counts[row.pipeline_stage] = row.count;
    }

    // Get leads grouped by stage
    const leadRows = db.prepare(`
      SELECT * FROM leads ${whereClause}
      ORDER BY pipeline_stage ASC, updated_at DESC
    `).all(params) as LeadRow[];

    const stages: Record<string, Lead[]> = {};
    for (const stage of PIPELINE_STAGES) {
      stages[stage] = [];
    }
    for (const row of leadRows) {
      const lead = mapLeadRow(row);
      if (stages[lead.pipelineStage]) {
        stages[lead.pipelineStage].push(lead);
      }
    }

    logger.info({ filters: { temperature, category }, totalLeads: leadRows.length }, 'Fetched pipeline');
    res.json({ stages, counts });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/pipeline/:leadId/stage
 * Changes a lead's pipeline stage and creates an activity record.
 */
router.patch('/:leadId/stage', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);

    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const payload = updateStageSchema.parse(req.body);

    const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Lead not found');
    }

    const oldStage = existing.pipeline_stage;
    const newStage = payload.stage;

    if (oldStage === newStage) {
      // No change needed, return lead as-is
      res.json(mapLeadRow(existing));
      return;
    }

    const now = new Date().toISOString();

    const updateStage = db.transaction(() => {
      db.prepare('UPDATE leads SET pipeline_stage = ?, updated_at = ? WHERE id = ?')
        .run(newStage, now, leadId);

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'stage_change', ?, ?, ?)
      `).run(
        leadId,
        `Moved to ${stageLabels[newStage] || newStage}`,
        `from ${stageLabels[oldStage as PipelineStage] || oldStage}`,
        now,
      );
    });

    updateStage();

    const updatedRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow;
    const lead = mapLeadRow(updatedRow);

    logger.info({ leadId, oldStage, newStage }, 'Pipeline stage changed');
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/pipeline/:leadId/temperature
 * Changes a lead's temperature and creates an activity record.
 */
router.patch('/:leadId/temperature', (req, res, next) => {
  try {
    const db = getDb();
    const leadId = parseInt(req.params.leadId, 10);

    if (isNaN(leadId)) {
      throw new ApiError(400, 'Invalid lead ID');
    }

    const payload = updateTemperatureSchema.parse(req.body);

    const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
    if (!existing) {
      throw new ApiError(404, 'Lead not found');
    }

    const oldTemp = existing.temperature;
    const newTemp = payload.temperature;
    const now = new Date().toISOString();

    const updateTemp = db.transaction(() => {
      db.prepare('UPDATE leads SET temperature = ?, updated_at = ? WHERE id = ?')
        .run(newTemp, now, leadId);

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at)
        VALUES (?, 'temperature_change', ?, ?, ?)
      `).run(
        leadId,
        `Temperature set to ${newTemp || 'none'}`,
        oldTemp ? `from ${oldTemp}` : null,
        now,
      );
    });

    updateTemp();

    const updatedRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow;
    const lead = mapLeadRow(updatedRow);

    logger.info({ leadId, oldTemp, newTemp }, 'Temperature changed');
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pipeline/stats
 * Pipeline metrics: leads per stage, conversion rates, avg time in each stage,
 * and total pipeline value (sum of project values for leads in negotiation/won).
 */
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();

    // Leads per stage
    const stageCounts = db.prepare(`
      SELECT pipeline_stage, COUNT(*) AS count
      FROM leads
      GROUP BY pipeline_stage
    `).all() as { pipeline_stage: string; count: number }[];

    const leadsPerStage: Record<string, number> = {};
    let totalLeads = 0;
    for (const row of stageCounts) {
      leadsPerStage[row.pipeline_stage] = row.count;
      totalLeads += row.count;
    }

    // Conversion rate: won / (won + lost) — only if there are closed leads
    const wonCount = leadsPerStage['won'] || 0;
    const lostCount = leadsPerStage['lost'] || 0;
    const closedTotal = wonCount + lostCount;
    const conversionRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : 0;

    // Total pipeline value — sum of project values for leads in negotiation or won
    const valueRow = db.prepare(`
      SELECT COALESCE(SUM(p.value), 0) AS total_value
      FROM projects p
      JOIN leads l ON l.id = p.lead_id
      WHERE l.pipeline_stage IN ('negotiation', 'won')
    `).get() as { total_value: number };

    // Temperature breakdown
    const tempCounts = db.prepare(`
      SELECT temperature, COUNT(*) AS count
      FROM leads
      WHERE temperature IS NOT NULL
      GROUP BY temperature
    `).all() as { temperature: string; count: number }[];

    const temperatureBreakdown: Record<string, number> = {};
    for (const row of tempCounts) {
      temperatureBreakdown[row.temperature] = row.count;
    }

    const stats = {
      byStage: leadsPerStage,
      conversionRate,
      totalPipelineValue: valueRow.total_value,
      byTemperature: temperatureBreakdown,
    };

    logger.info({ totalLeads, conversionRate }, 'Fetched pipeline stats');
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
