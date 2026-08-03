import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Kanban,
  Filter,
  Loader2,
  Phone,
  Building2,
  ChevronDown,
  DollarSign,
  Users,
  Trophy,
  ArrowRight,
} from 'lucide-react';
import * as api from '../services/api';
import { rememberLeadProfileReturn } from '../utils/leadProfileNav';
import type { Lead, PipelineStage } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import StatCard from '../components/ui/StatCard';
import PillButton from '../components/ui/PillButton';

// ── Column definitions ──────────────────────────────────────────

interface StageColumn {
  key: PipelineStage;
  label: string;
  color: string; // Tailwind-compatible color for the header strip
  bgTint: string; // Subtle background tint for column header area
}

const STAGES: StageColumn[] = [
  { key: 'proposal', label: 'Proposals', color: 'bg-sky', bgTint: 'bg-[rgba(94,197,230,0.08)]' },
  { key: 'tier_1', label: 'Tier 1', color: 'bg-sky-ink', bgTint: 'bg-[rgba(10,156,212,0.06)]' },
  { key: 'tier_2', label: 'Tier 2', color: 'bg-amber-400', bgTint: 'bg-[rgba(245,158,11,0.06)]' },
  { key: 'tier_3', label: 'Tier 3', color: 'bg-ink-dim', bgTint: 'bg-[rgba(138,149,160,0.06)]' },
  { key: 'pulse', label: 'Pulse', color: 'bg-violet-500', bgTint: 'bg-[rgba(139,92,246,0.06)]' },
  { key: 'won', label: 'Won', color: 'bg-emerald-500', bgTint: 'bg-[rgba(16,185,129,0.06)]' },
  { key: 'lost', label: 'Lost', color: 'bg-red-400', bgTint: 'bg-[rgba(248,113,113,0.06)]' },
];

// ── Component ───────────────────────────────────────────────────

export default function PipelinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Data state
  const [pipeline, setPipeline] = useState<Record<string, Lead[]>>({});
  const [stats, setStats] = useState<{
    byStage: Record<string, number>;
    conversionRate: number;
    totalPipelineValue: number;
    unplaced?: number;
  } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state — restored from URL params
  const [filterCategory, setFilterCategory] = useState(searchParams.get('cat') || 'all');

  // Sync filter to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterCategory !== 'all') params.set('cat', filterCategory);
    setSearchParams(params, { replace: true });
  }, [filterCategory, setSearchParams]);

  // Stage move dropdown state
  const [openMoveDropdown, setOpenMoveDropdown] = useState<number | null>(null);
  const [movingLead, setMovingLead] = useState<number | null>(null);
  // Drag-and-drop between tier columns. Native HTML5 DnD — no library
  // needed for a column-target kanban, and it keeps the bundle lean.
  const [draggingLeadId, setDraggingLeadId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);
  // Set on drag start, cleared shortly after drop. Suppresses the card's
  // navigate-on-click so finishing a drag doesn't open the lead profile.
  const didDragRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Data loading ────────────────────────────────────────────

  useEffect(() => {
    loadData();
  }, [filterCategory]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenMoveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: { category?: string } = {};
      if (filterCategory !== 'all') filters.category = filterCategory;

      const [pipelineData, statsData, cats] = await Promise.all([
        api.getPipeline(filters),
        api.getPipelineStats(),
        api.getCategories(),
      ]);
      setPipeline(pipelineData);
      setStats(statsData);
      setCategories(cats);
    } catch (err) {
      console.error('Failed to load pipeline data:', err);
      setError('Failed to load pipeline data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Actions ─────────────────────────────────────────────────

  const handleStageChange = async (leadId: number, newStage: PipelineStage) => {
    setMovingLead(leadId);
    setOpenMoveDropdown(null);
    try {
      const updated = await api.updateLeadStage(leadId, newStage);
      // Move lead in local state
      setPipeline((prev) => {
        const next = { ...prev };
        // Remove from all columns
        for (const key of Object.keys(next)) {
          next[key] = next[key].filter((l) => l.id !== leadId);
        }
        // Add to target column
        const targetKey = newStage;
        if (!next[targetKey]) next[targetKey] = [];
        next[targetKey] = [...next[targetKey], updated];
        return next;
      });
      // Refresh stats
      api.getPipelineStats().then(setStats).catch(() => {});
    } catch (err) {
      console.error('Failed to update stage:', err);
    } finally {
      setMovingLead(null);
    }
  };

  // ── Drag and drop ───────────────────────────────────────────

  const handleDragStart = (leadId: number) => {
    didDragRef.current = true;
    setDraggingLeadId(leadId);
  };

  const handleDragEnd = () => {
    setDraggingLeadId(null);
    setDragOverStage(null);
    // Let the click event that follows a drag fire and be ignored first.
    setTimeout(() => { didDragRef.current = false; }, 0);
  };

  const handleDrop = (targetStage: PipelineStage) => {
    setDragOverStage(null);
    const leadId = draggingLeadId;
    setDraggingLeadId(null);
    if (leadId === null) return;
    // No-op when dropped back into the column it came from.
    const currentStage = (Object.keys(pipeline) as PipelineStage[])
      .find((k) => (pipeline[k] || []).some((l) => l.id === leadId));
    if (currentStage === targetStage) return;
    handleStageChange(leadId, targetStage);
  };

  // ── Derived data ────────────────────────────────────────────

  const totalLeads = Object.values(pipeline).reduce((sum, leads) => sum + leads.length, 0);

  // Leads with no pipeline stage (NULL) don't appear in the kanban.
  // Surface the count from /api/pipeline/stats so Jordan knows where they went.
  const unplacedCount = stats?.unplaced ?? 0;

  // Sum deal values across active tiers (Pulse/Tier 1/2/3 — Won/Lost are closed)
  const activePipelineValue = (['proposal', 'tier_1', 'tier_2', 'tier_3', 'pulse'] as const).reduce((sum, key) => {
    const list = pipeline[key] || [];
    return sum + list.reduce((s, l) => s + (l.dealValue || 0), 0);
  }, 0);
  const formatAUD = (n: number) => n
    ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
    : '$0';

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="p-10 flex flex-col bg-cream min-h-full">
      {/* Header */}
      <div className="mb-8 flex-shrink-0">
        <EyebrowLabel variant="pill" className="mb-5">
          OPERATIONS · PIPELINE
        </EyebrowLabel>
        <SectionHeading size="section">Active pipeline.</SectionHeading>
        <p className="text-ink-muted text-sm mt-3">
          Track leads through your sales pipeline.
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6 flex-shrink-0">
          <StatCard
            eyebrow="Total Leads"
            value={totalLeads}
            icon={<Users size={16} />}
            elevated
          />
          <StatCard
            eyebrow="Active Pipeline Value"
            value={formatAUD(activePipelineValue)}
            icon={<DollarSign size={16} />}
            elevated
          />
          <StatCard
            eyebrow="Won"
            value={stats.byStage?.won || 0}
            icon={<Trophy size={16} />}
            elevated
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-shrink-0">
        <Filter size={14} className="text-ink-dim" />
        {categories.length > 0 && (
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-paper border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
        <span className="text-ink-dim text-sm ml-auto">
          {totalLeads} lead{totalLeads !== 1 ? 's' : ''} in pipeline
        </span>
      </div>

      {/* Hint when leads exist but aren't placed on the kanban */}
      {unplacedCount > 0 && (
        <div className="bg-sky-wash border border-sky-hair rounded-xl px-4 py-3 mb-6 flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-ink text-sm">
            <span className="font-medium">{unplacedCount} lead{unplacedCount !== 1 ? 's' : ''}</span>
            {' '}not yet placed in a tier. Open them from Leads and set a tier to add them to the kanban.
          </p>
          <button
            onClick={() => navigate('/leads')}
            className="text-sky-ink text-sm font-medium hover:underline flex-shrink-0"
          >
            Go to Leads -&gt;
          </button>
        </div>
      )}

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center py-16 flex-1">
          <Loader2 size={24} className="animate-spin text-ink-dim" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <p className="text-risk text-sm mb-4">{error}</p>
            <PillButton variant="primary" size="md" trailing="none" onClick={loadData}>
              Retry
            </PillButton>
          </div>
        </div>
      ) : totalLeads === 0 ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <Kanban size={32} className="text-sky-ink mx-auto mb-3" />
            <p className="text-ink-muted text-sm mb-1">No leads in your pipeline yet</p>
            <p className="text-ink-dim text-xs mb-4">Import leads or create one to get started.</p>
            <PillButton variant="primary" size="md" trailing="none" onClick={() => navigate('/')}>
              Go to home
            </PillButton>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => {
              const leads = pipeline[stage.key] || [];
              const columnValue = leads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
              return (
                <div
                  key={stage.key}
                  onDragOver={(e) => {
                    // preventDefault is what marks this a valid drop target.
                    e.preventDefault();
                    if (dragOverStage !== stage.key) setDragOverStage(stage.key);
                  }}
                  onDragLeave={(e) => {
                    // Only clear when leaving the column itself, not when
                    // crossing between child cards inside it.
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverStage((prev) => (prev === stage.key ? null : prev));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(stage.key);
                  }}
                  className={`w-72 flex-shrink-0 flex flex-col bg-paper border rounded-xl overflow-hidden transition-all ${
                    dragOverStage === stage.key
                      ? 'border-sky-hair ring-2 ring-[rgba(94,197,230,0.35)]'
                      : 'border-hair-soft'
                  }`}
                >
                  {/* Column header */}
                  <div className={`${stage.bgTint} border-b border-hair-soft`}>
                    {/* Color strip */}
                    <div className={`h-1 ${stage.color}`} />
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-ink text-sm font-bold">{stage.label}</h3>
                        <span className="bg-tray text-ink-muted text-xs font-medium px-2 py-0.5 rounded-full">
                          {leads.length}
                        </span>
                      </div>
                      <p className="text-ink-muted text-xs font-medium">
                        {formatAUD(columnValue)}
                      </p>
                    </div>
                  </div>

                  {/* Card list — grows with content; whole page scrolls */}
                  <div className="p-3 space-y-2.5">
                    {leads.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="text-ink-dim text-xs">No leads</p>
                      </div>
                    ) : (
                      leads.map((lead) => (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={() => handleDragStart(lead.id)}
                          onDragEnd={handleDragEnd}
                          title="Drag to move between tiers"
                          className={`bg-tray border border-hair-soft rounded-lg p-3.5 hover:border-hair-strong transition-all group cursor-grab active:cursor-grabbing ${
                            movingLead === lead.id ? 'opacity-50' : ''
                          } ${draggingLeadId === lead.id ? 'opacity-40 ring-2 ring-sky-hair' : ''}`}
                        >
                          {/* Clickable lead info */}
                          <div
                            className="cursor-pointer"
                            onClick={() => {
                              // Swallow the click that fires at the end of a
                              // drag, otherwise every drop opens the profile.
                              if (didDragRef.current) return;
                              rememberLeadProfileReturn();
                              navigate(`/leads/${lead.id}`);
                            }}
                          >
                            <p className="text-ink text-sm font-medium truncate hover:text-sky-ink transition-colors">
                              {lead.name}
                            </p>
                            {lead.company && (
                              <p className="text-ink-muted text-xs truncate flex items-center gap-1 mt-0.5">
                                <Building2 size={10} className="text-ink-dim flex-shrink-0" />
                                {lead.company}
                              </p>
                            )}
                          </div>

                          {/* Badges row */}
                          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                            {/* Deal value badge */}
                            {lead.dealValue > 0 && (
                              <span className="bg-[rgba(11,13,14,0.05)] text-ink text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                                <DollarSign size={8} />
                                {lead.dealValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                              </span>
                            )}

                            {/* Category badge */}
                            {lead.category && (
                              <span className="bg-[rgba(10,156,212,0.1)] text-sky-ink text-[10px] px-2 py-0.5 rounded-full">
                                {lead.category}
                              </span>
                            )}
                          </div>

                          {/* Phone + move action row */}
                          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-hair-soft">
                            {lead.phone && (
                              <span className="text-ink-dim text-[10px] flex items-center gap-1">
                                <Phone size={8} />
                                {lead.phone}
                              </span>
                            )}

                            {/* Move to stage dropdown */}
                            <div className="relative" ref={openMoveDropdown === lead.id ? dropdownRef : undefined}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMoveDropdown(openMoveDropdown === lead.id ? null : lead.id);
                                }}
                                className="text-ink-dim hover:text-ink-muted transition-all flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100"
                              >
                                <ArrowRight size={10} />
                                Move
                                <ChevronDown size={8} />
                              </button>

                              {openMoveDropdown === lead.id && (
                                <div className="absolute right-0 bottom-full mb-1 bg-paper border border-hair-soft rounded-lg shadow-xl shadow-black/40 py-1 z-50 min-w-[140px]">
                                  {STAGES.filter((s) => s.key !== stage.key).map((target) => (
                                    <button
                                      key={target.key}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStageChange(lead.id, target.key);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all flex items-center gap-2"
                                    >
                                      <div className={`w-1.5 h-1.5 rounded-full ${target.color}`} />
                                      {target.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
