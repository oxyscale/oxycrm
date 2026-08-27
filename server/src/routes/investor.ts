// ============================================================
// Investor Report
//
// A monthly one-pager for shareholders. Reads the CRM as it is —
// no new fields on deals, no changes to the stage model, no writes
// back to any deal record. Everything this section owns lives in its
// own investor_* tables.
//
// Two ideas drive the whole thing:
//
//  1. Revenue lead time. A signed client starts billing ~60 days later
//     (30 build, 30 free), so "signed" and "earning" are different
//     dates. The report therefore reports three MRR figures: live,
//     contracted-not-yet-live, and committed (the two combined).
//
//  2. Locked snapshots. Once a month is finalised its numbers are
//     frozen as JSON. A report already sent to shareholders must never
//     change underneath them because a deal moved in the CRM.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import pino from 'pino';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';

const logger = pino({ name: 'investor-routes' });

const router = Router();
router.use(requireAuth);

// Board order, matching the kanban. The spec's funnel names map onto
// the stages the CRM already uses rather than introducing new ones.
const FUNNEL_STAGES: Array<{ stage: string; label: string }> = [
  { stage: 'new_lead', label: 'Leads in' },
  { stage: 'pulse', label: 'Discovery' },
  { stage: 'meeting_booked', label: 'Meeting booked' },
  { stage: 'proposal', label: 'Proposal sent' },
  { stage: 'won', label: 'Signed' },
  { stage: 'lost', label: 'Lost' },
];

const OPEN_STAGES = ['new_lead', 'pulse', 'meeting_booked', 'proposal'];

// Titles written by older stage-change activities, before the stage was
// recorded in metadata. Kept so historical months still report a funnel.
const LEGACY_TITLE_TO_STAGE: Record<string, string> = {
  'Moved to New lead': 'new_lead',
  'Moved to Pulse': 'pulse',
  'Moved to Meeting booked': 'meeting_booked',
  'Moved to Proposal sent': 'proposal',
  'Moved to Won': 'won',
  'Moved to Lost': 'lost',
  'Converted to project': 'won',
  'Lead created': 'new_lead',
};

// ── date helpers (date-only strings, no timezone drift) ──────────

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${month}-${String(last).padStart(2, '0')}` };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
}

// ── settings ─────────────────────────────────────────────────────

type Settings = {
  revenueLeadDays: number;
  monthlyCostBase: number;
  forecastMrr6: number;
  forecastMrr12: number;
  forecastNote: string;
  avgClientValue: number;
  potRingfenceTotal: number;
  potWagesTotal: number;
  distributionList: string[];
};

function readSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM investor_settings').all() as
    { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) ? v : d;
  };
  let list: string[] = [];
  try {
    const parsed = JSON.parse(map.get('distribution_list') || '[]');
    if (Array.isArray(parsed)) list = parsed.filter((e) => typeof e === 'string');
  } catch {
    list = [];
  }
  return {
    revenueLeadDays: num('revenue_lead_days', 60),
    monthlyCostBase: num('monthly_cost_base', 0),
    forecastMrr6: num('forecast_mrr_6', 0),
    forecastMrr12: num('forecast_mrr_12', 0),
    forecastNote: map.get('forecast_note') ?? '',
    avgClientValue: num('avg_client_value', 2500),
    potRingfenceTotal: num('pot_ringfence_total', 30000),
    potWagesTotal: num('pot_wages_total', 90000),
    distributionList: list,
  };
}

// ── the computation ──────────────────────────────────────────────

interface SignedClient {
  leadId: number;
  company: string;
  contact: string;
  signedOn: string;
  retainer: number;
  oneOff: number;
  oneOffPaid: number;
  oneOffOutstanding: number;
  revenueStartsOn: string;
  daysUntilLive: number;
  isLive: boolean;
}

/**
 * Every signed client, with the date their revenue starts.
 *
 * Signed date comes from the earliest linked project's start date,
 * falling back to the stage-change activity that moved them to Won.
 * Revenue start prefers a real go-live date when the build is actually
 * live — that is a fact — and otherwise projects it as signed + the
 * configured lead time.
 */
function signedClients(leadTimeDays: number): SignedClient[] {
  const db = getDb();
  const today = todayIso();

  const rows = db.prepare(`
    SELECT
      l.id                AS lead_id,
      COALESCE(NULLIF(TRIM(l.company), ''), l.name) AS company,
      l.name              AS contact,
      (SELECT MIN(p.start_date) FROM projects p WHERE p.lead_id = l.id) AS project_start,
      (SELECT MIN(p.live_from)  FROM projects p WHERE p.lead_id = l.id AND p.status = 'live') AS live_from,
      (SELECT COALESCE(SUM(p.build_fee), 0) FROM projects p WHERE p.lead_id = l.id) AS one_off,
      (SELECT COALESCE(SUM(p.build_fee_paid), 0) FROM projects p WHERE p.lead_id = l.id) AS one_off_paid,
      (SELECT MIN(a.created_at) FROM activities a
        WHERE a.lead_id = l.id AND a.type = 'stage_change'
          AND (a.title IN ('Moved to Won', 'Converted to project')
               OR a.metadata LIKE '%"to":"won"%')) AS won_at,
      COALESCE(r.monthly_amount, 0) AS retainer,
      l.updated_at
    FROM leads l
    LEFT JOIN current_retainers r ON r.lead_id = l.id
    WHERE l.pipeline_stage = 'won'
  `).all() as Array<{
    lead_id: number; company: string; contact: string;
    project_start: string | null; live_from: string | null; one_off: number;
    won_at: string | null; retainer: number; updated_at: string; one_off_paid: number;
  }>;

  return rows.map((r) => {
    const signedOn = (r.project_start || r.won_at || r.updated_at).slice(0, 10);
    const revenueStartsOn = r.live_from
      ? r.live_from.slice(0, 10)
      : addDays(signedOn, leadTimeDays);
    const daysUntilLive = daysBetween(today, revenueStartsOn);
    return {
      leadId: r.lead_id,
      company: r.company,
      contact: r.contact,
      signedOn,
      retainer: r.retainer,
      oneOff: r.one_off,
      oneOffPaid: r.one_off_paid,
      oneOffOutstanding: Math.max(0, Math.round((r.one_off - r.one_off_paid) * 100) / 100),
      revenueStartsOn,
      daysUntilLive,
      isLive: daysUntilLive <= 0,
    };
  });
}

/** Counts of leads that ENTERED each stage within a month. */
function stageEntries(month: string): Record<string, number> {
  const db = getDb();
  const { start, end } = monthBounds(month);
  const rows = db.prepare(`
    SELECT title, metadata FROM activities
    WHERE type = 'stage_change'
      AND DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).all(start, end) as { title: string; metadata: string | null }[];

  const counts: Record<string, number> = {};
  for (const row of rows) {
    let stage: string | null = null;
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata);
        if (parsed && typeof parsed.to === 'string') stage = parsed.to;
      } catch {
        stage = null;
      }
    }
    if (!stage) stage = LEGACY_TITLE_TO_STAGE[row.title] ?? null;
    if (stage) counts[stage] = (counts[stage] || 0) + 1;
  }
  return counts;
}

/**
 * Leads created per source, per month.
 *
 * Read straight from leads.created_at rather than from locked
 * snapshots, so the history is complete from day one instead of only
 * filling in as months are finalised. Bounded at the report month so a
 * locked report never picks up leads that arrived after it was sent.
 */
function leadSourcesByMonth(upToMonth: string, monthCount: number) {
  const db = getDb();
  const months: string[] = [];
  for (let i = monthCount - 1; i >= 0; i--) months.push(shiftMonth(upToMonth, -i));
  const from = `${months[0]}-01`;
  const to = monthBounds(upToMonth).end;

  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COALESCE(NULLIF(TRIM(lead_source), ''), 'Unattributed') AS source,
           COUNT(*) AS n
      FROM leads
     WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
     GROUP BY month, source
  `).all(from, to) as { month: string; source: string; n: number }[];

  const bySource = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, {});
    bySource.get(r.source)![r.month] = r.n;
  }

  const thisMonth = upToMonth;
  const lastMonth = shiftMonth(upToMonth, -1);

  const sources = [...bySource.entries()]
    .map(([source, counts]) => {
      const current = counts[thisMonth] || 0;
      const previous = counts[lastMonth] || 0;
      return {
        source,
        counts: months.map((m) => counts[m] || 0),
        total: months.reduce((sum, m) => sum + (counts[m] || 0), 0),
        thisMonth: current,
        lastMonth: previous,
        change: current - previous,
      };
    })
    // Busiest source first; ties broken alphabetically so the order is
    // stable between months rather than shuffling.
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));

  return {
    months,
    monthLabels: months.map((m) => monthLabel(m).replace(/ \d{4}$/, '')),
    sources,
    totals: months.map((_, i) => sources.reduce((sum, s) => sum + s.counts[i], 0)),
  };
}

type Runway =
  | { state: 'months'; months: number }
  | { state: 'covered' }
  | { state: 'unknown' };

/**
 * Runway, or an honest reason there isn't one.
 *
 * 'unknown' matters: with no cost base recorded the burn is negative and
 * the arithmetic reports infinite runway, which renders as a healthy
 * business when the truth is that nobody has entered the costs yet.
 */
function safeRunway(cash: number, netBurn: number | null): Runway {
  if (netBurn === null) return { state: 'unknown' };
  if (netBurn <= 0) return { state: 'covered' };
  return { state: 'months', months: Math.round((cash / netBurn) * 10) / 10 };
}

function buildReport(month: string) {
  const db = getDb();
  const settings = readSettings();
  const today = todayIso();
  const { start, end } = monthBounds(month);
  const prevMonth = shiftMonth(month, -1);

  // ── manual inputs for this month ──
  const inputs = db.prepare(
    'SELECT * FROM investor_months WHERE month = ?'
  ).get(month) as {
    month: string; bank_balance: number | null; live_mrr_override: number | null;
    pot_wages_drawn: number; status: string; snapshot: string | null; finalised_at: string | null;
  } | undefined;

  // ── clients + MRR split by revenue start ──
  const clients = signedClients(settings.revenueLeadDays);
  const crmLiveMrr = clients.filter((c) => c.isLive).reduce((s, c) => s + c.retainer, 0);
  const notYetLiveMrr = clients.filter((c) => !c.isLive).reduce((s, c) => s + c.retainer, 0);
  // The override exists because the CRM can lag reality; a value of 0 is
  // a legitimate override, so only NULL falls back.
  const liveMrr = inputs?.live_mrr_override ?? crmLiveMrr;
  const committedMrr = liveMrr + notYetLiveMrr;

  // ── funnel ──
  const openCounts = db.prepare(`
    SELECT pipeline_stage AS stage, COUNT(*) AS n FROM leads
    WHERE pipeline_stage IS NOT NULL GROUP BY pipeline_stage
  `).all() as { stage: string; n: number }[];
  const openMap = new Map(openCounts.map((r) => [r.stage, r.n]));
  const thisMonthEntries = stageEntries(month);
  const lastMonthEntries = stageEntries(prevMonth);

  const funnel = FUNNEL_STAGES.map(({ stage, label }) => {
    const entered = thisMonthEntries[stage] || 0;
    const last = lastMonthEntries[stage] || 0;
    return {
      stage, label,
      openNow: openMap.get(stage) || 0,
      enteredThisMonth: entered,
      enteredLastMonth: last,
      change: entered - last,
    };
  });

  // ── open pipeline, grouped by stage ──
  const openRows = db.prepare(`
    SELECT
      l.id, l.pipeline_stage AS stage,
      COALESCE(NULLIF(TRIM(l.company), ''), l.name) AS company,
      l.name AS contact,
      COALESCE(r.monthly_amount, l.deal_value, 0) AS retainer,
      (SELECT COALESCE(SUM(p.build_fee), 0) FROM projects p WHERE p.lead_id = l.id) AS one_off,
      (SELECT n.content FROM notes n WHERE n.lead_id = l.id
        ORDER BY n.created_at DESC LIMIT 1) AS latest_note,
      (SELECT n.created_at FROM notes n WHERE n.lead_id = l.id
        ORDER BY n.created_at DESC LIMIT 1) AS latest_note_at,
      (SELECT t.label FROM tasks t WHERE t.lead_id = l.id AND t.completed = 0
        ORDER BY t.due_date ASC LIMIT 1) AS next_action,
      (SELECT t.due_date FROM tasks t WHERE t.lead_id = l.id AND t.completed = 0
        ORDER BY t.due_date ASC LIMIT 1) AS next_action_due
    FROM leads l
    LEFT JOIN current_retainers r ON r.lead_id = l.id
    WHERE l.pipeline_stage IN (${OPEN_STAGES.map(() => '?').join(',')})
    ORDER BY retainer DESC
  `).all(...OPEN_STAGES) as Array<{
    id: number; stage: string; company: string; contact: string;
    retainer: number; one_off: number;
    latest_note: string | null; latest_note_at: string | null;
    next_action: string | null; next_action_due: string | null;
  }>;

  const byStage = FUNNEL_STAGES
    .filter((f) => OPEN_STAGES.includes(f.stage))
    .map(({ stage, label }) => {
      const rows = openRows.filter((r) => r.stage === stage).map((r) => ({
        leadId: r.id,
        company: r.company,
        contact: r.contact,
        retainer: r.retainer,
        oneOff: r.one_off,
        latestNote: r.latest_note ? r.latest_note.slice(0, 200) : null,
        latestNoteAt: r.latest_note_at ? r.latest_note_at.slice(0, 10) : null,
        nextAction: r.next_action,
        nextActionDue: r.next_action_due,
      }));
      return {
        stage, label,
        count: rows.length,
        retainerTotal: rows.reduce((s, r) => s + r.retainer, 0),
        rows,
      };
    })
    // Skip any stage with no open deals, per spec.
    .filter((g) => g.count > 0);

  const openPipelineMrr = openRows.reduce((s, r) => s + r.retainer, 0);
  const openPipelineOneOff = openRows.reduce((s, r) => s + r.one_off, 0);

  // ── signed this month ──
  const signedThisMonthList = clients.filter(
    (c) => c.signedOn >= start && c.signedOn <= end,
  );
  const signedThisMonth = {
    count: signedThisMonthList.length,
    mrr: signedThisMonthList.reduce((s, c) => s + c.retainer, 0),
    oneOff: signedThisMonthList.reduce((s, c) => s + c.oneOff, 0),
  };

  // ── investment pots, as at the end of the reporting month ──
  // Bounded by date so a report for July shows the pots as they stood in
  // July, rather than as they stand today.
  const payments = db.prepare(
    'SELECT id, paid_on AS paidOn, item, amount FROM investor_ringfence_payments WHERE paid_on <= ? ORDER BY paid_on ASC, id ASC'
  ).all(end) as { id: number; paidOn: string; item: string; amount: number }[];
  const ringfencePaid = payments.reduce((s, p) => s + p.amount, 0);

  const wageDraws = db.prepare(
    'SELECT id, drawn_on AS drawnOn, item, amount FROM investor_wage_draws WHERE drawn_on <= ? ORDER BY drawn_on ASC, id ASC'
  ).all(end) as { id: number; drawnOn: string; item: string; amount: number }[];
  // Fall back to the old single-figure input for months captured before
  // instalments were logged individually.
  const wagesDrawn = wageDraws.length
    ? wageDraws.reduce((s, w) => s + w.amount, 0)
    : (inputs?.pot_wages_drawn ?? 0);

  const investment = {
    ringfence: {
      total: settings.potRingfenceTotal,
      paid: ringfencePaid,
      remaining: settings.potRingfenceTotal - ringfencePaid,
      payments,
    },
    wages: {
      total: settings.potWagesTotal,
      drawn: wagesDrawn,
      remaining: settings.potWagesTotal - wagesDrawn,
      draws: wageDraws,
    },
  };

  // ── actuals, reconciled from Xero ──
  // Three months of what actually went out and came in. Superannuation
  // and wages are already inside the expense figure, so nothing is added
  // on top — doing so would count super twice.
  const actualMonths: string[] = [];
  for (let i = 2; i >= 0; i--) actualMonths.push(shiftMonth(month, -i));

  const actualRows = db.prepare(`
    SELECT month, actual_expenses AS expenses, actual_revenue AS revenue
      FROM investor_months
     WHERE month IN (${actualMonths.map(() => '?').join(',')})
  `).all(...actualMonths) as
    { month: string; expenses: number | null; revenue: number | null }[];
  const actualMap = new Map(actualRows.map((r) => [r.month, r]));

  const trend = actualMonths.map((m) => {
    const row = actualMap.get(m);
    const expenses = row?.expenses ?? null;
    const revenue = row?.revenue ?? null;
    return {
      month: m,
      monthLabel: monthLabel(m),
      expenses,
      revenue,
      // Rounded to cents: subtracting floats leaves noise like
      // 15302.580000000002, which then leaks into comparisons.
      netBurn: expenses === null
        ? null
        : Math.round((expenses - (revenue ?? 0)) * 100) / 100,
    };
  });

  // Average across the months that have been reconciled. A single heavy
  // month (a superannuation catch-up, say) should not set the runway on
  // its own, and an unreconciled month must not count as zero burn.
  const burns = trend.map((t) => t.netBurn).filter((n): n is number => n !== null);
  const avgNetBurn = burns.length
    ? Math.round((burns.reduce((s, n) => s + n, 0) / burns.length) * 100) / 100
    : null;
  const thisMonthActual = actualMap.get(month) ?? null;

  // ── position ──
  const bankBalance = inputs?.bank_balance ?? 0;
  // Remaining wage pot is committed incoming cash, so it counts toward
  // runway — but it is deliberately reported separately from the bank.
  const cashAvailable = bankBalance + investment.wages.remaining;
  const runway = safeRunway(cashAvailable, avgNetBurn);
  // Forecast assumes the not-yet-live retainers land, reducing the burn
  // by that amount each month.
  const forecastRunway = safeRunway(
    cashAvailable,
    avgNetBurn === null ? null : avgNetBurn - notYetLiveMrr,
  );

  const plannedSpend = db.prepare(
    'SELECT id, item, estimated_cost AS estimatedCost, timing, purpose, status FROM investor_planned_spend ORDER BY id ASC'
  ).all();
  const risks = db.prepare(
    'SELECT id, risk, mitigation, status FROM investor_risks ORDER BY CASE status WHEN \'open\' THEN 0 WHEN \'mitigating\' THEN 1 ELSE 2 END, id ASC'
  ).all();

  return {
    month,
    monthLabel: monthLabel(month),
    periodStart: start,
    periodEnd: end,
    generatedAt: new Date().toISOString(),
    preparedBy: 'Jordan Bell',
    status: inputs?.status ?? 'draft',
    finalisedAt: inputs?.finalised_at ?? null,
    settings: { revenueLeadDays: settings.revenueLeadDays },
    forecast: {
      mrr6: settings.forecastMrr6,
      mrr12: settings.forecastMrr12,
      note: settings.forecastNote,
      // A dollar target is abstract; clients are countable. Derived from
      // the average client value rather than entered separately, so the
      // two can never disagree.
      avgClientValue: settings.avgClientValue,
      // Months to the target at the current committed run rate, so the
      // ambition sits next to where the business actually is.
      liveMrr,
      committedMrr,
    },
    tiles: {
      liveMrr,
      committedMrr,
      notYetLiveMrr,
      bankBalance,
      runway,
      forecastRunway,
      openPipelineMrr,
      signedThisMonth,
    },
    funnel,
    leadSources: leadSourcesByMonth(month, 6),
    pipeline: {
      openCount: openRows.length,
      openPipelineMrr,
      openPipelineOneOff,
      byStage,
    },
    signedNotYetLive: clients
      .filter((c) => !c.isLive)
      .sort((a, b) => a.revenueStartsOn.localeCompare(b.revenueStartsOn)),
    investment,
    position: {
      bankBalance,
      liveMrr,
      committedMrr,
      committedIncoming: investment.wages.remaining,
      runway,
      forecastRunway,
      avgNetBurn,
    },
    actuals: {
      trend,
      avgNetBurn,
      expenses: thisMonthActual?.expenses ?? null,
      revenue: thisMonthActual?.revenue ?? null,
    },
    plannedSpend,
    risks,
    inputs: {
      bankBalance: inputs?.bank_balance ?? null,
      liveMrrOverride: inputs?.live_mrr_override ?? null,
      crmLiveMrr,
      potWagesDrawn: wagesDrawn,
      actualExpenses: thisMonthActual?.expenses ?? null,
      actualRevenue: thisMonthActual?.revenue ?? null,
    },
  };
}

type Report = ReturnType<typeof buildReport>;

/** Previous month's numbers, only ever from a locked snapshot. */
function previousSnapshot(month: string): Report | null {
  const db = getDb();
  const prev = db.prepare(
    "SELECT snapshot FROM investor_months WHERE month = ? AND status = 'final'"
  ).get(shiftMonth(month, -1)) as { snapshot: string | null } | undefined;
  if (!prev?.snapshot) return null;
  try {
    return JSON.parse(prev.snapshot) as Report;
  } catch {
    return null;
  }
}

/** Locked months, oldest first — the series behind every chart. */
function historySeries(upToMonth: string, months: number) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT month, snapshot FROM investor_months WHERE status = 'final' AND month <= ? ORDER BY month ASC"
  ).all(upToMonth) as { month: string; snapshot: string | null }[];

  const out: Array<Record<string, unknown>> = [];
  for (const row of rows.slice(-months)) {
    if (!row.snapshot) continue;
    try {
      const snap = JSON.parse(row.snapshot) as Report;
      out.push({
        month: row.month,
        monthLabel: monthLabel(row.month),
        liveMrr: snap.tiles?.liveMrr ?? 0,
        committedMrr: snap.tiles?.committedMrr ?? 0,
        notYetLiveMrr: snap.tiles?.notYetLiveMrr ?? 0,
        bankBalance: snap.tiles?.bankBalance ?? 0,
        runwayMonths: snap.tiles?.runway?.state === 'months' ? snap.tiles.runway.months : null,
        ringfenceRemaining: snap.investment?.ringfence?.remaining ?? 0,
        wagesRemaining: snap.investment?.wages?.remaining ?? 0,
        funnel: Object.fromEntries(
          (snap.funnel || []).map((f) => [f.stage, f.enteredThisMonth]),
        ),
      });
    } catch {
      // A corrupt snapshot must not take out the whole archive.
      continue;
    }
  }
  return out;
}

/** Committed MRR forward projection from known revenue start dates. */
function forwardMrr(month: string, monthsAhead: number, clients: SignedClient[]) {
  const out = [];
  for (let i = 1; i <= monthsAhead; i++) {
    const m = shiftMonth(month, i);
    const { end } = monthBounds(m);
    const live = clients
      .filter((c) => c.revenueStartsOn <= end)
      .reduce((s, c) => s + c.retainer, 0);
    const pending = clients
      .filter((c) => c.revenueStartsOn > end)
      .reduce((s, c) => s + c.retainer, 0);
    out.push({ month: m, monthLabel: monthLabel(m), liveMrr: live, notYetLiveMrr: pending, projected: true });
  }
  return out;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new ApiError(400, 'Month must be YYYY-MM');
}

// ── routes ───────────────────────────────────────────────────────

/** GET /api/investor/report/:month */
router.get('/report/:month', (req, res, next) => {
  try {
    const month = req.params.month;
    assertMonth(month);
    const db = getDb();

    const existing = db.prepare(
      'SELECT status, snapshot FROM investor_months WHERE month = ?'
    ).get(month) as { status: string; snapshot: string | null } | undefined;

    // A finalised month serves its frozen copy, never a recomputation.
    let report: Report;
    if (existing?.status === 'final' && existing.snapshot) {
      report = JSON.parse(existing.snapshot) as Report;
    } else {
      report = buildReport(month);
    }

    const settings = readSettings();
    res.json({
      report,
      previous: previousSnapshot(month),
      history: historySeries(month, 12),
      forward: forwardMrr(month, 3, signedClients(settings.revenueLeadDays)),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/investor/months — archive listing */
router.get('/months', (_req, res, next) => {
  try {
    const rows = getDb().prepare(`
      SELECT month, status, finalised_at AS finalisedAt, bank_balance AS bankBalance
      FROM investor_months ORDER BY month DESC
    `).all() as Array<{ month: string; status: string; finalisedAt: string | null }>;
    res.json(rows.map((r) => ({ ...r, monthLabel: monthLabel(r.month) })));
  } catch (err) {
    next(err);
  }
});

const inputsSchema = z.object({
  bankBalance: z.number().nullable().optional(),
  liveMrrOverride: z.number().nullable().optional(),
  potWagesDrawn: z.number().min(0).optional(),
  actualExpenses: z.number().min(0).nullable().optional(),
  actualRevenue: z.number().min(0).nullable().optional(),
});

/** PATCH /api/investor/report/:month/inputs */
router.patch('/report/:month/inputs', (req, res, next) => {
  try {
    const month = req.params.month;
    assertMonth(month);
    const body = inputsSchema.parse(req.body);
    const db = getDb();

    const existing = db.prepare('SELECT status FROM investor_months WHERE month = ?')
      .get(month) as { status: string } | undefined;
    if (existing?.status === 'final') {
      throw new ApiError(409, 'This month is finalised and can no longer be edited.');
    }

    // Seed a new month from the previous one so the form arrives pre-filled.
    if (!existing) {
      const prev = db.prepare(
        'SELECT bank_balance, pot_wages_drawn FROM investor_months WHERE month = ? '
      ).get(shiftMonth(month, -1)) as
        { bank_balance: number | null; pot_wages_drawn: number } | undefined;
      db.prepare(`
        INSERT INTO investor_months (month, bank_balance, pot_wages_drawn)
        VALUES (?, ?, ?)
      `).run(month, prev?.bank_balance ?? null, prev?.pot_wages_drawn ?? 0);
    }

    const sets: string[] = [];
    const params: Record<string, unknown> = { month };
    if (body.bankBalance !== undefined) {
      sets.push('bank_balance = @bankBalance'); params.bankBalance = body.bankBalance;
    }
    if (body.liveMrrOverride !== undefined) {
      sets.push('live_mrr_override = @liveMrrOverride'); params.liveMrrOverride = body.liveMrrOverride;
    }
    if (body.potWagesDrawn !== undefined) {
      sets.push('pot_wages_drawn = @potWagesDrawn'); params.potWagesDrawn = body.potWagesDrawn;
    }
    if (body.actualExpenses !== undefined) {
      sets.push('actual_expenses = @actualExpenses'); params.actualExpenses = body.actualExpenses;
    }
    if (body.actualRevenue !== undefined) {
      sets.push('actual_revenue = @actualRevenue'); params.actualRevenue = body.actualRevenue;
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE investor_months SET ${sets.join(', ')} WHERE month = @month`).run(params);
    }

    res.json(buildReport(month));
  } catch (err) {
    next(err);
  }
});

/** POST /api/investor/report/:month/finalise — freeze the month */
router.post('/report/:month/finalise', (req, res, next) => {
  try {
    const month = req.params.month;
    assertMonth(month);
    const db = getDb();

    const existing = db.prepare('SELECT status FROM investor_months WHERE month = ?')
      .get(month) as { status: string } | undefined;
    if (existing?.status === 'final') {
      throw new ApiError(409, 'This month is already finalised.');
    }
    if (!existing) {
      db.prepare('INSERT INTO investor_months (month) VALUES (?)').run(month);
    }

    const report = buildReport(month);
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE investor_months
         SET status = 'final', snapshot = @snapshot, finalised_at = @now,
             updated_at = datetime('now')
       WHERE month = @month
    `).run({ month, snapshot: JSON.stringify({ ...report, status: 'final', finalisedAt: now }), now });

    logger.info({ month }, 'Investor report finalised');
    res.json({ success: true, month, finalisedAt: now });
  } catch (err) {
    next(err);
  }
});

/** POST /api/investor/report/:month/reopen — undo a finalise */
router.post('/report/:month/reopen', (req, res, next) => {
  try {
    const month = req.params.month;
    assertMonth(month);
    // The snapshot is kept, not deleted — reopening and re-finalising
    // should never be able to lose the version that was already sent.
    const r = getDb().prepare(`
      UPDATE investor_months SET status = 'draft', updated_at = datetime('now')
      WHERE month = ? AND status = 'final'
    `).run(month);
    if (r.changes === 0) throw new ApiError(404, 'No finalised report for that month.');
    logger.info({ month }, 'Investor report reopened');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── ring fence payments ──────────────────────────────────────────

const paymentSchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  item: z.string().min(1).max(200),
  amount: z.number(),
});

router.post('/ringfence', (req, res, next) => {
  try {
    const b = paymentSchema.parse(req.body);
    const r = getDb().prepare(
      'INSERT INTO investor_ringfence_payments (paid_on, item, amount) VALUES (?, ?, ?)'
    ).run(b.paidOn, b.item.trim(), b.amount);
    res.status(201).json({ id: r.lastInsertRowid, ...b });
  } catch (err) {
    next(err);
  }
});

router.delete('/ringfence/:id', (req, res, next) => {
  try {
    const r = getDb().prepare('DELETE FROM investor_ringfence_payments WHERE id = ?')
      .run(parseInt(req.params.id, 10));
    if (r.changes === 0) throw new ApiError(404, 'Payment not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── planned spend ────────────────────────────────────────────────

const SPEND_STATUS = ['proposed', 'approved', 'deferred', 'spent'] as const;

const spendSchema = z.object({
  item: z.string().min(1).max(200),
  estimatedCost: z.number().min(0).optional(),
  timing: z.string().max(100).nullable().optional(),
  purpose: z.string().max(500).nullable().optional(),
  status: z.enum(SPEND_STATUS).optional(),
});

router.post('/planned-spend', (req, res, next) => {
  try {
    const b = spendSchema.parse(req.body);
    const r = getDb().prepare(`
      INSERT INTO investor_planned_spend (item, estimated_cost, timing, purpose, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(b.item.trim(), b.estimatedCost ?? 0, b.timing ?? null, b.purpose ?? null, b.status ?? 'proposed');
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/planned-spend/:id', (req, res, next) => {
  try {
    const b = spendSchema.partial().parse(req.body);
    const id = parseInt(req.params.id, 10);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    const map: Record<string, string> = {
      item: 'item', estimatedCost: 'estimated_cost', timing: 'timing',
      purpose: 'purpose', status: 'status',
    };
    for (const [k, col] of Object.entries(map)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) { sets.push(`${col} = @${k}`); params[k] = v; }
    }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    sets.push("updated_at = datetime('now')");
    const r = getDb().prepare(
      `UPDATE investor_planned_spend SET ${sets.join(', ')} WHERE id = @id`
    ).run(params);
    if (r.changes === 0) throw new ApiError(404, 'Item not found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/planned-spend/:id', (req, res, next) => {
  try {
    const r = getDb().prepare('DELETE FROM investor_planned_spend WHERE id = ?')
      .run(parseInt(req.params.id, 10));
    if (r.changes === 0) throw new ApiError(404, 'Item not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── risks ────────────────────────────────────────────────────────

const RISK_STATUS = ['open', 'mitigating', 'closed'] as const;

const riskSchema = z.object({
  risk: z.string().min(1).max(300),
  mitigation: z.string().max(600).nullable().optional(),
  status: z.enum(RISK_STATUS).optional(),
});

router.post('/risks', (req, res, next) => {
  try {
    const b = riskSchema.parse(req.body);
    const r = getDb().prepare(
      'INSERT INTO investor_risks (risk, mitigation, status) VALUES (?, ?, ?)'
    ).run(b.risk.trim(), b.mitigation ?? null, b.status ?? 'open');
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.patch('/risks/:id', (req, res, next) => {
  try {
    const b = riskSchema.partial().parse(req.body);
    const id = parseInt(req.params.id, 10);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const k of ['risk', 'mitigation', 'status'] as const) {
      if (b[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = b[k]; }
    }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    sets.push("updated_at = datetime('now')");
    const r = getDb().prepare(`UPDATE investor_risks SET ${sets.join(', ')} WHERE id = @id`).run(params);
    if (r.changes === 0) throw new ApiError(404, 'Risk not found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/risks/:id', (req, res, next) => {
  try {
    const r = getDb().prepare('DELETE FROM investor_risks WHERE id = ?')
      .run(parseInt(req.params.id, 10));
    if (r.changes === 0) throw new ApiError(404, 'Risk not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── settings ─────────────────────────────────────────────────────

router.get('/settings', (_req, res, next) => {
  try {
    res.json(readSettings());
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  revenueLeadDays: z.number().int().min(0).max(365).optional(),
  monthlyCostBase: z.number().min(0).optional(),
  forecastMrr6: z.number().min(0).optional(),
  forecastMrr12: z.number().min(0).optional(),
  forecastNote: z.string().max(600).optional(),
  avgClientValue: z.number().min(1).optional(),
  potRingfenceTotal: z.number().min(0).optional(),
  potWagesTotal: z.number().min(0).optional(),
  distributionList: z.array(z.string().email()).optional(),
});

router.patch('/settings', (req, res, next) => {
  try {
    const b = settingsSchema.parse(req.body);
    const db = getDb();
    const put = db.prepare(
      'INSERT INTO investor_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const map: Record<string, string> = {
      revenueLeadDays: 'revenue_lead_days',
      monthlyCostBase: 'monthly_cost_base',
      forecastMrr6: 'forecast_mrr_6',
      forecastMrr12: 'forecast_mrr_12',
      forecastNote: 'forecast_note',
      avgClientValue: 'avg_client_value',
      potRingfenceTotal: 'pot_ringfence_total',
      potWagesTotal: 'pot_wages_total',
    };
    for (const [k, col] of Object.entries(map)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) put.run(col, String(v));
    }
    if (b.distributionList !== undefined) {
      put.run('distribution_list', JSON.stringify(b.distributionList));
    }
    res.json(readSettings());
  } catch (err) {
    next(err);
  }
});

// ── email ────────────────────────────────────────────────────────

const emailSchema = z.object({
  html: z.string().min(1),
  subject: z.string().min(1).max(200).optional(),
  to: z.array(z.string().email()).optional(),
});

/**
 * Sends the rendered report to the distribution list. The client passes
 * the exact HTML it displayed, so what shareholders receive is what was
 * previewed rather than a second rendering that could drift.
 */
router.post('/report/:month/email', async (req, res, next) => {
  try {
    const month = req.params.month;
    assertMonth(month);
    const body = emailSchema.parse(req.body);
    const settings = readSettings();
    const recipients = body.to?.length ? body.to : settings.distributionList;

    if (!recipients.length) {
      throw new ApiError(400, 'No recipients configured. Add a distribution list in settings.');
    }

    const subject = body.subject || `OxyScale investor update — ${monthLabel(month)}`;
    const text = `OxyScale investor update for ${monthLabel(month)}.\n\n`
      + 'This report is best viewed as HTML.';

    await sendEmail({
      to: recipients.join(', '),
      subject,
      htmlBody: body.html,
      textBody: text,
    });

    logger.info({ month, recipients: recipients.length }, 'Investor report emailed');
    res.json({ success: true, sentTo: recipients });
  } catch (err) {
    next(err);
  }
});

export default router;
