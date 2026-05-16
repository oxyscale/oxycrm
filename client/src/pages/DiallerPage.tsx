// ============================================================
// Dialler — simplified lead browser (May 2026)
//
// The old Dialler was a full Twilio-powered in-browser softphone with
// auto-cycling queue, post-call disposition flow and call intelligence.
// All of that has been removed. Calls now happen on a personal mobile
// and are recorded via the Lead Profile "Log Call" action.
//
// What this page does now:
//   - Shows every active lead (status = not_called) in a clean list
//   - Filters by category (top tabs) with totals per tab
//   - Free-text search across name / company / phone / email
//   - Click a lead to open its profile
//
// That's it. No calling, no queue cycling, no audio gear.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Loader2,
  Building2,
  Mail,
  Phone,
  Globe,
  ChevronRight,
  Users,
} from 'lucide-react';
import * as api from '../services/api';
import type { Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

export default function DiallerPage() {
  const navigate = useNavigate();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  // ── Data load ────────────────────────────────────────────────

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    try {
      setLoading(true);
      setError(null);
      // Pull every active lead — filtering is done client-side so the
      // category tabs can show accurate per-tab counts without re-fetching.
      const data = await api.getLeads({ status: 'not_called' });
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  // ── Derived data ─────────────────────────────────────────────

  // Distinct categories with counts, alphabetical
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const cat = lead.category?.trim() || 'Uncategorised';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [leads]);

  // Visible leads after category + search filters
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (activeCategory !== 'all') {
        const cat = lead.category?.trim() || 'Uncategorised';
        if (cat !== activeCategory) return false;
      }
      if (q) {
        return (
          lead.name.toLowerCase().includes(q) ||
          (lead.company || '').toLowerCase().includes(q) ||
          (lead.phone || '').includes(q) ||
          (lead.email || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, activeCategory, search]);

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="p-10 min-h-full bg-cream">
      {/* Header */}
      <div className="mb-6">
        <EyebrowLabel variant="pill" className="mb-4">
          OPERATIONS · LEADS
        </EyebrowLabel>
        <SectionHeading size="section">Active leads.</SectionHeading>
        <p className="text-ink-muted text-sm mt-3">
          Click a lead to open their profile, log a call, or move them between tiers.
        </p>
      </div>

      {/* Search + total count */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company, phone, or email"
            className="w-full bg-paper border border-hair-soft rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-sky transition-all"
          />
        </div>
        <div className="text-ink-dim text-sm flex items-center gap-1.5 ml-auto">
          <Users size={13} />
          <span>{visible.length}</span>
          {visible.length !== leads.length && (
            <span className="text-ink-faint">of {leads.length}</span>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        <CategoryTab
          label="All"
          count={leads.length}
          active={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
        />
        {categoryCounts.map(([cat, count]) => (
          <CategoryTab
            key={cat}
            label={cat}
            count={count}
            active={activeCategory === cat}
            onClick={() => setActiveCategory(cat)}
          />
        ))}
      </div>

      {/* Lead list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-dim" />
        </div>
      ) : error ? (
        <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-xl p-4">
          <p className="text-risk text-sm">{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-paper border border-hair-soft rounded-xl py-12 text-center">
          <Users size={28} className="text-ink-faint mx-auto mb-3" />
          <p className="text-ink-muted text-sm mb-1">
            {leads.length === 0 ? 'No active leads.' : 'No leads match your filters.'}
          </p>
          <p className="text-ink-dim text-xs">
            {leads.length === 0
              ? 'Import leads from the home page to get started.'
              : 'Try a different category or clear the search.'}
          </p>
        </div>
      ) : (
        <div className="bg-paper border border-hair-soft rounded-xl overflow-hidden">
          {visible.map((lead, idx) => (
            <button
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className={`w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-tray transition-all group ${
                idx > 0 ? 'border-t border-hair-soft' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                {/* Top line: name + category badge */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-ink font-medium text-base truncate">{lead.name}</span>
                  {lead.category && (
                    <span className="bg-sky-wash text-sky-ink text-[11px] px-2 py-0.5 rounded-full flex-shrink-0">
                      {lead.category}
                    </span>
                  )}
                </div>
                {/* Bottom line: company . phone . email . website */}
                <div className="flex items-center gap-4 text-ink-muted text-xs flex-wrap">
                  {lead.company && (
                    <span className="flex items-center gap-1">
                      <Building2 size={11} className="text-ink-dim flex-shrink-0" />
                      <span className="truncate max-w-[200px]">{lead.company}</span>
                    </span>
                  )}
                  {lead.phone && (
                    <span className="flex items-center gap-1">
                      <Phone size={11} className="text-ink-dim flex-shrink-0" />
                      {lead.phone}
                    </span>
                  )}
                  {lead.email && (
                    <span className="flex items-center gap-1">
                      <Mail size={11} className="text-ink-dim flex-shrink-0" />
                      <span className="truncate max-w-[220px]">{lead.email}</span>
                    </span>
                  )}
                  {lead.website && (
                    <span className="flex items-center gap-1">
                      <Globe size={11} className="text-ink-dim flex-shrink-0" />
                      <span className="truncate max-w-[200px]">
                        {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="text-ink-faint group-hover:text-ink-dim transition-colors flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Category tab pill ─────────────────────────────────────────

function CategoryTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm transition-all flex items-center gap-2 ${
        active
          ? 'bg-ink text-white'
          : 'bg-paper border border-hair-soft text-ink-muted hover:border-hair-strong hover:text-ink'
      }`}
    >
      <span>{label}</span>
      <span className={`text-xs ${active ? 'text-white/70' : 'text-ink-dim'}`}>{count}</span>
    </button>
  );
}
