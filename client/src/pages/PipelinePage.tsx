import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Kanban,
  Filter,
  Loader2,
  Phone,
  Building2,
  ChevronDown,
  Flame,
  Thermometer,
  Snowflake,
  TrendingUp,
  Users,
  Trophy,
  ArrowRight,
} from 'lucide-react';
import * as api from '../services/api';
import type { Lead, PipelineStage, Temperature } from '../types';
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
  { key: 'new_lead', label: 'New Lead', color: 'bg-ink', bgTint: 'bg-[rgba(10,156,212,0.06)]' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-amber-400', bgTint: 'bg-[rgba(251,191,36,0.06)]' },
  { key: 'call_booked', label: 'Call Booked', color: 'bg-blue-400', bgTint: 'bg-[rgba(96,165,250,0.06)]' },
  { key: 'negotiation', label: 'Negotiation', color: 'bg-purple-400', bgTint: 'bg-[rgba(192,132,252,0.06)]' },
  { key: 'won', label: 'Won', color: 'bg-ink', bgTint: 'bg-[rgba(10,156,212,0.06)]' },
  { key: 'lost', label: 'Lost', color: 'bg-red-400', bgTint: 'bg-[rgba(248,113,113,0.06)]' },
  { key: 'not_interested', label: 'Not Interested', color: 'bg-ink-dim', bgTint: 'bg-[rgba(138,149,160,0.06)]' },
  { key: 'five_strikes', label: 'Five Strikes', color: 'bg-ink-faint', bgTint: 'bg-[rgba(184,191,198,0.08)]' },
];

const TEMPERATURE_CYCLE: (Temperature | null)[] = ['hot', 'warm', 'cold', null];

function getTemperatureStyle(temp: Temperature): { label: string; color: string; bg: string; Icon: typeof Flame } {
  switch (temp) {
    case 'hot':
      return { label: 'Hot', color: 'text-red-400', bg: 'bg-red-500/15', Icon: Flame };
    case 'warm':
      return { label: 'Warm', color: 'text-amber-400', bg: 'bg-amber-500/15', Icon: Thermometer };
    case 'cold':
      return { label: 'Cold', color: 'text-blue-400', bg: 'bg-blue-500/15', Icon: Snowflake };
    default: {
      const _exhaustive: never = temp;
      return _exhaustive;
    }
  }
}

// ── Component ───────────────────────────────────────────────────

export default function PipelinePage() {
  const navigate = useNavigate();

  // Data state
  const [pipeline, setPipeline] = useState<Record<string, Lead[]>>({});
  const [stats, setStats] = useState<{
    byStage: Record<string, number>;
    conversionRate: number;
    totalPipelineValue: number;
    byTemperature: Record<string, number>;
  } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterTemperature, setFilterTemperature] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  // Stage move dropdown state
  const [openMoveDropdown, setOpenMoveDropdown] = useState<number | null>(null);
  const [movingLead, setMovingLead] = useState<number | null>(null);
  const [updatingTemp, setUpdatingTemp] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Data loading ────────────────────────────────────────────

  useEffect(() => {
    loadData();
  }, [filterTemperature, filterCategory]);

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
      const filters: { temperature?: string; category?: string } = {};
      if (filterTemperature !== 'all') filters.temperature = filterTemperature;
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

  const handleTemperatureChange = async (lead: Lead) => {
    setUpdatingTemp(lead.id);
    try {
      const currentIdx = TEMPERATURE_CYCLE.indexOf(lead.temperature);
      const nextIdx = (currentIdx + 1) % TEMPERATURE_CYCLE.length;
      const nextTemp = TEMPERATURE_CYCLE[nextIdx];

      const updated = await api.updateLeadTemperature(lead.id, nextTemp);
      // Update in local state
      setPipeline((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = next[key].map((l) => (l.id === lead.id ? updated : l));
        }
        return next;
      });
      // Refresh stats
      api.getPipelineStats().then(setStats).catch(() => {});
    } catch (err) {
      console.error('Failed to update temperature:', err);
    } finally {
      setUpdatingTemp(null);
    }
  };

  // ── Derived data ────────────────────────────────────────────

  const totalLeads = Object.values(pipeline).reduce((sum, leads) => sum + leads.length, 0);

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="p-10 h-full flex flex-col bg-cream">
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
        <div className="grid grid-cols-4 gap-4 mb-6 flex-shrink-0">
          <StatCard
            eyebrow="Total Leads"
            value={totalLeads}
            icon={<Users size={16} />}
            elevated
          />
          <StatCard
            eyebrow="Conversion"
            value={`${stats.conversionRate}%`}
            icon={<TrendingUp size={16} />}
            elevated
          />
          <StatCard
            eyebrow="Hot"
            value={stats.byTemperature?.hot || 0}
            icon={<Flame size={16} />}
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
        <select
          value={filterTemperature}
          onChange={(e) => setFilterTemperature(e.target.value)}
          className="bg-paper border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
        >
          <option value="all">All Temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
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
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max h-full">
            {STAGES.map((stage) => {
              const leads = pipeline[stage.key] || [];
              return (
                <div
                  key={stage.key}
                  className="w-72 flex-shrink-0 flex flex-col bg-paper border border-hair-soft rounded-xl overflow-hidden"
                >
                  {/* Column header */}
                  <div className={`${stage.bgTint} border-b border-hair-soft`}>
                    {/* Color strip */}
                    <div className={`h-1 ${stage.color}`} />
                    <div className="px-4 py-3 flex items-center justify-between">
                      <h3 className="text-ink text-sm font-bold">{stage.label}</h3>
                      <span className="bg-tray text-ink-muted text-xs font-medium px-2 py-0.5 rounded-full">
                        {leads.length}
                      </span>
                    </div>
                  </div>

                  {/* Scrollable card list */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {leads.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="text-ink-dim text-xs">No leads</p>
                      </div>
                    ) : (
                      leads.map((lead) => (
                        <div
                          key={lead.id}
                          className={`bg-tray border border-hair-soft rounded-lg p-3.5 hover:border-hair-strong transition-all group ${
                            movingLead === lead.id ? 'opacity-50' : ''
                          }`}
                        >
                          {/* Clickable lead info */}
                          <div
                            className="cursor-pointer"
                            onClick={() => navigate(`/leads/${lead.id}`)}
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
                            {/* Temperature badge — clickable to cycle */}
                            {lead.temperature ? (
                              <button
                                onClick={() => handleTemperatureChange(lead)}
                                disabled={updatingTemp === lead.id}
                                className={`${getTemperatureStyle(lead.temperature).bg} ${getTemperatureStyle(lead.temperature).color} text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 hover:opacity-80 transition-all disabled:opacity-40`}
                                title="Click to change temperature"
                              >
                                {updatingTemp === lead.id ? (
                                  <Loader2 size={8} className="animate-spin" />
                                ) : (
                                  (() => {
                                    const { Icon } = getTemperatureStyle(lead.temperature!);
                                    return <Icon size={8} />;
                                  })()
                                )}
                                {getTemperatureStyle(lead.temperature).label}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleTemperatureChange(lead)}
                                disabled={updatingTemp === lead.id}
                                className="text-ink-dim text-[10px] px-2 py-0.5 rounded-full border border-hair-soft hover:border-hair-strong hover:text-ink-muted transition-all opacity-0 group-hover:opacity-100 disabled:opacity-40"
                                title="Set temperature"
                              >
                                {updatingTemp === lead.id ? (
                                  <Loader2 size={8} className="animate-spin" />
                                ) : (
                                  '+ Temp'
                                )}
                              </button>
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
