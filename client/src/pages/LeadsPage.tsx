import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  ArrowUpDown,
  UserPlus,
  Clock,
  Building2,
  Check,
  X,
} from 'lucide-react';
import * as api from '../services/api';
import { getRecentLeads, refreshRecentLeads, type RecentLead } from '../utils/recentLeads';
import { rememberLeadProfileReturn } from '../utils/leadProfileNav';
import type { Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import PillButton from '../components/ui/PillButton';

// 'recent' is the default — sorts by max(lastViewedAt, updatedAt) DESC so
// the leads Jordan's actually been working on bubble to the top of the list.
// The other fields are still available via column-header clicks.
type SortField = 'recent' | 'name' | 'category' | 'queuePosition';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore filter state from URL params (so back-button preserves filters)
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // Category dropdown is sourced from the managed categories list (Settings >
  // Categories), NOT from distinct values in the loaded leads. Apify imports
  // dump raw scrape strings like "Roofing contractor" / "Nursing agency" into
  // leads.category, which used to pollute the filter. The managed list is the
  // single source of truth — if it's not there, it doesn't show up.
  const [categories, setCategories] = useState<string[]>([]);
  // Duplicate flags keyed by suspect lead id → flag info. The row for
  // each suspect lead shows a "Likely duplicate of X" pill with Fold /
  // Dismiss / Open buttons. Populated once on mount; updated locally as
  // Jordan acts on each pill (no full reload needed).
  const [flagsBySuspect, setFlagsBySuspect] = useState<Map<number, api.DuplicateFlag>>(new Map());
  const [foldingId, setFoldingId] = useState<number | null>(null);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [filterCategory, setFilterCategory] = useState<string>(searchParams.get('cat') || 'all');
  const [filterContacted, setFilterContacted] = useState<'all' | 'contacted' | 'not_contacted'>(
    (searchParams.get('status') as 'all' | 'contacted' | 'not_contacted') || 'all'
  );
  const [sortField, setSortField] = useState<SortField>(
    (searchParams.get('sort') as SortField) || 'recent'
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    (searchParams.get('dir') as SortDir) || 'asc'
  );
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  // Sync filter state to URL params (replace, not push — avoids polluting history)
  // Also stash the full URL in sessionStorage so other pages (Compose, etc.)
  // can redirect back here with the same filters after completing an action.
  const syncParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (filterCategory !== 'all') params.set('cat', filterCategory);
    if (filterContacted !== 'all') params.set('status', filterContacted);
    if (sortField !== 'recent') params.set('sort', sortField);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    setSearchParams(params, { replace: true });
    // Remember this URL for "return to leads" after actions
    const qs = params.toString();
    try {
      sessionStorage.setItem('leads-return-url', `/leads${qs ? `?${qs}` : ''}`);
    } catch { /* ignore */ }
  }, [search, filterCategory, filterContacted, sortField, sortDir, setSearchParams]);

  useEffect(() => {
    syncParams();
  }, [syncParams]);

  // Load ALL leads once. The Contacted filter is applied CLIENT-SIDE
  // below so it doesn't constrain what the search bar can find — search
  // is global and ignores filter pills. Toggling Contacted is instant
  // (no network round trip) and the search always sees every lead.
  useEffect(() => {
    loadLeads();
  }, []);

  // Pull managed categories once on mount so the filter dropdown stays in
  // sync with Settings without needing a page refresh after edits there.
  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => { /* non-critical */ });
  }, []);

  // Auto-refresh leads when the tab regains focus (or comes back from
  // background). Edits made on a lead profile, in another tab, or by
  // George land here on the next focus event — no manual refresh needed.
  useEffect(() => {
    const onFocus = () => loadLeads();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadLeads();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // loadLeads closes over filterContacted but is stable enough — the
    // dep array intentionally excludes it to avoid re-binding listeners
    // on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load duplicate flags so we can render the inline pills.
  useEffect(() => {
    api.getDuplicateFlags()
      .then((flags) => {
        const m = new Map<number, api.DuplicateFlag>();
        for (const f of flags) m.set(f.suspectId, f);
        setFlagsBySuspect(m);
      })
      .catch(() => { /* non-critical — pills just won't show */ });
  }, []);

  const handleFoldLead = async (flag: api.DuplicateFlag) => {
    const ok = window.confirm(
      `Fold "${flag.suspect.name}" into "${flag.target.name}"?\n\n` +
      `${flag.target.name} keeps all its fields. Any blank fields on ${flag.target.name} will be filled in from "${flag.suspect.name}" if available (phone, email, website, etc.). Nothing existing gets overwritten.\n\n` +
      `Any activity on "${flag.suspect.name}" moves to "${flag.target.name}". The duplicate row is then deleted.`,
    );
    if (!ok) return;
    setFoldingId(flag.suspectId);
    try {
      await api.foldLead(flag.suspectId, flag.targetId);
      // Remove the folded lead from the list + drop the flag.
      setLeads((prev) => prev.filter((l) => l.id !== flag.suspectId));
      setFlagsBySuspect((prev) => {
        const next = new Map(prev);
        next.delete(flag.suspectId);
        return next;
      });
    } catch (err) {
      console.error('Failed to fold lead:', err);
      alert(err instanceof Error ? err.message : 'Failed to fold lead');
    } finally {
      setFoldingId(null);
    }
  };

  const handleDismissDuplicate = async (flag: api.DuplicateFlag) => {
    // Optimistic — drop the pill straight away; if the server call fails
    // we restore it below.
    setFlagsBySuspect((prev) => {
      const next = new Map(prev);
      next.delete(flag.suspectId);
      return next;
    });
    try {
      await api.dismissDuplicate(flag.suspectId, flag.targetId);
    } catch (err) {
      console.error('Failed to dismiss flag:', err);
      // Restore the flag on failure so the user can retry.
      setFlagsBySuspect((prev) => {
        const next = new Map(prev);
        next.set(flag.suspectId, flag);
        return next;
      });
    }
  };

  // Close recent leads dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadLeads = async () => {
    try {
      setLoading(true);
      // Always pull ALL leads (no server-side contacted filter). The
      // Contacted toggle is applied client-side below so it doesn't
      // constrain what the search bar can find.
      const data = await api.getLeads();
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  // Search is GLOBAL — when there's an active query, the Contacted
  // toggle is bypassed entirely so Jordan can find any lead by name /
  // company / phone / email regardless of which filter pill is on.
  // When the search box is empty, the Contacted toggle applies normally.
  const isSearching = search.trim().length > 0;

  // Running totals for the Contacted / Not Contacted / All filter
  // pills. Counts respect the active category filter (so toggling
  // category updates the numbers) but IGNORE the current contacted
  // pill (otherwise the inactive pills would always show 0) and the
  // search box (numbers shouldn't jump while typing).
  const counts = leads.reduce(
    (acc, lead) => {
      if (filterCategory === 'none' && lead.category) return acc;
      if (filterCategory !== 'all' && filterCategory !== 'none' && lead.category !== filterCategory) return acc;
      acc.all += 1;
      if (lead.contacted) acc.contacted += 1;
      else acc.notContacted += 1;
      return acc;
    },
    { all: 0, contacted: 0, notContacted: 0 },
  );

  const filtered = leads
    .filter((lead) => {
      // Contacted filter — bypassed during a search so it doesn't hide
      // matches that happen to be in the other filter bucket.
      if (!isSearching) {
        if (filterContacted === 'contacted' && !lead.contacted) return false;
        if (filterContacted === 'not_contacted' && lead.contacted) return false;
      }
      if (filterCategory === 'none' && lead.category) return false;
      if (filterCategory !== 'all' && filterCategory !== 'none' && lead.category !== filterCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.name.toLowerCase().includes(q) ||
          (lead.company || '').toLowerCase().includes(q) ||
          (lead.phone || '').includes(q) ||
          (lead.email || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      // 'recent' is a virtual sort field — uses last_viewed_at (bumped
      // when Jordan opens the lead profile) and falls back to updated_at.
      // Always DESC: most recently touched first. The Recent default
      // means the leads Jordan's been working on bubble to the top
      // instead of always showing the same low-queue-position leads.
      if (sortField === 'recent') {
        const aRef = a.lastViewedAt || a.updatedAt || '';
        const bRef = b.lastViewedAt || b.updatedAt || '';
        return bRef.localeCompare(aRef);
      }
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const handleMarkContacted = async (leadId: number) => {
    try {
      await api.markLeadContacted(leadId, true);
      // Remove from local list so it disappears instantly
      setLeads((prev) => prev.map((l) =>
        l.id === leadId ? { ...l, contacted: true, manuallyContacted: true } : l
      ));
    } catch (err) {
      console.error('Failed to mark lead as contacted:', err);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Only blank the page when we have NOTHING yet (first ever load).
  // Once leads are in memory, every subsequent refresh (filter toggle,
  // tab focus, background refetch) happens silently — the UI never
  // disappears mid-interaction. A subtle "Refreshing…" hint in the
  // header is enough.
  if (loading && leads.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-ink-dim">Loading leads...</div>
      </div>
    );
  }

  return (
    <div className="p-10 min-h-full bg-cream">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            DIRECTORY · LEADS
          </EyebrowLabel>
          <SectionHeading size="section">All leads.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3">
            {isSearching ? (
              <>
                {filtered.length} match{filtered.length === 1 ? '' : 'es'} for "{search}"
                {filterContacted !== 'all' && (
                  <span className="text-ink-dim"> · search ignores the {filterContacted === 'contacted' ? 'Contacted' : 'Not Contacted'} filter</span>
                )}
              </>
            ) : (
              <>{leads.length} total</>
            )}
            {loading && leads.length > 0 && (
              <span className="text-ink-dim ml-2 text-xs">· Refreshing…</span>
            )}
          </p>
        </div>
        <PillButton
          variant="outline"
          size="md"
          trailing="none"
          icon={<UserPlus size={16} className="text-sky-ink" />}
          onClick={() => navigate('/?create=lead')}
        >
          Create lead
        </PillButton>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 mb-6">
        {/* Search with recent leads dropdown */}
        <div className="relative flex-1 max-w-sm" ref={searchWrapperRef}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim z-10" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              setSearchFocused(true);
              // Show whatever's in localStorage immediately, then validate
              // against the server in the background. Deleted leads vanish
              // from the dropdown, renamed leads get their new name.
              setRecentLeads(getRecentLeads());
              refreshRecentLeads().then(setRecentLeads).catch(() => { /* keep stale */ });
            }}
            className="w-full bg-paper border border-hair-soft rounded-lg pl-10 pr-4 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
          />
          {/* Recent leads dropdown — shows when focused and search is empty */}
          {searchFocused && !search && recentLeads.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-paper border border-hair-soft rounded-xl shadow-lg z-20 overflow-hidden">
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-ink-dim text-[11px] uppercase tracking-wider font-medium flex items-center gap-1.5">
                  <Clock size={11} />
                  Recently visited
                </p>
              </div>
              <ul className="py-1">
                {recentLeads.map((recent) => (
                  <li key={recent.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchFocused(false);
                        rememberLeadProfileReturn();
                        navigate(`/leads/${recent.id}`);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-tray transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-ink truncate block">{recent.name}</span>
                        {recent.company && (
                          <span className="flex items-center gap-1 text-xs text-ink-muted truncate">
                            <Building2 size={11} className="flex-shrink-0" />
                            {recent.company}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Category filter */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
        >
          <option value="all">All Categories</option>
          <option value="none">No Category</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* Contacted filter — three independent pills, each showing
            its running count so Jordan can see all three totals at
            once instead of cycling through them. Counts ignore the
            search box and the active pill, so the inactive pills
            still show their bucket size. */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterContacted('all')}
            className={`rounded-full px-3.5 py-2 text-sm font-medium border transition-all select-none ${
              filterContacted === 'all'
                ? 'bg-ink border-ink text-white'
                : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)]'
            }`}
          >
            All <span className={filterContacted === 'all' ? 'text-white/70 ml-1' : 'text-ink-dim ml-1'}>{counts.all.toLocaleString()}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterContacted('contacted')}
            className={`rounded-full px-3.5 py-2 text-sm font-medium border transition-all select-none ${
              filterContacted === 'contacted'
                ? 'bg-[rgba(16,185,129,0.12)] border-[rgba(16,185,129,0.35)] text-[#0f9d70]'
                : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)]'
            }`}
          >
            Contacted <span className={filterContacted === 'contacted' ? 'text-[#0f9d70]/70 ml-1' : 'text-ink-dim ml-1'}>{counts.contacted.toLocaleString()}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterContacted('not_contacted')}
            className={`rounded-full px-3.5 py-2 text-sm font-medium border transition-all select-none ${
              filterContacted === 'not_contacted'
                ? 'bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.3)] text-[#dc2626]'
                : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)]'
            }`}
          >
            Not Contacted <span className={filterContacted === 'not_contacted' ? 'text-[#dc2626]/70 ml-1' : 'text-ink-dim ml-1'}>{counts.notContacted.toLocaleString()}</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-paper border border-sky-hair shadow-sky-elevated rounded-2xl overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-hair-soft">
              <th className="text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('name')}>
                <span className="flex items-center gap-1">
                  Name
                  {sortField === 'name' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="w-[180px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('category')}>
                <span className="flex items-center gap-1">
                  Category
                  {sortField === 'category' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="w-[110px] text-center text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3">Task</th>
              <th className="w-[130px] text-right text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => {
                  rememberLeadProfileReturn();
                  navigate(`/leads/${lead.id}`);
                }}
                className="border-b border-hair-soft hover:bg-[rgba(10,156,212,0.04)] transition-colors cursor-pointer"
              >
                <td className="px-3 py-3">
                  <div className="text-ink text-sm font-medium truncate">
                    {lead.name}
                  </div>
                  <div className="text-ink-dim text-xs mt-0.5 truncate">
                    {lead.company || ''}{lead.company && lead.phone ? ' · ' : ''}{lead.phone}
                    {lead.website && (
                      <>
                        {' · '}
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-dim hover:text-sky-ink transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                        </a>
                      </>
                    )}
                  </div>
                  {/* Duplicate flag pill — fires when the scan identified
                      this lead as likely the same as another in the DB.
                      Click Fold to merge (target keeps everything, blanks
                      get filled from this row, activity moves over).
                      Click Dismiss to mark "not a dup" forever. */}
                  {flagsBySuspect.has(lead.id) && (() => {
                    const flag = flagsBySuspect.get(lead.id)!;
                    return (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className={`mt-2 inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
                          flag.confidence === 'high'
                            ? 'bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)]'
                            : 'bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.22)]'
                        }`}
                      >
                        <span className={flag.confidence === 'high' ? 'text-risk font-medium' : 'text-warn font-medium'}>
                          {flag.confidence === 'high' ? 'Match' : 'Possible match'}
                        </span>
                        <span className="text-ink-muted">
                          Likely duplicate of <span className="text-ink font-medium">{flag.target.name}</span>
                          {flag.target.company && <span className="text-ink-dim"> at {flag.target.company}</span>}
                        </span>
                        <span className="text-ink-dim text-[11px]">
                          ({flag.reasons.join(' · ')})
                        </span>
                        <div className="flex items-center gap-1.5 ml-1">
                          <button
                            type="button"
                            onClick={() => handleFoldLead(flag)}
                            disabled={foldingId === flag.suspectId}
                            className="text-ink-muted hover:text-ink text-[11px] font-medium px-2 py-0.5 rounded-full bg-paper border border-hair-soft hover:border-hair-strong transition-all disabled:opacity-50"
                          >
                            {foldingId === flag.suspectId ? 'Folding...' : 'Fold'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismissDuplicate(flag)}
                            className="text-ink-dim hover:text-ink-muted text-[11px] px-2 py-0.5 transition-all"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              rememberLeadProfileReturn();
                              navigate(`/leads/${flag.targetId}`);
                            }}
                            className="text-sky-ink hover:underline text-[11px] font-medium px-1"
                          >
                            Open {flag.target.name.split(' ')[0]} →
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-3 py-3 overflow-hidden">
                  {lead.category && (
                    <span className="bg-[rgba(10,156,212,0.15)] text-sky-ink text-xs px-2.5 py-1 rounded-full inline-block max-w-full truncate align-middle">
                      {lead.category}
                    </span>
                  )}
                </td>
                {/* Task column — green check pill when the lead has any
                    open task, hairline outline pill with em-dash when it
                    doesn't. Lets Jordan scan the column for "no task"
                    rows without opening every profile. Click the pill
                    to jump straight into the profile (the row click
                    already does that — stopPropagation NOT needed). */}
                <td className="px-3 py-3 text-center">
                  {(lead.openTaskCount ?? 0) > 0 ? (
                    <span className="inline-flex items-center gap-1 bg-[rgba(16,185,129,0.1)] text-[#0f9d70] text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      <Check size={12} strokeWidth={2.5} />
                      {(lead.openTaskCount ?? 0) > 1 ? `${lead.openTaskCount} tasks` : 'Task set'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 border border-hair-soft text-ink-dim text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      <X size={12} strokeWidth={2.5} />
                      No task
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  {lead.contacted ? (
                    <span className="bg-[rgba(16,185,129,0.1)] text-[#10b981] text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      Contacted
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkContacted(lead.id);
                      }}
                      className="bg-[rgba(239,68,68,0.08)] text-[#ef4444] text-xs px-2.5 py-1 rounded-full whitespace-nowrap hover:bg-[rgba(16,185,129,0.1)] hover:text-[#10b981] transition-colors cursor-pointer"
                    >
                      Not Contacted
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-ink-dim">
            {search || filterCategory !== 'all' || filterContacted !== 'all'
              ? 'No leads match your filters'
              : 'No leads imported yet'}
          </div>
        )}
      </div>
    </div>
  );
}
