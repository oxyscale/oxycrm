import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  Loader2,
  X,
  Check,
  Pencil,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react';
import * as api from '../services/api';
import { parseTimestamp, todayInSydney } from '../utils/dates';
import type { Project, ProjectStatus, Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import PillButton from '../components/ui/PillButton';

type FilterStatus = 'all' | ProjectStatus;

// Two states that matter day to day: it's being built, or it's live and
// on a retainer. 'ended' retires a client without deleting the history.
const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bg: string }> = {
  building: { label: 'In Build', color: 'text-warn', bg: 'bg-[rgba(245,158,11,0.15)]' },
  live: { label: 'Active Client', color: 'text-[#0f9d70]', bg: 'bg-[rgba(16,185,129,0.12)]' },
  ended: { label: 'Ended', color: 'text-ink-dim', bg: 'bg-[rgba(11,13,14,0.05)]' },
};

/**
 * One client and every project they have with us.
 *
 * The page groups by client rather than listing projects flat, because
 * the retainer is a per-CLIENT figure. Listing projects flat is what
 * made MRR double-count any client with two live projects.
 */
type ClientGroup = {
  key: string;
  leadId: number | null;
  clientName: string;
  projects: Project[];
  /** Rolled up from the projects: live beats building beats ended. */
  status: ProjectStatus;
  retainer: number;
  retainerSince: string | null;
  /** Earliest go-live across their projects — when the free period started. */
  liveFrom: string | null;
  freeDays: number;
};

/** Date-only maths on YYYY-MM-DD strings, no timezone drift. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showModal, setShowModal] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Inline editors — one project name / one client retainer at a time.
  const [editingName, setEditingName] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [editingRetainer, setEditingRetainer] = useState<string | null>(null);
  const [retainerDraft, setRetainerDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal form state
  const [formName, setFormName] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formLeadId, setFormLeadId] = useState<number | null>(null);
  const [wonLeads, setWonLeads] = useState<Lead[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load once, filter in the browser. Refetching per tab is what made the
  // headline numbers change meaning when you clicked a filter — MRR read
  // $0 on the "In Build" tab because live clients weren't in the payload.
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.getProjects());
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load clients. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openModal = async () => {
    setShowModal(true);
    setCreateError(null);
    try {
      const leads = await api.getLeads({ stage: 'won' });
      setWonLeads(leads);
    } catch {
      // Non-critical — linking a lead is optional.
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setFormName('');
    setFormClient('');
    setFormDescription('');
    setFormStartDate('');
    setFormLeadId(null);
    setCreateError(null);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formClient.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createProject({
        name: formName.trim(),
        clientName: formClient.trim(),
        description: formDescription.trim() || undefined,
        startDate: formStartDate || undefined,
        leadId: formLeadId ?? undefined,
      });
      closeModal();
      loadProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreateError('Could not create it. Check the details and try again.');
    } finally {
      setCreating(false);
    }
  };

  // ── Inline rename ────────────────────────────────────────────────
  const startRename = (project: Project) => {
    setEditingName(project.id);
    setNameDraft(project.name);
  };

  const commitRename = async (project: Project) => {
    const next = nameDraft.trim();
    setEditingName(null);
    if (!next || next === project.name) return;
    // Optimistic — the row is a single string, and a failure restores it.
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, name: next } : p)),
    );
    try {
      await api.updateProject(project.id, { name: next });
    } catch (err) {
      console.error('Failed to rename project:', err);
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, name: project.name } : p)),
      );
      setError('Could not save that name. It has been put back.');
    }
  };

  // ── Inline retainer change ───────────────────────────────────────
  // Writes a new dated row to the retainer history rather than editing
  // the old one, so what a client paid last month stays true.
  const startRetainerEdit = (group: ClientGroup) => {
    setEditingRetainer(group.key);
    setRetainerDraft(group.retainer ? String(group.retainer) : '');
  };

  const commitRetainer = async (group: ClientGroup) => {
    const amount = Number(retainerDraft);
    if (!group.leadId || !Number.isFinite(amount) || amount < 0) {
      setEditingRetainer(null);
      return;
    }
    if (amount === group.retainer) {
      setEditingRetainer(null);
      return;
    }
    setSaving(true);
    try {
      await api.addRetainer(group.leadId, {
        monthlyAmount: amount,
        effectiveFrom: todayInSydney(),
        note: 'Updated from Active clients',
      });
      setEditingRetainer(null);
      await loadProjects();
    } catch (err) {
      console.error('Failed to update retainer:', err);
      setError('Could not save that amount. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Grouping ─────────────────────────────────────────────────────
  const groups = useMemo<ClientGroup[]>(() => {
    const byClient = new Map<string, ClientGroup>();
    const rank: Record<ProjectStatus, number> = { ended: 0, building: 1, live: 2 };

    for (const p of projects) {
      // Projects with no linked lead fall back to their client name so
      // they still group, they just can't carry a retainer.
      const key = p.leadId != null ? `lead:${p.leadId}` : `name:${p.clientName}`;
      const existing = byClient.get(key);
      if (!existing) {
        byClient.set(key, {
          key,
          leadId: p.leadId,
          clientName: p.clientName,
          projects: [p],
          status: p.status,
          retainer: p.currentRetainer || 0,
          retainerSince: p.retainerSince ?? null,
          liveFrom: p.status === 'live' ? p.liveFrom : null,
          freeDays: p.freeDays ?? 30,
        });
        continue;
      }
      existing.projects.push(p);
      if (rank[p.status] > rank[existing.status]) existing.status = p.status;
      // currentRetainer is a lead-level figure repeated on every row of
      // that lead, so take it once rather than summing.
      existing.retainer = Math.max(existing.retainer, p.currentRetainer || 0);
      if (!existing.retainerSince) existing.retainerSince = p.retainerSince ?? null;
      if (p.status === 'live' && p.liveFrom) {
        existing.liveFrom =
          !existing.liveFrom || p.liveFrom < existing.liveFrom ? p.liveFrom : existing.liveFrom;
      }
    }

    return [...byClient.values()].sort((a, b) => {
      if (rank[b.status] !== rank[a.status]) return rank[b.status] - rank[a.status];
      return b.retainer - a.retainer || a.clientName.localeCompare(b.clientName);
    });
  }, [projects]);

  /** Where a live client sits in their complimentary period. */
  const freePeriod = (group: ClientGroup) => {
    if (group.status !== 'live' || !group.liveFrom) return null;
    const endsOn = addDays(group.liveFrom, group.freeDays);
    return { endsOn, remaining: daysBetween(todayInSydney(), endsOn) };
  };

  // Headline numbers always read across every client, whatever tab is
  // selected. Counted per client, not per project.
  const liveGroups = groups.filter((g) => g.status === 'live');
  const inBuild = groups.filter((g) => g.status === 'building').length;
  const activeClients = liveGroups.length;
  const monthlyRecurring = liveGroups.reduce((sum, g) => sum + g.retainer, 0);

  // A client inside their free 30 days has a retainer agreed but isn't
  // paying it yet, so the headline figure is what's contracted, not what
  // is landing in the bank this month. Split so both are readable.
  const inFreePeriod = liveGroups.filter((g) => {
    const f = freePeriod(g);
    return f !== null && f.remaining >= 0;
  });
  const notYetBilling = inFreePeriod.reduce((sum, g) => sum + g.retainer, 0);
  const billingNow = monthlyRecurring - notYetBilling;

  // Free periods landing in the next fortnight, plus any that went past
  // in the last week. Bounded on both sides deliberately: there's no
  // "review done" flag, so an open-ended "anything in the past" would
  // leave every long-standing client sitting here forever and the tile
  // would stop meaning anything.
  const reviewsDue = liveGroups.filter((g) => {
    const f = freePeriod(g);
    return f !== null && f.remaining <= 14 && f.remaining >= -7;
  });

  const visible = filter === 'all' ? groups : groups.filter((g) => g.status === filter);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return parseTimestamp(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <div className="p-10 min-h-full bg-cream">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            DELIVERY · ACTIVE
          </EyebrowLabel>
          <SectionHeading size="section">Active.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3">
            Every client we're building for or running for, and what they're on.
          </p>
        </div>
        <PillButton
          variant="primary"
          size="md"
          trailing="none"
          icon={<Plus size={18} />}
          onClick={openModal}
        >
          New project
        </PillButton>
      </div>

      {/* Operations overview. Reads across every client regardless of the
          tab below, and each tile answers a different question — annual
          recurring sits under monthly rather than taking its own tile,
          because it is only ever monthly x 12. */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-paper border border-hair-soft rounded-xl p-4">
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1">
            In Build
          </p>
          <p className="text-ink text-2xl font-bold">{inBuild}</p>
          <p className="text-ink-dim text-xs mt-0.5">not yet delivered</p>
        </div>

        <div className="bg-paper border border-hair-soft rounded-xl p-4">
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1">
            Active Clients
          </p>
          <p className="text-ink text-2xl font-bold">{activeClients}</p>
          <p className="text-ink-dim text-xs mt-0.5">live and on a retainer</p>
        </div>

        {/* Click to see the working — every client and their figure,
            adding up to the total. */}
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          className="bg-paper border border-hair-soft rounded-xl p-4 text-left hover:border-hair transition-all"
        >
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            Monthly Recurring
            <ChevronDown
              size={11}
              className={`transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
            />
          </p>
          <p className="text-sky-ink text-2xl font-bold">{formatCurrency(monthlyRecurring)}</p>
          <p className="text-ink-dim text-xs mt-0.5">
            {formatCurrency(monthlyRecurring * 12)} a year
          </p>
        </button>

        {/* The one number that is a to-do rather than a readout. */}
        <div
          className={`rounded-xl p-4 border ${
            reviewsDue.length > 0
              ? 'bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.25)]'
              : 'bg-paper border-hair-soft'
          }`}
        >
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1">
            Reviews Due
          </p>
          <p className="text-ink text-2xl font-bold">{reviewsDue.length}</p>
          <p className="text-ink-dim text-xs mt-0.5">
            {notYetBilling > 0
              ? `${formatCurrency(notYetBilling)} not billing yet`
              : 'free periods up within 14 days'}
          </p>
        </div>
      </div>

      {/* Working behind Monthly Recurring */}
      {showBreakdown && (
        <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-6">
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-3">
            What makes up {formatCurrency(monthlyRecurring)}
          </p>
          {liveGroups.length === 0 ? (
            <p className="text-ink-dim text-sm">No live clients yet.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {liveGroups.map((g) => {
                  const f = freePeriod(g);
                  const free = f !== null && f.remaining >= 0;
                  return (
                    <div
                      key={g.key}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-ink-muted truncate">
                        {g.clientName}
                        {free && (
                          <span className="text-warn text-xs ml-2">
                            free for {f!.remaining} more {f!.remaining === 1 ? 'day' : 'days'}
                          </span>
                        )}
                        {g.retainer === 0 && (
                          <span className="text-ink-faint text-xs ml-2">no retainer set</span>
                        )}
                      </span>
                      <span className="text-ink font-medium whitespace-nowrap">
                        {formatCurrency(g.retainer)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-hair-soft mt-3 pt-3 space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink font-medium">Total contracted</span>
                  <span className="text-ink font-bold">{formatCurrency(monthlyRecurring)}</span>
                </div>
                {notYetBilling > 0 && (
                  <>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-dim">Still inside a free period</span>
                      <span className="text-ink-dim">-{formatCurrency(notYetBilling)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-ink-muted">Actually billing this month</span>
                      <span className="text-ink-muted font-medium">
                        {formatCurrency(billingNow)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-1 mb-6 bg-paper border border-hair-soft rounded-lg p-1 w-fit">
        {(['all', 'building', 'live', 'ended'] satisfies FilterStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              filter === status
                ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                : 'text-ink-dim hover:text-ink-muted'
            }`}
          >
            {status === 'all' ? 'All' : STATUS_CONFIG[status].label}
          </button>
        ))}
      </div>

      {/* Client cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-ink-dim" />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-risk text-sm mb-4">{error}</p>
          <button
            onClick={loadProjects}
            className="bg-ink text-white font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-ink/90 transition-all"
          >
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <Users size={32} className="text-ink-dim mx-auto mb-3" />
          <p className="text-ink-muted text-sm mb-1">
            {filter === 'all' ? 'No clients yet' : 'Nobody at this stage'}
          </p>
          <p className="text-ink-dim text-xs mb-4">
            {filter === 'all'
              ? 'Convert a won lead to start their first build.'
              : 'Try a different tab.'}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => navigate('/pipeline')}
              className="bg-transparent text-ink-muted border border-hair-soft rounded-lg px-5 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
            >
              View Pipeline
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {visible.map((group) => {
            const cfg = STATUS_CONFIG[group.status];
            const free = freePeriod(group);

            return (
              <div
                key={group.key}
                className="bg-paper border border-hair-soft rounded-xl p-5"
              >
                {/* Client name + status */}
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div className="min-w-0">
                    <h3 className="text-ink text-base font-bold truncate">
                      {group.clientName}
                    </h3>
                    <p className="text-ink-dim text-xs mt-0.5">
                      {group.projects.length === 1
                        ? '1 project'
                        : `${group.projects.length} projects`}
                    </p>
                  </div>
                  <span
                    className={`${cfg.bg} ${cfg.color} text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0`}
                  >
                    {cfg.label}
                  </span>
                </div>

                {/* Retainer — editable in place */}
                <div className="flex items-baseline gap-2 mb-1">
                  {editingRetainer === group.key ? (
                    <div className="flex items-center gap-2">
                      <span className="text-ink-dim text-sm">$</span>
                      <input
                        autoFocus
                        type="number"
                        value={retainerDraft}
                        onChange={(e) => setRetainerDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRetainer(group);
                          if (e.key === 'Escape') setEditingRetainer(null);
                        }}
                        className="w-28 bg-cream border border-hair rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]"
                      />
                      <button
                        onClick={() => commitRetainer(group)}
                        disabled={saving}
                        className="text-sky-ink hover:text-ink transition-colors p-1 disabled:opacity-40"
                        title="Save"
                      >
                        {saving ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingRetainer(null)}
                        className="text-ink-dim hover:text-ink-muted transition-colors p-1"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-ink text-xl font-bold">
                        {group.retainer > 0 ? formatCurrency(group.retainer) : 'No retainer'}
                      </span>
                      {group.retainer > 0 && (
                        <span className="text-ink-dim text-xs">
                          /mo · {formatCurrency(group.retainer * 12)} a year
                        </span>
                      )}
                      {group.leadId != null && (
                        <button
                          onClick={() => startRetainerEdit(group)}
                          className="text-ink-dim hover:text-sky-ink transition-colors p-1"
                          title="Change retainer"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {group.retainerSince && editingRetainer !== group.key && (
                  <p className="text-ink-dim text-xs mb-3">
                    since {formatDate(group.retainerSince)}
                  </p>
                )}

                {/* Free period countdown */}
                {free && (
                  <div
                    className={`rounded-lg px-3 py-2 mb-3 text-xs ${
                      free.remaining > 7
                        ? 'bg-[rgba(16,185,129,0.10)] text-[#0f9d70]'
                        : free.remaining >= 0
                          ? 'bg-[rgba(245,158,11,0.14)] text-warn'
                          : 'bg-[rgba(11,13,14,0.04)] text-ink-muted'
                    }`}
                  >
                    {free.remaining > 0
                      ? `${free.remaining} ${free.remaining === 1 ? 'day' : 'days'} of the free period left — review ${formatDate(free.endsOn)}`
                      : free.remaining === 0
                        ? `Free period ends today — review due`
                        : `Free period ended ${formatDate(free.endsOn)} — billing`}
                  </div>
                )}

                {/* Projects — rename in place */}
                <div className="border-t border-hair-soft pt-3 space-y-1.5">
                  {group.projects.map((project) => (
                    <div key={project.id} className="flex items-center gap-2 group/row">
                      {editingName === project.id ? (
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => commitRename(project)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingName(null);
                          }}
                          className="flex-1 bg-cream border border-hair rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]"
                        />
                      ) : (
                        <>
                          <button
                            onClick={() => navigate(`/projects/${project.id}`)}
                            className="flex-1 text-left text-ink-muted text-sm truncate hover:text-sky-ink transition-colors"
                          >
                            {project.name}
                          </button>
                          <span className="text-ink-dim text-[10px] whitespace-nowrap">
                            {STATUS_CONFIG[project.status].label}
                          </span>
                          <button
                            onClick={() => startRename(project)}
                            className="text-ink-faint hover:text-sky-ink transition-colors p-1 opacity-0 group-hover/row:opacity-100"
                            title="Rename"
                          >
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Link back to the contact record */}
                {group.leadId != null && (
                  <button
                    onClick={() => navigate(`/leads/${group.leadId}`)}
                    className="mt-3 inline-flex items-center gap-1 text-ink-dim hover:text-sky-ink text-xs transition-colors"
                  >
                    Open client record
                    <ArrowUpRight size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={closeModal}
          />

          <div className="relative bg-paper border border-hair-soft rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-ink text-lg font-bold">New Project</h2>
              <button
                onClick={closeModal}
                className="text-ink-dim hover:text-ink-muted transition-colors p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Recruitment dashboard"
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                />
              </div>

              <div>
                <label className="block text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                  Client Name *
                </label>
                <input
                  type="text"
                  value={formClient}
                  onChange={(e) => setFormClient(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                />
              </div>

              <div>
                <label className="block text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                />
              </div>

              <div>
                <label className="block text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of the project..."
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                  Link to Client (optional)
                </label>
                <select
                  value={formLeadId ?? ''}
                  onChange={(e) =>
                    setFormLeadId(e.target.value ? parseInt(e.target.value) : null)
                  }
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                >
                  <option value="">No linked client</option>
                  {wonLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} {lead.company ? `(${lead.company})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-ink-dim text-xs mt-1.5">
                  Link it and the retainer, notes and history all hang off the
                  one client record.
                </p>
              </div>
            </div>

            {createError && (
              <p className="text-risk text-xs mt-4">{createError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-lg text-sm text-ink-muted border border-hair-soft hover:bg-[rgba(11,13,14,0.03)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formName.trim() || !formClient.trim() || creating}
                className="bg-ink text-white font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-ink/90 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
