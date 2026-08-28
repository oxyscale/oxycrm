// ============================================================
// Pipeline Routes — /api/pipeline
// Pipeline view, stage/temperature changes, and stats
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { todayInMelbourne } from '../util/dates.js';
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
  lead_source: string | null;
  campaign: string | null;
  campaign_content: string | null;
  status: string;
  unanswered_calls: number;
  voicemail_left: number;
  voicemail_date: string | null;
  consolidated_summary: string | null;
  company_info: string | null;
  monday_item_id: string | null;
  pipeline_stage: string | null;
  temperature: string | null;
  converted_to_project: number;
  follow_up_date: string | null;
  deal_value: number;
  queue_position: number;
  last_called_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapLeadRow(row: LeadRow & { current_retainer?: number | null }): Lead {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    website: row.website,
    leadType: row.lead_type as Lead['leadType'],
    category: row.category,
    leadSource: row.lead_source,
    campaign: row.campaign,
    campaignContent: row.campaign_content,
    status: row.status as Lead['status'],
    unansweredCalls: row.unanswered_calls,
    voicemailLeft: row.voicemail_left === 1,
    voicemailDate: row.voicemail_date,
    consolidatedSummary: row.consolidated_summary,
    companyInfo: row.company_info,
    mondayItemId: row.monday_item_id,
    pipelineStage: (row.pipeline_stage as PipelineStage | null) ?? null,
    temperature: (row.temperature as Temperature) ?? null,
    convertedToProject: row.converted_to_project === 1,
    followUpDate: row.follow_up_date,
    dealValue: row.deal_value ?? 0,
    // What a client actually pays, when they are one. The kanban shows
    // this in preference to deal_value, which is only ever an estimate.
    currentRetainer: row.current_retainer ?? 0,
    queuePosition: row.queue_position,
    lastCalledAt: row.last_called_at,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Validation schemas
// ============================================================

// Board order, left to right. No Answer is a calling outcome that sits
// beside New lead; On Ice parks a deal that has gone quiet after the
// pitch. Neither is a closed outcome — both can be revived.
const PIPELINE_STAGES: [PipelineStage, ...PipelineStage[]] = [
  'new_lead', 'no_answer', 'meeting_booked', 'proposal', 'pulse', 'on_ice', 'won', 'lost',
];

const TEMPERATURES: [Temperature, ...Temperature[]] = ['hot', 'warm', 'cold'];

const updateStageSchema = z.object({
  // null = remove from kanban (lead stays in /leads but isn't placed in any tier)
  stage: z.enum(PIPELINE_STAGES).nullable(),
});

const updateTemperatureSchema = z.object({
  temperature: z.enum(TEMPERATURES).nullable(),
});

// ============================================================
// Helper: human-readable stage names
// ============================================================

const stageLabels: Record<PipelineStage, string> = {
  new_lead: 'New lead',
  no_answer: 'No answer',
  meeting_booked: 'Meeting booked',
  proposal: 'Proposal sent',
  pulse: 'Pulse',
  on_ice: 'On ice',
  won: 'Won',
  lost: 'Lost',
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
      SELECT leads.*, r.monthly_amount AS current_retainer
        FROM leads
        LEFT JOIN current_retainers r ON r.lead_id = leads.id
      ${whereClause}
      ORDER BY pipeline_stage ASC, updated_at DESC
    `).all(params) as (LeadRow & { current_retainer: number | null })[];

    const stages: Record<string, Lead[]> = {};
    for (const stage of PIPELINE_STAGES) {
      stages[stage] = [];
    }
    for (const row of leadRows) {
      const lead = mapLeadRow(row);
      // Skip leads with no pipeline stage — they're hidden from the kanban
      // by design (live in /leads only).
      if (lead.pipelineStage && stages[lead.pipelineStage]) {
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
 * GET /api/pipeline/follow-ups
 * Returns every lead with a follow_up_date set, regardless of tier
 * (excluding 'won' and 'lost' since those are closed). Sorted by date.
 * Includes an isOverdue flag for dates in the past.
 */
router.get('/follow-ups', (_req, res, next) => {
  try {
    const db = getDb();
    const today = todayInMelbourne(); // Melbourne YYYY-MM-DD

    const rows = db.prepare(`
      SELECT *,
        CASE WHEN follow_up_date IS NOT NULL AND follow_up_date < ? THEN 1 ELSE 0 END as is_overdue
      FROM leads
      WHERE follow_up_date IS NOT NULL
        AND pipeline_stage NOT IN ('won', 'lost')
      ORDER BY
        follow_up_date ASC,
        updated_at DESC
    `).all(today) as (LeadRow & { is_overdue: number })[];

    const leads = rows.map((row) => ({
      ...mapLeadRow(row),
      isOverdue: row.is_overdue === 1,
    }));

    res.json(leads);
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

    const actor = req.user?.name || null;
    const updateStage = db.transaction(() => {
      db.prepare('UPDATE leads SET pipeline_stage = ?, updated_at = ? WHERE id = ?')
        .run(newStage, now, leadId);

      const newLabel = newStage ? (stageLabels[newStage] || newStage) : 'No tier';
      const oldLabel = oldStage ? (stageLabels[oldStage as PipelineStage] || oldStage) : 'No tier';
      // Record the machine-readable stage in metadata as well as the
      // human title. The Investor Report's funnel needs "how many
      // entered this stage this month", and parsing "Moved to Pulse"
      // out of a display string breaks the moment a label is reworded.
      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, metadata, created_at, created_by)
        VALUES (?, 'stage_change', ?, ?, ?, ?, ?)
      `).run(
        leadId,
        `Moved to ${newLabel}`,
        `from ${oldLabel}`,
        JSON.stringify({ from: oldStage ?? null, to: newStage ?? null }),
        now,
        actor,
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

    const actor = req.user?.name || null;
    const updateTemp = db.transaction(() => {
      db.prepare('UPDATE leads SET temperature = ?, updated_at = ? WHERE id = ?')
        .run(newTemp, now, leadId);

      db.prepare(`
        INSERT INTO activities (lead_id, type, title, description, created_at, created_by)
        VALUES (?, 'temperature_change', ?, ?, ?, ?)
      `).run(
        leadId,
        `Temperature set to ${newTemp || 'none'}`,
        oldTemp ? `from ${oldTemp}` : null,
        now,
        actor,
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

    // Honour the same category filter the board uses. Without it the
    // header cards described the whole database while the columns
    // underneath described one category, so picking a filter made the
    // Won card contradict the Won column directly below it.
    const { category } = req.query;
    const catFilter =
      category && typeof category === 'string' && category !== 'all'
        ? 'AND category = @category'
        : '';
    const catParam: Record<string, string> =
      category && typeof category === 'string' && category !== 'all' ? { category } : {};

    // Stages that are still in play. Won and Lost are closed outcomes —
    // counting Won as pipeline was making Home's total disagree with
    // both the board and Reports, under the same label.
    const ACTIVE = "('new_lead','meeting_booked','proposal','pulse')";

    const stageCounts = db.prepare(`
      SELECT pipeline_stage, COUNT(*) AS count
      FROM leads
      WHERE 1=1 ${catFilter}
      GROUP BY pipeline_stage
    `).all(catParam) as { pipeline_stage: string | null; count: number }[];

    const leadsPerStage: Record<string, number> = {};
    let totalLeads = 0;
    let placedLeads = 0;
    let unplaced = 0;
    for (const row of stageCounts) {
      totalLeads += row.count;
      if (row.pipeline_stage === null) {
        unplaced += row.count;
      } else {
        leadsPerStage[row.pipeline_stage] = row.count;
        placedLeads += row.count;
      }
    }

    // Conversion rate: won / (won + lost) — only if there are closed leads
    const wonCount = leadsPerStage['won'] || 0;
    const lostCount = leadsPerStage['lost'] || 0;
    const closedTotal = wonCount + lostCount;
    const conversionRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : 0;

    // Money per lead: the agreed retainer when there is one, the estimate
    // otherwise. Same rule as the board and Reports, via the shared view.
    const valueRow = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(r.monthly_amount, leads.deal_value)), 0) AS total_value
      FROM leads
      LEFT JOIN current_retainers r ON r.lead_id = leads.id
      WHERE pipeline_stage IN ${ACTIVE} ${catFilter}
    `).get(catParam) as { total_value: number };

    // Won is reported separately rather than folded into the pipeline
    // figure, so "what's still in play" and "what we closed" stay apart.
    const wonRow = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(r.monthly_amount, leads.deal_value)), 0) AS total_value
      FROM leads
      LEFT JOIN current_retainers r ON r.lead_id = leads.id
      WHERE pipeline_stage = 'won' ${catFilter}
    `).get(catParam) as { total_value: number };

    // Active client monthly recurring revenue — what live clients pay us
    // each month. Summed over the retainer view, which is keyed per
    // CLIENT, so a client with two live projects is counted once.
    // Deliberately separate from pipeline value: this is money landing,
    // that is money hoped for.
    const mrrRow = db.prepare(`
      SELECT COALESCE(SUM(r.monthly_amount), 0) AS mrr
      FROM current_retainers r
      JOIN leads ON leads.id = r.lead_id
      WHERE EXISTS (
        SELECT 1 FROM projects p WHERE p.lead_id = r.lead_id AND p.status = 'live'
      ) ${catFilter}
    `).get(catParam) as { mrr: number };

    const tempCounts = db.prepare(`
      SELECT temperature, COUNT(*) AS count
      FROM leads
      WHERE temperature IS NOT NULL ${catFilter}
      GROUP BY temperature
    `).all(catParam) as { temperature: string; count: number }[];

    const temperatureBreakdown: Record<string, number> = {};
    for (const row of tempCounts) {
      temperatureBreakdown[row.temperature] = row.count;
    }

    const stats = {
      byStage: leadsPerStage,
      conversionRate,
      /** Still in play: new lead, meeting booked, proposal, pulse. */
      totalPipelineValue: valueRow.total_value,
      /** Closed and won — deliberately not part of the above. */
      wonValue: wonRow.total_value,
      /** What live clients pay per month. Counted once per client. */
      activeClientMrr: mrrRow.mrr,
      byTemperature: temperatureBreakdown,
      /** Every lead, placed on the board or not. */
      totalLeads,
      /** Only those sitting in a kanban column. */
      placedLeads,
      unplaced,
    };

    logger.info({ totalLeads, placedLeads, conversionRate }, 'Fetched pipeline stats');
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
