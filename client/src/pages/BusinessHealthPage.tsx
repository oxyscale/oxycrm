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

/** How a runway state reads as a headline figure. */
function runwayValue(r: api.InvestorRunway): string {
  if (r.state === 'unknown') return 'Not set';
  if (r.state === 'covered') return 'Covered';
  return String(r.months);
}

/**
 * The sentence under the runway figure. 'Not set' has to say why —
 * an unentered cost base previously rendered as infinite runway, which
 * read as a healthy business rather than as missing information.
 */
function runwayNote(
  r: api.InvestorRunway, forecast: api.InvestorRunway, avgBurn: number | null,
): string {
  if (r.state === 'unknown') return "Add the month's expenses to calculate runway";
  if (r.state === 'covered') return 'Revenue now covers what the business spends';
  if (avgBurn !== null && r.state === 'months') {
    if (forecast.state === 'covered') return 'Signed revenue will cover the burn';
    if (forecast.state === 'months') return `${forecast.months} months once signed clients go live`;
  }
  if (forecast.state === 'covered') return 'Signed revenue will cover the cost base';
  if (forecast.state === 'months') return `${forecast.months} months once signed clients go live`;
  return '';
}

/** A dollar figure expressed as a client count. */
function clientsFor(amount: number, avg: number): string {
  if (!(avg > 0)) return '—';
  const n = Math.round(amount / avg);
  return `${n} ${n === 1 ? 'client' : 'clients'}`;
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


/** Multi-series line chart over labelled months. */
/** Compact money for chart labels: 13900 -> 13.9k. */
function compact(n: number): string {
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

function LineChart({
  points, series, showValues = false, spike,
}: {
  points: Array<{ label: string } & Record<string, unknown>>;
  series: Array<{ key: string; label: string; colour: string }>;
  /** Print the value above each point of the FIRST series. Only the
   *  first, because two series that touch would collide. */
  showValues?: boolean;
  /** One-off amounts drawn as vertical bars rather than a line, because
   *  they arrive once rather than every month. */
  spike?: { key: string; label: string; colour: string };
}) {
  const max = niceMax(Math.max(
    1,
    ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)),
  ));
  // Spikes are scaled independently. A one-off fee can be several times
  // a month's recurring revenue, and sharing the axis would squash the
  // line into the floor — the trend is the point of the chart.
  const spikeMax = spike
    ? niceMax(Math.max(1, ...points.map((p) => Number(p[spike.key]) || 0)))
    : 1;
  const iw = CHART_W - PAD.l - PAD.r;
  const ih = CHART_H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;

  return (
    <>
      <svg width={CHART_W + (spike ? 34 : 0)} height={CHART_H + (showValues ? 10 : 0)} role="img">
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
            {/* One-off cash reads against its own axis on the right, so
                a spike three times a month's revenue can be shown at
                full height without flattening the line. */}
            {spike && (
              <text x={CHART_W - PAD.r + 8} y={PAD.t + ih - f * ih + 3} textAnchor="start"
                fontSize={9} fill={spike.colour}>
                {spikeMax * f >= 1000 ? `${Math.round(spikeMax * f / 1000)}k` : Math.round(spikeMax * f)}
              </text>
            )}
          </g>
        ))}
        {spike && points.map((p, i) => {
          const v = Number(p[spike.key]) || 0;
          if (v <= 0) return null;
          // Own scale, and never taller than the plot area.
          const top = PAD.t + ih - (v / spikeMax) * ih;
          return (
            <g key={`sp${i}`}>
              <rect x={x(i) - 3} y={top} width={6} height={PAD.t + ih - top}
                fill={spike.colour} rx={1.5} opacity={0.9} />
              <text x={x(i)} y={top - 6} textAnchor="middle"
                fontSize={10} fontWeight={600} fill={spike.colour}>
                {compact(v)}
              </text>
            </g>
          );
        })}
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
            {showValues && s.key === series[0].key && points.map((p, i) => {
              // A spike runs vertically through the point, so the label
              // goes underneath rather than on top of the bar.
              const collides = spike ? (Number(p[spike.key]) || 0) > 0 : false;
              return (
                <text
                  key={`v${i}`}
                  // Shifted clear of the bar rather than sitting on it.
                  x={x(i) + (collides ? 8 : 0)}
                  y={y(Number(p[s.key]) || 0) + (collides ? 14 : -8)}
                  textAnchor={collides ? 'start' : 'middle'}
                  fontSize={10}
                  fontWeight={600}
                  fill="#0b0d0e"
                >
                  {compact(Number(p[s.key]) || 0)}
                </text>
              );
            })}
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
        {spike && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="w-1 h-3 rounded-sm" style={{ background: spike.colour }} />
            {spike.label}
            <span className="text-ink-dim">(right axis)</span>
          </span>
        )}
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

export default function BusinessHealthPage() {
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
  const [showCompose, setShowCompose] = useState(false);
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
      runwayMonths: data.report.tiles.runway.state === 'months' ? data.report.tiles.runway.months : null,
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

  const openCompose = () => {
    if (!settings?.distributionList.length) {
      setError('No distribution list set. Add recipients in settings first.');
      return;
    }
    setShowCompose(true);
  };

  const sendReport = async (to: string[], note: string, subject: string) => {
    if (!report || !printRef.current) return;
    setBusy(true);
    setError(null);
    try {
      // The covering note sits above the report, and the report itself is
      // exactly what is on screen — so the email cannot drift from the
      // preview.
      const intro = note.trim()
        ? `<div style="font-family:Geist,Helvetica,Arial,sans-serif;color:#0b0d0e;font-size:15px;line-height:1.6;max-width:640px;margin:0 auto 28px">
             ${note.trim().split('\n').filter(Boolean).map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('')}
           </div>`
        : '';
      const html = `<div style="font-family:Geist,Helvetica,Arial,sans-serif;color:#0b0d0e">${intro}${printRef.current.innerHTML}</div>`;
      const res = await api.emailInvestorReport(report.month, { html, subject, to });
      setShowCompose(false);
      setNotice(`Sent to ${res.sentTo.join(', ')}.`);
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
  // One-off fees still to be invoiced on the builds in flight.
  const lsTotals = report.leadSources.totals;
  const leadsInThisMonth = lsTotals[lsTotals.length - 1] ?? 0;
  const prevLeadsIn = lsTotals.length > 1 ? lsTotals[lsTotals.length - 2] : undefined;

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
          <EyebrowLabel variant="pill" className="mb-4">OXYSCALE · BUSINESS HEALTH</EyebrowLabel>
          <SectionHeading size="section">Business health.</SectionHeading>
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
            onClick={openCompose}
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

      {showCompose && settings && report && (
        <ComposePanel
          report={report}
          recipients={settings.distributionList}
          busy={busy}
          onCancel={() => setShowCompose(false)}
          onSend={sendReport}
        />
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
        // The document. Reads as a printed sheet: numbered sections,
        // hairline rules, no stacked card chrome.
        <div ref={printRef} className="bg-paper border border-hair-soft rounded-2xl px-12 py-10 max-w-[900px] mx-auto print:border-0 print:rounded-none print:px-0 print:py-0 print:max-w-none">

          {/* Masthead */}
          <header className="pb-8 border-b border-hair-strong">
            <div className="flex items-start justify-between gap-8">
              <div>
                <p className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-dim">
                  Oxy<span className="text-sky-ink">Scale</span> · Business health
                </p>
                <h1 className="mt-4 text-ink text-[42px] font-medium leading-none tracking-[-0.03em]">
                  {report.monthLabel.split(' ')[0]}{' '}
                  <span className="font-editorial italic text-sky-ink font-normal">
                    {report.monthLabel.split(' ')[1]}
                  </span>
                </h1>
                <p className="mt-3 text-ink-muted text-sm">
                  Prepared by {report.preparedBy} · {shortDate(report.periodStart)} to {shortDate(report.periodEnd)}
                </p>
              </div>
              <span className={`font-mono text-[10px] font-semibold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full whitespace-nowrap ${
                locked ? 'bg-[rgba(16,185,129,0.12)] text-[#0f9d70]' : 'bg-[rgba(245,158,11,0.15)] text-warn'
              }`}>
                {locked ? 'Final' : 'Draft'}
              </span>
            </div>
          </header>

          {/* 01 — Health */}
          <Band n="01" title="The health of the business" lead>
            <div className="grid grid-cols-3 gap-10">
              <Lead label="In the bank" value={aud(t.bankBalance)}
                delta={<Delta current={t.bankBalance} previous={pt?.bankBalance} money />}
                note={t.currentLiabilities > 0
                  ? `${aud(t.freeCash)} of it is free — ${aud(t.currentLiabilities)} is owed to the ATO and super. Plus ${aud(report.position.committedIncoming)} still to come from the wages pot.`
                  : `Plus ${aud(report.position.committedIncoming)} still to come from the wages pot`} />
              <Lead label="Runway"
                value={runwayValue(t.runway)}
                unit={t.runway.state === 'months' ? 'months' : undefined}
                delta={t.runway.state === 'months'
                  ? <Delta current={t.runway.months}
                      previous={pt?.runway?.state === 'months' ? pt.runway.months : undefined} />
                  : undefined}
                note={runwayNote(t.runway, t.forecastRunway, report.actuals.avgNetBurn)} />
              <Lead label="Monthly revenue" value={aud(t.liveMrr)}
                delta={<Delta current={t.liveMrr} previous={pt?.liveMrr} money />}
                note={t.notYetLiveMrr > 0
                  ? `${aud(t.notYetLiveMrr)} more signed, starts within ${report.settings.revenueLeadDays} days`
                  : 'All signed clients are billing'} />
            </div>
          </Band>

          {/* 02 — Growth */}
          <Band n="02" title="Growth this month">
            <div className="grid grid-cols-3 gap-10">
              <Lead label="Clients signed" value={String(t.signedThisMonth.count)}
                delta={<Delta current={t.signedThisMonth.count} previous={pt?.signedThisMonth.count} />}
                note={`${aud(t.signedThisMonth.mrr)} a month, plus ${aud(t.signedThisMonth.oneOff)} in build fees`} />
              <Lead label="New monthly revenue" value={aud(t.signedThisMonth.mrr)}
                delta={<Delta current={t.signedThisMonth.mrr} previous={pt?.signedThisMonth.mrr} money />}
                note="Signed this month, billing once live" />
              <Lead label="Leads in" value={String(leadsInThisMonth)}
                delta={<Delta current={leadsInThisMonth} previous={prevLeadsIn} />}
                note={`Across ${report.leadSources.sources.length} sources`} />
            </div>
          </Band>

          {/* 03 — Where the business is going, before where its money is. */}
          <Band n="03" title="Where we are heading">
            {report.forecast.targetMrr <= 0 ? (
              <p className="text-ink-dim text-sm">
                No target set yet. Add one in settings and it will appear here.
              </p>
            ) : (
              <>
              {report.forecast.monthsRemaining !== null
                && report.forecast.monthsRemaining <= 0 && (
                <div className="no-print mb-6 rounded-lg px-4 py-3 bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.25)]">
                  <p className="text-ink text-sm">
                    {report.forecast.monthsRemaining === 0
                      ? `This is the target month. Set the next one once you know where ${report.forecast.targetMonthLabel} landed.`
                      : `The ${report.forecast.targetMonthLabel} target has passed. Set a new one so this section keeps meaning something.`}
                  </p>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="text-sky-ink text-xs font-medium hover:underline mt-1"
                  >
                    Set a new target
                  </button>
                </div>
              )}
              <>
                <div className="grid grid-cols-3 gap-10">
                  <Lead label="Today" value={aud(report.forecast.committedMrr)}
                    note={`${clientsFor(report.forecast.committedMrr, report.forecast.avgClientValue)} · committed monthly revenue`} />
                  <Lead
                    label={report.forecast.targetMonthLabel
                      ? `By ${report.forecast.targetMonthLabel}`
                      : 'Target'}
                    value={aud(report.forecast.targetMrr)}
                    note={`${clientsFor(report.forecast.targetMrr, report.forecast.avgClientValue)} at ${aud(report.forecast.avgClientValue)} a month each`} />
                  <TargetGap
                    target={report.forecast.targetMrr}
                    committed={report.forecast.committedMrr}
                    avg={report.forecast.avgClientValue}
                    monthsRemaining={report.forecast.monthsRemaining} />
                </div>
            {report.signedNotYetLive.length > 0 && (
              <div className="mt-8 break-inside-avoid">
                <div className="flex items-baseline justify-between border-b border-hair pb-1.5 mb-1">
                  <Micro>Signed, revenue not started</Micro>
                  <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-dim tabular-nums">
                    {aud(t.notYetLiveMrr)}/mo confirmed
                  </span>
                </div>
                {report.signedNotYetLive.map((c) => (
                  <div key={c.leadId} className="flex items-baseline justify-between gap-6 py-2 border-b border-hair-soft last:border-0">
                    <span className="text-ink text-sm">{c.company}</span>
                    <span className="text-ink-muted text-xs tabular-nums whitespace-nowrap">
                      {aud(c.retainer)}/mo · starts {shortDate(c.revenueStartsOn)}
                      <span className="text-ink-dim"> ({c.daysUntilLive} days)</span>
                    </span>
                  </div>
                ))}
                {report.buildFees.dueLater > 0 && (
                  <p className="text-ink text-sm mt-3">
                    Plus {aud(report.buildFees.dueLater)} of build fees still to
                    invoice, all due before those retainers start.
                  </p>
                )}
                <p className="text-ink-dim text-xs mt-3 leading-relaxed">
                  Revenue starts about {report.settings.revenueLeadDays} days after signing —
                  roughly a month building, then a month free. The build fee is invoiced
                  and collected in full by then; the retainer is ongoing management
                  from that point on.
                </p>
              </div>
            )}

                {report.projection.length > 1 && (
                  <div className="mt-8">
                    <Micro>Projected billing revenue</Micro>
                    <p className="text-ink-dim text-xs mt-1 mb-2 leading-relaxed max-w-[62ch]">
                      Contracted revenue from the CRM, not invoiced revenue.
                      The blue line is what signed clients will be billing each
                      month, read against the left axis. Amber spikes are one-off
                      build fees landing when that client's retainer begins, read
                      against the right.
                      {prev?.projection?.length
                        ? " The grey line is last month's projection — the gap between the lines is what onboarding added."
                        : ' A second line appears once a previous month has been finalised, showing how the forecast has moved since.'}
                    </p>
                    <div className="overflow-x-auto">
                      <LineChart
                        showValues
                        points={report.projection.map((pt, i) => {
                          const last = prev?.projection?.find((q) => q.month === pt.month);
                          return {
                            label: shortLabel(pt.month),
                            thisMonth: pt.projectedMrr,
                            ...(last ? { lastMonth: last.projectedMrr } : {}),
                            buildFeeCash: pt.buildFeeCash,
                            _i: i,
                          };
                        })}
                        spike={{ key: 'buildFeeCash', label: 'Build fee, one-off', colour: '#f59e0b' }}
                        series={[
                          { key: 'thisMonth', label: 'Projected now', colour: '#0a9cd4' },
                          ...(prev?.projection?.length
                            ? [{ key: 'lastMonth', label: `As projected in ${prev.monthLabel.split(' ')[0]}`, colour: '#b8bfc6' }]
                            : []),
                        ]}
                      />
                    </div>
                  </div>
                )}
                {report.forecast.note && (
                  <p className="text-ink-muted text-sm mt-6 leading-relaxed max-w-[52ch]">
                    {report.forecast.note}
                  </p>
                )}
              </>
              </>
            )}
          </Band>

          {/* 04 — Investment */}
          <Band n="04" title="Where the investment sits">
            <div className="grid grid-cols-2 gap-12">
              <Pot
                name="Build fund"
                total={report.investment.ringfence.total}
                used={report.investment.ringfence.paid}
                remaining={report.investment.ringfence.remaining}
                caption="Ring-fenced for setting the business up"
              />
              <Pot
                name="Founder wages"
                total={report.investment.wages.total}
                used={report.investment.wages.drawn}
                remaining={report.investment.wages.remaining}
                caption="Drawn to date against the agreed period"
              />
            </div>

            {report.investment.wages.draws.length > 0 && (
              <div className="mt-8">
                <Micro>Wage instalments received</Micro>
                <table className="w-full text-sm mt-2 tabular-nums">
                  <tbody>
                    {report.investment.wages.draws.map((w) => (
                      <tr key={w.id} className="border-b border-hair-soft last:border-0">
                        <td className="py-1.5 text-ink-dim text-xs w-24">{shortDate(w.drawnOn)}</td>
                        <td className="py-1.5 text-ink-muted">{w.item}</td>
                        <td className="py-1.5 text-right text-ink">{aud(w.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.investment.ringfence.payments.length > 0 && (
              <div className="mt-8">
                <Micro>What the build fund has gone on</Micro>
                <table className="w-full text-sm mt-2 tabular-nums">
                  <tbody>
                    {report.investment.ringfence.payments.map((p) => (
                      <tr key={p.id} className="border-b border-hair-soft last:border-0">
                        <td className="py-1.5 text-ink-dim text-xs w-24">{shortDate(p.paidOn)}</td>
                        <td className="py-1.5 text-ink-muted">{p.item}</td>
                        <td className="py-1.5 text-right text-ink">{aud(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {series.length >= 2 && (
              <div className="mt-8">
                <Micro>Both pots, month by month</Micro>
                <div className="mt-2 overflow-x-auto">
                  <LineChart
                    points={series.map((h) => ({
                      label: shortLabel(h.month),
                      wagesRemaining: h.wagesRemaining,
                      ringfenceRemaining: h.ringfenceRemaining,
                    }))}
                    series={[
                      { key: 'wagesRemaining', label: 'Founder wages left', colour: '#0a9cd4' },
                      { key: 'ringfenceRemaining', label: 'Build fund left', colour: '#f59e0b' },
                    ]}
                  />
                </div>
              </div>
            )}
          </Band>

          {/* 05 — What we actually spent, straight from the books. */}
          <Band n="05" title="What it costs to run"
            aside={report.actuals.avgNetBurn !== null
              ? `${aud(report.actuals.avgNetBurn)} average monthly burn`
              : undefined}>
            {report.actuals.trend.every((t) => t.expenses === null) ? (
              <p className="text-ink-dim text-sm">
                No reconciled figures yet, so runway cannot be calculated.
                Add the month's total expenses on the input screen.
              </p>
            ) : (
              <>
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-hair">
                      <th className="text-left pb-2"><Micro>Month</Micro></th>
                      <th className="text-right pb-2"><Micro>Money in</Micro></th>
                      <th className="text-right pb-2 pl-6"><Micro>Money out</Micro></th>
                      <th className="text-right pb-2 pl-6"><Micro>Net</Micro></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.actuals.trend.map((m, i) => {
                      const current = i === report.actuals.trend.length - 1;
                      return (
                        <tr key={m.month} className="border-b border-hair-soft last:border-0">
                          <td className={`py-2 ${current ? 'text-ink font-medium' : 'text-ink-muted'}`}>
                            {m.monthLabel}
                          </td>
                          <td className={`py-2 text-right ${current ? 'text-ink' : 'text-ink-muted'}`}>
                            {m.revenue === null ? <span className="text-ink-faint">·</span> : aud(m.revenue)}
                          </td>
                          <td className={`py-2 pl-6 text-right ${current ? 'text-ink' : 'text-ink-muted'}`}>
                            {m.expenses === null ? <span className="text-ink-faint">·</span> : aud(m.expenses)}
                          </td>
                          <td className="py-2 pl-6 text-right">
                            {m.netBurn === null
                              ? <span className="text-ink-faint">·</span>
                              : <span className={m.netBurn > 0 ? 'text-risk' : 'text-[#0f9d70]'}>
                                  {m.netBurn > 0 ? '-' : '+'}{aud(Math.abs(m.netBurn))}
                                </span>}
                          </td>
                        </tr>
                      );
                    })}
                    {report.actuals.avgNetBurn !== null && (
                      <tr className="border-t border-hair">
                        <td className="pt-2" colSpan={3}>
                          <Micro>Average burn each month</Micro>
                        </td>
                        <td className="pt-2 pl-6 text-right text-ink font-medium">
                          {aud(report.actuals.avgNetBurn)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="text-ink-dim text-xs mt-4 leading-relaxed max-w-[62ch]">
                  Reconciled from the accounts each month, so wages and
                  superannuation are already inside these figures. Runway is{' '}
                  {aud(t.freeCash)} of free cash — the bank balance less{' '}
                  {aud(t.currentLiabilities)} of PAYG, super and wages still to be
                  paid out — plus {aud(report.position.committedIncoming)} still to
                  come from the wages pot, divided by the average monthly burn.
                </p>
              </>
            )}
          </Band>

          {/* 06 — Lead sources */}
          <Band n="06" title="Where the leads came from">
            {report.leadSources.sources.length === 0 ? (
              <p className="text-ink-dim text-sm">No leads created in this window.</p>
            ) : (
              <>
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-hair">
                      <th className="text-left pb-2"><Micro>Source</Micro></th>
                      {report.leadSources.monthLabels.map((l, i) => (
                        <th key={i} className="text-right pb-2 px-2 whitespace-nowrap">
                          <Micro dim={i !== report.leadSources.monthLabels.length - 1}>{l.slice(0, 3)}</Micro>
                        </th>
                      ))}
                      <th className="text-right pb-2 pl-3"><Micro>+/-</Micro></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.leadSources.sources.map((s, si) => (
                      <tr key={s.source} className="border-b border-hair-soft last:border-0">
                        <td className="py-2 text-ink-muted whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: SOURCE_COLOURS[si % SOURCE_COLOURS.length] }} />
                            {s.source}
                          </span>
                        </td>
                        {s.counts.map((c, i) => (
                          <td key={i} className={`py-2 px-2 text-right ${
                            i === s.counts.length - 1 ? 'text-ink font-medium' : 'text-ink-dim'
                          }`}>
                            {c || <span className="text-ink-faint">·</span>}
                          </td>
                        ))}
                        <td className="py-2 pl-3 text-right font-mono text-xs">
                          {s.change === 0
                            ? <span className="text-ink-faint">·</span>
                            : <span className={s.change > 0 ? 'text-[#0f9d70]' : 'text-risk'}>
                                {s.change > 0 ? '+' : ''}{s.change}
                              </span>}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-hair">
                      <td className="pt-2"><Micro>Total</Micro></td>
                      {report.leadSources.totals.map((c, i) => (
                        <td key={i} className={`pt-2 px-2 text-right font-medium ${
                          i === report.leadSources.totals.length - 1 ? 'text-ink' : 'text-ink-muted'
                        }`}>{c}</td>
                      ))}
                      <td />
                    </tr>
                  </tbody>
                </table>
                <div className="mt-6 overflow-x-auto">
                  <StackedBars
                    points={report.leadSources.monthLabels.map((label, i) => {
                      const row: Record<string, unknown> = { label: label.slice(0, 3) };
                      report.leadSources.sources.forEach((s, si) => { row[`s${si}`] = s.counts[i]; });
                      return row as { label: string };
                    })}
                    series={report.leadSources.sources.map((s, si) => ({
                      key: `s${si}`, label: s.source,
                      colour: SOURCE_COLOURS[si % SOURCE_COLOURS.length],
                    }))}
                  />
                </div>
              </>
            )}
          </Band>

          {/* 07 — Pipeline */}
          <Band n="07" title="Balls in the air"
            aside={`${report.pipeline.openCount} opportunities · ${aud(report.pipeline.openPipelineMrr)} a month`}>
            {report.pipeline.byStage.length === 0 ? (
              <p className="text-ink-dim text-sm">Nothing open right now.</p>
            ) : report.pipeline.byStage.map((g) => (
              <div key={g.stage} className="mb-6 last:mb-0 break-inside-avoid">
                <div className="flex items-baseline justify-between border-b border-hair pb-1.5 mb-1">
                  <Micro>{g.label}</Micro>
                  <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-dim tabular-nums">
                    {g.count} · {aud(g.retainerTotal)}/mo
                  </span>
                </div>
                {g.rows.map((r) => (
                  <div key={r.leadId} className="py-2.5 border-b border-hair-soft last:border-0">
                    <div className="flex items-baseline justify-between gap-6">
                      <div className="min-w-0">
                        <span className="text-ink text-sm font-medium">{r.company}</span>
                        <span className="text-ink-dim text-xs ml-2">{r.contact}</span>
                      </div>
                      <span className="text-ink text-sm tabular-nums whitespace-nowrap">
                        {r.retainer ? `${aud(r.retainer)}/mo` : '—'}
                        {r.oneOff > 0 && (
                          <span className="text-ink-dim"> + {aud(r.oneOff)} build</span>
                        )}
                      </span>
                    </div>
                    {(r.latestNote || r.nextAction) && (
                      <p className="text-ink-muted text-xs mt-1 leading-relaxed">
                        {r.latestNote}
                        {r.latestNote && r.nextAction && <span className="text-ink-faint"> — </span>}
                        {r.nextAction && (
                          <span className="text-sky-ink">
                            Next: {r.nextAction} ({shortDate(r.nextActionDue)})
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ))}

          </Band>

          {report.buildFees.overdue > 0 && (
            <Band n="07b" title="Build fees overdue"
              aside={`${aud(report.buildFees.overdue)} should already be in`}>
              <p className="text-ink-muted text-sm mb-3 leading-relaxed max-w-[62ch]">
                These clients are billing, which means their build fee should have
                been invoiced and collected in full before the retainer started.
              </p>
              {report.buildFees.overdueClients.map((c) => (
                <div key={c.leadId}
                  className="flex items-baseline justify-between gap-6 py-2 border-b border-hair-soft last:border-0">
                  <span className="text-ink text-sm">{c.company}</span>
                  <span className="text-risk text-sm tabular-nums whitespace-nowrap">
                    {aud(c.outstanding)}
                    <span className="text-ink-dim"> · due by {shortDate(c.shouldHaveBeenPaidBy)}</span>
                  </span>
                </div>
              ))}
            </Band>
          )}

          <Band n="08" title="What we plan to spend">
            {report.plannedSpend.length === 0 ? (
              <p className="text-ink-dim text-sm">Nothing planned this month.</p>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-hair">
                    <th className="text-left pb-2"><Micro>Item</Micro></th>
                    <th className="text-right pb-2"><Micro>Cost</Micro></th>
                    <th className="text-left pb-2 pl-6"><Micro>When</Micro></th>
                    <th className="text-left pb-2 pl-6"><Micro>Why</Micro></th>
                    <th className="text-right pb-2"><Micro>Status</Micro></th>
                  </tr>
                </thead>
                <tbody>
                  {report.plannedSpend.map((sp) => (
                    <tr key={sp.id} className="border-b border-hair-soft last:border-0 align-top">
                      <td className="py-2.5 text-ink">{sp.item}</td>
                      <td className="py-2.5 text-right text-ink whitespace-nowrap">
                        {sp.estimatedCost ? aud(sp.estimatedCost) : '—'}
                      </td>
                      <td className="py-2.5 pl-6 text-ink-muted whitespace-nowrap">{sp.timing || '—'}</td>
                      <td className="py-2.5 pl-6 text-ink-muted max-w-[26ch]">{sp.purpose || '—'}</td>
                      <td className="py-2.5 text-right">
                        <span className={`font-mono text-[9px] tracking-[0.14em] uppercase px-2 py-0.5 rounded-full ${STATUS_PILL[sp.status] || ''}`}>
                          {sp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Band>

          {/* 08 — Risks */}
          <Band n="09" title="What could go wrong">
            {report.risks.length === 0 ? (
              <p className="text-ink-dim text-sm">Nothing flagged.</p>
            ) : report.risks.map((r) => (
              <div key={r.id} className="py-3 border-b border-hair-soft last:border-0 break-inside-avoid">
                <div className="flex items-baseline justify-between gap-6">
                  <span className="text-ink text-sm font-medium">{r.risk}</span>
                  <span className={`font-mono text-[9px] tracking-[0.14em] uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_PILL[r.status] || ''}`}>
                    {r.status}
                  </span>
                </div>
                {r.mitigation && (
                  <p className="text-ink-muted text-xs mt-1 leading-relaxed max-w-[70ch]">
                    {r.mitigation}
                  </p>
                )}
              </div>
            ))}
          </Band>

          <footer className="mt-12 pt-5 border-t border-hair-strong flex items-baseline justify-between">
            <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-dim">
              Oxy<span className="text-sky-ink">Scale</span> · {report.monthLabel}
            </p>
            <p className="text-ink-faint text-xs">
              Generated {new Date(report.generatedAt).toLocaleDateString('en-AU')}
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────

/**
 * A numbered section of the document. Hairline rule and a mono index
 * rather than a card — the page should read as one sheet, not a stack
 * of boxes.
 */
function Band({
  n, title, aside, lead = false, children,
}: {
  n: string; title: string; aside?: string;
  /** First band after the masthead: no rule of its own, tighter top. */
  lead?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`break-inside-avoid ${
      lead ? 'pt-8' : 'pt-9 mt-9 border-t border-hair'
    }`}>
      <div className="flex items-baseline justify-between gap-6 mb-6">
        <h2 className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] font-semibold tracking-[0.22em] text-sky-ink">{n}</span>
          <span className="text-ink text-[19px] font-medium tracking-[-0.02em]">{title}</span>
        </h2>
        {aside && (
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-dim whitespace-nowrap tabular-nums">
            {aside}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** One headline figure. The largest type on the page, used sparingly. */
function Lead({
  label, value, unit, delta, note,
}: {
  label: string; value: string; unit?: string;
  delta?: React.ReactNode; note?: string;
}) {
  return (
    <div>
      <Micro>{label}</Micro>
      <p className="mt-2 text-ink text-[38px] font-medium leading-none tracking-[-0.035em] tabular-nums">
        {value}
        {unit && <span className="text-ink-dim text-base font-normal tracking-normal ml-1.5">{unit}</span>}
      </p>
      {delta && <div className="mt-2">{delta}</div>}
      {note && <p className="text-ink-muted text-xs mt-2 leading-relaxed max-w-[30ch]">{note}</p>}
    </div>
  );
}

/**
 * What is left to do, expressed as a rate. "13 more clients" is a fact;
 * "13 in 4 months" is a plan, and the monthly rate is the thing that can
 * be checked against reality each month.
 */
function TargetGap({
  target, committed, avg, monthsRemaining,
}: {
  target: number; committed: number; avg: number; monthsRemaining: number | null;
}) {
  const gap = target - committed;
  if (gap <= 0) {
    return (
      <div>
        <Micro>To get there</Micro>
        <p className="mt-2 text-[#0f9d70] text-[38px] font-medium leading-none tracking-[-0.035em]">
          There
        </p>
        <p className="text-ink-muted text-xs mt-2">Target already met</p>
      </div>
    );
  }
  const clients = Math.ceil(gap / (avg > 0 ? avg : 1));
  const perMonth =
    monthsRemaining !== null && monthsRemaining > 0
      ? Math.round((clients / monthsRemaining) * 10) / 10
      : null;
  return (
    <div>
      <Micro>To get there</Micro>
      <p className="mt-2 text-ink text-[38px] font-medium leading-none tracking-[-0.035em] tabular-nums">
        {clients}
      </p>
      <p className="text-ink-muted text-xs mt-2 leading-relaxed max-w-[30ch]">
        more clients, {aud(gap)} a month
        {monthsRemaining === null
          ? ''
          : monthsRemaining <= 0
            ? ' · target date has passed'
            : ` · ${monthsRemaining} ${monthsRemaining === 1 ? 'month' : 'months'} left, about ${perMonth} a month`}
      </p>
    </div>
  );
}

/** Mono micro-label. The document's connective tissue. */
function Micro({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <span className={`font-mono text-[10px] font-semibold tracking-[0.2em] uppercase ${
      dim ? 'text-ink-faint' : 'text-ink-dim'
    }`}>
      {children}
    </span>
  );
}

/**
 * An investment pot, drawn as a meter. Stephen asked to see where each
 * pot is up to, so the remaining figure is the one set large and the
 * bar reads left-to-right as spent-to-remaining.
 */
function Pot({
  name, total, used, remaining, caption,
}: {
  name: string; total: number; used: number; remaining: number; caption: string;
}) {
  const left = total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Micro>{name}</Micro>
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-dim tabular-nums">
          of {aud(total)}
        </span>
      </div>
      <p className="mt-2 text-ink text-[38px] font-medium leading-none tracking-[-0.035em] tabular-nums">
        {aud(remaining)}
      </p>
      <p className="text-ink-muted text-xs mt-1.5">left · {aud(used)} used</p>
      <div className="mt-3 h-1.5 bg-tray rounded-full overflow-hidden" title={`${Math.round(left)}% remaining`}>
        <div className="h-full bg-ink rounded-full" style={{ width: `${left}%` }} />
      </div>
      <div className="flex items-baseline justify-between mt-1.5">
        <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-faint">
          {Math.round(left)}% remaining
        </span>
      </div>
      <p className="text-ink-dim text-xs mt-2 leading-relaxed">{caption}</p>
    </div>
  );
}

/** Card wrapper for the input form. App chrome, not part of the document. */
function FormSection({
  title, right, children,
}: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-ink text-sm font-medium uppercase tracking-wider">{title}</h3>
        {right && <span className="text-ink-dim text-xs">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Compose step before sending. Lets a test go to one address first, and
 * puts a covering note above the report — an email that arrives as a
 * wall of figures with no greeting reads as automated.
 */
function ComposePanel({
  report, recipients, busy, onCancel, onSend,
}: {
  report: InvestorReport;
  recipients: string[];
  busy: boolean;
  onCancel: () => void;
  onSend: (to: string[], note: string, subject: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(recipients);
  const [subject, setSubject] = useState(`OxyScale business health — ${report.monthLabel}`);
  const [note, setNote] = useState(
    `Morning all,\n\n`
    + `Here is the ${report.monthLabel} update. Live monthly revenue is `
    + `${aud(report.tiles.liveMrr)}, with ${aud(report.tiles.notYetLiveMrr)} more signed `
    + `and starting shortly. The full picture is below.\n\n`
    + `Happy to walk through any of it.\n\nJordan`,
  );

  const toggle = (email: string) =>
    setSelected((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]);

  const me = recipients.find((e) => e.startsWith('jordan@'));

  return (
    <div className="no-print bg-paper border border-hair-soft rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-ink text-sm font-medium">Send {report.monthLabel}</h3>
        <button onClick={onCancel} className="text-ink-dim hover:text-ink p-1">
          <X size={16} />
        </button>
      </div>

      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
      </Field>

      <div className="mt-4">
        <Field label="Covering note" hint="Sits above the report. Leave blank to send the report on its own.">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={7}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)] resize-none leading-relaxed" />
        </Field>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between mb-2">
          <Micro>Send to</Micro>
          <div className="flex items-center gap-3">
            {me && (
              <button onClick={() => setSelected([me])}
                className="text-sky-ink text-xs hover:underline">
                Just me, as a test
              </button>
            )}
            <button onClick={() => setSelected(recipients)}
              className="text-sky-ink text-xs hover:underline">
              Everyone
            </button>
          </div>
        </div>
        {recipients.map((email) => (
          <label key={email}
            className="flex items-center gap-2.5 py-1.5 border-b border-hair-soft last:border-0 cursor-pointer">
            <input type="checkbox" checked={selected.includes(email)}
              onChange={() => toggle(email)} className="accent-ink" />
            <span className="text-ink-muted text-sm">{email}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 mt-5">
        <p className="text-ink-dim text-xs">
          The report goes in the body of the email, exactly as shown on this
          page. Use Print for a PDF.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-ink-muted border border-hair-soft hover:bg-[rgba(11,13,14,0.03)]">
            Cancel
          </button>
          <PillButton variant="primary" size="md" trailing="none"
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            onClick={() => selected.length && onSend(selected, note, subject)}>
            {selected.length === 1 ? 'Send to 1' : `Send to ${selected.length}`}
          </PillButton>
        </div>
      </div>
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
  const [targetMrr, setTargetMrr] = useState(String(settings.forecastTargetMrr));
  const [targetMonth, setTargetMonth] = useState(settings.forecastTargetMonth);
  const [note, setNote] = useState(settings.forecastNote);
  const [list, setList] = useState(settings.distributionList.join('\n'));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const emails = list.split('\n').map((s) => s.trim()).filter(Boolean);
      const saved = await api.updateInvestorSettings({
        revenueLeadDays: Number(leadDays),
        forecastTargetMrr: Number(targetMrr) || 0,
        ...(targetMonth ? { forecastTargetMonth: targetMonth } : {}),
        forecastNote: note,
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
        <h3 className="text-ink text-sm font-medium">Settings</h3>
        <button onClick={onClose} className="text-ink-dim hover:text-ink p-1"><X size={16} /></button>
      </div>
      <Field label="Revenue lead time (days)"
        hint="Signing to first billing. 30 days building, 30 days free.">
        <input type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)}
          className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
      </Field>
      <p className="text-ink-dim text-xs mt-3">
        Monthly expenses are reconciled from the accounts on the input screen,
        not modelled here.
      </p>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <Field label="Target monthly revenue">
          <input type="number" value={targetMrr} onChange={(e) => setTargetMrr(e.target.value)}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
        </Field>
        <Field label="By when" hint="The month you want to hit it.">
          <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)]" />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="What we will need to get there" hint="One or two lines. Appears on the report.">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)] resize-none" />
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
  const [actualExpenses, setActualExpenses] = useState(
    report.inputs.actualExpenses?.toString() ?? '',
  );
  const [actualRevenue, setActualRevenue] = useState(
    report.inputs.actualRevenue?.toString() ?? '',
  );
  const [liabilities, setLiabilities] = useState(
    report.inputs.currentLiabilities?.toString() ?? '',
  );

  const [drawDate, setDrawDate] = useState(report.periodEnd);
  const [drawAmount, setDrawAmount] = useState('');
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
        actualExpenses: actualExpenses === '' ? null : Number(actualExpenses),
        actualRevenue: actualRevenue === '' ? null : Number(actualRevenue),
        currentLiabilities: liabilities === '' ? null : Number(liabilities),
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


  const addDraw = async () => {
    if (!drawAmount) return;
    try {
      await api.addWageDraw({ drawnOn: drawDate, amount: Number(drawAmount) });
      setDrawAmount(''); onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that instalment.');
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
      {/* The monthly job, and nothing else. Three numbers off the Xero
          P&L once everything is reconciled. */}
      <FormSection title={`Every month — ${report.monthLabel}`}>
        <p className="text-ink-dim text-xs mb-4 leading-relaxed">
          Reconcile everything in Xero, then take the first three off the P&amp;L
          and the fourth off the balance sheet. Nothing below this needs
          touching unless something has actually changed.
        </p>
        <div className="grid grid-cols-4 gap-4">
          <Field label="1 · Bank balance" hint="At month end.">
            <input type="number" step="0.01" value={bank} onChange={(e) => setBank(e.target.value)}
              placeholder="0.00" className={input} />
          </Field>
          <Field label="2 · Total expenses"
            hint="Total operating expenses. Wages and super are already inside it.">
            <input type="number" step="0.01" value={actualExpenses}
              onChange={(e) => setActualExpenses(e.target.value)}
              placeholder="0.00" className={input} />
          </Field>
          <Field label="3 · Revenue received" hint="Total trading income.">
            <input type="number" step="0.01" value={actualRevenue}
              onChange={(e) => setActualRevenue(e.target.value)}
              placeholder="0.00" className={input} />
          </Field>
          <Field label="4 · Total current liabilities"
            hint="Off the balance sheet. PAYG, super and wages owed — money in the bank that is not yours.">
            <input type="number" step="0.01" value={liabilities}
              onChange={(e) => setLiabilities(e.target.value)}
              placeholder="0.00" className={input} />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <PillButton variant="primary" size="md" trailing="none"
            icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            onClick={saveFigures}>Save</PillButton>
          {saved && <span className="text-[#0f9d70] text-xs">Saved.</span>}
        </div>

        {/* Escape hatch, not part of the monthly routine. */}
        <details className="mt-5 pt-4 border-t border-hair-soft">
          <summary className="text-ink-dim text-xs cursor-pointer hover:text-ink-muted">
            Live MRR is pulling {aud(report.inputs.crmLiveMrr)} from the CRM — override it
          </summary>
          <div className="mt-3 max-w-xs">
            <Field label="Live MRR override" hint="Leave blank to trust the CRM.">
              <input type="number" value={mrrOverride} onChange={(e) => setMrrOverride(e.target.value)}
                placeholder={String(report.inputs.crmLiveMrr)} className={input} />
            </Field>
          </div>
        </details>
      </FormSection>

      <div className="pt-4 pb-1">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] uppercase text-ink-dim">
          Only when something changes
        </p>
        <p className="text-ink-dim text-xs mt-1.5">
          These carry forward on their own. Skip them most months.
        </p>
      </div>

      <FormSection title="Ring fence payments this month"
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
      </FormSection>

      <FormSection title="Founder wage instalments received"
        right={`${aud(report.investment.wages.remaining)} of ${aud(report.investment.wages.total)} left`}>
        <p className="text-ink-dim text-xs mb-3 leading-relaxed">
          Log each instalment as it lands. The total drawn adds itself up, so the
          pot is always right without keeping a running figure by hand.
        </p>
        <div className="grid grid-cols-[10rem_1fr_auto] gap-2 items-end mb-3">
          <Field label="Date received">
            <input type="date" value={drawDate} onChange={(e) => setDrawDate(e.target.value)} className={input} />
          </Field>
          <Field label="Amount">
            <input type="number" value={drawAmount} onChange={(e) => setDrawAmount(e.target.value)}
              placeholder="10000" className={input} />
          </Field>
          <button onClick={addDraw} disabled={!drawAmount}
            className="bg-ink text-white rounded-lg p-2.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 mb-[1px]">
            <Plus size={16} />
          </button>
        </div>
        {report.investment.wages.draws.map((w) => (
          <div key={w.id} className="flex items-center gap-3 py-1.5 border-b border-hair-soft last:border-0 text-sm group">
            <span className="text-ink-dim text-xs w-24">{shortDate(w.drawnOn)}</span>
            <span className="text-ink-muted flex-1">{w.item}</span>
            <span className="text-ink tabular-nums">{aud(w.amount)}</span>
            <button
              onClick={async () => {
                if (!window.confirm(`Remove the ${aud(w.amount)} instalment?`)) return;
                try { await api.deleteWageDraw(w.id); onChanged(); }
                catch { onError('Could not remove that instalment.'); }
              }}
              className="text-ink-faint hover:text-risk p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </FormSection>

      <FormSection title="Planned spend">
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
      </FormSection>

      <FormSection title="Key risks">
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
      </FormSection>
    </div>
  );
}
