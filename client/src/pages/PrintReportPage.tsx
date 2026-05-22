// ============================================================
// Print Report — Branded, print-friendly operations report
//
// Opens via /report?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...
// Fetches the same data as ReportsPage but renders it as a
// clean, branded A4-ready document. Cmd+P to print or save as PDF.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../services/api';

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

function tierLabel(tier: string): string {
  return ({ pulse: 'Pulse', tier_1: 'Tier 1', tier_2: 'Tier 2', tier_3: 'Tier 3', won: 'Won', lost: 'Lost' })[tier] || tier;
}

// ── Component ──────────────────────────────────────────────────

export default function PrintReportPage() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<api.ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const [expandedLeads, setExpandedLeads] = useState<Set<number>>(new Set());

  const toggleLead = useCallback((id: number) => {
    setExpandedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const category = searchParams.get('category') || undefined;

  useEffect(() => {
    api.getReport({ from, to, category })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [from, to, category]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <p className="text-[#8a95a0] text-sm">Loading report...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <p className="text-[#ef4444] text-sm">Failed to load report data.</p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          .print-show-note { display: block !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-[800px] mx-auto bg-white font-[Geist,Inter,-apple-system,sans-serif] text-[#0b0d0e]">

        {/* ── Print button (hidden when printing) ─────────────── */}
        <div className="no-print sticky top-0 bg-white border-b border-[rgba(11,13,14,0.08)] px-8 py-4 flex items-center justify-between z-10">
          <button
            onClick={() => window.history.back()}
            className="text-[#8a95a0] text-sm hover:text-[#0b0d0e] transition-colors"
          >
            Back to Operations
          </button>
          <button
            onClick={() => window.print()}
            className="bg-[#0b0d0e] text-white text-sm font-medium rounded-full px-6 py-2.5 hover:bg-[#1a1d1f] transition-colors"
          >
            Print / Save PDF
          </button>
        </div>

        <div className="px-8 py-10">
          {/* ── Header ───────────────────────────────────────── */}
          <div className="flex items-start justify-between mb-2">
            <div>
              <span className="text-[22px] font-semibold tracking-[-0.035em]">
                <span className="text-[#0b0d0e]">Oxy</span>
                <span className="text-[#0a9cd4]">Scale</span>
              </span>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.24em] font-semibold">
                Generated
              </p>
              <p className="text-[13px] text-[#55606a]">
                {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Sky accent bar */}
          <div className="flex mb-8">
            <div className="h-[2px] w-[30%] bg-[#0a9cd4]" />
            <div className="h-[2px] flex-1 bg-[rgba(11,13,14,0.08)]" />
          </div>

          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0b0d0e] mb-1">
            Operations Report
          </h1>
          <p className="text-[14px] text-[#55606a] mb-10">
            {formatLongDate(data.window.from)} &mdash; {formatLongDate(data.window.to)}
            {data.window.category && (
              <span className="ml-2 text-[#0a9cd4]">
                / {data.window.category}
              </span>
            )}
          </p>

          {/* ── KPI Strip ────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <KpiCard
              label="Pipeline Value"
              value={formatAUD(s.totalPipelineValue)}
              sub={`${s.totalPipelineCount} active`}
              accent
            />
            <KpiCard
              label="New Leads"
              value={String(s.newLeadCount)}
              sub="in period"
            />
            <KpiCard
              label="Contacted"
              value={String(s.contactedCount)}
              sub="in period"
            />
            <KpiCard
              label="Tasks Set"
              value={String(s.tasksCreated)}
              sub="in period"
            />
            <KpiCard
              label="Tasks Completed"
              value={String(s.tasksCompleted)}
              sub="in period"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-10">
            <KpiCard
              label="Won"
              value={`${s.wonCount}`}
              sub={formatAUD(s.wonValue)}
              tone="ok"
            />
            <KpiCard
              label="Lost"
              value={`${s.lostCount}`}
              sub={formatAUD(s.lostValue)}
              tone="risk"
            />
          </div>

          {/* ── Pipeline by Tier ──────────────────────────────── */}
          <div className="mb-3">
            <SectionLabel>Pipeline by Tier</SectionLabel>
            <div className="grid grid-cols-4 gap-3 mb-6">
              {data.byTier
                .filter((b) => ['pulse', 'tier_1', 'tier_2', 'tier_3'].includes(b.tier))
                .map((b) => (
                  <div
                    key={b.tier}
                    className="border border-[rgba(11,13,14,0.06)] rounded-lg px-4 py-3"
                  >
                    <p className="text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.22em] font-semibold mb-1">
                      {b.label}
                    </p>
                    <p className="text-[20px] font-semibold text-[#0b0d0e] tracking-[-0.02em]">
                      {b.count}
                      {b.tier !== 'pulse' && (
                        <span className="text-[14px] text-[#55606a] font-normal ml-2">
                          {formatAUD(b.totalValue)}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
            </div>
          </div>

          {/* ── Active Pipeline — the meeting discussion table ── */}
          <SectionLabel>Active Pipeline</SectionLabel>
          <p className="text-[12px] text-[#8a95a0] mb-3 -mt-2">
            All leads in Tier 1, 2, and 3 — for discussion.
          </p>

          {data.pipelineLeads.length === 0 ? (
            <p className="text-[13px] text-[#8a95a0] italic mb-8">No leads in pipeline.</p>
          ) : (
            <table className="w-full text-[13px] mb-10 border-collapse">
              <thead>
                <tr className="border-b-2 border-[#0a9cd4]">
                  <th className="text-left text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.2em] font-semibold py-2 pr-3">Lead</th>
                  <th className="text-left text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.2em] font-semibold py-2 pr-3 w-[70px]">Tier</th>
                  <th className="text-right text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.2em] font-semibold py-2 pr-3 w-[80px]">Value</th>
                  <th className="text-center text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.2em] font-semibold py-2 w-[70px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.pipelineLeads.map((lead, i) => {
                  const prevTier = i > 0 ? data.pipelineLeads[i - 1].tier : null;
                  const showDivider = prevTier && prevTier !== lead.tier;
                  const isExpanded = expandedLeads.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => lead.latestNote && toggleLead(lead.id)}
                      className={`border-b border-[rgba(11,13,14,0.06)] ${showDivider ? 'border-t-2 border-t-[rgba(11,13,14,0.12)]' : ''} ${lead.latestNote ? 'cursor-pointer hover:bg-[#faf9f5]' : ''}`}
                    >
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-[#0b0d0e]">{lead.name}</span>
                        {lead.company && (
                          <span className="text-[#8a95a0] ml-1.5">{lead.company}</span>
                        )}
                        {lead.latestNote && !isExpanded && (
                          <p className="no-print text-[11px] text-[#8a95a0] mt-0.5 leading-snug">
                            {lead.latestNote.slice(0, 80)}{lead.latestNote.length > 80 ? '...' : ''}
                            <span className="text-[#0a9cd4] ml-1">show</span>
                          </p>
                        )}
                        {lead.latestNote && (
                          <div
                            className={`print-show-note mt-1 text-[12px] text-[#55606a] leading-relaxed whitespace-pre-line ${isExpanded ? '' : 'hidden'}`}
                          >
                            {lead.latestNote}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 align-top">
                        <span className={`text-[11px] font-mono font-semibold uppercase tracking-[0.15em] ${
                          lead.tier === 'tier_1' ? 'text-[#0a9cd4]'
                          : lead.tier === 'tier_2' ? 'text-[#f59e0b]'
                          : lead.tier === 'pulse' ? 'text-[#8b5cf6]'
                          : 'text-[#8a95a0]'
                        }`}>
                          {tierLabel(lead.tier)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium align-top">
                        {lead.dealValue > 0 ? formatAUD(lead.dealValue) : (
                          <span className="text-[#b8bfc6]">--</span>
                        )}
                      </td>
                      <td className="py-2.5 text-center align-top">
                        <span className={`text-[10px] font-mono font-semibold uppercase tracking-[0.18em] px-2 py-0.5 rounded-full ${
                          lead.contacted
                            ? 'bg-[rgba(16,185,129,0.1)] text-[#10b981]'
                            : 'bg-[rgba(239,68,68,0.06)] text-[#ef4444]'
                        }`}>
                          {lead.contacted ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── Won / Lost Summary ───────────────────────────── */}
          {(data.won.length > 0 || data.lost.length > 0) && (
            <>
              <SectionLabel>Won / Lost in Period</SectionLabel>
              <div className="grid grid-cols-2 gap-6 mb-10">
                {data.won.length > 0 && (
                  <div>
                    <p className="text-[11px] font-mono text-[#10b981] uppercase tracking-[0.2em] font-semibold mb-2">
                      Won ({data.won.length}) &mdash; {formatAUD(s.wonValue)}
                    </p>
                    <ul className="space-y-1.5">
                      {data.won.map((w) => (
                        <li key={w.id} className="text-[13px]">
                          <span className="font-medium">{w.name}</span>
                          {w.company && <span className="text-[#8a95a0] ml-1">{w.company}</span>}
                          {w.dealValue > 0 && (
                            <span className="text-[#10b981] ml-1.5 font-medium">{formatAUD(w.dealValue)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.lost.length > 0 && (
                  <div>
                    <p className="text-[11px] font-mono text-[#ef4444] uppercase tracking-[0.2em] font-semibold mb-2">
                      Lost ({data.lost.length}) &mdash; {formatAUD(s.lostValue)}
                    </p>
                    <ul className="space-y-1.5">
                      {data.lost.map((l) => (
                        <li key={l.id} className="text-[13px]">
                          <span className="font-medium">{l.name}</span>
                          {l.company && <span className="text-[#8a95a0] ml-1">{l.company}</span>}
                          {l.dealValue > 0 && (
                            <span className="text-[#ef4444] ml-1.5 font-medium">{formatAUD(l.dealValue)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Footer ───────────────────────────────────────── */}
          <div className="border-t border-[rgba(11,13,14,0.08)] pt-6 mt-6 flex items-center justify-between">
            <span className="text-[14px] font-semibold tracking-[-0.035em]">
              <span className="text-[#55606a]">Oxy</span>
              <span className="text-[#0a9cd4]">Scale</span>
            </span>
            <p className="text-[11px] text-[#8a95a0]">
              Confidential &mdash; internal use only
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'ok' | 'risk';
}) {
  const borderColor = accent
    ? 'border-[#0a9cd4]'
    : tone === 'ok'
      ? 'border-[#10b981]'
      : tone === 'risk'
        ? 'border-[#ef4444]'
        : 'border-[rgba(11,13,14,0.06)]';
  const valueColor = accent
    ? 'text-[#0a9cd4]'
    : tone === 'ok'
      ? 'text-[#10b981]'
      : tone === 'risk'
        ? 'text-[#ef4444]'
        : 'text-[#0b0d0e]';

  return (
    <div className={`border ${borderColor} rounded-lg px-4 py-3`}>
      <p className="text-[10px] text-[#8a95a0] font-mono uppercase tracking-[0.22em] font-semibold mb-1">
        {label}
      </p>
      <p className={`text-[24px] font-semibold tracking-[-0.02em] ${valueColor}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[#8a95a0] mt-0.5">{sub}</p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-[#0a9cd4] font-mono uppercase tracking-[0.24em] font-semibold mb-3">
      {children}
    </p>
  );
}
