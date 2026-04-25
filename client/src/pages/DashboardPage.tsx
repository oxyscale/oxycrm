import { useState, useEffect } from 'react';
import {
  Phone,
  PhoneIncoming,
  ThumbsUp,
  ThumbsDown,
  Clock,
  TrendingUp,
  Voicemail,
  PhoneMissed,
  Loader2,
} from 'lucide-react';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

interface CallStats {
  totalCalls: number;
  answered: number;
  noAnswer: number;
  voicemails: number;
  interested: number;
  notInterested: number;
  connectRate: number;
  interestedRate: number;
  avgDuration: number;
  bestHour: number | null;
  hourlyBreakdown: { hour: number; count: number; interested_count: number }[];
}

type Period = 'today' | 'week' | 'month' | 'all';

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today');
  const [stats, setStats] = useState<CallStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/calls/stats?period=${period}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const formatHour = (hour: number): string => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  const periodLabels: Record<Period, string> = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    all: 'All Time',
  };

  return (
    <div className="p-10 max-w-5xl mx-auto min-h-full bg-cream">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            ANALYTICS · STATS
          </EyebrowLabel>
          <SectionHeading size="section">Performance.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3">
            Your calling performance at a glance.
          </p>
        </div>

        {/* Period toggle */}
        <div className="flex gap-1 bg-paper border border-hair-soft rounded-lg p-1">
          {(['today', 'week', 'month', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                period === p
                  ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                  : 'text-ink-dim hover:text-ink-muted'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {loading || !stats ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-sky-ink" />
        </div>
      ) : (
        <>
          {/* Top stats grid */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={Phone}
              label="Total Calls"
              value={stats.totalCalls.toString()}
              accent={false}
            />
            <StatCard
              icon={PhoneIncoming}
              label="Connect Rate"
              value={`${stats.connectRate}%`}
              subtitle={`${stats.answered} answered`}
              accent={false}
            />
            <StatCard
              icon={TrendingUp}
              label="Interested Rate"
              value={`${stats.interestedRate}%`}
              subtitle={`${stats.interested} interested`}
              accent={true}
            />
            <StatCard
              icon={Clock}
              label="Avg Duration"
              value={formatDuration(stats.avgDuration)}
              accent={false}
            />
          </div>

          {/* Disposition breakdown */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            {/* Left — breakdown */}
            <div className="bg-paper border border-hair-soft rounded-xl p-6">
              <h3 className="text-ink text-sm font-bold mb-5">
                Call Outcomes
              </h3>
              <div className="space-y-4">
                <OutcomeRow
                  icon={ThumbsUp}
                  label="Interested"
                  count={stats.interested}
                  total={stats.totalCalls}
                  color="#0a9cd4"
                />
                <OutcomeRow
                  icon={ThumbsDown}
                  label="Not Interested"
                  count={stats.notInterested}
                  total={stats.totalCalls}
                  color="#f87171"
                />
                <OutcomeRow
                  icon={PhoneMissed}
                  label="No Answer"
                  count={stats.noAnswer}
                  total={stats.totalCalls}
                  color="#55606a"
                />
                <OutcomeRow
                  icon={Voicemail}
                  label="Voicemail"
                  count={stats.voicemails}
                  total={stats.totalCalls}
                  color="#fbbf24"
                />
              </div>
            </div>

            {/* Right — best time + hourly chart */}
            <div className="bg-paper border border-hair-soft rounded-xl p-6">
              <h3 className="text-ink text-sm font-bold mb-5">
                Calling Activity
              </h3>

              {stats.bestHour !== null && (
                <div className="bg-[rgba(10,156,212,0.08)] border border-[rgba(10,156,212,0.15)] rounded-lg p-4 mb-5">
                  <p className="text-ink-muted text-xs uppercase tracking-wider mb-1">
                    Best time for connects
                  </p>
                  <p className="text-sky-ink text-lg font-bold">
                    {formatHour(stats.bestHour)}
                  </p>
                </div>
              )}

              {/* Simple hourly bar chart */}
              {stats.hourlyBreakdown.length > 0 ? (
                <div className="space-y-2">
                  {stats.hourlyBreakdown.map((h) => {
                    const maxCount = Math.max(
                      ...stats.hourlyBreakdown.map((x) => x.count)
                    );
                    const width = maxCount > 0 ? (h.count / maxCount) * 100 : 0;
                    return (
                      <div key={h.hour} className="flex items-center gap-3">
                        <span className="text-ink-dim text-xs w-12 text-right font-mono">
                          {formatHour(h.hour)}
                        </span>
                        <div className="flex-1 h-5 bg-tray rounded overflow-hidden">
                          <div
                            className="h-full bg-ink/30 rounded relative"
                            style={{ width: `${width}%` }}
                          >
                            {h.interested_count > 0 && (
                              <div
                                className="absolute left-0 top-0 h-full bg-ink rounded"
                                style={{
                                  width: `${(h.interested_count / h.count) * 100}%`,
                                }}
                              />
                            )}
                          </div>
                        </div>
                        <span className="text-ink-muted text-xs w-6 font-mono">
                          {h.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-ink-dim text-sm italic">
                  No call data for this period yet
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accent,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  subtitle?: string;
  accent: boolean;
}) {
  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon
          size={16}
          className={accent ? 'text-sky-ink' : 'text-ink-dim'}
        />
        <span className="text-ink-dim text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p
        className={`text-2xl font-bold tracking-tight ${
          accent ? 'text-sky-ink' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-ink-dim text-xs mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function OutcomeRow({
  icon: Icon,
  label,
  count,
  total,
  color,
}: {
  icon: typeof Phone;
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} style={{ color }} />
      <span className="text-ink-muted text-sm flex-1">{label}</span>
      <span className="text-ink text-sm font-medium w-8 text-right">
        {count}
      </span>
      <div className="w-24 h-2 bg-tray rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-ink-dim text-xs w-10 text-right">{pct}%</span>
    </div>
  );
}
