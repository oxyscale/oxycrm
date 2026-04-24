import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  ExternalLink,
  FolderKanban,
  Plus,
  Trash2,
  Check,
  Loader2,
  Pencil,
} from 'lucide-react';
import * as api from '../services/api';
import type { Project, ProjectTask, ProjectStatus } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';

const STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  onboarding: {
    label: 'Onboarding',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
  },
  review: {
    label: 'Review',
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
  },
  complete: {
    label: 'Complete',
    color: 'text-sky-ink',
    bg: 'bg-[rgba(10,156,212,0.15)]',
    border: 'border-[rgba(10,156,212,0.3)]',
  },
};

const STATUS_ORDER: ProjectStatus[] = ['onboarding', 'in_progress', 'review', 'complete'];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New task input
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // Inline task editing
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Description editing
  const [description, setDescription] = useState('');
  const [descriptionDirty, setDescriptionDirty] = useState(false);

  // Notes editing
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  // Status updating
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (id) loadProject(parseInt(id));
  }, [id]);

  useEffect(() => {
    if (editingTaskId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTaskId]);

  const loadProject = async (projectId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      setTasks(data.tasks || []);
      setDescription(data.description || '');
      setNotes((data as Project & { notes?: string }).notes || '');
    } catch (err) {
      console.error('Failed to load project:', err);
      setError('Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    if (!project || newStatus === project.status) return;
    setUpdatingStatus(true);
    try {
      const updated = await api.updateProject(project.id, { status: newStatus });
      setProject(updated);
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDescriptionBlur = async () => {
    if (!project || !descriptionDirty) return;
    setDescriptionDirty(false);
    try {
      await api.updateProject(project.id, { description: description || null });
    } catch (err) {
      console.error('Failed to save description:', err);
    }
  };

  const handleNotesBlur = async () => {
    if (!project || !notesDirty) return;
    setNotesDirty(false);
    try {
      await api.updateProject(project.id, { notes } as Partial<Project>);
    } catch (err) {
      console.error('Failed to save notes:', err);
    }
  };

  const handleAddTask = async () => {
    if (!project || !newTaskTitle.trim()) return;
    setAddingTask(true);
    try {
      const task = await api.addProjectTask(project.id, newTaskTitle.trim());
      setTasks((prev) => [...prev, task]);
      setNewTaskTitle('');
    } catch (err) {
      console.error('Failed to add task:', err);
    } finally {
      setAddingTask(false);
    }
  };

  const handleToggleTask = async (task: ProjectTask) => {
    if (!project) return;
    try {
      const updated = await api.updateProjectTask(project.id, task.id, {
        completed: !task.completed,
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const handleStartEditTask = (task: ProjectTask) => {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
  };

  const handleSaveEditTask = async () => {
    if (!project || editingTaskId === null || !editingTaskTitle.trim()) {
      setEditingTaskId(null);
      return;
    }
    try {
      const updated = await api.updateProjectTask(project.id, editingTaskId, {
        title: editingTaskTitle.trim(),
      });
      setTasks((prev) => prev.map((t) => (t.id === editingTaskId ? updated : t)));
    } catch (err) {
      console.error('Failed to update task:', err);
    } finally {
      setEditingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!project) return;
    try {
      await api.deleteProjectTask(project.id, taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <button
          onClick={() => navigate('/projects')}
          className="flex items-center gap-2 text-ink-muted hover:text-ink transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Back to Projects</span>
        </button>
        <div className="text-center py-16">
          <FolderKanban size={32} className="text-ink-dim mx-auto mb-3" />
          <p className="text-red-400 text-sm mb-1">{error || 'Project not found'}</p>
          <p className="text-ink-dim text-xs mb-4">
            {error ? 'Something went wrong loading this project.' : 'This project may have been deleted or the link is invalid.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            {error && (
              <button
                onClick={() => id && loadProject(parseInt(id))}
                className="bg-ink text-white font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-ink/90 transition-all"
              >
                Retry
              </button>
            )}
            <button
              onClick={() => navigate('/projects')}
              className="bg-transparent text-ink-muted border border-hair-soft rounded-lg px-5 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
            >
              Back to Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[project.status];
  const incompleteTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);
  const completedCount = completedTasks.length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="p-10 max-w-4xl min-h-full bg-cream">
      {/* Back button */}
      <button
        onClick={() => navigate('/projects')}
        className="flex items-center gap-2 text-ink-muted hover:text-sky-ink transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        <span className="text-sm">Back to Projects</span>
      </button>

      {/* Header */}
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          DELIVERY · PROJECT
        </EyebrowLabel>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-sky-ink text-[34px] font-semibold tracking-section">{project.name}</h1>
          <span
            className={`${cfg.bg} ${cfg.color} text-xs font-medium px-2.5 py-0.5 rounded-full`}
          >
            {cfg.label}
          </span>
        </div>
        <p className="text-ink-muted text-sm">{project.clientName}</p>
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-6 mb-6 bg-paper border border-hair-soft rounded-xl px-5 py-3">
        <div className="flex items-center gap-1.5">
          <DollarSign size={14} className="text-ink-dim" />
          <span className="text-ink text-sm font-medium">
            {formatCurrency(project.value)} AUD
          </span>
        </div>
        <div className="w-px h-4 bg-hair-soft" />
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-ink-dim" />
          <span className="text-ink-muted text-sm">
            Start: {formatDate(project.startDate)}
          </span>
        </div>
        <div className="w-px h-4 bg-hair-soft" />
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-ink-dim" />
          <span className="text-ink-muted text-sm">
            End: {formatDate(project.endDate)}
          </span>
        </div>
        {project.leadId && (
          <>
            <div className="w-px h-4 bg-hair-soft" />
            <button
              onClick={() => navigate(`/leads?highlight=${project.leadId}`)}
              className="flex items-center gap-1.5 text-sky-ink text-sm hover:underline"
            >
              <ExternalLink size={12} />
              View Lead
            </button>
          </>
        )}
      </div>

      {/* Status selector */}
      <div className="mb-8">
        <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-2">Status</p>
        <div className="flex items-center gap-2">
          {STATUS_ORDER.map((status, index) => {
            const sCfg = STATUS_CONFIG[status];
            const isCurrent = project.status === status;
            const currentIndex = STATUS_ORDER.indexOf(project.status);
            const isPast = index < currentIndex;

            return (
              <div key={status} className="flex items-center gap-2">
                {index > 0 && (
                  <div
                    className={`w-8 h-px ${
                      isPast ? 'bg-ink/40' : 'bg-hair-soft'
                    }`}
                  />
                )}
                <button
                  onClick={() => handleStatusChange(status)}
                  disabled={updatingStatus}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                    isCurrent
                      ? `${sCfg.bg} ${sCfg.color} ${sCfg.border}`
                      : isPast
                        ? 'bg-white/[0.02] text-ink-muted border-hair-soft'
                        : 'bg-transparent text-ink-dim border-hair-soft hover:text-ink-muted hover:border-hair'
                  } disabled:opacity-50`}
                >
                  {sCfg.label}
                </button>
              </div>
            );
          })}
          {updatingStatus && (
            <Loader2 size={14} className="animate-spin text-ink-dim ml-2" />
          )}
        </div>
      </div>

      {/* Description */}
      <div className="mb-8">
        <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-2">
          Description
        </p>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDescriptionDirty(true);
          }}
          onBlur={handleDescriptionBlur}
          rows={3}
          placeholder="Add a project description..."
          className="w-full bg-paper border border-hair-soft rounded-xl px-4 py-3 text-sm text-ink-muted placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
        />
      </div>

      {/* Tasks */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider">Tasks</p>
          <span className="text-ink-dim text-xs">
            {completedCount} of {totalCount} tasks complete
          </span>
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="w-full h-1.5 bg-tray rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-ink rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Add task input */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 relative">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTask();
              }}
              placeholder="Add a task and press Enter..."
              className="w-full bg-paper border border-hair-soft rounded-lg px-4 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all pr-10"
            />
            {addingTask && (
              <Loader2
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-dim"
              />
            )}
          </div>
          <button
            onClick={handleAddTask}
            disabled={!newTaskTitle.trim() || addingTask}
            className="bg-ink text-white rounded-lg p-2.5 hover:bg-ink/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Incomplete tasks */}
        {incompleteTasks.length > 0 && (
          <div className="space-y-1 mb-3">
            {incompleteTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 bg-paper border border-hair-soft rounded-lg px-4 py-2.5 group hover:bg-[rgba(10,156,212,0.04)] transition-all"
              >
                {/* Checkbox */}
                <button
                  onClick={() => handleToggleTask(task)}
                  className="w-5 h-5 rounded border border-hair-strong flex-shrink-0 flex items-center justify-center hover:border-sky-ink transition-colors"
                >
                  {/* empty */}
                </button>

                {/* Title (editable) */}
                {editingTaskId === task.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTaskTitle}
                    onChange={(e) => setEditingTaskTitle(e.target.value)}
                    onBlur={handleSaveEditTask}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEditTask();
                      if (e.key === 'Escape') setEditingTaskId(null);
                    }}
                    className="flex-1 bg-transparent text-sm text-ink focus:outline-none border-b border-[rgba(10,156,212,0.3)]"
                  />
                ) : (
                  <span
                    onClick={() => handleStartEditTask(task)}
                    className="flex-1 text-sm text-ink cursor-text hover:text-sky-ink transition-colors"
                  >
                    {task.title}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleStartEditTask(task)}
                    className="text-ink-dim hover:text-ink-muted transition-colors p-1"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-ink-dim hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div className="space-y-1">
            {incompleteTasks.length > 0 && (
              <div className="border-t border-hair-soft my-3" />
            )}
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 bg-paper/50 border border-hair-soft rounded-lg px-4 py-2.5 group hover:bg-[rgba(10,156,212,0.04)] transition-all opacity-60"
              >
                {/* Checkbox (checked) */}
                <button
                  onClick={() => handleToggleTask(task)}
                  className="w-5 h-5 rounded border border-sky-ink/40 bg-[rgba(10,156,212,0.15)] flex-shrink-0 flex items-center justify-center hover:border-sky-ink transition-colors"
                >
                  <Check size={12} className="text-sky-ink" />
                </button>

                {/* Title (strikethrough) */}
                {editingTaskId === task.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTaskTitle}
                    onChange={(e) => setEditingTaskTitle(e.target.value)}
                    onBlur={handleSaveEditTask}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEditTask();
                      if (e.key === 'Escape') setEditingTaskId(null);
                    }}
                    className="flex-1 bg-transparent text-sm text-ink-muted focus:outline-none border-b border-[rgba(10,156,212,0.3)]"
                  />
                ) : (
                  <span
                    onClick={() => handleStartEditTask(task)}
                    className="flex-1 text-sm text-ink-muted line-through cursor-text"
                  >
                    {task.title}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-ink-dim hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {totalCount === 0 && (
          <div className="text-center py-8 bg-paper border border-hair-soft rounded-xl">
            <p className="text-ink-dim text-sm">No tasks yet</p>
            <p className="text-ink-dim text-xs mt-1">Add your first task above</p>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mb-8">
        <p className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-2">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          onBlur={handleNotesBlur}
          rows={5}
          placeholder="Add notes about this project..."
          className="w-full bg-paper border border-hair-soft rounded-xl px-4 py-3 text-sm text-ink-muted placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
        />
      </div>
    </div>
  );
}
