// ============================================================
// Reports — investor pulse-check view
//
// One screen. Pick a date range + optional category, hit Refresh,
// see everything you need for a fortnightly investor catch-up:
//
//   - Pipeline summary by tier (count + $ value)
//   - KPI strip: total pipeline $, new leads, won, lost, tasks due
//   - New leads added in the window
//   - Won and Lost deals closed in the window
//   - Tasks due / overdue
//
// Designed to be readable as a one-pager you can screenshot and
// share, or read off live during the meeting.
// ============================================================

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Trophy,
  XCircle,
  CalendarClock,
  Building2,
  DollarSign,
  Printer,
  PhoneCall,
  CheckSquare,
  ClipboardList,
} from 'lucide-react';
import * as api from '../services/api';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

// ── Helpers ────────────────────────────────────────────────────

function formatAUD(n: number): string {
  if (!n) return '$0';
  return `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

function formatLongDate(yyyymmdd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyymmdd);
  if (!match) return yyyymmdd;
  const [, y, m, d] = match;
  const day = parseInt(d, 10);
  const monthName = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, day))
    .toLocaleDateString('en-AU', { month: 'long', timeZone: 'UTC' });
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? 'th'
    : day % 10 === 1 ? 'st'
    : day % 10 === 2 ? 'nd'
    : day % 10 === 3 ? 'rd'
    : 'th';
  return `${day}${suffix} ${monthName} ${y}`;
}

// Default window: today and 14 days back
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().split('T')[0];
  const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  return { from, to };
}

// Quick-pick range options
function rangeForPreset(preset: 'today' | 'week' | 'fortnight' | 'month' | 'quarter' | 'mtd' | 'ytd') {
  const today = new Date();
  const to = today.toISOString().split('T')[0];
  if (preset === 'mtd') {
    const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    return { from, to };
  }
  if (preset === 'ytd') {
    const from = `${today.getFullYear()}-01-01`;
    return { from, to };
  }
  const days = preset === 'today' ? 0 : preset === 'week' ? 7 : preset === 'fortnight' ? 14 : preset === 'month' ? 30 : 90;
  const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  return { from, to };
}

// ── Component ──────────────────────────────────────────────────

export default function ReportsPage() {
  const navigate = useNavigate();
  const initialRange = defaultRange();

  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const toggleTier = useCallback((tier: string) => {
    setExpandedTier((prev) => (prev === tier ? null : tier));
  }, []);

  const [from, setFrom] = useState<string>(initialRange.from);
  const [to, setTo] = useState<string>(initialRange.to);
  const [category, setCategory] = useState<string>('all');
  const [data, setData] = useState<api.ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load whenever filters change
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, category]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getReport({
        from,
        to,
        category: category === 'all' ? undefined : category,
      });
      setData(result);
    } catch (err) {
      console.error('Failed to load report:', err);
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  // Distinct categories pulled from the report response
  const categories = useMemo(() => data?.categories ?? [], [data]);

  return (
    <div className="p-10 min-h-full bg-cream max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            OPERATIONS · REPORTS
          </EyebrowLabel>
          <SectionHeading size="section">Operations overview.</SectionHeading>
        </div>
        <button
          onClick={() => {
            const params = new URLSearchParams();
            params.set('from', from);
            params.set('to', to);
            if (category !== 'all') params.set('category', category);
            navigate(`/report?${params.toString()}`);
          }}
          className="border border-hair-strong text-ink-muted hover:text-ink text-sm rounded-full px-4 py-2 transition-all flex items-center gap-2"
          title="Print / save as PDF"
        >
          <Printer size={14} />
          Print Report
        </button>
      </div>

      {/* Filters bar */}
      <div className="bg-paper border border-hair-soft rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter size={14} className="text-ink-dim" />

          <div className="flex items-center gap-2">
            <span className="text-ink-dim text-xs uppercase tracking-wider">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-cream border border-hair-soft rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-sky transition-all [color-scheme:light]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-ink-dim text-xs uppercase tracking-wider">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-cream border border-hair-soft rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-sky transition-all [color-scheme:light]"
            />
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-cream border border-hair-soft rounded-lg px-3 py-1.5 text-sm text-ink-muted focus:outline-none focus:border-sky transition-all"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Quick-pick presets */}
          <div className="flex items-center gap-1 ml-auto">
            {([
              { key: 'week', label: '7 days' },
              { key: 'fortnight', label: '14 days' },
              { key: 'month', label: '30 days' },
              { key: 'quarter', label: '90 days' },
              { key: 'mtd', label: 'MTD' },
              { key: 'ytd', label: 'YTD' },
            ] as const).map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  const r = rangeForPreset(p.key);
                  setFrom(r.from);
                  setTo(r.to);
                }}
                className="text-ink-muted text-xs px-2.5 py-1 rounded-full border border-hair-soft hover:border-hair-strong hover:text-ink transition-all"
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={load}
              disabled={loading}
              className="text-ink-muted text-xs px-2.5 py-1 rounded-full hover:text-ink transition-all flex items-center gap-1 disabled:opacity-50"
              title="Refresh"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
        </div>

        {data && (
          <p className="text-ink-dim text-xs mt-3">
            Reporting on {formatLongDate(data.window.from)} - {formatLongDate(data.window.to)}
            {data.window.category && ` . filtered to ${data.window.category}`}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-xl p-4 mb-6">
          <p className="text-risk text-sm">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin text-ink-dim" />
        </div>
      ) : data ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <KpiCard
              icon={<DollarSign size={14} />}
              label="Total pipeline"
              value={formatAUD(data.summary.totalPipelineValue)}
              sub={`${data.summary.totalPipelineCount} active`}
              accent
            />
            <KpiCard
              icon={<DollarSign size={14} />}
              label="Weighted pipeline"
              value={formatAUD(data.summary.weightedPipelineValue)}
              sub="risk-adjusted"
              accent
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KpiCard
              icon={<Users size={14} />}
              label="New leads"
              value={String(data.summary.newLeadCount)}
              sub="in window"
            />
            <KpiCard
              icon={<PhoneCall size={14} />}
              label="Contacted"
              value={String(data.summary.contactedCount)}
              sub="in window"
            />
            <KpiCard
              icon={<ClipboardList size={14} />}
              label="Tasks set"
              value={String(data.summary.tasksCreated)}
              sub="in window"
            />
            <KpiCard
              icon={<CheckSquare size={14} />}
              label="Tasks completed"
              value={String(data.summary.tasksCompleted)}
              sub="in window"
            />
          </div>

          {/* Won / Lost */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <KpiCard
              icon={<Trophy size={14} />}
              label="Won"
              value={String(data.summary.wonCount)}
              sub={formatAUD(data.summary.wonValue)}
            />
            <KpiCard
              icon={<XCircle size={14} />}
              label="Lost"
              value={String(data.summary.lostCount)}
              sub={formatAUD(data.summary.lostValue)}
            />
          </div>

          {/* Tier breakdown — clickable to expand leads */}
          <Section title="Pipeline by tier" icon={<TrendingUp size={14} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data.byTier.filter((t) => ['pulse', 'tier_1', 'tier_2', 'tier_3'].includes(t.tier)).map((t) => (
                <button
                  key={t.tier}
                  onClick={() => t.count > 0 && toggleTier(t.tier)}
                  className={`text-left bg-paper border rounded-xl p-4 transition-all ${
                    expandedTier === t.tier
                      ? 'border-sky ring-1 ring-sky-hair'
                      : 'border-hair-soft hover:border-hair-strong'
                  } ${t.count > 0 ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <p className="text-ink-dim text-[11px] uppercase tracking-wider">{t.label}</p>
                  <p className="text-ink text-2xl font-medium mt-1">{t.count}</p>
                  <p className="text-ink-muted text-xs mt-1">{formatAUD(t.totalValue)}</p>
                </button>
              ))}
            </div>

            {/* Expanded tier leads */}
            {expandedTier && data.pipelineLeads.filter((l) => l.tier === expandedTier).length > 0 && (
              <div className="mt-4 bg-paper border border-hair-soft rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_100px] gap-3 px-4 py-2.5 bg-tray text-ink-dim text-[11px] uppercase tracking-wider font-medium">
                  <span>Lead</span>
                  <span className="text-right">Value</span>
                </div>
                {data.pipelineLeads
                  .filter((l) => l.tier === expandedTier)
                  .map((l, idx) => (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/leads/${l.id}`)}
                      className={`w-full text-left grid grid-cols-[1fr_100px] gap-3 px-4 py-3 hover:bg-tray transition-all items-center ${
                        idx > 0 ? 'border-t border-hair-soft' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-ink text-sm font-medium truncate">{l.name}</p>
                        {l.company && (
                          <p className="text-ink-muted text-xs truncate flex items-center gap-1.5">
                            <Building2 size={10} className="text-ink-dim flex-shrink-0" />
                            <span className="truncate">{l.company}</span>
                          </p>
                        )}
                        {l.latestNote && (
                          <p className="text-ink-dim text-xs mt-0.5 truncate max-w-[400px]">
                            {l.latestNote.slice(0, 80)}{l.latestNote.length > 80 ? '...' : ''}
                          </p>
                        )}
                      </div>
                      <span className="text-ink text-sm font-medium text-right">
                        {l.dealValue ? formatAUD(l.dealValue) : <span className="text-ink-dim font-normal">--</span>}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </Section>

          {/* Won */}
          <Section
            title={`Won (${data.won.length} - ${formatAUD(data.summary.wonValue)})`}
            icon={<Trophy size={14} />}
          >
            {data.won.length === 0 ? (
              <EmptyRow text="No deals won in this window." />
            ) : (
              <LeadTable
                rows={data.won.map((l) => ({
                  id: l.id,
                  name: l.name,
                  company: l.company,
                  category: l.category,
                  tier: l.tier,
                  dealValue: l.dealValue,
                  whenLabel: formatLongDate(l.closedAt.split('T')[0]),
                }))}
                whenColumn="Closed"
                onOpen={(id) => navigate(`/leads/${id}`)}
              />
            )}
          </Section>

          {/* Lost */}
          <Section
            title={`Lost (${data.lost.length} - ${formatAUD(data.summary.lostValue)})`}
            icon={<XCircle size={14} />}
          >
            {data.lost.length === 0 ? (
              <EmptyRow text="No deals lost in this window." />
            ) : (
              <LeadTable
                rows={data.lost.map((l) => ({
                  id: l.id,
                  name: l.name,
                  company: l.company,
                  category: l.category,
                  tier: l.tier,
                  dealValue: l.dealValue,
                  whenLabel: formatLongDate(l.closedAt.split('T')[0]),
                }))}
                whenColumn="Closed"
                onOpen={(id) => navigate(`/leads/${id}`)}
              />
            )}
          </Section>

          {/* Tasks due */}
          <Section
            title={`Tasks due or overdue (${data.tasksDue.length})`}
            icon={<CalendarClock size={14} />}
          >
            {data.tasksDue.length === 0 ? (
              <EmptyRow text="Nothing due as of this window." />
            ) : (
              <div className="bg-paper border border-hair-soft rounded-xl overflow-hidden">
                {data.tasksDue.map((t, idx) => {
                  const today = new Date().toISOString().split('T')[0];
                  const overdue = t.dueDate < today;
                  const dueToday = t.dueDate === today;
                  return (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/leads/${t.leadId}`)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-tray transition-all ${
                        idx > 0 ? 'border-t border-hair-soft' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-ink text-sm font-medium truncate">{t.label}</p>
                        <p className="text-ink-muted text-xs truncate">
                          {t.leadName}{t.leadCompany ? ` . ${t.leadCompany}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs flex-shrink-0 ${
                        overdue ? 'text-risk' : dueToday ? 'text-warn' : 'text-ink-dim'
                      }`}>
                        {overdue ? 'Overdue . ' : dueToday ? 'Today . ' : ''}
                        {formatLongDate(t.dueDate)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      ) : (
        <div className="bg-paper border border-hair-soft rounded-xl py-16 text-center">
          <FileText size={28} className="text-ink-faint mx-auto mb-3" />
          <p className="text-ink-muted text-sm">No data.</p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        accent
          ? 'bg-sky-wash border border-sky-hair'
          : 'bg-paper border border-hair-soft'
      }`}
    >
      <div className="flex items-center gap-1.5 text-ink-dim text-[11px] uppercase tracking-wider">
        <span className={accent ? 'text-sky-ink' : 'text-ink-dim'}>{icon}</span>
        {label}
      </div>
      <p className={`text-2xl font-medium mt-1 ${accent ? 'text-sky-ink' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-ink-muted text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sky-ink">{icon}</span>
        <h3 className="text-ink text-base font-medium">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl py-6 text-center">
      <p className="text-ink-dim text-sm italic">{text}</p>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  pulse: 'Pulse',
  tier_1: 'Tier 1',
  tier_2: 'Tier 2',
  tier_3: 'Tier 3',
  won: 'Won',
  lost: 'Lost',
};

function LeadTable({
  rows,
  whenColumn,
  onOpen,
}: {
  rows: Array<{
    id: number;
    name: string;
    company: string | null;
    category: string | null;
    tier: string;
    dealValue: number;
    whenLabel: string;
  }>;
  whenColumn: string;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_100px_140px] gap-3 px-4 py-2.5 bg-tray text-ink-dim text-[11px] uppercase tracking-wider font-medium">
        <span>Lead</span>
        <span>Tier</span>
        <span className="text-right">Value</span>
        <span className="text-right">{whenColumn}</span>
      </div>
      {rows.map((r, idx) => (
        <button
          key={r.id}
          onClick={() => onOpen(r.id)}
          className={`w-full text-left grid grid-cols-[1fr_120px_100px_140px] gap-3 px-4 py-3 hover:bg-tray transition-all items-center ${
            idx > 0 ? 'border-t border-hair-soft' : ''
          }`}
        >
          <div className="min-w-0">
            <p className="text-ink text-sm font-medium truncate">{r.name}</p>
            <p className="text-ink-muted text-xs truncate flex items-center gap-1.5">
              {r.company && (
                <>
                  <Building2 size={10} className="text-ink-dim flex-shrink-0" />
                  <span className="truncate">{r.company}</span>
                </>
              )}
              {r.category && (
                <span className="text-ink-dim">. {r.category}</span>
              )}
            </p>
          </div>
          <span className="text-ink-muted text-xs">{TIER_LABELS[r.tier] || r.tier}</span>
          <span className="text-ink text-sm font-medium text-right">
            {r.dealValue ? formatAUD(r.dealValue) : <span className="text-ink-dim font-normal">-</span>}
          </span>
          <span className="text-ink-muted text-xs text-right">{r.whenLabel}</span>
        </button>
      ))}
    </div>
  );
}
