import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  X,
  CalendarX,
} from 'lucide-react';
import Glyph from '../components/ui/Glyph';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import PillButton from '../components/ui/PillButton';
import SectionHeading from '../components/ui/SectionHeading';
import StatCard from '../components/ui/StatCard';
import PanelCard from '../components/ui/PanelCard';
import PriorityRow from '../components/ui/PriorityRow';
import { useDialler } from '../hooks/useDiallerSession';
import * as api from '../services/api';
import type { ImportResult, DuplicateLead, Activity, Lead } from '../types';

// ── Pipeline stage display config ────────────────────────────
const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new_lead: { label: 'New Lead', color: '#55606a' },
  follow_up: { label: 'Follow Up', color: '#0a9cd4' },
  call_booked: { label: 'Call Booked', color: '#0b0d0e' },
  negotiation: { label: 'Negotiation', color: '#f59e0b' },
  won: { label: 'Won', color: '#10b981' },
  lost: { label: 'Lost', color: '#ef4444' },
  not_interested: { label: 'Not Interested', color: '#8a95a0' },
  five_strikes: { label: 'Five Strikes', color: '#b8bfc6' },
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
    todaysCallbacks: _todaysCallbacks,
    loadTodaysCallbacks,
  } = useDialler();

  const [pipelineStats, setPipelineStats] = useState<{
    byStage: Record<string, number>;
    conversionRate: number;
    totalPipelineValue: number;
    byTemperature: Record<string, number>;
  } | null>(null);
  const [recentActivities, setRecentActivities] = useState<
    (Activity & { leadName: string; leadCompany: string | null })[]
  >([]);
  const [callStats, setCallStats] = useState<{
    totalCalls: number;
    answered: number;
    interested: number;
    connectRate: number;
    interestedRate: number;
    avgDuration: number;
  } | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [followUpQueue, setFollowUpQueue] = useState<(Lead & { isOverdue: boolean })[]>([]);
  const [queueFilter, setQueueFilter] = useState<'all' | 'overdue' | 'due_today' | 'upcoming'>('all');
  const [removingLeadId, setRemovingLeadId] = useState<number | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    (ImportResult & { duplicateLeads?: DuplicateLead[] }) | null
  >(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importCategory, setImportCategory] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateLead, setShowCreateLead] = useState(searchParams.get('create') === 'lead');

  // Calendar connection state. `null` = not yet checked. Polled every 60s
  // server-side (which itself caches for 5 min). When we land back from
  // a successful OAuth callback (?googleAuth=success) we force-refresh
  // the cache and clear the stale chip immediately.
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
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

  // Calendar status — initial check, then poll every 60s. After an OAuth
  // success redirect we force a fresh check and clear the URL flag so the
  // chip disappears the moment Google honours the new tokens.
  useEffect(() => {
    let cancelled = false;
    const justAuthed = searchParams.get('googleAuth') === 'success';
    const check = async () => {
      try {
        const { authenticated } = await api.getGoogleAuthStatus({ force: justAuthed });
        if (!cancelled) setCalendarConnected(authenticated);
      } catch {
        // Network blip — leave the previous value rather than flicker.
      }
    };
    check();
    if (justAuthed) {
      searchParams.delete('googleAuth');
      setSearchParams(searchParams, { replace: true });
    }
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [searchParams, setSearchParams]);

  const handleReconnectCalendar = () => {
    window.open(api.buildGoogleAuthUrl('/'), '_blank');
    // Active poll while the new tab does its thing — every 3s for 2 min.
    const start = Date.now();
    const id = setInterval(async () => {
      try {
        const { authenticated } = await api.getGoogleAuthStatus({ force: true });
        if (authenticated) {
          setCalendarConnected(true);
          clearInterval(id);
        }
      } catch { /* ignore */ }
      if (Date.now() - start > 120_000) clearInterval(id);
    }, 3000);
  };

  useEffect(() => {
    loadTodaysCallbacks();

    const loadDashboard = async () => {
      setDashboardLoading(true);
      try {
        const [statsRes, activitiesRes, callStatsRes, followUpsRes] = await Promise.allSettled([
          api.getPipelineStats(),
          api.getRecentActivities(),
          fetch('/api/calls/stats?period=week').then((r) => r.json()),
          api.getFollowUpQueue(),
        ]);

        if (statsRes.status === 'fulfilled') setPipelineStats(statsRes.value);
        if (activitiesRes.status === 'fulfilled') setRecentActivities(activitiesRes.value);
        if (callStatsRes.status === 'fulfilled') setCallStats(callStatsRes.value);
        if (followUpsRes.status === 'fulfilled') setFollowUpQueue(followUpsRes.value);
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
      setImportError(err instanceof Error ? err.message : 'Failed to import leads');
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveFollowUp = async (leadId: number) => {
    setRemovingLeadId(leadId);
    try {
      await api.updateLead(leadId, { followUpDate: null });
      setFollowUpQueue((prev) => prev.filter((l) => l.id !== leadId));
    } catch (err) {
      console.error('Failed to remove from follow-up queue:', err);
    } finally {
      setRemovingLeadId(null);
    }
  };

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
      setCreateError(err instanceof Error ? err.message : 'Failed to create lead');
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

  const now = new Date();
  const greetingHour = now.getHours();
  const greeting =
    greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening';
  const dayLabel = now
    .toLocaleDateString('en-AU', { weekday: 'long' })
    .toUpperCase();
  const timeLabel = now.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const overdueLeads = followUpQueue.filter((l) => l.isOverdue);
  const today = new Date().toISOString().split('T')[0];
  const dueTodayLeads = followUpQueue.filter((l) => !l.isOverdue && l.followUpDate === today);
  const upcomingLeads = followUpQueue.filter(
    (l) => !l.isOverdue && l.followUpDate && l.followUpDate !== today
  );

  const highPriorityCount = overdueLeads.length + dueTodayLeads.length;

  const tempInputClass =
    'w-full bg-paper border border-hair-soft rounded-xl px-3.5 py-2.5 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-sky-hair focus:bg-paper transition-all';

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-cream">
      {/* Soft sky-wash halo at the top of the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-sky-wash via-transparent to-transparent"
      />

      <div className="relative max-w-[1280px] mx-auto px-10 py-10">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0">
              <EyebrowLabel variant="pill" className="mb-5">
                SALES · COMMAND CENTRE
              </EyebrowLabel>
              <SectionHeading size="hero" accent="pipeline.">
                Your
              </SectionHeading>
              <p className="mt-4 text-ink text-[17px] max-w-xl leading-relaxed">
                {highPriorityCount > 0
                  ? `${highPriorityCount} items need your attention today.`
                  : `${greeting} — no items overdue.`}
              </p>
            </div>

            {/* Live status pill */}
            <div className="hidden md:flex flex-col items-end gap-3 pt-3">
              <div className="inline-flex items-center gap-2 bg-paper border border-hair-soft rounded-full px-3 py-1.5">
                <Glyph size={10} pulse />
                <span className="font-mono text-[10.5px] font-semibold tracking-[0.22em] uppercase text-sky-ink">
                  Live
                </span>
              </div>
              <span className="font-mono text-[11px] text-ink-dim tracking-wider">
                {timeLabel} · {dayLabel}
              </span>
            </div>
          </div>

          {/* Action bar */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {/* Calendar reconnect chip — only when tokens have been
                revoked (Google's 7-day rule for unverified apps).
                Pushes itself to the right edge with ml-auto so it sits
                above the Avg Call stat without crowding the primary
                actions on the left. */}
            {calendarConnected === false && (
              <PillButton
                variant="outline"
                size="md"
                trailing="none"
                icon={<CalendarX size={16} className="text-warn" />}
                onClick={handleReconnectCalendar}
                className="order-last ml-auto border-[rgba(245,158,11,0.4)] text-warn hover:bg-[rgba(245,158,11,0.06)]"
              >
                Reconnect calendar
              </PillButton>
            )}

            {leads.length > 0 && (
              <PillButton
                variant="primary"
                size="md"
                icon={<Phone size={16} />}
                onClick={() => {
                  startSession('new');
                  navigate('/dialler');
                }}
              >
                Start Dialler ({leads.length})
              </PillButton>
            )}
            <PillButton
              variant="outline"
              size="md"
              trailing="none"
              icon={<UserPlus size={16} className="text-sky-ink" />}
              onClick={() => {
                const next = !showCreateLead;
                setShowCreateLead(next);
                setShowImport(false);
                setCreateResult(null);
                setCreateError(null);
                if (!next && searchParams.get('create') === 'lead') {
                  searchParams.delete('create');
                  setSearchParams(searchParams, { replace: true });
                }
              }}
            >
              Create lead
            </PillButton>
            <PillButton
              variant="outline"
              size="md"
              trailing="none"
              icon={<Upload size={16} className="text-ink-muted" />}
              onClick={() => {
                setShowImport(!showImport);
                setShowCreateLead(false);
              }}
            >
              Import CSV
            </PillButton>
          </div>
        </section>

        {/* ── Create Lead Panel (collapsible) ───────────────────── */}
        {showCreateLead && (
          <PanelCard
            className="mb-8"
            eyebrow="NEW LEAD"
            title="Create a lead"
            elevated
          >
            {createResult && (
              <div className="bg-sky-wash border border-sky-hair rounded-xl p-3.5 mb-4 flex items-start gap-2.5">
                <CheckCircle size={16} className="text-sky-ink mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sky-ink text-sm font-medium">
                    {createResult.leadName} added to queue
                  </p>
                  {createResult.temperature && (
                    <p className="text-ink-muted text-xs mt-0.5">
                      Temperature:{' '}
                      {createResult.temperature.charAt(0).toUpperCase() +
                        createResult.temperature.slice(1)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {createError && (
              <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.18)] rounded-xl p-3.5 mb-4 flex items-start gap-2.5">
                <AlertCircle size={14} className="text-risk mt-0.5 flex-shrink-0" />
                <p className="text-risk text-sm">{createError}</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 mb-4">
              {([
                { key: 'name', label: 'Name', placeholder: 'John Smith', required: true },
                { key: 'phone', label: 'Phone', placeholder: '0412 345 678', required: true },
                { key: 'company', label: 'Company', placeholder: 'Acme Corp', required: false },
              ] as const).map(({ key, label, placeholder, required }) => (
                <div key={key}>
                  <EyebrowLabel variant="bare" className="mb-2">
                    {label}
                    {required && <span className="text-sky-ink ml-1">*</span>}
                  </EyebrowLabel>
                  <input
                    type={key === 'phone' ? 'tel' : 'text'}
                    value={newLead[key]}
                    onChange={(e) =>
                      setNewLead((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className={tempInputClass}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5">
              {([
                { key: 'email', label: 'Email', placeholder: 'john@acme.com' },
                { key: 'website', label: 'Website', placeholder: 'acme.com' },
                { key: 'category', label: 'Category', placeholder: 'e.g. Recruitment' },
              ] as const).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <EyebrowLabel variant="bare" className="mb-2">
                    {label}
                  </EyebrowLabel>
                  <input
                    type={key === 'email' ? 'email' : 'text'}
                    value={newLead[key]}
                    onChange={(e) =>
                      setNewLead((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className={tempInputClass}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4 mb-6">
              <EyebrowLabel variant="bare">Temperature</EyebrowLabel>
              <div className="flex gap-2">
                {([
                  { value: 'hot', label: 'Hot', accent: 'text-risk bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)]' },
                  { value: 'warm', label: 'Warm', accent: 'text-warn bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.25)]' },
                  { value: 'cold', label: 'Cold', accent: 'text-sky-ink bg-sky-wash border-sky-hair' },
                ] as const).map(({ value, label, accent }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setCreateTemperature(createTemperature === value ? '' : value)
                    }
                    className={`px-4 py-1.5 rounded-full border text-sm font-medium transition-all ${
                      createTemperature === value
                        ? accent
                        : 'bg-paper border-hair-soft text-ink-dim hover:text-ink-muted hover:border-hair'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <PillButton
              variant="primary"
              size="md"
              icon={creating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              onClick={handleCreateLead}
              disabled={!newLead.name.trim() || !newLead.phone.trim() || creating}
            >
              {creating ? 'Creating…' : 'Add lead'}
            </PillButton>
          </PanelCard>
        )}

        {/* ── Import Panel (collapsible) ────────────────────────── */}
        {showImport && (
          <PanelCard
            className="mb-8"
            eyebrow="CSV IMPORT"
            title="Import leads from CSV"
            elevated
          >
            <div className="mb-4 max-w-md">
              <EyebrowLabel variant="bare" className="mb-2">
                Category (optional)
              </EyebrowLabel>
              <input
                type="text"
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
                placeholder="e.g. Recruitment, Property Styling, SaaS…"
                className={tempInputClass}
              />
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all max-w-lg ${
                isDragging
                  ? 'border-sky-ink bg-sky-wash'
                  : 'border-hair hover:border-sky-hair bg-tray'
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
              <Upload
                size={22}
                className={`mx-auto mb-2 ${isDragging ? 'text-sky-ink' : 'text-ink-dim'}`}
              />
              {selectedFile ? (
                <p className="text-ink text-sm font-medium">{selectedFile.name}</p>
              ) : (
                <>
                  <p className="text-ink-muted text-sm">Drop a CSV here, or click to browse</p>
                  <p className="text-ink-dim text-xs mt-1 font-mono tracking-wide">
                    columns · name · company · phone · email · category
                  </p>
                </>
              )}
            </div>

            <div className="mt-5">
              <PillButton
                variant="primary"
                size="md"
                icon={<Upload size={16} />}
                onClick={handleImport}
                disabled={!selectedFile || importing}
              >
                {importing ? 'Importing…' : 'Import leads'}
              </PillButton>
            </div>

            {importError && (
              <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.18)] rounded-xl p-3.5 mt-4">
                <p className="text-risk text-sm">{importError}</p>
              </div>
            )}

            {importResult && (
              <div className="bg-sky-wash border border-sky-hair rounded-xl p-3.5 mt-4">
                <p className="text-sky-ink text-sm font-medium">
                  {importResult.imported} leads imported
                </p>
                {importResult.skipped > 0 && (
                  <p className="text-ink-muted text-xs mt-1">{importResult.skipped} skipped</p>
                )}
                {importResult.duplicates > 0 && (
                  <p className="text-warn text-xs mt-1">
                    {importResult.duplicates} duplicates found
                  </p>
                )}
              </div>
            )}
          </PanelCard>
        )}

        {/* ── Stat row ─────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4 mb-10">
          <StatCard
            eyebrow="Total Leads"
            value={totalPipelineLeads}
            sub={
              highPriorityCount > 0 ? `${highPriorityCount} need attention` : 'All clear'
            }
            subTone={highPriorityCount > 0 ? 'sky' : 'neutral'}
            icon={<Users size={16} />}
            onClick={() => navigate('/pipeline')}
            elevated
          />
          <StatCard
            eyebrow="Calls this week"
            value={callStats?.totalCalls ?? 0}
            sub={
              callStats ? `${callStats.answered} answered` : '—'
            }
            icon={<PhoneCall size={16} />}
            onClick={() => navigate('/dashboard')}
            elevated
          />
          <StatCard
            eyebrow="Connect rate"
            value={`${callStats?.connectRate ?? 0}%`}
            sub={
              callStats
                ? `${callStats.interestedRate}% interested`
                : '—'
            }
            subTone="sky"
            icon={<TrendingUp size={16} />}
            elevated
          />
          <StatCard
            eyebrow="Avg call"
            value={callStats?.avgDuration ? formatDuration(callStats.avgDuration) : '0m'}
            sub={
              callStats && callStats.totalCalls > 0
                ? `across ${callStats.totalCalls} calls`
                : 'no data'
            }
            icon={<Clock size={16} />}
            elevated
          />
        </div>

        {/* ── Main grid: Pipeline + Follow-ups | Activity ───────── */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            {/* Pipeline Overview */}
            <PanelCard
              eyebrow="PIPELINE"
              title="Stage overview"
              elevated
              right={
                <button
                  onClick={() => navigate('/pipeline')}
                  className="text-sky-ink text-xs font-medium hover:underline inline-flex items-center gap-1"
                >
                  View pipeline <ArrowRight size={12} />
                </button>
              }
            >
              <div className="grid grid-cols-7 gap-4">
                {Object.entries(STAGE_CONFIG).map(([key, { label, color }]) => {
                  const count = pipelineStats?.byStage[key] ?? 0;
                  return (
                    <div key={key} className="min-w-0">
                      <p
                        className="text-[32px] font-medium leading-none tracking-tight"
                        style={{ color }}
                      >
                        {count}
                      </p>
                      <p className="mt-2 font-mono text-[10px] font-semibold tracking-[0.2em] uppercase text-ink-dim leading-tight">
                        {label}
                      </p>
                    </div>
                  );
                })}
              </div>

              {pipelineStats && pipelineStats.totalPipelineValue > 0 && (
                <div className="mt-6 pt-5 border-t border-hair-soft flex items-center justify-between">
                  <EyebrowLabel variant="bare">Pipeline value</EyebrowLabel>
                  <span className="text-ink font-medium text-[22px] tracking-tight">
                    ${pipelineStats.totalPipelineValue.toLocaleString('en-AU')}
                  </span>
                </div>
              )}
            </PanelCard>

            {/* Temperature */}
            {pipelineStats && (
              <PanelCard eyebrow="TEMPERATURE" title="Lead heat" elevated>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    {
                      key: 'hot',
                      label: 'Hot',
                      Icon: Flame,
                      tint: 'bg-[rgba(239,68,68,0.06)]',
                      border: 'border-[rgba(239,68,68,0.18)]',
                      text: 'text-risk',
                    },
                    {
                      key: 'warm',
                      label: 'Warm',
                      Icon: Thermometer,
                      tint: 'bg-[rgba(245,158,11,0.06)]',
                      border: 'border-[rgba(245,158,11,0.22)]',
                      text: 'text-warn',
                    },
                    {
                      key: 'cold',
                      label: 'Cold',
                      Icon: Snowflake,
                      tint: 'bg-[rgba(94,197,230,0.22)]',
                      border: 'border-[rgba(94,197,230,0.4)]',
                      text: 'text-sky-ink',
                    },
                  ] as const).map(({ key, label, Icon, tint, border, text }) => (
                    <div
                      key={key}
                      className={`${tint} ${border} border rounded-xl p-4 flex items-center justify-between`}
                    >
                      <div>
                        <p className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-dim">
                          {label}
                        </p>
                        <p className="mt-1.5 text-ink font-medium text-[28px] leading-none tracking-tight">
                          {pipelineStats.byTemperature[key] ?? 0}
                        </p>
                      </div>
                      <Icon size={24} className={text} />
                    </div>
                  ))}
                </div>
              </PanelCard>
            )}

            {/* Follow-Up Queue */}
            {followUpQueue.length > 0 && (
              <PanelCard
                eyebrow="FOLLOW-UPS"
                title="Today's queue"
                elevated={overdueLeads.length > 0}
                right={
                  <button
                    onClick={() => navigate('/pipeline')}
                    className="text-sky-ink text-xs font-medium hover:underline inline-flex items-center gap-1"
                  >
                    View all <ArrowRight size={12} />
                  </button>
                }
              >
                {/* Summary chips — clickable to filter. Click active chip again to clear. */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {overdueLeads.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setQueueFilter((curr) => (curr === 'overdue' ? 'all' : 'overdue'))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase transition-all border ${
                        queueFilter === 'overdue'
                          ? 'bg-risk text-white border-risk shadow-btn-hover'
                          : 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.22)] text-risk hover:bg-[rgba(239,68,68,0.14)]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${queueFilter === 'overdue' ? 'bg-white' : 'bg-risk'}`} />
                      {overdueLeads.length} overdue
                    </button>
                  )}
                  {dueTodayLeads.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setQueueFilter((curr) => (curr === 'due_today' ? 'all' : 'due_today'))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase transition-all border ${
                        queueFilter === 'due_today'
                          ? 'bg-warn text-white border-warn shadow-btn-hover'
                          : 'bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.24)] text-warn hover:bg-[rgba(245,158,11,0.14)]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${queueFilter === 'due_today' ? 'bg-white' : 'bg-warn'}`} />
                      {dueTodayLeads.length} due today
                    </button>
                  )}
                  {upcomingLeads.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setQueueFilter((curr) => (curr === 'upcoming' ? 'all' : 'upcoming'))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase transition-all border ${
                        queueFilter === 'upcoming'
                          ? 'bg-sky-ink text-white border-sky-ink shadow-btn-hover'
                          : 'bg-sky-wash border-sky-hair text-sky-ink hover:bg-[rgba(94,197,230,0.22)]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${queueFilter === 'upcoming' ? 'bg-white' : 'bg-sky-ink'}`} />
                      {upcomingLeads.length} upcoming
                    </button>
                  )}
                  {queueFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setQueueFilter('all')}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase text-ink-dim hover:text-ink border border-hair-soft hover:border-hair transition-all"
                    >
                      <X size={10} />
                      Clear
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {[
                    ...(queueFilter === 'all' || queueFilter === 'overdue'
                      ? overdueLeads.map((l) => ({ lead: l, tone: 'risk' as const }))
                      : []),
                    ...(queueFilter === 'all' || queueFilter === 'due_today'
                      ? dueTodayLeads.map((l) => ({ lead: l, tone: 'warn' as const }))
                      : []),
                    ...(queueFilter === 'all' || queueFilter === 'upcoming'
                      ? upcomingLeads.map((l) => ({ lead: l, tone: 'sky' as const }))
                      : []),
                  ].map(({ lead, tone }) => {
                    const daysOverdue = lead.followUpDate
                      ? Math.floor(
                          (Date.now() -
                            new Date(lead.followUpDate + 'T00:00:00').getTime()) /
                            86400000
                        )
                      : 0;
                    const dateFmt = lead.followUpDate
                      ? new Date(lead.followUpDate + 'T00:00:00').toLocaleDateString(
                          'en-AU',
                          { day: 'numeric', month: 'short' }
                        )
                      : 'No date';
                    const tag =
                      tone === 'risk'
                        ? `OVERDUE · ${daysOverdue} ${daysOverdue === 1 ? 'DAY' : 'DAYS'}`
                        : tone === 'warn'
                          ? 'DUE TODAY'
                          : lead.category
                            ? `UPCOMING · ${lead.category.toUpperCase()}`
                            : 'UPCOMING';

                    return (
                      <PriorityRow
                        key={lead.id}
                        tone={tone}
                        tag={tag}
                        title={
                          <span className="inline-flex items-center gap-2">
                            <span className="truncate">{lead.name}</span>
                            {lead.company && (
                              <span className="text-ink-muted font-normal">
                                · {lead.company}
                              </span>
                            )}
                          </span>
                        }
                        body={
                          lead.consolidatedSummary?.split('\n')[0]?.slice(0, 90) ||
                          'No prior notes'
                        }
                        onClick={() => navigate(`/leads/${lead.id}`)}
                        right={
                          <>
                            <span className="font-mono text-[11px] text-ink-dim tracking-wide">
                              {dateFmt}
                            </span>
                            <div className="flex flex-col items-stretch gap-1.5">
                              <PillButton
                                variant="primary"
                                size="sm"
                                trailing="none"
                                icon={<Phone size={13} />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/dialler', { state: { loadLeadId: lead.id } });
                                }}
                              >
                                Call
                              </PillButton>
                              <PillButton
                                variant="outline"
                                size="sm"
                                trailing="none"
                                icon={<X size={12} />}
                                disabled={removingLeadId === lead.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveFollowUp(lead.id);
                                }}
                              >
                                {removingLeadId === lead.id ? 'Removing…' : 'Remove'}
                              </PillButton>
                            </div>
                          </>
                        }
                      />
                    );
                  })}
                </div>
              </PanelCard>
            )}
          </div>

          {/* Right column: Activity feed + quick links */}
          <div className="col-span-1 space-y-4">
            <PanelCard eyebrow="ACTIVITY" title="Recent" elevated>
              {dashboardLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-ink-dim" />
                </div>
              ) : recentActivities.length === 0 ? (
                <p className="text-ink-dim text-sm text-center py-10">No recent activity</p>
              ) : (
                <div className="space-y-1 -mx-2">
                  {recentActivities.slice(0, 15).map((activity) => {
                    const Icon = ACTIVITY_ICONS[activity.type] || ActivityIcon;
                    return (
                      <button
                        key={activity.id}
                        onClick={() => navigate(`/leads/${activity.leadId}`)}
                        className="w-full text-left p-2.5 rounded-lg hover:bg-tray transition-all group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-sky-wash group-hover:bg-sky-hair flex items-center justify-center flex-shrink-0 mt-0.5 text-sky-ink">
                            <Icon size={13} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-ink text-[13px] font-medium truncate">
                              {activity.title}
                            </p>
                            <p className="text-ink-dim text-[11.5px] mt-0.5 truncate">
                              {activity.leadName}
                              {activity.leadCompany && ` · ${activity.leadCompany}`}
                            </p>
                            <p className="font-mono text-ink-faint text-[10px] mt-0.5 tracking-wide">
                              {formatTimeAgo(activity.createdAt)}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </PanelCard>

            <button
              onClick={() => navigate('/projects')}
              className="w-full bg-paper border border-sky-hair shadow-sky-elevated rounded-2xl p-5 flex items-center gap-4 hover:shadow-sky-strong transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-sky-wash text-sky-ink flex items-center justify-center">
                <FolderKanban size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink text-[15px] font-medium">Projects</p>
                <p className="text-ink-dim text-xs mt-0.5">Active jobs &amp; onboarding</p>
              </div>
              <ChevronRight size={16} className="text-sky-ink" />
            </button>
            <button
              onClick={() => navigate('/intelligence')}
              className="w-full bg-paper border border-sky-hair shadow-sky-elevated rounded-2xl p-5 flex items-center gap-4 hover:shadow-sky-strong transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-sky-wash text-sky-ink flex items-center justify-center">
                <TrendingUp size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink text-[15px] font-medium">Call intelligence</p>
                <p className="text-ink-dim text-xs mt-0.5">AI patterns across every call</p>
              </div>
              <ChevronRight size={16} className="text-sky-ink" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
