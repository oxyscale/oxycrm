// ============================================================
// Reports Routes — /api/reports
//
// Single endpoint that returns everything needed to render the
// investor pulse-check Report:
//   - Pipeline summary by tier (count + total deal $)
//   - New leads added in the selected window
//   - Won / Lost deals in the window
//   - Tasks due / overdue in the window
//
// Date range comes from query params `from` and `to` (YYYY-MM-DD).
// Default: last 14 days.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { todayInSydney } from '../util/dates.js';
import pino from 'pino';

const logger = pino({ name: 'reports-routes' });
const router = Router();

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().optional(),
});

interface TierBucket {
  tier: string;
  label: string;
  count: number;
  totalValue: number;
}

const TIER_LABELS: Record<string, string> = {
  pulse: 'Pulse',
  tier_1: 'Tier 1',
  tier_2: 'Tier 2',
  tier_3: 'Tier 3',
  proposal: 'Proposals',
  won: 'Won',
  lost: 'Lost',
};

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { from, to, category } = querySchema.parse(req.query);

    // Default window = last 14 days, inclusive of today.
    const today = todayInSydney();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const fromDate = from || fourteenDaysAgo;
    const toDate = to || today;

    // Build the optional category WHERE fragment once
    const catFilter = category && category !== 'all' ? 'AND category = @category' : '';
    const catParam: Record<string, string> = category && category !== 'all' ? { category } : {};

    // ── Pipeline summary by tier ────────────────────────────
    const tierRows = db.prepare(`
      SELECT pipeline_stage AS tier,
             COUNT(*) AS count,
             COALESCE(SUM(deal_value), 0) AS total_value
      FROM leads
      WHERE pipeline_stage IN ('pulse','tier_1','tier_2','tier_3','proposal','won','lost')
        ${catFilter}
      GROUP BY pipeline_stage
    `).all(catParam) as { tier: string; count: number; total_value: number }[];

    // Build the full set of tiers (even ones with 0) so the UI shows every column.
    const byTier: TierBucket[] = (['tier_1', 'tier_2', 'tier_3', 'pulse', 'proposal', 'won', 'lost'] as const).map(
      (t) => {
        const row = tierRows.find((r) => r.tier === t);
        return {
          tier: t,
          label: TIER_LABELS[t],
          count: row?.count ?? 0,
          totalValue: row?.total_value ?? 0,
        };
      },
    );

    // ── New leads in the window ─────────────────────────────
    const newLeads = db.prepare(`
      SELECT id, name, company, category, pipeline_stage AS tier, deal_value AS dealValue, created_at AS createdAt
      FROM leads
      WHERE DATE(created_at) >= @fromDate
        AND DATE(created_at) <= @toDate
        ${catFilter}
      ORDER BY created_at DESC
    `).all({ fromDate, toDate, ...catParam }) as Array<{
      id: number; name: string; company: string | null; category: string | null;
      tier: string; dealValue: number; createdAt: string;
    }>;

    // ── Won / Lost in the window ────────────────────────────
    // We approximate "moved to won/lost in this window" by looking at
    // updated_at — the disposition / stage-change handlers always touch
    // updated_at. Not perfect (any subsequent edit would shift it) but
    // good enough for fortnightly pulse-check reporting.
    const wonLost = db.prepare(`
      SELECT id, name, company, category, pipeline_stage AS tier, deal_value AS dealValue, updated_at AS closedAt
      FROM leads
      WHERE pipeline_stage IN ('won','lost')
        AND DATE(updated_at) >= @fromDate
        AND DATE(updated_at) <= @toDate
        ${catFilter}
      ORDER BY pipeline_stage ASC, updated_at DESC
    `).all({ fromDate, toDate, ...catParam }) as Array<{
      id: number; name: string; company: string | null; category: string | null;
      tier: string; dealValue: number; closedAt: string;
    }>;

    const won = wonLost.filter((r) => r.tier === 'won');
    const lost = wonLost.filter((r) => r.tier === 'lost');

    // ── Tasks due in the window (incomplete only) ───────────
    const tasksDue = db.prepare(`
      SELECT t.id, t.label, t.due_date AS dueDate, t.completed,
             l.id AS leadId, l.name AS leadName, l.company AS leadCompany
      FROM tasks t
      INNER JOIN leads l ON l.id = t.lead_id
      WHERE t.completed = 0
        AND t.due_date <= @toDate
      ORDER BY t.due_date ASC
    `).all({ toDate }) as Array<{
      id: number; label: string; dueDate: string; completed: number;
      leadId: number; leadName: string; leadCompany: string | null;
    }>;

    // ── Contacted leads in the window ─────────────────────
    // A lead counts as "contacted" if it has any note, email,
    // call, or task logged within the date window.
    const contactedCount = (db.prepare(`
      SELECT COUNT(DISTINCT lead_id) AS n FROM (
        SELECT lead_id FROM notes WHERE DATE(created_at) >= @fromDate AND DATE(created_at) <= @toDate
        UNION
        SELECT lead_id FROM emails_sent WHERE DATE(created_at) >= @fromDate AND DATE(created_at) <= @toDate
        UNION
        SELECT lead_id FROM call_logs WHERE DATE(created_at) >= @fromDate AND DATE(created_at) <= @toDate
        UNION
        SELECT lead_id FROM tasks WHERE DATE(created_at) >= @fromDate AND DATE(created_at) <= @toDate
      )
    `).get({ fromDate, toDate }) as { n: number }).n;

    // ── Conversion rate: contacted / total leads in ecosystem ─
    const totalLeadCount = (db.prepare(`
      SELECT COUNT(*) AS n FROM leads WHERE 1=1 ${catFilter}
    `).get(catParam) as { n: number }).n;

    // Total leads ever contacted (not window-scoped)
    // Pulse leads are always contacted by definition
    const totalContactedCount = (db.prepare(`
      SELECT COUNT(*) AS n FROM leads
      WHERE (
        pipeline_stage = 'pulse'
        OR manually_contacted = 1
        OR EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = leads.id AND notes.created_by != 'Import')
        OR EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = leads.id)
        OR EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = leads.id)
        OR EXISTS (SELECT 1 FROM tasks WHERE tasks.lead_id = leads.id)
      ) ${catFilter}
    `).get(catParam) as { n: number }).n;

    // ── Tasks created in the window ────────────────────────
    const tasksCreated = (db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE DATE(created_at) >= @fromDate AND DATE(created_at) <= @toDate
    `).get({ fromDate, toDate }) as { n: number }).n;

    // ── Tasks completed in the window ──────────────────────
    const tasksCompleted = (db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE completed = 1
        AND DATE(completed_at) >= @fromDate AND DATE(completed_at) <= @toDate
    `).get({ fromDate, toDate }) as { n: number }).n;

    // ── Pipeline leads (Tier 1/2/3) with details ───────────
    // Full list of active pipeline leads for the meeting table
    const pipelineLeads = db.prepare(`
      SELECT id, name, company, category, pipeline_stage AS tier,
             deal_value AS dealValue, follow_up_date AS followUpDate,
             manually_contacted AS manuallyContacted
      FROM leads
      WHERE pipeline_stage IN ('pulse','tier_1','tier_2','tier_3','proposal')
        ${catFilter}
      ORDER BY
        CASE pipeline_stage WHEN 'tier_1' THEN 1 WHEN 'tier_2' THEN 2 WHEN 'tier_3' THEN 3 WHEN 'pulse' THEN 4 WHEN 'proposal' THEN 5 END,
        deal_value DESC
    `).all(catParam) as Array<{
      id: number; name: string; company: string | null; category: string | null;
      tier: string; dealValue: number; followUpDate: string | null; manuallyContacted: number;
    }>;

    // Determine contacted status for each pipeline lead
    const pipelineLeadsWithContacted = pipelineLeads.map((lead) => {
      // Pulse leads are always contacted by definition
      if (lead.tier === 'pulse') return { ...lead, contacted: true };
      if (lead.manuallyContacted === 1) return { ...lead, contacted: true };
      const hasActivity = (db.prepare(`
        SELECT 1 FROM notes WHERE lead_id = ?
        UNION SELECT 1 FROM emails_sent WHERE lead_id = ?
        UNION SELECT 1 FROM call_logs WHERE lead_id = ?
        UNION SELECT 1 FROM tasks WHERE lead_id = ?
        LIMIT 1
      `).get(lead.id, lead.id, lead.id, lead.id));
      return { ...lead, contacted: !!hasActivity };
    });

    // Grab the latest note for each pipeline lead (for meeting context)
    const pipelineLeadsEnriched = pipelineLeadsWithContacted.map((lead) => {
      const latestNote = db.prepare(
        'SELECT content FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(lead.id) as { content: string } | undefined;
      return { ...lead, latestNote: latestNote?.content || null };
    });

    // ── Totals + KPIs ───────────────────────────────────────
    const totalPipelineValue = byTier
      .filter((b) => ['pulse', 'tier_1', 'tier_2', 'tier_3', 'proposal'].includes(b.tier))
      .reduce((sum, b) => sum + b.totalValue, 0);
    const totalPipelineCount = byTier
      .filter((b) => ['pulse', 'tier_1', 'tier_2', 'tier_3', 'proposal'].includes(b.tier))
      .reduce((sum, b) => sum + b.count, 0);
    const wonValue = won.reduce((sum, w) => sum + (w.dealValue || 0), 0);
    const lostValue = lost.reduce((sum, w) => sum + (w.dealValue || 0), 0);

    // Weighted pipeline value — close probability by tier
    const TIER_WEIGHTS: Record<string, number> = {
      pulse: 0.10,   // 10%
      tier_3: 0.20,  // 20%
      tier_2: 0.40,  // 40%
      proposal: 0.90, // 90% — a quote is out, awaiting their decision
  tier_1: 0.80,  // 80%
    };
    const weightedPipelineValue = byTier
      .filter((b) => b.tier in TIER_WEIGHTS)
      .reduce((sum, b) => sum + b.totalValue * TIER_WEIGHTS[b.tier], 0);

    // Distinct categories available for the filter dropdown
    const categories = (db.prepare(
      "SELECT DISTINCT category FROM leads WHERE category IS NOT NULL AND category != '' ORDER BY category ASC"
    ).all() as { category: string }[]).map((r) => r.category);

    logger.info({ fromDate, toDate, category }, 'Report generated');

    res.json({
      window: { from: fromDate, to: toDate, category: category || null },
      categories,
      summary: {
        totalPipelineCount,
        totalPipelineValue,
        weightedPipelineValue: Math.round(weightedPipelineValue),
        newLeadCount: newLeads.length,
        wonCount: won.length,
        wonValue,
        lostCount: lost.length,
        lostValue,
        tasksDueCount: tasksDue.length,
        contactedCount,
        totalLeadCount,
        totalContactedCount,
        conversionRate: totalLeadCount > 0
          ? Math.round((totalContactedCount / totalLeadCount) * 100)
          : 0,
        tasksCreated,
        tasksCompleted,
      },
      byTier,
      newLeads,
      won,
      lost,
      tasksDue,
      pipelineLeads: pipelineLeadsEnriched,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
