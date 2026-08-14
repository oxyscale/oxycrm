import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  ExternalLink,
  FolderKanban,
  Loader2,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import * as api from '../services/api';
import { parseTimestamp } from '../utils/dates';
import type { Project, ProjectStatus } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';

const STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  building: {
    label: 'In Build',
    color: 'text-warn',
    bg: 'bg-[rgba(245,158,11,0.15)]',
    border: 'border-[rgba(245,158,11,0.3)]',
  },
  live: {
    label: 'Active Client',
    color: 'text-[#0f9d70]',
    bg: 'bg-[rgba(16,185,129,0.12)]',
    border: 'border-[rgba(16,185,129,0.3)]',
  },
  ended: {
    label: 'Ended',
    color: 'text-ink-dim',
    bg: 'bg-[rgba(11,13,14,0.05)]',
    border: 'border-hair-soft',
  },
};

const STATUS_ORDER: ProjectStatus[] = ['building', 'live', 'ended'];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Surfaces a failed inline save. Silent failures on this page used to
   *  look identical to successful ones. */
  const [saveError, setSaveError] = useState<string | null>(null);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Build fee editing
  const [editingFee, setEditingFee] = useState(false);
  const [feeDraft, setFeeDraft] = useState('');

  // Description editing
  const [description, setDescription] = useState('');
  const [descriptionDirty, setDescriptionDirty] = useState(false);

  // Notes editing
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  // Status updating
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) loadProject(parseInt(id));
  }, [id]);

  const loadProject = async (projectId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      setDescription(data.description || '');
      setNotes(data.notes || '');
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
    setSaveError(null);
    try {
      setProject(await api.updateProject(project.id, { status: newStatus }));
    } catch (err) {
      console.error('Failed to update status:', err);
      setSaveError('Could not change the status. Please try again.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const startRename = () => {
    if (!project) return;
    setNameDraft(project.name);
    setEditingName(true);
  };

  const commitRename = async () => {
    if (!project) return;
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === project.name) return;
    setSaveError(null);
    try {
      setProject(await api.updateProject(project.id, { name: next }));
    } catch (err) {
      console.error('Failed to rename project:', err);
      setSaveError('Could not save that name. Please try again.');
    }
  };

  const commitFee = async () => {
    if (!project) return;
    const amount = Number(feeDraft);
    setEditingFee(false);
    if (!Number.isFinite(amount) || amount < 0 || amount === project.buildFee) return;
    setSaveError(null);
    try {
      setProject(await api.updateProject(project.id, { buildFee: amount }));
    } catch (err) {
      console.error('Failed to save build fee:', err);
      setSaveError('Could not save the build fee. Please try again.');
    }
  };

  /**
   * Deletes the project. Retainers live on the CLIENT, not the project,
   * so removing a mistyped project never touches billing history — worth
   * saying out loud in the prompt, because that is the thing a user is
   * afraid of when clicking delete.
   */
  const handleDelete = async () => {
    if (!project) return;
    const warning = project.status === 'live'
      ? `Delete "${project.name}"? This client is live. Their retainer and history stay on the client record, but this project and its checklist are removed for good.`
      : `Delete "${project.name}"? This cannot be undone. The client record, notes and retainer history are not affected.`;
    if (!window.confirm(warning)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await api.deleteProject(project.id);
      navigate('/projects');
    } catch (err) {
      console.error('Failed to delete project:', err);
      setSaveError('Could not delete this project. Please try again.');
      setDeleting(false);
    }
  };

  const handleDescriptionBlur = async () => {
    if (!project || !descriptionDirty) return;
    setDescriptionDirty(false);
    setSaveError(null);
    try {
      await api.updateProject(project.id, { description: description || null });
    } catch (err) {
      console.error('Failed to save description:', err);
      setSaveError('Could not save the description. Copy it somewhere safe and try again.');
      setDescriptionDirty(true);
    }
  };

  const handleNotesBlur = async () => {
    if (!project || !notesDirty) return;
    setNotesDirty(false);
    setSaveError(null);
    try {
      await api.updateProject(project.id, { notes });
    } catch (err) {
      console.error('Failed to save notes:', err);
      setSaveError('Could not save those notes. Copy them somewhere safe and try again.');
      setNotesDirty(true);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return parseTimestamp(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

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
          <span className="text-sm">Back to Active</span>
        </button>
        <div className="text-center py-16">
          <FolderKanban size={32} className="text-ink-dim mx-auto mb-3" />
          <p className="text-risk text-sm mb-1">{error || 'Project not found'}</p>
          <p className="text-ink-dim text-xs mb-4">
            {error
              ? 'Something went wrong loading this project.'
              : 'This project may have been deleted or the link is invalid.'}
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
              Back to Active
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[project.status];
  const retainer = project.currentRetainer || 0;

  return (
    <div className="p-10 max-w-4xl min-h-full bg-cream">
      {/* Back button */}
      <button
        onClick={() => navigate('/projects')}
        className="flex items-center gap-2 text-ink-muted hover:text-sky-ink transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        <span className="text-sm">Back to Active</span>
      </button>

      {/* Header */}
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          DELIVERY · PROJECT
        </EyebrowLabel>
        <div className="flex items-center gap-3 mb-1">
          {editingName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="flex-1 bg-paper border border-hair rounded-lg px-3 py-1.5 text-[28px] font-semibold tracking-section text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]"
              />
              <button
                onClick={commitRename}
                className="text-sky-ink hover:text-ink transition-colors p-1.5"
                title="Save"
              >
                <Check size={18} />
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="text-ink-dim hover:text-ink-muted transition-colors p-1.5"
                title="Cancel"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-sky-ink text-[34px] font-semibold tracking-section">
                {project.name}
              </h1>
              <button
                onClick={startRename}
                className="text-ink-dim hover:text-sky-ink transition-colors p-1.5"
                title="Rename project"
              >
                <Pencil size={15} />
              </button>
              <span
                className={`${cfg.bg} ${cfg.color} text-xs font-medium px-2.5 py-0.5 rounded-full`}
              >
                {cfg.label}
              </span>
            </>
          )}
        </div>
        <p className="text-ink-muted text-sm">{project.clientName}</p>
      </div>

      {saveError && (
        <div className="mb-6 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded-xl px-4 py-3">
          <p className="text-risk text-sm">{saveError}</p>
        </div>
      )}

      {/* Info bar */}
      <div className="flex items-center flex-wrap gap-x-6 gap-y-2 mb-6 bg-paper border border-hair-soft rounded-xl px-5 py-3">
        {/* Money comes from the client's retainer history, not the legacy
            one-off value field that was showing $0 for everyone. */}
        <div className="flex items-center gap-1.5">
          <DollarSign size={14} className="text-ink-dim" />
          <span className="text-ink text-sm font-medium">
            {retainer > 0 ? `${formatCurrency(retainer)}/mo` : 'No retainer set'}
          </span>
          {project.retainerSince && (
            <span className="text-ink-dim text-xs">
              since {formatDate(project.retainerSince)}
            </span>
          )}
        </div>
        <div className="w-px h-4 bg-hair-soft" />
        {/* One-off build fee. Kept separate from the monthly retainer —
            they are different kinds of money and shouldn't be added up
            into a single misleading figure. */}
        <div className="flex items-center gap-1.5">
          <span className="text-ink-dim text-sm">Build fee</span>
          {editingFee ? (
            <>
              <span className="text-ink-dim text-sm">$</span>
              <input
                autoFocus
                type="number"
                value={feeDraft}
                onChange={(e) => setFeeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitFee();
                  if (e.key === 'Escape') setEditingFee(false);
                }}
                onBlur={commitFee}
                className="w-24 bg-cream border border-hair rounded-md px-2 py-0.5 text-sm text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]"
              />
            </>
          ) : (
            <button
              onClick={() => {
                setFeeDraft(project.buildFee ? String(project.buildFee) : '');
                setEditingFee(true);
              }}
              className="text-ink text-sm font-medium hover:text-sky-ink transition-colors flex items-center gap-1"
              title="Set the upfront build fee"
            >
              {project.buildFee > 0 ? formatCurrency(project.buildFee) : 'not set'}
              <Pencil size={10} className="text-ink-dim" />
            </button>
          )}
        </div>
        <div className="w-px h-4 bg-hair-soft" />
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-ink-dim" />
          <span className="text-ink-muted text-sm">
            Start: {formatDate(project.startDate)}
          </span>
        </div>
        {/* Only one of these ever applies: live shows when it went live,
            ended shows when it stopped. The old page showed "End" for
            everyone using the go-live date, which read as finished. */}
        {project.status === 'live' && project.liveFrom && (
          <>
            <div className="w-px h-4 bg-hair-soft" />
            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-ink-dim" />
              <span className="text-ink-muted text-sm">
                Live: {formatDate(project.liveFrom)}
              </span>
            </div>
          </>
        )}
        {project.status === 'ended' && project.endDate && (
          <>
            <div className="w-px h-4 bg-hair-soft" />
            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-ink-dim" />
              <span className="text-ink-muted text-sm">
                Ended: {formatDate(project.endDate)}
              </span>
            </div>
          </>
        )}
        {project.leadId && (
          <>
            <div className="w-px h-4 bg-hair-soft" />
            {/* Straight to the client record. The old link went to the
                leads list, which filters clients out by default. */}
            <button
              onClick={() => navigate(`/leads/${project.leadId}`)}
              className="flex items-center gap-1.5 text-sky-ink text-sm hover:underline"
            >
              <ExternalLink size={12} />
              Client record
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
                  <div className={`w-8 h-px ${isPast ? 'bg-ink/40' : 'bg-hair-soft'}`} />
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
          {updatingStatus && <Loader2 size={14} className="animate-spin text-ink-dim ml-2" />}
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
          placeholder="What are we building for them?"
          className="w-full bg-paper border border-hair-soft rounded-xl px-4 py-3 text-sm text-ink-muted placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
        />
      </div>

      {/* Notes */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-ink-dim text-xs font-medium uppercase tracking-wider">
            Delivery notes
          </p>
          {project.leadId && (
            <button
              onClick={() => navigate(`/leads/${project.leadId}`)}
              className="text-ink-dim hover:text-sky-ink text-xs transition-colors"
            >
              Account notes live on the client record
            </button>
          )}
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          onBlur={handleNotesBlur}
          rows={5}
          placeholder="Scratchpad for this build..."
          className="w-full bg-paper border border-hair-soft rounded-xl px-4 py-3 text-sm text-ink-muted placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
        />
      </div>

      {/* Deliberately last and understated — not next to anything used daily */}
      <div className="pt-6 border-t border-hair-soft flex items-center justify-between gap-4">
        <p className="text-ink-dim text-xs">
          Removing this project leaves the client record, notes and retainer
          history untouched.
        </p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 text-ink-dim hover:text-risk text-xs transition-colors disabled:opacity-40 flex-shrink-0"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Delete project
        </button>
      </div>
    </div>
  );
}
