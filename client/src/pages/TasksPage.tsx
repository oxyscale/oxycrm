import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  CheckCircle2,
  ArrowRight,
  Trophy,
} from 'lucide-react';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import PanelCard from '../components/ui/PanelCard';
import * as api from '../services/api';
import type { TaskWithLead, TaskStats } from '../services/api';

type FilterTab = 'overdue' | 'due_today' | 'upcoming' | 'completed';

export default function TasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskWithLead[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('overdue');
  const [completingId, setCompletingId] = useState<number | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    try {
      const [allTasks, taskStats] = await Promise.all([
        api.getAllTasks(),
        api.getTaskStats(),
      ]);
      setTasks(allTasks);
      setStats(taskStats);

      // Auto-select first non-empty tab
      if (taskStats.overdue > 0) setActiveTab('overdue');
      else if (taskStats.dueToday > 0) setActiveTab('due_today');
      else if (taskStats.upcoming > 0) setActiveTab('upcoming');
      else setActiveTab('completed');
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleComplete = async (taskId: number) => {
    setCompletingId(taskId);
    try {
      await api.completeTask(taskId);
      // Reload to get fresh stats
      const [allTasks, taskStats] = await Promise.all([
        api.getAllTasks(),
        api.getTaskStats(),
      ]);
      setTasks(allTasks);
      setStats(taskStats);
    } catch (err) {
      console.error('Failed to complete task:', err);
    } finally {
      setCompletingId(null);
    }
  };

  // Filter tasks into buckets
  const overdueTasks = tasks.filter((t) => !t.completed && t.dueDate < today);
  const dueTodayTasks = tasks.filter((t) => !t.completed && t.dueDate === today);
  const upcomingTasks = tasks.filter((t) => !t.completed && t.dueDate > today);
  const completedTasks = tasks
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));

  const filteredTasks =
    activeTab === 'overdue' ? overdueTasks
    : activeTab === 'due_today' ? dueTodayTasks
    : activeTab === 'upcoming' ? upcomingTasks
    : completedTasks;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getDaysLabel = (dueDate: string) => {
    const diffMs = new Date(dueDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime();
    const days = Math.round(diffMs / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return '1 day overdue';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    return `In ${days} days`;
  };

  const tabs: { key: FilterTab; label: string; count: number; color: string; dotColor: string }[] = [
    {
      key: 'overdue',
      label: 'Overdue',
      count: stats?.overdue ?? 0,
      color: 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.22)] text-risk hover:bg-[rgba(239,68,68,0.14)]',
      dotColor: 'bg-risk',
    },
    {
      key: 'due_today',
      label: 'Due Today',
      count: stats?.dueToday ?? 0,
      color: 'bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.24)] text-warn hover:bg-[rgba(245,158,11,0.14)]',
      dotColor: 'bg-warn',
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      count: stats?.upcoming ?? 0,
      color: 'bg-sky-wash border-sky-hair text-sky-ink hover:bg-[rgba(94,197,230,0.22)]',
      dotColor: 'bg-sky-ink',
    },
    {
      key: 'completed',
      label: 'Completed',
      count: stats?.completedTotal ?? 0,
      color: 'bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.22)] text-ok hover:bg-[rgba(16,185,129,0.14)]',
      dotColor: 'bg-ok',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-full bg-cream flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-cream">
      {/* Soft halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-sky-wash via-transparent to-transparent"
      />

      <div className="relative max-w-[960px] mx-auto px-10 py-10">
        {/* Header */}
        <section className="mb-8">
          <div className="flex items-start justify-between gap-8">
            <div>
              <EyebrowLabel variant="pill" className="mb-5">
                TASK MANAGER
              </EyebrowLabel>
              <SectionHeading size="hero" accent="tasks.">
                Your
              </SectionHeading>
            </div>

            {/* Completed tally */}
            <div className="flex items-center gap-3 bg-paper border border-hair-soft rounded-2xl px-5 py-3.5 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-[rgba(16,185,129,0.12)] text-ok flex items-center justify-center">
                <Trophy size={18} />
              </div>
              <div>
                <p className="text-[28px] font-medium leading-none tracking-tight text-ink">
                  {stats?.completedTotal ?? 0}
                </p>
                <p className="font-mono text-[10px] font-semibold tracking-[0.2em] uppercase text-ink-dim mt-1">
                  Completed
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Filter tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {tabs.map(({ key, label, count, color, dotColor }) => {
            const isActive = activeTab === key;
            const activeStyles: Record<FilterTab, string> = {
              overdue: 'bg-risk text-white border-risk shadow-btn-hover',
              due_today: 'bg-warn text-white border-warn shadow-btn-hover',
              upcoming: 'bg-sky-ink text-white border-sky-ink shadow-btn-hover',
              completed: 'bg-ok text-white border-ok shadow-btn-hover',
            };
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase transition-all border ${
                  isActive ? activeStyles[key] : color
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : dotColor}`} />
                {count} {label}
              </button>
            );
          })}
        </div>

        {/* Task list */}
        <PanelCard elevated>
          {filteredTasks.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-ink-dim text-sm">
                {activeTab === 'overdue' && 'No overdue tasks. Nice work.'}
                {activeTab === 'due_today' && 'Nothing due today.'}
                {activeTab === 'upcoming' && 'No upcoming tasks scheduled.'}
                {activeTab === 'completed' && 'No tasks completed yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-hair-soft">
              {filteredTasks.map((task) => {
                const isOverdue = !task.completed && task.dueDate < today;
                const isDueToday = !task.completed && task.dueDate === today;
                const isCompleting = completingId === task.id;

                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-4 py-3.5 group"
                  >
                    {/* Complete / uncomplete button */}
                    <button
                      onClick={() => handleComplete(task.id)}
                      disabled={isCompleting}
                      className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                        task.completed
                          ? 'border-ok bg-ok text-white'
                          : isOverdue
                            ? 'border-risk/40 hover:border-risk hover:bg-[rgba(239,68,68,0.08)]'
                            : isDueToday
                              ? 'border-warn/40 hover:border-warn hover:bg-[rgba(245,158,11,0.08)]'
                              : 'border-hair-strong hover:border-sky-ink hover:bg-sky-wash'
                      }`}
                      title={task.completed ? 'Mark incomplete' : 'Complete task'}
                    >
                      {isCompleting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : task.completed ? (
                        <CheckCircle2 size={16} />
                      ) : null}
                    </button>

                    {/* Task info */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/leads/${task.leadId}`)}
                    >
                      <p className={`text-[14px] font-medium ${task.completed ? 'line-through text-ink-dim' : 'text-ink'}`}>
                        {task.label}
                      </p>
                      <p className="text-[12.5px] text-ink-muted mt-0.5 truncate">
                        {task.leadName}
                        {task.leadCompany && (
                          <span className="text-ink-dim"> · {task.leadCompany}</span>
                        )}
                      </p>
                    </div>

                    {/* Due date / status */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {!task.completed && (
                        <span
                          className={`font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase ${
                            isOverdue ? 'text-risk' : isDueToday ? 'text-warn' : 'text-ink-dim'
                          }`}
                        >
                          {getDaysLabel(task.dueDate)}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-ink-dim tracking-wide">
                        {formatDate(task.dueDate)}
                      </span>
                      <button
                        onClick={() => navigate(`/leads/${task.leadId}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-full bg-tray hover:bg-sky-wash flex items-center justify-center text-ink-dim hover:text-sky-ink"
                        title="Open lead"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
