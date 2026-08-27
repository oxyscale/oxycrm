import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FolderKanban,
  Loader2,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import * as api from '../services/api';
import { parseTimestamp, todayInMelbourne } from '../utils/dates';
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

const detailInput =
  'w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink ' +
  'placeholder-ink-faint focus:outline-none focus:border-[rgba(10,156,212,0.35)] transition-all';

/** Date-only addition, for showing the default revenue start. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function DetailField({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-ink-dim mb-1.5">
        {label}
      </p>
      {children}
      {hint && <p className="text-ink-dim text-xs mt-1">{hint}</p>}
    </div>
  );
}

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

  // The detail fields are plain always-visible inputs rather than
  // click-to-reveal. An empty box reads as "nothing here yet" without
  // needing a word for it.
  const [fee, setFee] = useState('');
  const [paid, setPaid] = useState('');
  const [signed, setSigned] = useState('');
  const [revenueStart, setRevenueStart] = useState('');
  const [retainerInput, setRetainerInput] = useState('');
  const [savingRetainer, setSavingRetainer] = useState(false);
  /** How many projects this client has. A retainer edit here affects
   *  all of them, so the page has to be able to say so. */
  const [siblingProjects, setSiblingProjects] = useState(1);

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
      setFee(data.buildFee ? String(data.buildFee) : '');
      setPaid(data.buildFeePaid ? String(data.buildFeePaid) : '');
      setSigned(data.startDate ?? '');
      setRevenueStart(data.liveFrom ?? '');
      setRetainerInput(data.currentRetainer ? String(data.currentRetainer) : '');
      if (data.leadId) {
        try {
          const siblings = await api.getLeadProjects(data.leadId);
          setSiblingProjects(siblings.length || 1);
        } catch {
          setSiblingProjects(1);
        }
      }
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

  /**
   * Writes the client's monthly retainer from here.
   *
   * The figure still belongs to the CLIENT — a client with two builds
   * pays one monthly amount, not two — so this saves to the same
   * retainer history the client record shows. It is only the editing
   * that moved, not the data.
   */
  const saveRetainer = async () => {
    if (!project?.leadId) return;
    const amount = Number(retainerInput);
    if (retainerInput.trim() === '' || !Number.isFinite(amount) || amount < 0) return;
    if (amount === (project.currentRetainer ?? 0)) return;
    setSavingRetainer(true);
    setSaveError(null);
    try {
      await api.addRetainer(project.leadId, {
        monthlyAmount: amount,
        effectiveFrom: todayInMelbourne(),
        note: `Set from ${project.name}`,
      });
      await loadProject(project.id);
    } catch (err) {
      console.error('Failed to save retainer:', err);
      setSaveError('Could not save the retainer. Please try again.');
    } finally {
      setSavingRetainer(false);
    }
  };

  /**
   * Saves one field of the detail bar on blur. Everything in there is a
   * single value, so one handler covers all of them and an empty box
   * means null rather than zero.
   */
  const saveField = async (
    field: 'buildFee' | 'buildFeePaid' | 'startDate' | 'liveFrom',
    raw: string,
  ) => {
    if (!project) return;
    const isMoney = field === 'buildFee' || field === 'buildFeePaid';
    const next = raw.trim() === '' ? (isMoney ? 0 : null) : (isMoney ? Number(raw) : raw);
    if (isMoney && (!Number.isFinite(next as number) || (next as number) < 0)) return;

    const current =
      field === 'buildFee' ? project.buildFee
      : field === 'buildFeePaid' ? project.buildFeePaid
      : field === 'startDate' ? project.startDate
      : project.liveFrom;
    if (next === current) return;

    setSaveError(null);
    try {
      setProject(await api.updateProject(project.id, { [field]: next }));
    } catch (err) {
      console.error(`Failed to save ${field}:`, err);
      setSaveError('Could not save that. Please try again.');
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

      {/* Detail bar. The retainer is shown, not asked for — it belongs
          to the client, not the project. Everything else is editable. */}
      <div className="bg-paper border border-hair-soft rounded-xl px-5 py-4 mb-6">
        <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr_1.2fr] gap-5">
          <DetailField
            label="Monthly retainer"
            hint={
              !project.leadId
                ? 'no client linked'
                : siblingProjects > 1
                  ? `applies across all ${siblingProjects} of this client's projects`
                  : project.retainerSince
                    ? `since ${formatDate(project.retainerSince)}`
                    : undefined
            }
          >
            <div className="relative">
              <input
                type="number" step="0.01" value={retainerInput}
                onChange={(e) => setRetainerInput(e.target.value)}
                onBlur={saveRetainer}
                disabled={!project.leadId}
                className={detailInput}
              />
              {savingRetainer && (
                <Loader2 size={13}
                  className="animate-spin text-ink-dim absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
          </DetailField>

          <DetailField label="Build fee">
            <input
              type="number" step="0.01" value={fee}
              onChange={(e) => setFee(e.target.value)}
              onBlur={() => saveField('buildFee', fee)}
              className={detailInput}
            />
          </DetailField>

          <DetailField label="Invoiced">
            <input
              type="number" step="0.01" value={paid}
              onChange={(e) => setPaid(e.target.value)}
              onBlur={() => saveField('buildFeePaid', paid)}
              className={detailInput}
            />
          </DetailField>

          <DetailField label="Signed">
            <input
              type="date" value={signed}
              onChange={(e) => setSigned(e.target.value)}
              onBlur={() => saveField('startDate', signed)}
              className={detailInput}
            />
          </DetailField>

          <DetailField
            label="Est. revenue start"
            hint={!project.liveFrom && project.startDate
              ? `defaults to ${formatDate(addDays(project.startDate, 60))}`
              : undefined}
          >
            <input
              type="date" value={revenueStart}
              onChange={(e) => setRevenueStart(e.target.value)}
              onBlur={() => saveField('liveFrom', revenueStart)}
              className={detailInput}
            />
          </DetailField>
        </div>
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
