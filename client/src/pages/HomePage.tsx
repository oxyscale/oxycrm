import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Phone,
  Loader2,
  CheckCircle,
  AlertCircle,
  UserPlus,
  TrendingUp,
  Users,
  PhoneCall,
  ArrowRight,
  Flame,
  Thermometer,
  Snowflake,
  Clock,
  ChevronRight,
  FolderKanban,
  Mail,
  MessageSquare,
  Activity as ActivityIcon,
} from 'lucide-react';
import Logo from '../components/Logo';
import { useDialler } from '../hooks/useDiallerSession';
import * as api from '../services/api';
import type { ImportResult, DuplicateLead, Activity } from '../types';

// ── Pipeline stage display config ────────────────────────────
const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new_lead: { label: 'New Lead', color: '#a1a1aa' },
  follow_up: { label: 'Follow Up', color: '#60a5fa' },
  call_booked: { label: 'Call Booked', color: '#c084fc' },
  negotiation: { label: 'Negotiation', color: '#facc15' },
  won: { label: 'Won', color: '#34d399' },
  lost: { label: 'Lost', color: '#f87171' },
  not_interested: { label: 'Not Interested', color: '#a1a1aa' },
};

const ACTIVITY_ICONS: Record<string, typeof Phone> = {
  call: PhoneCall,
  email: Mail,
  note: MessageSquare,
  stage_change: TrendingUp,
  meeting: Clock,
  temperature_change: Thermometer,
};

export default function HomePage() {
  const navigate = useNavigate();
  const {
    setLeads,
    leads,
    startSession,
    todaysCallbacks,
    loadTodaysCallbacks,
  } = useDialler();

  // Dashboard data
  const [pipelineStats, setPipelineStats] = useState<{
    byStage: Record<string, number>;
    conversionRate: number;
    totalPipelineValue: number;
    byTemperature: Record<string, number>;
  } | null>(null);
  const [recentActivities, setRecentActivities] = useState<(Activity & { leadName: string; leadCompany: string | null })[]>([]);
  const [callStats, setCallStats] = useState<{
    totalCalls: number;
    answered: number;
    interested: number;
    connectRate: number;
    interestedRate: number;
    avgDuration: number;
  } | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // Import / Create state
  const [showImport, setShowImport] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<(ImportResult & { duplicateLeads?: DuplicateLead[] }) | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importCategory, setImportCategory] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create Lead state
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    website: '',
    category: '',
  });
  const [createTemperature, setCreateTemperature] = useState<'hot' | 'warm' | 'cold' | ''>('');
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{
    leadName: string;
    temperature?: string;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load dashboard data on mount
  useEffect(() => {
    loadTodaysCallbacks();

    const loadDashboard = async () => {
      setDashboardLoading(true);
      try {
        const [statsRes, activitiesRes, callStatsRes] = await Promise.allSettled([
          api.getPipelineStats(),
          api.getRecentActivities(),
          fetch('/api/calls/stats?period=week').then((r) => r.json()),
        ]);

        if (statsRes.status === 'fulfilled') setPipelineStats(statsRes.value);
        if (activitiesRes.status === 'fulfilled') setRecentActivities(activitiesRes.value);
        if (callStatsRes.status === 'fulfilled') setCallStats(callStatsRes.value);
      } catch {
        // Silently fail — dashboard still works with partial data
      } finally {
        setDashboardLoading(false);
      }
    };

    loadDashboard();
  }, [loadTodaysCallbacks]);

  // ── File handling ────────────────────────────────────────────

  const handleFileSelect = useCallback((file: File) => {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setImportError('Please select a CSV file');
      return;
    }
    setSelectedFile(file);
    setImportError(null);
    setImportResult(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleImport = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setImportError(null);

    try {
      const result = await api.importLeadsCSV(selectedFile, 'new', importCategory || undefined);
      setImportResult(result);

      const freshLeads = await api.getLeads({ status: 'not_called' });
      setLeads(freshLeads);

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to import leads'
      );
    } finally {
      setImporting(false);
    }
  };

  // ── Create Lead ──────────────────────────────────────────────

  const handleCreateLead = async () => {
    if (!newLead.name.trim() || !newLead.phone.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);

    try {
      const created = await api.createLead({
        name: newLead.name.trim(),
        phone: newLead.phone.trim(),
        company: newLead.company.trim() || undefined,
        email: newLead.email.trim() || undefined,
        website: newLead.website.trim() || undefined,
        category: newLead.category.trim() || undefined,
        temperature: createTemperature || undefined,
        pipelineStage: createTemperature ? 'follow_up' : undefined,
      });

      setCreateResult({
        leadName: created.name,
        temperature: createTemperature || undefined,
      });

      setNewLead({ name: '', company: '', phone: '', email: '', website: '', category: '' });
      setCreateTemperature('');

      const freshLeads = await api.getLeads({ status: 'not_called' });
      setLeads(freshLeads);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create lead'
      );
    } finally {
      setCreating(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const totalPipelineLeads = pipelineStats
    ? Object.values(pipelineStats.byStage).reduce((a, b) => a + b, 0)
    : 0;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Logo variant="full" className="text-3xl" />
          <p className="text-[#a1a1aa] mt-1">Sales CRM</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowCreateLead(!showCreateLead);
              setShowImport(false);
              setCreateResult(null);
              setCreateError(null);
            }}
            className="bg-[#18181b] border border-white/[0.06] text-[#fafafa] font-medium text-sm rounded-lg px-4 py-2.5 hover:bg-[#1f1f23] transition-all flex items-center gap-2"
          >
            <UserPlus size={16} className="text-[#34d399]" />
            Create Lead
          </button>
          <button
            onClick={() => {
              setShowImport(!showImport);
              setShowCreateLead(false);
            }}
            className="bg-[#18181b] border border-white/[0.06] text-[#fafafa] font-medium text-sm rounded-lg px-4 py-2.5 hover:bg-[#1f1f23] transition-all flex items-center gap-2"
          >
            <Upload size={16} className="text-[#a1a1aa]" />
            Import CSV
          </button>
          {leads.length > 0 && (
            <button
              onClick={() => {
                startSession('new');
                navigate('/dialler');
              }}
              className="bg-[#34d399] text-[#09090b] font-bold text-sm rounded-lg px-5 py-2.5 hover:bg-[#34d399]/90 transition-all flex items-center gap-2"
            >
              <Phone size={16} />
              Start Dialler ({leads.length})
            </button>
          )}
        </div>
      </div>

      {/* Create Lead Panel (collapsible) */}
      {showCreateLead && (
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6 mb-6">
          <h3 className="text-[#fafafa] font-bold text-sm mb-4 flex items-center gap-2">
            <UserPlus size={16} className="text-[#34d399]" />
            Create New Lead
          </h3>

          {createResult && (
            <div className="bg-[rgba(52,211,153,0.1)] border border-[rgba(52,211,153,0.2)] rounded-lg p-3 mb-4 flex items-start gap-2">
              <CheckCircle size={16} className="text-[#34d399] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[#34d399] text-sm font-medium">
                  {createResult.leadName} added to queue
                </p>
                {createResult.temperature && (
                  <p className="text-[#a1a1aa] text-xs mt-0.5">
                    Temperature: {createResult.temperature.charAt(0).toUpperCase() + createResult.temperature.slice(1)}
                  </p>
                )}
              </div>
            </div>
          )}

          {createError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-red-400 text-sm">{createError}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Name *</label>
              <input
                type="text"
                value={newLead.name}
                onChange={(e) => setNewLead((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="John Smith"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Phone *</label>
              <input
                type="tel"
                value={newLead.phone}
                onChange={(e) => setNewLead((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="0412 345 678"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Company</label>
              <input
                type="text"
                value={newLead.company}
                onChange={(e) => setNewLead((prev) => ({ ...prev, company: e.target.value }))}
                placeholder="Acme Corp"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Email</label>
              <input
                type="email"
                value={newLead.email}
                onChange={(e) => setNewLead((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="john@acme.com"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Website</label>
              <input
                type="text"
                value={newLead.website}
                onChange={(e) => setNewLead((prev) => ({ ...prev, website: e.target.value }))}
                placeholder="acme.com"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
            <div>
              <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">Category</label>
              <input
                type="text"
                value={newLead.category}
                onChange={(e) => setNewLead((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="e.g. Recruitment"
                className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all"
              />
            </div>
          </div>

          {/* Temperature */}
          <div className="flex items-center gap-4 mb-5">
            <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider">Temperature</label>
            <div className="flex gap-2">
              {([
                { value: 'hot', label: 'Hot', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
                { value: 'warm', label: 'Warm', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
                { value: 'cold', label: 'Cold', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
              ] as const).map(({ value, label, color, bg, border }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCreateTemperature(createTemperature === value ? '' : value)}
                  className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    createTemperature === value
                      ? `${bg} ${border} ${color}`
                      : 'bg-[#1f1f23] border-white/[0.06] text-[#52525b] hover:text-[#a1a1aa]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreateLead}
            disabled={!newLead.name.trim() || !newLead.phone.trim() || creating}
            className="bg-[#34d399] text-[#09090b] font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-[#34d399]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {creating ? 'Creating...' : 'Add Lead'}
          </button>
        </div>
      )}

      {/* Import Panel (collapsible) */}
      {showImport && (
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6 mb-6">
          <h3 className="text-[#fafafa] font-bold text-sm mb-4 flex items-center gap-2">
            <Upload size={16} className="text-[#a1a1aa]" />
            Import Leads from CSV
          </h3>

          <div className="mb-4">
            <label className="text-[#52525b] text-xs font-medium uppercase tracking-wider block mb-1.5">
              Category (optional)
            </label>
            <input
              type="text"
              value={importCategory}
              onChange={(e) => setImportCategory(e.target.value)}
              placeholder="e.g. Recruitment, Property Styling, SaaS..."
              className="w-full bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-2 text-[#fafafa] text-sm placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.4)] transition-all max-w-md"
            />
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 max-w-lg ${
              isDragging
                ? 'border-[#34d399] bg-[rgba(52,211,153,0.05)]'
                : 'border-white/[0.06] hover:border-white/[0.12] bg-[#1f1f23]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="hidden"
            />
            <Upload size={20} className={`mx-auto mb-2 ${isDragging ? 'text-[#34d399]' : 'text-[#52525b]'}`} />
            {selectedFile ? (
              <p className="text-[#fafafa] text-sm font-medium">{selectedFile.name}</p>
            ) : (
              <>
                <p className="text-[#a1a1aa] text-sm">Drop a CSV file here, or click to browse</p>
                <p className="text-[#52525b] text-xs mt-1">Columns: name, company, phone, email, category</p>
              </>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={!selectedFile || importing}
            className="bg-[#34d399] text-[#09090b] font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-[#34d399]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 mt-4"
          >
            <Upload size={16} />
            {importing ? 'Importing...' : 'Import Leads'}
          </button>

          {importError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-4">
              <p className="text-red-400 text-sm">{importError}</p>
            </div>
          )}

          {importResult && (
            <div className="bg-[rgba(52,211,153,0.1)] border border-[rgba(52,211,153,0.2)] rounded-lg p-3 mt-4">
              <p className="text-[#34d399] text-sm font-medium">{importResult.imported} leads imported</p>
              {importResult.skipped > 0 && (
                <p className="text-[#a1a1aa] text-xs mt-1">{importResult.skipped} skipped</p>
              )}
              {importResult.duplicates > 0 && (
                <p className="text-amber-400 text-xs mt-1">{importResult.duplicates} duplicates found</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Stats Row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {/* Total Leads */}
        <div
          onClick={() => navigate('/pipeline')}
          className="bg-[#18181b] border border-white/[0.06] rounded-xl p-5 cursor-pointer hover:border-white/[0.12] transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg bg-[rgba(52,211,153,0.1)] flex items-center justify-center">
              <Users size={18} className="text-[#34d399]" />
            </div>
            <ChevronRight size={16} className="text-[#52525b] group-hover:text-[#a1a1aa] transition-colors" />
          </div>
          <p className="text-[#fafafa] text-2xl font-bold">{totalPipelineLeads}</p>
          <p className="text-[#52525b] text-xs mt-1">Total Leads</p>
        </div>

        {/* Calls This Week */}
        <div
          onClick={() => navigate('/dashboard')}
          className="bg-[#18181b] border border-white/[0.06] rounded-xl p-5 cursor-pointer hover:border-white/[0.12] transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg bg-[rgba(96,165,250,0.1)] flex items-center justify-center">
              <PhoneCall size={18} className="text-[#60a5fa]" />
            </div>
            <ChevronRight size={16} className="text-[#52525b] group-hover:text-[#a1a1aa] transition-colors" />
          </div>
          <p className="text-[#fafafa] text-2xl font-bold">{callStats?.totalCalls ?? 0}</p>
          <p className="text-[#52525b] text-xs mt-1">Calls This Week</p>
        </div>

        {/* Connect Rate */}
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg bg-[rgba(250,204,21,0.1)] flex items-center justify-center">
              <TrendingUp size={18} className="text-[#facc15]" />
            </div>
          </div>
          <p className="text-[#fafafa] text-2xl font-bold">{callStats?.connectRate ?? 0}%</p>
          <p className="text-[#52525b] text-xs mt-1">Connect Rate</p>
        </div>

        {/* Avg Duration */}
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg bg-[rgba(192,132,252,0.1)] flex items-center justify-center">
              <Clock size={18} className="text-[#c084fc]" />
            </div>
          </div>
          <p className="text-[#fafafa] text-2xl font-bold">{callStats?.avgDuration ? formatDuration(callStats.avgDuration) : '0m'}</p>
          <p className="text-[#52525b] text-xs mt-1">Avg Call Duration</p>
        </div>
      </div>

      {/* Main Grid: Pipeline + Temperature | Activity Feed */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Left: Pipeline Summary + Temperature */}
        <div className="col-span-2 space-y-6">
          {/* Pipeline Summary */}
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[#fafafa] font-bold text-sm tracking-tight">Pipeline Overview</h2>
              <button
                onClick={() => navigate('/pipeline')}
                className="text-[#34d399] text-xs font-medium hover:underline flex items-center gap-1"
              >
                View Pipeline <ArrowRight size={12} />
              </button>
            </div>

            <div className="grid grid-cols-6 gap-3">
              {Object.entries(STAGE_CONFIG).map(([key, { label, color }]) => {
                const count = pipelineStats?.byStage[key] ?? 0;
                return (
                  <div key={key} className="text-center">
                    <p className="text-[#fafafa] text-xl font-bold" style={{ color }}>
                      {count}
                    </p>
                    <p className="text-[#52525b] text-[10px] mt-1 uppercase tracking-wider">{label}</p>
                  </div>
                );
              })}
            </div>

            {/* Pipeline value */}
            {pipelineStats && pipelineStats.totalPipelineValue > 0 && (
              <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-[#52525b] text-xs">Total Pipeline Value</span>
                <span className="text-[#34d399] font-bold text-sm">
                  ${pipelineStats.totalPipelineValue.toLocaleString('en-AU')}
                </span>
              </div>
            )}
          </div>

          {/* Temperature Breakdown */}
          {pipelineStats && (
            <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6">
              <h2 className="text-[#fafafa] font-bold text-sm tracking-tight mb-4">Lead Temperature</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-4 text-center">
                  <Flame size={20} className="text-red-400 mx-auto mb-2" />
                  <p className="text-[#fafafa] text-2xl font-bold">{pipelineStats.byTemperature.hot ?? 0}</p>
                  <p className="text-red-400 text-xs mt-1">Hot</p>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4 text-center">
                  <Thermometer size={20} className="text-amber-400 mx-auto mb-2" />
                  <p className="text-[#fafafa] text-2xl font-bold">{pipelineStats.byTemperature.warm ?? 0}</p>
                  <p className="text-amber-400 text-xs mt-1">Warm</p>
                </div>
                <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 text-center">
                  <Snowflake size={20} className="text-blue-400 mx-auto mb-2" />
                  <p className="text-[#fafafa] text-2xl font-bold">{pipelineStats.byTemperature.cold ?? 0}</p>
                  <p className="text-blue-400 text-xs mt-1">Cold</p>
                </div>
              </div>
            </div>
          )}

          {/* Today's Callbacks */}
          {todaysCallbacks.length > 0 && (
            <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[#fafafa] font-bold text-sm tracking-tight flex items-center gap-2">
                  Today's Callbacks
                  <span className="bg-[rgba(52,211,153,0.15)] text-[#34d399] text-xs font-medium px-2 py-0.5 rounded-full">
                    {todaysCallbacks.length}
                  </span>
                </h2>
              </div>

              <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                {todaysCallbacks.map((cb) => (
                  <div
                    key={cb.id}
                    className="bg-[#1f1f23] rounded-lg p-4 flex items-center justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[#fafafa] font-medium text-sm truncate">{cb.lead.name}</span>
                        {cb.lead.category && (
                          <span className="bg-[rgba(52,211,153,0.15)] text-[#34d399] text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0">
                            {cb.lead.category}
                          </span>
                        )}
                      </div>
                      <p className="text-[#52525b] text-xs mt-0.5">
                        {cb.lead.company || 'No company'} — {cb.lead.phone}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        startSession('callback');
                        navigate('/dialler');
                      }}
                      className="bg-[#34d399] text-[#09090b] font-bold text-xs rounded-lg px-3 py-1.5 hover:bg-[#34d399]/90 transition-all flex-shrink-0 flex items-center gap-1"
                    >
                      <Phone size={12} />
                      Call
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Recent Activity Feed */}
        <div className="col-span-1">
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-[#fafafa] font-bold text-sm tracking-tight mb-4 flex items-center gap-2">
              <ActivityIcon size={16} className="text-[#a1a1aa]" />
              Recent Activity
            </h2>

            {dashboardLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#52525b]" />
              </div>
            ) : recentActivities.length === 0 ? (
              <p className="text-[#52525b] text-sm text-center py-8">No recent activity</p>
            ) : (
              <div className="space-y-1">
                {recentActivities.slice(0, 15).map((activity) => {
                  const Icon = ACTIVITY_ICONS[activity.type] || ActivityIcon;
                  return (
                    <button
                      key={activity.id}
                      onClick={() => navigate(`/leads/${activity.leadId}`)}
                      className="w-full text-left p-3 rounded-lg hover:bg-[#1f1f23] transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full bg-[#1f1f23] group-hover:bg-[#18181b] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Icon size={13} className="text-[#52525b]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[#fafafa] text-xs font-medium truncate">
                            {activity.title}
                          </p>
                          <p className="text-[#52525b] text-[11px] mt-0.5 truncate">
                            {activity.leadName}
                            {activity.leadCompany && ` at ${activity.leadCompany}`}
                          </p>
                          <p className="text-[#52525b]/60 text-[10px] mt-0.5">
                            {formatTimeAgo(activity.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="mt-4 space-y-2">
            <button
              onClick={() => navigate('/projects')}
              className="w-full bg-[#18181b] border border-white/[0.06] rounded-xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-all group text-left"
            >
              <FolderKanban size={18} className="text-[#a1a1aa]" />
              <div>
                <p className="text-[#fafafa] text-sm font-medium">Projects</p>
                <p className="text-[#52525b] text-xs">Manage active jobs</p>
              </div>
              <ChevronRight size={14} className="text-[#52525b] ml-auto group-hover:text-[#a1a1aa]" />
            </button>
            <button
              onClick={() => navigate('/intelligence')}
              className="w-full bg-[#18181b] border border-white/[0.06] rounded-xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-all group text-left"
            >
              <TrendingUp size={18} className="text-[#a1a1aa]" />
              <div>
                <p className="text-[#fafafa] text-sm font-medium">Call Intelligence</p>
                <p className="text-[#52525b] text-xs">AI-powered insights</p>
              </div>
              <ChevronRight size={14} className="text-[#52525b] ml-auto group-hover:text-[#a1a1aa]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
