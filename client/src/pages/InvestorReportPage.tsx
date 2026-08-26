import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Loader2, Lock, Unlock, Printer, Send, Plus, Trash2, Check, X,
  ArrowUp, ArrowDown, Minus, Settings as SettingsIcon,
} from 'lucide-react';
import * as api from '../services/api';
import type {
  InvestorReportResponse, InvestorReport, InvestorHistoryPoint, InvestorSettings,
} from '../services/api';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import PillButton from '../components/ui/PillButton';

// ── formatting ───────────────────────────────────────────────────

const aud = (n: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);

const shortDate = (iso: string | null) => {
  if (!iso) return '--';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};

function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' }).slice(0, 7);
}

// ── month-on-month delta ─────────────────────────────────────────

/**
 * Change against the previous locked month. Returns null when there is
 * no prior snapshot — the first report should show no comparison rather
 * than implying everything grew from zero.
 */
function Delta({
  current, previous, money = false,
}: {
  current: number | null;
  previous: number | null | undefined;
  money?: boolean;
}) {
  if (previous === null || previous === undefined || current === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-dim text-xs">
        <Minus size={10} /> no change
      </span>
    );
  }
  const up = diff > 0;
  const good = up;
  const pct = previous !== 0 ? Math.abs(Math.round((diff / Math.abs(previous)) * 100)) : null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        good ? 'text-[#0f9d70]' : 'text-risk'
      }`}
    >
      {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
      {money ? aud(Math.abs(diff)) : Math.abs(diff).toLocaleString('en-AU')}
      {pct !== null && <span className="text-ink-dim font-normal">({pct}%)</span>}
    </span>
  );
}

// ── charts (hand-rolled SVG, no dependency) ──────────────────────

const CHART_W = 640;
const CHART_H = 170;
const PAD = { l: 52, r: 12, t: 12, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function ChartFrame({
  title, subtitle, empty, children,
}: {
  title: string; subtitle?: string; empty?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-5 break-inside-avoid">
      <p className="text-ink text-sm font-medium">{title}</p>
      {subtitle && <p className="text-ink-dim text-xs mt-0.5 mb-3">{subtitle}</p>}
      {empty ? (
        <p className="text-ink-dim text-xs py-8 text-center">
          Not enough finalised months yet — this fills in as you lock each month.
        </p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

/** Multi-series line chart over labelled months. */
function LineChart({
  points, series,
}: {
  points: Array<{ label: string } & Record<string, unknown>>;
  series: Array<{ key: string; label: string; colour: string }>;
}) {
  const max = niceMax(Math.max(
    1,
    ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)),
  ));
  const iw = CHART_W - PAD.l - PAD.r;
  const ih = CHART_H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;

  return (
    <>
      <svg width={CHART_W} height={CHART_H} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l} x2={CHART_W - PAD.r}
              y1={PAD.t + ih - f * ih} y2={PAD.t + ih - f * ih}
              stroke="rgba(11,13,14,0.08)" strokeWidth={1}
            />
            <text x={PAD.l - 8} y={PAD.t + ih - f * ih + 3} textAnchor="end"
              fontSize={9} fill="#8a95a0">
              {max * f >= 1000 ? `${Math.round(max * f / 1000)}k` : Math.round(max * f)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none" stroke={s.colour} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
              points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]) || 0)}`).join(' ')}
            />
            {points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(Number(p[s.key]) || 0)} r={2.5} fill={s.colour} />
            ))}
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={CHART_H - 8} textAnchor="middle" fontSize={9} fill="#8a95a0">
            {p.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.colour }} />
            {s.label}
          </span>
        ))}
      </div>
    </>
  );
}

/** Stacked bars — used for live vs not-yet-live MRR. */
function StackedBars({
  points, series,
}: {
  points: Array<{ label: string; projected?: boolean } & Record<string, unknown>>;
  series: Array<{ key: string; label: string; colour: string }>;
}) {
  const totals = points.map((p) => series.reduce((s, ser) => s + (Number(p[ser.key]) || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const iw = CHART_W - PAD.l - PAD.r;
  const ih = CHART_H - PAD.t - PAD.b;
  const bw = Math.min(38, (iw / Math.max(points.length, 1)) * 0.62);

  return (
    <>
      <svg width={CHART_W} height={CHART_H} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={CHART_W - PAD.r}
              y1={PAD.t + ih - f * ih} y2={PAD.t + ih - f * ih}
              stroke="rgba(11,13,14,0.08)" strokeWidth={1} />
            <text x={PAD.l - 8} y={PAD.t + ih - f * ih + 3} textAnchor="end"
              fontSize={9} fill="#8a95a0">
              {max * f >= 1000 ? `${Math.round(max * f / 1000)}k` : Math.round(max * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.l + (i + 0.5) * (iw / Math.max(points.length, 1));
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s) => {
                const v = Number(p[s.key]) || 0;
                const h = (v / max) * ih;
                const yTop = PAD.t + ih - acc - h;
                acc += h;
                return (
                  <rect key={s.key} x={cx - bw / 2} y={yTop} width={bw} height={Math.max(h, 0)}
                    fill={s.colour} opacity={p.projected ? 0.45 : 1} rx={2} />
                );
              })}
              <text x={cx} y={CHART_H - 8} textAnchor="middle" fontSize={9} fill="#8a95a0">
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.colour }} />
            {s.label}
          </span>
        ))}
        {points.some((p) => p.projected) && (
          <span className="text-xs text-ink-dim">Faded bars are projections</span>
        )}
      </div>
    </>
  );
}

// ── tiles ────────────────────────────────────────────────────────

function Tile({
  label, value, delta, sub,
}: {
  label: string; value: string; delta?: React.ReactNode; sub?: string;
}) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-4 break-inside-avoid">
      <p className="text-ink-dim text-[10px] font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-ink text-2xl font-bold leading-tight">{value}</p>
      <div className="mt-1 min-h-[16px]">{delta}</div>
      {sub && <p className="text-ink-dim text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

const SOURCE_COLOURS = [
  '#0a9cd4', '#f59e0b', '#10b981', '#8b5cf6',
  '#ef4444', '#5ec5e6', '#0f9d70', '#b8bfc6',
];

const STATUS_PILL: Record<string, string> = {
  proposed: 'bg-[rgba(94,197,230,0.14)] text-sky-ink',
  approved: 'bg-[rgba(16,185,129,0.12)] text-[#0f9d70]',
  deferred: 'bg-[rgba(11,13,14,0.05)] text-ink-dim',
  spent: 'bg-[rgba(245,158,11,0.15)] text-warn',
  open: 'bg-[rgba(239,68,68,0.10)] text-risk',
  mitigating: 'bg-[rgba(245,158,11,0.15)] text-warn',
  closed: 'bg-[rgba(11,13,14,0.05)] text-ink-dim',
};

export default function InvestorReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<InvestorReportResponse | null>(null);
  const [months, setMonths] = useState<Array<{ month: string; monthLabel: string; status: string }>>([]);
  const [settings, setSettings] = useState<InvestorSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'report' | 'inputs'>('report');
  const [showSettings, setShowSettings] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const load = async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const [d, ms, s] = await Promise.all([
        api.getInvestorReport(m),
        api.getInvestorMonths(),
        api.getInvestorSettings(),
      ]);
      setData(d); setMonths(ms); setSettings(s);
    } catch (err) {
      console.error('Failed to load investor report:', err);
      setError('Could not load the report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(month); }, [month]);

  const report = data?.report ?? null;
  const prev = data?.previous ?? null;
  const locked = report?.status === 'final';

  // Trailing history plus the live month, so charts always show today.
  const series = useMemo<InvestorHistoryPoint[]>(() => {
    if (!data) return [];
    const hist = data.history.filter((h) => h.month !== data.report.month);
    return [...hist, {
      month: data.report.month,
      monthLabel: data.report.monthLabel,
      liveMrr: data.report.tiles.liveMrr,
      committedMrr: data.report.tiles.committedMrr,
      notYetLiveMrr: data.report.tiles.notYetLiveMrr,
      bankBalance: data.report.tiles.bankBalance,
      runwayMonths: data.report.tiles.runwayMonths,
      ringfenceRemaining: data.report.investment.ringfence.remaining,
      wagesRemaining: data.report.investment.wages.remaining,
      funnel: Object.fromEntries(data.report.funnel.map((f) => [f.stage, f.enteredThisMonth])),
    }];
  }, [data]);

  const shortLabel = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' });
  };

  const handleFinalise = async () => {
    if (!report) return;
    if (!window.confirm(
      `Finalise ${report.monthLabel}? The numbers are frozen from this point, so what you send shareholders can't change if a deal moves afterwards. You can reopen it if you need to.`,
    )) return;
    setBusy(true);
    try {
      await api.finaliseInvestorReport(report.month);
      await load(report.month);
      setNotice('Report finalised.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finalise.');
    } finally { setBusy(false); }
  };

  const handleReopen = async () => {
    if (!report) return;
    setBusy(true);
    try {
      await api.reopenInvestorReport(report.month);
      await load(report.month);
      setNotice('Reopened for editing. The version you already sent is kept.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen.');
    } finally { setBusy(false); }
  };

  const handleEmail = async () => {
    if (!report || !printRef.current) return;
    const to = settings?.distributionList ?? [];
    if (!to.length) {
      setError('No distribution list set. Add recipients in settings first.');
      return;
    }
    if (!window.confirm(`Send the ${report.monthLabel} report to ${to.length} recipients?\n\n${to.join('\n')}`)) return;
    setBusy(true);
    try {
      // Send exactly what is on screen, so the email cannot drift from
      // the preview.
      const html = `<div style="font-family:Geist,Helvetica,Arial,sans-serif;color:#0b0d0e">${printRef.current.innerHTML}</div>`;
      const res = await api.emailInvestorReport(report.month, { html });
      setNotice(`Sent to ${res.sentTo.length} recipients.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report.');
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="p-10">
        <p className="text-risk text-sm mb-4">{error}</p>
        <PillButton variant="primary" size="md" trailing="none" onClick={() => load(month)}>
          Retry
        </PillButton>
      </div>
    );
  }

  if (!report) return null;

  const t = report.tiles;
  const pt = prev?.tiles;

  return (
    <div className="p-10 min-h-full bg-cream">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .break-inside-avoid { break-inside: avoid; }
        }
      `}</style>

      {/* Controls */}
      <div className="no-print flex items-start justify-between gap-6 mb-8 flex-wrap">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">OXYSCALE · INVESTOR REPORT</EyebrowLabel>
          <SectionHeading size="section">Investor report.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3">
            Pipeline pulls from the CRM. Five fields a month are yours.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-paper border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]"
          >
            {!months.some((m) => m.month === month) && (
              <option value={month}>{report.monthLabel} (draft)</option>
            )}
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.monthLabel}{m.status === 'final' ? '' : ' (draft)'}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-2 rounded-lg border border-hair-soft text-ink-dim hover:text-ink transition-colors"
            title="Report settings"
          >
            <SettingsIcon size={15} />
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-hair-soft text-ink-muted hover:text-ink text-sm transition-colors"
          >
            <Printer size={14} /> PDF
          </button>
          <button
            onClick={handleEmail}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-hair-soft text-ink-muted hover:text-ink text-sm transition-colors disabled:opacity-40"
          >
            <Send size={14} /> Email
          </button>
          {locked ? (
            <button
              onClick={handleReopen}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-hair-soft text-ink-muted hover:text-ink text-sm transition-colors disabled:opacity-40"
            >
              <Unlock size={14} /> Reopen
            </button>
          ) : (
            <PillButton variant="primary" size="md" trailing="none"
              icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
              onClick={handleFinalise}>
              Finalise
            </PillButton>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div className={`no-print mb-6 rounded-xl px-4 py-3 border ${
          error ? 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.2)]' : 'bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.2)]'
        }`}>
          <p className={`text-sm ${error ? 'text-risk' : 'text-[#0f9d70]'}`}>{error || notice}</p>
        </div>
      )}

      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => { setSettings(s); load(month); setNotice('Settings saved.'); }}
        />
      )}

      {/* Tabs */}
      <div className="no-print flex items-center gap-1 mb-6 bg-paper border border-hair-soft rounded-lg p-1 w-fit">
        {(['report', 'inputs'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === k ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink' : 'text-ink-dim hover:text-ink-muted'
            }`}>
            {k === 'report' ? 'Report' : 'Monthly input'}
          </button>
        ))}
      </div>

      {tab === 'inputs' ? (
        <InputsPanel
          report={report}
          locked={locked}
          onChanged={() => load(month)}
          onError={setError}
        />
      ) : (
        <div ref={printRef} className="space-y-6">
          {/* Header */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 break-inside-avoid">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-ink text-xl font-bold">OxyScale — {report.monthLabel}</h1>
                <p className="text-ink-dim text-xs mt-1">
                  {shortDate(report.periodStart)} to {shortDate(report.periodEnd)} ·
                  Prepared by {report.preparedBy} ·
                  Generated {new Date(report.generatedAt).toLocaleDateString('en-AU')}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                locked ? 'bg-[rgba(16,185,129,0.12)] text-[#0f9d70]' : 'bg-[rgba(245,158,11,0.15)] text-warn'
              }`}>
                {locked ? 'Final' : 'Draft'}
              </span>
            </div>
          </div>

          {/* Headline tiles */}
          <div className="grid grid-cols-3 gap-4">
            <Tile label="Live MRR" value={aud(t.liveMrr)}
              delta={<Delta current={t.liveMrr} previous={pt?.liveMrr} money />}
              sub="Retainers currently billing" />
            <Tile label="Committed MRR" value={aud(t.committedMrr)}
              delta={<Delta current={t.committedMrr} previous={pt?.committedMrr} money />}
              sub={`Includes ${aud(t.notYetLiveMrr)} signed, not yet live`} />
            <Tile label="Bank balance" value={aud(t.bankBalance)}
              delta={<Delta current={t.bankBalance} previous={pt?.bankBalance} money />} />
            <Tile
              label="Runway"
              value={t.runwayMonths === null ? 'Covered' : `${t.runwayMonths} mths`}
              delta={<Delta current={t.runwayMonths} previous={pt?.runwayMonths} />}
              sub={t.runwayMonths === null
                ? 'Revenue covers the cost base'
                : t.forecastRunwayMonths === null
                  ? 'Committed MRR covers the cost base'
                  : `${t.forecastRunwayMonths} mths on committed MRR`} />
            <Tile label="Open pipeline" value={`${aud(t.openPipelineMrr)}/mo`}
              delta={<Delta current={t.openPipelineMrr} previous={pt?.openPipelineMrr} money />}
              sub={`${report.pipeline.openCount} open opportunities`} />
            <Tile label="Signed this month" value={String(t.signedThisMonth.count)}
              delta={<Delta current={t.signedThisMonth.count} previous={pt?.signedThisMonth.count} />}
              sub={`${aud(t.signedThisMonth.mrr)}/mo · ${aud(t.signedThisMonth.oneOff)} one-off`} />
          </div>

          {/* Funnel */}
          <Section title="Funnel">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                  <th className="text-left font-medium pb-2">Stage</th>
                  <th className="text-right font-medium pb-2">Open now</th>
                  <th className="text-right font-medium pb-2">Entered this month</th>
                  <th className="text-right font-medium pb-2">Last month</th>
                  <th className="text-right font-medium pb-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {report.funnel.map((f) => (
                  <tr key={f.stage} className="border-b border-hair-soft last:border-0">
                    <td className="py-2 text-ink-muted">{f.label}</td>
                    <td className="py-2 text-right text-ink font-medium">{f.openNow}</td>
                    <td className="py-2 text-right text-ink-muted">{f.enteredThisMonth}</td>
                    <td className="py-2 text-right text-ink-dim">{f.enteredLastMonth}</td>
                    <td className="py-2 text-right">
                      {f.change === 0
                        ? <span className="text-ink-dim">—</span>
                        : <span className={f.change > 0 ? 'text-[#0f9d70]' : 'text-risk'}>
                            {f.change > 0 ? '+' : ''}{f.change}
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <ChartFrame title="Funnel by month" subtitle="Leads entering each stage, trailing 6 months"
            empty={series.length < 2}>
            <LineChart
              points={series.slice(-6).map((h) => ({
                label: shortLabel(h.month),
                new_lead: h.funnel?.new_lead ?? 0,
                proposal: h.funnel?.proposal ?? 0,
                won: h.funnel?.won ?? 0,
              }))}
              series={[
                { key: 'new_lead', label: 'Leads in', colour: '#5ec5e6' },
                { key: 'proposal', label: 'Proposal sent', colour: '#f59e0b' },
                { key: 'won', label: 'Signed', colour: '#10b981' },
              ]}
            />
          </ChartFrame>

          {/* Lead sources */}
          <Section title="Lead sources"
            right={`${report.leadSources.totals[report.leadSources.totals.length - 1]} in this month`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                    <th className="text-left font-medium pb-2">Source</th>
                    {report.leadSources.monthLabels.map((l, i) => (
                      <th key={i} className="text-right font-medium pb-2 px-2 whitespace-nowrap">{l}</th>
                    ))}
                    <th className="text-right font-medium pb-2 pl-3">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {report.leadSources.sources.length === 0 ? (
                    <tr>
                      <td colSpan={report.leadSources.months.length + 2}
                        className="text-ink-dim text-xs py-3">
                        No leads created in this window.
                      </td>
                    </tr>
                  ) : report.leadSources.sources.map((s, si) => (
                    <tr key={s.source} className="border-b border-hair-soft last:border-0">
                      <td className="py-2 text-ink-muted whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                            style={{ background: SOURCE_COLOURS[si % SOURCE_COLOURS.length] }} />
                          {s.source}
                        </span>
                      </td>
                      {s.counts.map((c, i) => (
                        <td key={i}
                          className={`py-2 px-2 text-right ${
                            i === s.counts.length - 1 ? 'text-ink font-medium' : 'text-ink-muted'
                          }`}>
                          {c || <span className="text-ink-faint">—</span>}
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right">
                        {s.change === 0
                          ? <span className="text-ink-dim">—</span>
                          : <span className={s.change > 0 ? 'text-[#0f9d70]' : 'text-risk'}>
                              {s.change > 0 ? '+' : ''}{s.change}
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {report.leadSources.sources.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-hair">
                      <td className="pt-2 text-ink text-xs font-medium uppercase tracking-wider">Total</td>
                      {report.leadSources.totals.map((c, i) => (
                        <td key={i} className="pt-2 px-2 text-right text-ink font-medium">{c}</td>
                      ))}
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Section>

          <ChartFrame title="Leads in by source" subtitle="New leads created each month, trailing 6 months"
            empty={report.leadSources.sources.length === 0}>
            <StackedBars
              points={report.leadSources.monthLabels.map((label, i) => {
                const row: Record<string, unknown> = { label };
                report.leadSources.sources.forEach((s, si) => { row[`s${si}`] = s.counts[i]; });
                return row as { label: string };
              })}
              series={report.leadSources.sources.map((s, si) => ({
                key: `s${si}`,
                label: s.source,
                colour: SOURCE_COLOURS[si % SOURCE_COLOURS.length],
              }))}
            />
          </ChartFrame>

          {/* Pipeline */}
          <Section title="Pipeline"
            right={`${report.pipeline.openCount} open · ${aud(report.pipeline.openPipelineMrr)}/mo`}>
            {report.pipeline.byStage.length === 0 ? (
              <p className="text-ink-dim text-sm">No open opportunities.</p>
            ) : report.pipeline.byStage.map((g) => (
              <div key={g.stage} className="mb-5 last:mb-0 break-inside-avoid">
                <div className="flex items-baseline justify-between mb-2">
                  <h4 className="text-ink text-sm font-medium">{g.label}</h4>
                  <span className="text-ink-dim text-xs">
                    {g.count} · {aud(g.retainerTotal)}/mo
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                      <th className="text-left font-medium pb-1.5">Company</th>
                      <th className="text-left font-medium pb-1.5">Contact</th>
                      <th className="text-right font-medium pb-1.5">$/mo</th>
                      <th className="text-right font-medium pb-1.5">One-off</th>
                      <th className="text-left font-medium pb-1.5 pl-4">Latest note</th>
                      <th className="text-left font-medium pb-1.5">Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.leadId} className="border-b border-hair-soft last:border-0 align-top">
                        <td className="py-2 text-ink">{r.company}</td>
                        <td className="py-2 text-ink-muted">{r.contact}</td>
                        <td className="py-2 text-right text-ink">{r.retainer ? aud(r.retainer) : '—'}</td>
                        <td className="py-2 text-right text-ink-muted">{r.oneOff ? aud(r.oneOff) : '—'}</td>
                        <td className="py-2 pl-4 text-ink-muted max-w-[18rem]">
                          {r.latestNote
                            ? <>{r.latestNote}<span className="text-ink-dim"> · {shortDate(r.latestNoteAt)}</span></>
                            : <span className="text-ink-dim">—</span>}
                        </td>
                        <td className="py-2 text-ink-muted">
                          {r.nextAction
                            ? <>{r.nextAction}<span className="text-ink-dim"> · {shortDate(r.nextActionDue)}</span></>
                            : <span className="text-ink-dim">none set</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Section>

          {report.signedNotYetLive.length > 0 && (
            <Section title="Signed, not yet billing"
              right={`${aud(t.notYetLiveMrr)}/mo confirmed`}>
              <p className="text-ink-dim text-xs mb-3">
                Revenue starts about {report.settings.revenueLeadDays} days after signing —
                roughly 30 days building and 30 days free.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                    <th className="text-left font-medium pb-1.5">Company</th>
                    <th className="text-left font-medium pb-1.5">Signed</th>
                    <th className="text-right font-medium pb-1.5">$/mo</th>
                    <th className="text-left font-medium pb-1.5">Revenue starts</th>
                    <th className="text-right font-medium pb-1.5">Days until live</th>
                  </tr>
                </thead>
                <tbody>
                  {report.signedNotYetLive.map((c) => (
                    <tr key={c.leadId} className="border-b border-hair-soft last:border-0">
                      <td className="py-2 text-ink">{c.company}</td>
                      <td className="py-2 text-ink-muted">{shortDate(c.signedOn)}</td>
                      <td className="py-2 text-right text-ink">{aud(c.retainer)}</td>
                      <td className="py-2 text-ink-muted">{shortDate(c.revenueStartsOn)}</td>
                      <td className="py-2 text-right text-ink-muted">{c.daysUntilLive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <ChartFrame title="Committed MRR" subtitle="Trailing months and 3 months forward"
            empty={series.length === 0}>
            <StackedBars
              points={[
                ...series.slice(-6).map((h) => ({
                  label: shortLabel(h.month), liveMrr: h.liveMrr, notYetLiveMrr: h.notYetLiveMrr,
                })),
                ...(data?.forward ?? []).map((f) => ({
                  label: shortLabel(f.month), liveMrr: f.liveMrr, notYetLiveMrr: f.notYetLiveMrr, projected: true as const,
                })),
              ]}
              series={[
                { key: 'liveMrr', label: 'Live MRR', colour: '#0a9cd4' },
                { key: 'notYetLiveMrr', label: 'Signed, not yet live', colour: '#5ec5e6' },
              ]}
            />
          </ChartFrame>

          {/* Investment tracker */}
          <Section title="Investment tracker">
            <div className="grid grid-cols-2 gap-5">
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <h4 className="text-ink text-sm font-medium">Ring fence</h4>
                  <span className="text-ink-dim text-xs">
                    {aud(report.investment.ringfence.remaining)} of {aud(report.investment.ringfence.total)} left
                  </span>
                </div>
                <PotBar total={report.investment.ringfence.total} used={report.investment.ringfence.paid} />
                <table className="w-full text-sm mt-3">
                  <tbody>
                    {report.investment.ringfence.payments.length === 0 ? (
                      <tr><td className="text-ink-dim text-xs py-2">No payments recorded.</td></tr>
                    ) : report.investment.ringfence.payments.map((p) => (
                      <tr key={p.id} className="border-b border-hair-soft last:border-0">
                        <td className="py-1.5 text-ink-dim text-xs w-20">{shortDate(p.paidOn)}</td>
                        <td className="py-1.5 text-ink-muted">{p.item}</td>
                        <td className="py-1.5 text-right text-ink">{aud(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <h4 className="text-ink text-sm font-medium">Wages pot</h4>
                  <span className="text-ink-dim text-xs">
                    {aud(report.investment.wages.remaining)} of {aud(report.investment.wages.total)} left
                  </span>
                </div>
                <PotBar total={report.investment.wages.total} used={report.investment.wages.drawn} />
                <p className="text-ink-dim text-xs mt-3">
                  {aud(report.investment.wages.drawn)} drawn to date. The remainder counts as
                  committed incoming cash in the runway figure.
                </p>
              </div>
            </div>
          </Section>

          <ChartFrame title="Pots remaining" subtitle="By month" empty={series.length < 2}>
            <LineChart
              points={series.map((h) => ({
                label: shortLabel(h.month),
                ringfenceRemaining: h.ringfenceRemaining,
                wagesRemaining: h.wagesRemaining,
              }))}
              series={[
                { key: 'wagesRemaining', label: 'Wages pot', colour: '#0a9cd4' },
                { key: 'ringfenceRemaining', label: 'Ring fence', colour: '#f59e0b' },
              ]}
            />
          </ChartFrame>

          {/* Position */}
          <Section title="Position">
            <div className="grid grid-cols-4 gap-4">
              <Figure label="Bank balance" value={aud(report.position.bankBalance)} />
              <Figure label="Committed incoming" value={aud(report.position.committedIncoming)}
                sub="Remaining wages pot" />
              <Figure label="Runway" value={report.position.runwayMonths === null ? 'Covered' : `${report.position.runwayMonths} mths`}
                sub="On live MRR" />
              <Figure label="Forecast runway" value={report.position.forecastRunwayMonths === null ? 'Covered' : `${report.position.forecastRunwayMonths} mths`}
                sub="On committed MRR" />
            </div>
          </Section>

          <ChartFrame title="Bank balance and live MRR" subtitle="Trailing 12 months"
            empty={series.length < 2}>
            <LineChart
              points={series.slice(-12).map((h) => ({
                label: shortLabel(h.month), bankBalance: h.bankBalance, liveMrr: h.liveMrr,
              }))}
              series={[
                { key: 'bankBalance', label: 'Bank balance', colour: '#0b0d0e' },
                { key: 'liveMrr', label: 'Live MRR', colour: '#0a9cd4' },
              ]}
            />
          </ChartFrame>

          {/* Planned spend */}
          <Section title="Planned spend">
            {report.plannedSpend.length === 0 ? (
              <p className="text-ink-dim text-sm">Nothing planned.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                    <th className="text-left font-medium pb-1.5">Item</th>
                    <th className="text-right font-medium pb-1.5">Est. cost</th>
                    <th className="text-left font-medium pb-1.5 pl-4">Timing</th>
                    <th className="text-left font-medium pb-1.5">Purpose</th>
                    <th className="text-left font-medium pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.plannedSpend.map((s) => (
                    <tr key={s.id} className="border-b border-hair-soft last:border-0 align-top">
                      <td className="py-2 text-ink">{s.item}</td>
                      <td className="py-2 text-right text-ink-muted">{s.estimatedCost ? aud(s.estimatedCost) : '—'}</td>
                      <td className="py-2 pl-4 text-ink-muted">{s.timing || '—'}</td>
                      <td className="py-2 text-ink-muted max-w-[20rem]">{s.purpose || '—'}</td>
                      <td className="py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_PILL[s.status] || ''}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Risks */}
          <Section title="Key risks">
            {report.risks.length === 0 ? (
              <p className="text-ink-dim text-sm">No risks recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-dim text-[10px] uppercase tracking-wider border-b border-hair-soft">
                    <th className="text-left font-medium pb-1.5">Risk</th>
                    <th className="text-left font-medium pb-1.5">Mitigation</th>
                    <th className="text-left font-medium pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.risks.map((r) => (
                    <tr key={r.id} className="border-b border-hair-soft last:border-0 align-top">
                      <td className="py-2 text-ink max-w-[18rem]">{r.risk}</td>
                      <td className="py-2 text-ink-muted max-w-[24rem]">{r.mitigation || '—'}</td>
                      <td className="py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_PILL[r.status] || ''}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────

function Section({
  title, right, children,
}: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-5 break-inside-avoid">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-ink text-sm font-medium uppercase tracking-wider">{title}</h3>
        {right && <span className="text-ink-dim text-xs">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-ink-dim text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-ink text-lg font-bold">{value}</p>
      {sub && <p className="text-ink-dim text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function PotBar({ total, used }: { total: number; used: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return (
    <div className="w-full h-2 bg-tray rounded-full overflow-hidden">
      <div className="h-full bg-ink rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── settings ─────────────────────────────────────────────────────

function SettingsPanel({
  settings, onClose, onSaved,
}: {
  settings: InvestorSettings;
  onClose: () => void;
  onSaved: (s: InvestorSettings) => void;
}) {
  const [leadDays, setLeadDays] = useState(String(settings.revenueLeadDays));
  const [costBase, setCostBase] = useState(String(settings.monthlyCostBase));
  const [list, setList] = useState(settings.distributionList.join('\n'));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const emails = list.split('\n').map((s) => s.trim()).filter(Boolean);
      const saved = await api.updateInvestorSettings({
        revenueLeadDays: Number(leadDays),
        monthlyCostBase: Number(costBase),
        distributionList: emails,
      });
      onSaved(saved); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save settings.');
    } finally { setSaving(false); }
  };

  return (
    <div className="no-print bg-paper border border-hair-soft rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-ink text-sm font-medium">Report settings</h3>
        <button onClick={onClose} className="text-ink-dim hover:text-ink p-1"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Revenue lead time (days)" hint="Signing to first billing. 30 build + 30 free.">
          <input type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
        </Field>
        <Field label="Monthly cost base" hint="Used for runway. Never shown on the report.">
          <input type="number" value={costBase} onChange={(e) => setCostBase(e.target.value)}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Distribution list" hint="One email per line.">
          <textarea value={list} onChange={(e) => setList(e.target.value)} rows={4}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)] resize-none" />
        </Field>
      </div>
      {err && <p className="text-risk text-xs mt-3">{err}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-ink-muted border border-hair-soft">Cancel</button>
        <PillButton variant="primary" size="md" trailing="none"
          icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          onClick={save}>Save</PillButton>
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-ink-dim text-[10px] font-medium uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-ink-dim text-xs mt-1">{hint}</p>}
    </div>
  );
}

// ── monthly input form ───────────────────────────────────────────

function InputsPanel({
  report, locked, onChanged, onError,
}: {
  report: InvestorReport;
  locked: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [bank, setBank] = useState(report.inputs.bankBalance?.toString() ?? '');
  const [mrrOverride, setMrrOverride] = useState(report.inputs.liveMrrOverride?.toString() ?? '');
  const [wagesDrawn, setWagesDrawn] = useState(String(report.inputs.potWagesDrawn));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [payDate, setPayDate] = useState(report.periodEnd);
  const [payItem, setPayItem] = useState('');
  const [payAmount, setPayAmount] = useState('');

  const [spendItem, setSpendItem] = useState('');
  const [spendCost, setSpendCost] = useState('');
  const [spendTiming, setSpendTiming] = useState('');
  const [spendPurpose, setSpendPurpose] = useState('');

  const [riskText, setRiskText] = useState('');
  const [riskMitigation, setRiskMitigation] = useState('');

  if (locked) {
    return (
      <div className="bg-paper border border-hair-soft rounded-xl p-8 text-center">
        <Lock size={20} className="text-ink-dim mx-auto mb-3" />
        <p className="text-ink-muted text-sm mb-1">{report.monthLabel} is finalised.</p>
        <p className="text-ink-dim text-xs">Reopen it from the header if you need to change something.</p>
      </div>
    );
  }

  const saveFigures = async () => {
    setSaving(true); setSaved(false);
    try {
      await api.saveInvestorInputs(report.month, {
        bankBalance: bank === '' ? null : Number(bank),
        liveMrrOverride: mrrOverride === '' ? null : Number(mrrOverride),
        potWagesDrawn: Number(wagesDrawn) || 0,
      });
      setSaved(true);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  };

  const addPayment = async () => {
    if (!payItem.trim() || !payAmount) return;
    try {
      await api.addRingfencePayment({
        paidOn: payDate, item: payItem.trim(), amount: Number(payAmount),
      });
      setPayItem(''); setPayAmount(''); onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add the payment.');
    }
  };

  const addSpend = async () => {
    if (!spendItem.trim()) return;
    try {
      await api.addPlannedSpend({
        item: spendItem.trim(),
        estimatedCost: Number(spendCost) || 0,
        timing: spendTiming.trim() || null,
        purpose: spendPurpose.trim() || null,
      });
      setSpendItem(''); setSpendCost(''); setSpendTiming(''); setSpendPurpose(''); onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add the item.');
    }
  };

  const addRisk = async () => {
    if (!riskText.trim()) return;
    try {
      await api.addInvestorRisk({ risk: riskText.trim(), mitigation: riskMitigation.trim() || null });
      setRiskText(''); setRiskMitigation(''); onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add the risk.');
    }
  };

  const input = 'w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)]';

  return (
    <div className="space-y-6 max-w-4xl">
      <Section title={`Figures for ${report.monthLabel}`}>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Bank balance at month end">
            <input type="number" value={bank} onChange={(e) => setBank(e.target.value)}
              placeholder="0" className={input} />
          </Field>
          <Field label="Live MRR override"
            hint={`CRM says ${aud(report.inputs.crmLiveMrr)}. Leave blank to use it.`}>
            <input type="number" value={mrrOverride} onChange={(e) => setMrrOverride(e.target.value)}
              placeholder={String(report.inputs.crmLiveMrr)} className={input} />
          </Field>
          <Field label="$90k pot: total drawn to date">
            <input type="number" value={wagesDrawn} onChange={(e) => setWagesDrawn(e.target.value)}
              placeholder="0" className={input} />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <PillButton variant="primary" size="md" trailing="none"
            icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            onClick={saveFigures}>Save figures</PillButton>
          {saved && <span className="text-[#0f9d70] text-xs">Saved.</span>}
        </div>
      </Section>

      <Section title="Ring fence payments this month"
        right={`${aud(report.investment.ringfence.remaining)} left`}>
        <div className="grid grid-cols-[8rem_1fr_8rem_auto] gap-2 items-end mb-3">
          <Field label="Date">
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={input} />
          </Field>
          <Field label="Item">
            <input value={payItem} onChange={(e) => setPayItem(e.target.value)}
              placeholder="What was it for" className={input} />
          </Field>
          <Field label="Amount">
            <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0" className={input} />
          </Field>
          <button onClick={addPayment} disabled={!payItem.trim() || !payAmount}
            className="bg-ink text-white rounded-lg p-2.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 mb-[1px]">
            <Plus size={16} />
          </button>
        </div>
        {report.investment.ringfence.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-hair-soft last:border-0 text-sm group">
            <span className="text-ink-dim text-xs w-20">{shortDate(p.paidOn)}</span>
            <span className="text-ink-muted flex-1">{p.item}</span>
            <span className="text-ink">{aud(p.amount)}</span>
            <button
              onClick={async () => {
                if (!window.confirm(`Remove the ${aud(p.amount)} payment for "${p.item}"?`)) return;
                try { await api.deleteRingfencePayment(p.id); onChanged(); }
                catch { onError('Could not remove that payment.'); }
              }}
              className="text-ink-faint hover:text-risk p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </Section>

      <Section title="Planned spend">
        <div className="grid grid-cols-[1fr_7rem_7rem_auto] gap-2 items-end mb-3">
          <Field label="Item">
            <input value={spendItem} onChange={(e) => setSpendItem(e.target.value)}
              placeholder="e.g. Offshore data resource" className={input} />
          </Field>
          <Field label="Est. cost">
            <input type="number" value={spendCost} onChange={(e) => setSpendCost(e.target.value)}
              placeholder="0" className={input} />
          </Field>
          <Field label="Timing">
            <input value={spendTiming} onChange={(e) => setSpendTiming(e.target.value)}
              placeholder="Oct 2026" className={input} />
          </Field>
          <button onClick={addSpend} disabled={!spendItem.trim()}
            className="bg-ink text-white rounded-lg p-2.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 mb-[1px]">
            <Plus size={16} />
          </button>
        </div>
        <input value={spendPurpose} onChange={(e) => setSpendPurpose(e.target.value)}
          placeholder="Purpose (optional)" className={`${input} mb-4`} />
        {report.plannedSpend.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-hair-soft last:border-0 text-sm group">
            <span className="text-ink flex-1">{s.item}</span>
            <span className="text-ink-muted text-xs">{s.estimatedCost ? aud(s.estimatedCost) : ''}</span>
            <select value={s.status}
              onChange={async (e) => {
                try { await api.updatePlannedSpend(s.id, { status: e.target.value }); onChanged(); }
                catch { onError('Could not update that item.'); }
              }}
              className="bg-cream border border-hair-soft rounded-md px-2 py-1 text-xs text-ink-muted focus:outline-none">
              {['proposed', 'approved', 'deferred', 'spent'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!window.confirm(`Remove "${s.item}" from planned spend?`)) return;
                try { await api.deletePlannedSpend(s.id); onChanged(); }
                catch { onError('Could not remove that item.'); }
              }}
              className="text-ink-faint hover:text-risk p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </Section>

      <Section title="Key risks">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end mb-3">
          <Field label="Risk">
            <input value={riskText} onChange={(e) => setRiskText(e.target.value)}
              placeholder="What could go wrong" className={input} />
          </Field>
          <Field label="Mitigation">
            <input value={riskMitigation} onChange={(e) => setRiskMitigation(e.target.value)}
              placeholder="What we're doing about it" className={input} />
          </Field>
          <button onClick={addRisk} disabled={!riskText.trim()}
            className="bg-ink text-white rounded-lg p-2.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 mb-[1px]">
            <Plus size={16} />
          </button>
        </div>
        {report.risks.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-1.5 border-b border-hair-soft last:border-0 text-sm group">
            <span className="text-ink flex-1">{r.risk}</span>
            <select value={r.status}
              onChange={async (e) => {
                try { await api.updateInvestorRisk(r.id, { status: e.target.value }); onChanged(); }
                catch { onError('Could not update that risk.'); }
              }}
              className="bg-cream border border-hair-soft rounded-md px-2 py-1 text-xs text-ink-muted focus:outline-none">
              {['open', 'mitigating', 'closed'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!window.confirm('Remove this risk?')) return;
                try { await api.deleteInvestorRisk(r.id); onChanged(); }
                catch { onError('Could not remove that risk.'); }
              }}
              className="text-ink-faint hover:text-risk p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}
