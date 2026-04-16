import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderKanban,
  Plus,
  DollarSign,
  Loader2,
  X,
  Calendar,
} from 'lucide-react';
import * as api from '../services/api';
import type { Project, ProjectStatus, Lead } from '../types';

type FilterStatus = 'all' | ProjectStatus;

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bg: string }> = {
  onboarding: { label: 'Onboarding', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  in_progress: { label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-500/15' },
  review: { label: 'Review', color: 'text-purple-400', bg: 'bg-purple-500/15' },
  complete: { label: 'Complete', color: 'text-[#34d399]', bg: 'bg-[rgba(52,211,153,0.15)]' },
};

type ProjectWithCounts = Project & { totalTasks: number; completedTasks: number };

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showModal, setShowModal] = useState(false);

  // Modal form state
  const [formName, setFormName] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formLeadId, setFormLeadId] = useState<number | null>(null);
  const [wonLeads, setWonLeads] = useState<Lead[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [filter]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = filter === 'all' ? undefined : filter;
      const data = await api.getProjects(status);
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load projects. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openModal = async () => {
    setShowModal(true);
    try {
      const leads = await api.getLeads();
      setWonLeads(leads.filter((l) => l.pipelineStage === 'won'));
    } catch {
      // Non-critical, lead linking is optional
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setFormName('');
    setFormClient('');
    setFormValue('');
    setFormDescription('');
    setFormStartDate('');
    setFormLeadId(null);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formClient.trim()) return;
    setCreating(true);
    try {
      await api.createProject({
        name: formName.trim(),
        clientName: formClient.trim(),
        value: parseFloat(formValue) || 0,
        description: formDescription.trim() || undefined,
        startDate: formStartDate || undefined,
        leadId: formLeadId ?? undefined,
      });
      closeModal();
      loadProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  };

  // Stats calculations
  const activeProjects = projects.filter((p) => p.status !== 'complete');
  const completedProjects = projects.filter((p) => p.status === 'complete');
  const totalValue = activeProjects.reduce((sum, p) => sum + (p.value || 0), 0);
  const avgCompletion =
    activeProjects.length > 0
      ? Math.round(
          activeProjects.reduce((sum, p) => {
            if (p.totalTasks === 0) return sum;
            return sum + (p.completedTasks / p.totalTasks) * 100;
          }, 0) / activeProjects.filter((p) => p.totalTasks > 0).length || 0
        )
      : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const filteredProjects = filter === 'all' ? projects : projects.filter((p) => p.status === filter);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[#fafafa] text-2xl font-bold tracking-tight flex items-center gap-3">
            <FolderKanban size={24} className="text-[#34d399]" />
            Projects
          </h1>
          <p className="text-[#a1a1aa] text-sm mt-1">
            Manage client projects and track deliverables
          </p>
        </div>
        <button
          onClick={openModal}
          className="bg-[#34d399] text-[#09090b] font-bold rounded-xl px-5 py-2.5 hover:bg-[#34d399]/90 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
        >
          <Plus size={18} />
          New Project
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">
            Active Projects
          </p>
          <p className="text-[#fafafa] text-2xl font-bold">{activeProjects.length}</p>
        </div>
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">
            Total Value
          </p>
          <p className="text-[#34d399] text-2xl font-bold">{formatCurrency(totalValue)}</p>
        </div>
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">
            Completed
          </p>
          <p className="text-[#fafafa] text-2xl font-bold">{completedProjects.length}</p>
        </div>
        <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">
            Avg Completion
          </p>
          <p className="text-[#fafafa] text-2xl font-bold">{avgCompletion}%</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 mb-6 bg-[#18181b] border border-white/[0.06] rounded-lg p-1 w-fit">
        {(['all', 'onboarding', 'in_progress', 'review', 'complete'] as FilterStatus[]).map(
          (status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                filter === status
                  ? 'bg-[rgba(52,211,153,0.15)] text-[#34d399]'
                  : 'text-[#52525b] hover:text-[#a1a1aa]'
              }`}
            >
              {status === 'all'
                ? 'All'
                : STATUS_CONFIG[status as ProjectStatus].label}
            </button>
          )
        )}
      </div>

      {/* Project cards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#52525b]" />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button
            onClick={loadProjects}
            className="bg-[#34d399] text-[#09090b] font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-[#34d399]/90 transition-all"
          >
            Retry
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-16">
          <FolderKanban size={32} className="text-[#52525b] mx-auto mb-3" />
          <p className="text-[#a1a1aa] text-sm mb-1">
            {filter === 'all' ? 'No projects yet' : 'No projects with this status'}
          </p>
          <p className="text-[#52525b] text-xs mb-4">
            {filter === 'all'
              ? 'Convert a lead to create your first project.'
              : 'Try a different filter or create a new project.'}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => navigate('/pipeline')}
              className="bg-transparent text-[#a1a1aa] border border-white/[0.06] rounded-lg px-5 py-2.5 text-sm hover:bg-white/[0.03] hover:text-[#fafafa] transition-all"
            >
              View Pipeline
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filteredProjects.map((project) => {
            const cfg = STATUS_CONFIG[project.status];
            const progress =
              project.totalTasks > 0
                ? Math.round((project.completedTasks / project.totalTasks) * 100)
                : 0;

            return (
              <button
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="bg-[#18181b] border border-white/[0.06] rounded-xl p-5 text-left hover:bg-white/[0.02] hover:border-white/[0.1] transition-all group"
              >
                {/* Top row: name + status badge */}
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-[#fafafa] text-base font-bold group-hover:text-[#34d399] transition-colors truncate mr-3">
                    {project.name}
                  </h3>
                  <span
                    className={`${cfg.bg} ${cfg.color} text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0`}
                  >
                    {cfg.label}
                  </span>
                </div>

                {/* Client name */}
                <p className="text-[#a1a1aa] text-sm mb-3">{project.clientName}</p>

                {/* Value */}
                <div className="flex items-center gap-1.5 mb-3">
                  <DollarSign size={12} className="text-[#52525b]" />
                  <span className="text-[#fafafa] text-sm font-medium">
                    {formatCurrency(project.value)} AUD
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[#52525b] text-xs">
                      {project.completedTasks}/{project.totalTasks} tasks
                    </span>
                    <span className="text-[#52525b] text-xs">{progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-[#1f1f23] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#34d399] rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Start date */}
                <div className="flex items-center gap-1.5 text-[#52525b] text-xs">
                  <Calendar size={10} />
                  <span>Started {formatDate(project.startDate)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* New Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Modal */}
          <div className="relative bg-[#18181b] border border-white/[0.06] rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[#fafafa] text-lg font-bold">New Project</h2>
              <button
                onClick={closeModal}
                className="text-[#52525b] hover:text-[#a1a1aa] transition-colors p-1"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Website Redesign"
                  className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>

              <div>
                <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                  Client Name *
                </label>
                <input
                  type="text"
                  value={formClient}
                  onChange={(e) => setFormClient(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                    Value ($)
                  </label>
                  <input
                    type="number"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder="0"
                    className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#fafafa] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of the project..."
                  className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all resize-none"
                />
              </div>

              {wonLeads.length > 0 && (
                <div>
                  <label className="block text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">
                    Link to Lead (optional)
                  </label>
                  <select
                    value={formLeadId ?? ''}
                    onChange={(e) =>
                      setFormLeadId(e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="w-full bg-[#09090b] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-[#a1a1aa] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                  >
                    <option value="">No linked lead</option>
                    {wonLeads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name} {lead.company ? `(${lead.company})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-lg text-sm text-[#a1a1aa] border border-white/[0.06] hover:bg-white/[0.03] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formName.trim() || !formClient.trim() || creating}
                className="bg-[#34d399] text-[#09090b] font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-[#34d399]/90 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
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
