import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  Mail,
  Plus,
  Globe,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  X,
  Pencil,
  Trash2,
  FileText,
  ArrowRightLeft,
  Thermometer,
  CalendarDays,
  Send,
  Mic,
  MicOff,
} from 'lucide-react';
import * as api from '../services/api';
import { recordLeadVisit, removeRecentLead } from '../utils/recentLeads';
import { decodeHtmlEntities } from '../utils/text';
import { todayInSydney, parseTimestamp } from '../utils/dates';
import {
  getLeadProfileReturn,
  clearLeadProfileReturn,
  getLeadProfileBackLabel,
} from '../utils/leadProfileNav';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import PillButton from '../components/ui/PillButton';
import type {
  Lead,
  CallLog,
  Note,
  Activity,
  EmailSent,
  PipelineStage,
  ActivityType,
  Project,
  ProjectStatus,
} from '../types';

// ── Constants ────────────────────────────────────────────────

// Sentinel value for the "+ Create category…" option. Prefixed so it can
// never collide with a real category name.
const CREATE_CATEGORY_VALUE = '__create_category__';

const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'tier_1', label: 'Tier 1' },
  { value: 'tier_2', label: 'Tier 2' },
  { value: 'tier_3', label: 'Tier 3' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const ACTIVITY_LIMIT = 20;

// ── Tabs ─────────────────────────────────────────────────────

type Tab = 'activity' | 'transcripts' | 'notes' | 'emails';

// ── Helpers ──────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return parseTimestamp(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(dateStr: string) {
  return parseTimestamp(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function dispositionLabel(disposition: string) {
  const labels: Record<string, string> = {
    interested: 'Interested',
    not_interested: 'Not Interested',
    no_answer: 'No Answer',
    voicemail: 'Voicemail',
    wrong_number: 'Wrong Number',
  };
  return labels[disposition] || disposition;
}

function dispositionBadgeStyle(disposition: string) {
  const styles: Record<string, string> = {
    interested: 'bg-[rgba(10,156,212,0.15)] text-sky-ink',
    not_interested: 'bg-red-500/15 text-red-400',
    no_answer: 'bg-amber-500/15 text-amber-400',
    voicemail: 'bg-blue-500/15 text-blue-400',
    wrong_number: 'bg-tray text-ink-muted',
  };
  return styles[disposition] || 'bg-tray text-ink-muted';
}

function activityIcon(type: ActivityType) {
  switch (type) {
    case 'call':
      return <Phone size={14} className="text-sky-ink" />;
    case 'note':
      return <FileText size={14} className="text-blue-400" />;
    case 'email':
      return <Mail size={14} className="text-amber-400" />;
    case 'stage_change':
      return <ArrowRightLeft size={14} className="text-purple-400" />;
    case 'meeting':
      return <CalendarDays size={14} className="text-sky-ink" />;
    case 'temperature_change':
      return <Thermometer size={14} className="text-orange-400" />;
    default:
      return <Clock size={14} className="text-ink-dim" />;
  }
}

function activityColorBar(type: ActivityType) {
  switch (type) {
    case 'call': return 'border-l-sky-ink';
    case 'note': return 'border-l-blue-400';
    case 'email': return 'border-l-amber-400';
    case 'stage_change': return 'border-l-purple-400';
    case 'meeting': return 'border-l-sky-ink';
    case 'temperature_change': return 'border-l-orange-400';
    default: return 'border-l-ink-dim';
  }
}

// Replace any "YYYY-MM-DD" substrings in human-readable strings with
// "17th of May 2026" style. Used so the activity timeline reads like a
// sentence regardless of when the row was written.
function humaniseDates(text: string): string {
  return text.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => {
    const day = parseInt(d, 10);
    const monthName = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, day))
      .toLocaleDateString('en-AU', { month: 'long', timeZone: 'UTC' });
    const suffix =
      day % 100 >= 11 && day % 100 <= 13 ? 'th'
      : day % 10 === 1 ? 'st'
      : day % 10 === 2 ? 'nd'
      : day % 10 === 3 ? 'rd'
      : 'th';
    return `${day}${suffix} of ${monthName} ${y}`;
  });
}

// Today + N weeks as a YYYY-MM-DD string. Anchored to local time so the
// date that lands matches what the user sees on their wall calendar.
function addWeeksFromToday(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  // Build YYYY-MM-DD in local time (don't use toISOString which is UTC).
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function stageLabel(stage: PipelineStage | null): string {
  if (!stage) return 'No tier';
  // Map legacy stages to their new labels for display
  const legacyMap: Record<string, string> = {
    new_lead: 'No tier',
    follow_up: 'Tier 2',
    call_booked: 'Tier 1',
    negotiation: 'Tier 1',
    not_interested: 'Lost',
  };
  return PIPELINE_STAGES.find((s) => s.value === stage)?.label || legacyMap[stage] || stage;
}

// ── Inline Editable Field ────────────────────────────────────

function InlineEdit({
  value,
  onSave,
  placeholder,
  className = '',
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={commit}
          className={`bg-tray border border-[rgba(10,156,212,0.4)] rounded px-2 py-0.5 text-ink focus:outline-none ${className}`}
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`group flex items-center gap-1.5 hover:text-ink transition-all rounded px-1 -mx-1 hover:bg-[rgba(11,13,14,0.03)] ${className}`}
      title="Click to edit"
    >
      <span className={value ? '' : 'text-ink-dim italic'}>
        {value || placeholder || 'Add...'}
      </span>
      <Pencil size={11} className="text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

// ── Main Component ───────────────────────────────────────────

export default function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadId = Number(id);

  // Core data
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state — restored from URL params
  const [tab, setTab] = useState<Tab>(
    (searchParams.get('tab') as Tab) || 'activity'
  );

  // Sync tab to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (tab !== 'activity') params.set('tab', tab);
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  }, [tab]);

  // Activity tab
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<number>>(new Set());

  // Calls tab
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);

  // Notes tab
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  // savingNote removed — notes use optimistic local insert (no spinner needed)
  const [fieldUpdateError, setFieldUpdateError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [isDictating, setIsDictating] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // Emails tab
  const [emails, setEmails] = useState<EmailSent[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Set<number>>(new Set());

  // Stage dropdown
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const [updatingStage, setUpdatingStage] = useState(false);

  // Set Task — schedule a follow-up that lands on the lead and on Google Calendar.
  const [showSetTask, setShowSetTask] = useState(false);
  const [taskLabel, setTaskLabel] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  // Manual transcript composer — Wispr Flow handles the dictation system-wide,
  // we just give it a text field to land in.
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Tasks attached to this lead
  const [tasks, setTasks] = useState<api.LeadTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [togglingTaskId, setTogglingTaskId] = useState<number | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);
  // Inline edit state for tasks in the sidebar
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTaskLabel, setEditingTaskLabel] = useState('');
  const [editingTaskDate, setEditingTaskDate] = useState('');
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);

  // Managed categories for the category dropdown
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  // Projects + retainer history for this contact.
  const [leadProjects, setLeadProjects] = useState<Project[]>([]);
  const [retainers, setRetainers] = useState<api.ClientRetainerEntry[]>([]);
  // Inline category creation, so a new industry can be added mid-call
  // without detouring to Settings.
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  // Managed lead sources for the source dropdown
  const [leadSourceOptions, setLeadSourceOptions] = useState<string[]>([]);

  // ── Load lead ──────────────────────────────────────────────

  useEffect(() => {
    if (!leadId || isNaN(leadId)) {
      setError('Invalid lead ID');
      setLoading(false);
      return;
    }
    loadLead();
  }, [leadId]);

  // Load tab data when tab changes
  useEffect(() => {
    if (!lead) return;
    if (tab === 'activity') loadActivities();
    if (tab === 'transcripts') loadCalls();
    if (tab === 'notes') loadNotes();
    if (tab === 'emails') loadEmails();
  }, [tab, lead?.id]);

  // Projects + retainer history, reloaded whenever the contact changes.
  useEffect(() => {
    if (!lead) return;
    api.getLeadProjects(lead.id).then(setLeadProjects).catch(() => { /* non-critical */ });
    api.getRetainers(lead.id).then(setRetainers).catch(() => { /* non-critical */ });
  }, [lead?.id]);

  // Load managed categories + lead sources for the sidebar dropdowns
  useEffect(() => {
    api.getManagedCategories()
      .then((cats) => setCategoryOptions(cats.map((c) => c.name)))
      .catch(() => {});
    api.getLeadSources()
      .then((srcs) => setLeadSourceOptions(srcs.map((s) => s.name)))
      .catch(() => {});
  }, []);

  // Tasks live in the sidebar — load alongside the lead, not per tab.
  useEffect(() => {
    if (!lead) return;
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  const loadLead = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLeadById(leadId);
      setLead(data);
      // Track this visit for "recent leads" in sidebar + search
      recordLeadVisit({ id: data.id, name: data.name, company: data.company });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  };

  const loadActivities = async (offset = 0) => {
    setLoadingActivities(true);
    try {
      const res = await api.getActivitiesForLead(leadId, { limit: ACTIVITY_LIMIT, offset });
      if (offset === 0) {
        setActivities(res.activities);
      } else {
        setActivities((prev) => [...prev, ...res.activities]);
      }
      setActivityTotal(res.total);
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoadingActivities(false);
    }
  };

  const loadCalls = async () => {
    setLoadingCalls(true);
    try {
      const data = await api.getCallHistory(leadId);
      setCallLogs(data);
    } catch (err) {
      console.error('Failed to load calls:', err);
    } finally {
      setLoadingCalls(false);
    }
  };

  const loadNotes = async () => {
    setLoadingNotes(true);
    try {
      const data = await api.getNotesForLead(leadId);
      setNotes(data);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoadingNotes(false);
    }
  };

  const loadEmails = async () => {
    setLoadingEmails(true);
    try {
      const data = await api.getEmailsForLead(leadId);
      setEmails(data);
    } catch (err) {
      console.error('Failed to load emails:', err);
    } finally {
      setLoadingEmails(false);
    }
  };

  const loadTasks = async () => {
    if (!leadId) return;
    setLoadingTasks(true);
    try {
      const data = await api.getLeadTasks(leadId);
      setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoadingTasks(false);
    }
  };

  // Toggle a task's completed state
  const handleToggleTask = async (task: api.LeadTask) => {
    if (togglingTaskId) return;
    setTogglingTaskId(task.id);
    try {
      const updated = await api.updateLeadTask(task.id, { completed: !task.completed });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      console.error('Failed to toggle task:', err);
    } finally {
      setTogglingTaskId(null);
    }
  };

  // Delete a task (with confirmation)
  // Permanently delete the lead. Confirms twice in the prompt copy
  // because this cascades to call_logs, notes, tasks, emails, activities.
  /**
   * Creates a category from the lead profile and assigns it in one go.
   *
   * If the name already exists the create 409s — that's not a failure
   * worth surfacing here, since the intent (put this lead in that
   * category) is still satisfiable. Fall through and assign it.
   */
  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !lead) return;
    setSavingCategory(true);
    setCategoryError(null);
    try {
      try {
        await api.createCategory(name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!/already exists/i.test(msg)) throw err;
      }
      const updated = await api.updateLead(lead.id, { category: name } as Partial<Lead>);
      setLead(updated);
      // Refresh so the new category is in the dropdown for other leads.
      const cats = await api.getManagedCategories();
      setCategoryOptions(cats.map((c) => c.name));
      setCreatingCategory(false);
      setNewCategoryName('');
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!lead || deletingLead) return;
    const ok = window.confirm(
      `Delete ${lead.name}?\n\n` +
      `This permanently removes the lead and ALL associated:\n` +
      `  - transcripts / call logs\n` +
      `  - notes\n` +
      `  - tasks (and their calendar events stay on the calendar)\n` +
      `  - sent emails record\n` +
      `  - activity history\n\n` +
      `This cannot be undone.`
    );
    if (!ok) return;
    setDeletingLead(true);
    try {
      await api.deleteLead(lead.id);
      // Drop this lead from the local recently-visited list so it
      // doesn't haunt the dropdown after deletion. (The dropdown also
      // validates against the server on open, so this is belt-and-braces.)
      removeRecentLead(lead.id);
      // Return to wherever the user came from (with their filter intact),
      // not bare /leads. If they were on /leads?status=not_contacted and
      // deleted a junk lead, they want to keep ploughing through the rest
      // of the Not Contacted queue — not land on the unfiltered list.
      // Falls back to /leads if there's no saved URL (e.g. direct link).
      const target = getLeadProfileReturn() || '/leads';
      clearLeadProfileReturn();
      navigate(target);
    } catch (err) {
      console.error('Failed to delete lead:', err);
      setFieldUpdateError(err instanceof Error ? err.message : 'Failed to delete lead');
      setTimeout(() => setFieldUpdateError(null), 5000);
      setDeletingLead(false);
    }
  };

  // Start editing — pre-fill the form with the task's current values.
  const startEditingTask = (task: api.LeadTask) => {
    setEditingTaskId(task.id);
    setEditingTaskLabel(task.label);
    setEditingTaskDate(task.dueDate);
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskLabel('');
    setEditingTaskDate('');
  };

  // Save edits — label + due date. Backend mirrors the change to Google
  // Calendar (in tasks.ts PATCH handler) so the calendar entry shifts too.
  const handleSaveTaskEdit = async (taskId: number) => {
    if (savingTaskEdit) return;
    if (!editingTaskLabel.trim() || !editingTaskDate) return;
    setSavingTaskEdit(true);
    try {
      const updated = await api.updateLeadTask(taskId, {
        label: editingTaskLabel.trim(),
        dueDate: editingTaskDate,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      cancelEditingTask();
      // Refresh activity in case the server logged a change.
      if (tab === 'activity') loadActivities();
    } catch (err) {
      console.error('Failed to update task:', err);
    } finally {
      setSavingTaskEdit(false);
    }
  };

  const handleDeleteTask = async (task: api.LeadTask) => {
    if (!confirm(`Delete task "${task.label}"?`)) return;
    try {
      await api.deleteLeadTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  // ── Actions ────────────────────────────────────────────────

  const handleUpdateField = async (field: string, value: string) => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, { [field]: value || null });
      setLead(updated);
    } catch (err) {
      console.error(`Failed to update ${field}:`, err);
      // Surface the failure so the user knows their edit didn't stick
      // instead of silently reverting to the previous value.
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setFieldUpdateError(`${field}: ${msg}`);
      setTimeout(() => setFieldUpdateError(null), 4000);
    }
  };

  // stage = null clears the lead from the kanban (still visible in /leads).
  const handleStageChange = async (stage: PipelineStage | null) => {
    if (!lead || lead.pipelineStage === stage) {
      setShowStageDropdown(false);
      return;
    }
    setUpdatingStage(true);
    setShowStageDropdown(false);
    try {
      const updated = await api.updateLeadStage(lead.id, stage);
      setLead(updated);
      // Refresh activities to show stage change
      if (tab === 'activity') loadActivities();
    } catch (err) {
      console.error('Failed to update stage:', err);
    } finally {
      setUpdatingStage(false);
    }
  };

  // Save a dictated transcript on the lead. Bypasses the disposition flow —
  // it's just a record of "here's what was said in this conversation".
  const handleSaveTranscript = async (alsoDraftEmail: boolean) => {
    if (!lead || savingTranscript || !transcriptDraft.trim()) return;
    setSavingTranscript(true);
    setTranscriptError(null);
    try {
      await api.saveLeadTranscript(lead.id, { transcript: transcriptDraft.trim() });
      const text = transcriptDraft.trim();
      setTranscriptDraft('');

      // Reload calls + activity to reflect the new transcript
      await loadCalls();
      const refreshed = await api.getLeadById(lead.id);
      setLead(refreshed);
      if (tab === 'activity') loadActivities();

      // If the user wanted an email draft from this transcript, jump to the
      // composer with the transcript stashed in sessionStorage so the page
      // can pick it up as AI context.
      if (alsoDraftEmail) {
        try {
          sessionStorage.setItem(`transcript-context-${lead.id}`, text);
        } catch {
          // sessionStorage can fail in private mode — non-critical, the
          // transcript is already saved.
        }
        navigate(`/compose/${lead.id}`);
      }
    } catch (err) {
      console.error('Failed to save transcript:', err);
      setTranscriptError(err instanceof Error ? err.message : 'Failed to save transcript');
    } finally {
      setSavingTranscript(false);
    }
  };

  // Create a scheduled task on the lead. The server creates the task row,
  // sets the lead's follow_up_date so it surfaces in Pipeline > Follow-ups,
  // and (if Google is connected) drops a calendar event on the OxyScale
  // calendar for that date.
  const handleCreateTask = async () => {
    if (!lead || creatingTask) return;
    if (!taskLabel.trim() || !taskDate) {
      setTaskError('Both task name and due date are required.');
      return;
    }
    setCreatingTask(true);
    setTaskError(null);
    try {
      const newTask = await api.createLeadTask(lead.id, {
        label: taskLabel.trim(),
        dueDate: taskDate,
      });

      // Update follow_up_date locally instead of re-fetching the whole lead.
      // The server mirrors the earliest task due date onto the lead.
      if (!lead.followUpDate || taskDate < lead.followUpDate) {
        setLead((prev) => prev ? { ...prev, followUpDate: taskDate } : prev);
      }

      // Append the new task locally — no need for a full reload
      setTasks((prev) => [...prev, newTask]);

      // Reset form but keep the panel open so the user can create another
      setTaskLabel('');
      setTaskDate('');

      // Quietly refresh the activity timeline (no loading spinner)
      if (tab === 'activity') {
        api.getActivitiesForLead(leadId, { limit: ACTIVITY_LIMIT, offset: 0 })
          .then((res) => { setActivities(res.activities); setActivityTotal(res.total); })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      setTaskError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreatingTask(false);
    }
  };

  const toggleDictation = () => {
    if (isDictating) {
      recognitionRef.current?.stop();
      setIsDictating(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Try Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';

    let processedUpTo = 0;

    recognition.onresult = (event: any) => {
      let newText = '';
      for (let i = processedUpTo; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          newText += event.results[i][0].transcript;
          processedUpTo = i + 1;
        }
      }
      if (newText) {
        setNewNote((prev) => (prev ? `${prev} ${newText.trim()}` : newText.trim()));
      }
    };

    recognition.onerror = () => {
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsDictating(true);
  };

  const handleCreateNote = async () => {
    if (!newNote.trim() || !lead) return;

    const content = newNote.trim();

    // Optimistic: show the note instantly, clear the input, no spinner.
    const tempId = -(Date.now());
    const optimisticNote: Note = {
      id: tempId,
      leadId: lead.id,
      content,
      createdBy: 'Jordan',
      createdAt: new Date().toISOString(),
    };
    setNotes((prev) => [optimisticNote, ...prev]);
    setNewNote('');

    // Stop dictation if it's running so the field is clean for next use
    if (isDictating) {
      recognitionRef.current?.stop();
      setIsDictating(false);
    }

    // Save in the background — swap the temp note for the real one
    try {
      const saved = await api.createNote({ leadId: lead.id, content });
      setNotes((prev) => prev.map((n) => (n.id === tempId ? saved : n)));

      // Quietly refresh activity timeline if that tab is active
      if (tab === 'activity') {
        api.getActivitiesForLead(leadId, { limit: ACTIVITY_LIMIT, offset: 0 })
          .then((res) => { setActivities(res.activities); setActivityTotal(res.total); })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to create note:', err);
      // Remove the optimistic note on failure
      setNotes((prev) => prev.filter((n) => n.id !== tempId));
      setNewNote(content); // restore so the user doesn't lose their text
    }
  };

  const handleUpdateNote = async (noteId: number) => {
    if (!editingNoteContent.trim()) return;
    try {
      const updated = await api.updateNote(noteId, editingNoteContent.trim());
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingNoteId(null);
      setEditingNoteContent('');
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await api.deleteNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  // ── Loading / Error states ─────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="flex items-center justify-center h-full bg-cream">
        <div className="text-center">
          <p className="text-ink-muted mb-4">{error || 'Lead not found'}</p>
          <PillButton
            variant="primary"
            size="md"
            trailing="none"
            onClick={() => navigate('/leads')}
          >
            Back to leads
          </PillButton>
        </div>
      </div>
    );
  }

  // ── Stats for sidebar ──────────────────────────────────────

  const totalCallsCount = callLogs.length || 0;
  const totalNotesCount = notes.length || 0;
  const totalEmailsCount = emails.length || 0;

  // Lifecycle mirrors the server's rule (any live project keeps them a
  // client), computed here from the projects we've already loaded so the
  // sidebar updates the moment a project changes state.
  const lifecycle: 'lead' | 'in_build' | 'client' =
    leadProjects.some((p) => p.status === 'live')
      ? 'client'
      : leadProjects.some((p) => p.status === 'building')
        ? 'in_build'
        : 'lead';
  // Retainer in effect today. Future-dated changes don't count yet.
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentRetainer =
    retainers
      .filter((r) => r.effectiveFrom <= todayIso)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.id - a.id))[0]
      ?.monthlyAmount ?? 0;

  // ── Render ─────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'activity', label: 'Activity' },
    { key: 'transcripts', label: 'Transcripts' },
    { key: 'notes', label: 'Notes' },
    { key: 'emails', label: 'Emails' },
  ];

  return (
    <div className="p-10 max-w-[1400px] mx-auto bg-cream min-h-full">
      {/* ── Back button — returns the user to wherever they came from.
          Tasks, Pipeline, Reports, Email Bank, the Home page or Leads
          — anything that stashed a return URL via rememberLeadProfileReturn().
          Falls back to /leads if nothing was saved (e.g. lead profile was
          opened directly via deep link). The label adapts to the
          destination so it always reads correctly. */}
      <button
        onClick={() => {
          const saved = getLeadProfileReturn();
          clearLeadProfileReturn();
          navigate(saved || '/leads');
        }}
        className="flex items-center gap-2 text-ink-dim hover:text-sky-ink transition-all text-sm mb-6"
      >
        <ArrowLeft size={16} />
        {getLeadProfileBackLabel(getLeadProfileReturn())}
      </button>

      {fieldUpdateError && (
        <div className="mb-4 bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)] rounded-lg px-4 py-2.5 text-risk text-sm">
          Couldn&apos;t save edit — {fieldUpdateError}
        </div>
      )}

      {/* ── Header section ──────────────────────────────────── */}
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          LEAD · PROFILE
        </EyebrowLabel>
        {/* Name */}
        <div className="mb-1">
          <InlineEdit
            value={lead.name}
            onSave={(val) => handleUpdateField('name', val)}
            placeholder="Lead name"
            className="text-sky-ink text-[34px] font-semibold tracking-section"
          />
        </div>

        {/* Company */}
        <div className="mb-4">
          <InlineEdit
            value={lead.company || ''}
            onSave={(val) => handleUpdateField('company', val)}
            placeholder="Add company"
            className="text-ink-muted text-sm"
          />
        </div>

        {/* Contact info row */}
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-1.5 text-ink-muted text-sm">
            <Phone size={13} className="text-ink-dim flex-shrink-0" />
            <InlineEdit
              value={lead.phone}
              onSave={(val) => handleUpdateField('phone', val)}
              placeholder="Phone number"
              className="text-sm text-ink-muted"
            />
          </div>
          <div className="flex items-center gap-1.5 text-ink-muted text-sm">
            <Mail size={13} className="text-ink-dim flex-shrink-0" />
            <InlineEdit
              value={lead.email || ''}
              onSave={(val) => handleUpdateField('email', val)}
              placeholder="Add email"
              className="text-sm text-ink-muted"
            />
          </div>
          <div className="flex items-center gap-1.5 text-ink-muted text-sm">
            <Globe size={13} className="text-ink-dim flex-shrink-0" />
            <InlineEdit
              value={lead.website || ''}
              onSave={(val) => handleUpdateField('website', val)}
              placeholder="Add website"
              className="text-sm text-ink-muted"
            />
          </div>
        </div>
      </div>

      {/* ── Quick actions bar ───────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap mb-8 pb-6 border-b border-hair-soft">
        {/* Email button */}
        <button
          onClick={() => navigate(`/compose/${lead.id}`)}
          className="flex items-center gap-2 bg-transparent text-ink-muted border border-hair-soft rounded-lg px-4 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
        >
          <Mail size={15} />
          Email
        </button>

        {/* Book Meeting button */}
        <button
          onClick={() => navigate(`/book-meeting/${lead.id}`)}
          className="flex items-center gap-2 bg-transparent text-ink-muted border border-hair-soft rounded-lg px-4 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
        >
          <CalendarDays size={15} />
          Book Meeting
        </button>

        {/* Set Task button — schedule a follow-up that lands in your calendar */}
        <button
          onClick={() => setShowSetTask((v) => !v)}
          className={`flex items-center gap-2 border rounded-lg px-4 py-2.5 text-sm transition-all ${
            showSetTask
              ? 'bg-sky-wash border-sky-hair text-sky-ink'
              : 'bg-transparent text-ink-muted border-hair-soft hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
          }`}
        >
          <CalendarDays size={15} />
          Set Task
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete lead — small, sits to the left of the tier dropdown so
            it's reachable but not prominent. Confirms before firing. */}
        <button
          onClick={handleDeleteLead}
          disabled={deletingLead}
          title="Delete this lead (permanent)"
          className="flex items-center gap-1.5 text-ink-dim hover:text-risk transition-colors text-xs px-2.5 py-1.5 rounded-full hover:bg-[rgba(239,68,68,0.06)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deletingLead ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          {deletingLead ? 'Deleting...' : 'Delete'}
        </button>

        {/* Pipeline stage dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowStageDropdown(!showStageDropdown)}
            disabled={updatingStage}
            className="flex items-center gap-2 bg-paper border border-hair-soft rounded-lg px-4 py-2.5 text-sm text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all disabled:opacity-50"
          >
            {updatingStage ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ArrowRightLeft size={13} className="text-ink-dim" />
            )}
            {stageLabel(lead.pipelineStage)}
            <ChevronDown size={13} className="text-ink-dim" />
          </button>
          {showStageDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowStageDropdown(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-paper border border-hair-soft rounded-xl shadow-xl overflow-hidden min-w-[180px]">
                {/* No Tier option */}
                <button
                  onClick={() => handleStageChange(null)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] transition-all flex items-center gap-2 ${
                    !lead.pipelineStage
                      ? 'text-sky-ink'
                      : 'text-ink-muted'
                  }`}
                >
                  {!lead.pipelineStage && <Check size={13} />}
                  <span className={!lead.pipelineStage ? '' : 'ml-[21px]'}>
                    No Tier
                  </span>
                </button>
                <div className="border-t border-hair-soft" />
                {PIPELINE_STAGES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => handleStageChange(s.value)}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] transition-all flex items-center gap-2 ${
                      lead.pipelineStage === s.value
                        ? 'text-sky-ink'
                        : 'text-ink-muted'
                    }`}
                  >
                    {lead.pipelineStage === s.value && <Check size={13} />}
                    <span className={lead.pipelineStage === s.value ? '' : 'ml-[21px]'}>
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

      </div>

      {/* ── Set Task panel ───────────────────────────────────── */}
      {showSetTask && (
        <div
          id="set-task-panel"
          className="bg-paper border border-sky-hair rounded-xl p-5 mb-8 -mt-6"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && taskLabel.trim() && taskDate && !creatingTask) {
              e.preventDefault();
              handleCreateTask();
            }
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-ink font-medium text-base flex items-center gap-2">
                <CalendarDays size={16} className="text-sky-ink" />
                Set a task
              </h3>
              <p className="text-ink-muted text-sm mt-0.5">
                Schedule a follow-up. Lands on the lead and on your OxyScale Google Calendar so you don&apos;t forget.
              </p>
            </div>
            <button
              onClick={() => { setShowSetTask(false); setTaskError(null); }}
              className="text-ink-dim hover:text-ink transition-all"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Due date first, then quick picks, then custom label — all close together */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">Due date</p>
              <input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all [color-scheme:light]"
              />
            </div>

            {/* Quick weeks — skip opening the calendar */}
            <div>
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">In</p>
              <div className="flex gap-1.5">
                {[2, 4, 6, 8].map((weeks) => {
                  const target = addWeeksFromToday(weeks);
                  const active = taskDate === target;
                  return (
                    <button
                      key={weeks}
                      type="button"
                      onClick={() => setTaskDate(target)}
                      title={`Due ${target}`}
                      className={`text-sm rounded-full px-3 py-1.5 border transition-all whitespace-nowrap ${
                        active
                          ? 'bg-sky-wash border-sky-hair text-sky-ink'
                          : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
                      }`}
                    >
                      {weeks}w
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">Quick</p>
              <div className="flex gap-2">
                {['Touch Base', 'Send Proposal', 'Send Summary'].map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTaskLabel(label)}
                    className={`text-sm rounded-full px-4 py-1.5 border transition-all whitespace-nowrap ${
                      taskLabel === label
                        ? 'bg-sky-wash border-sky-hair text-sky-ink'
                        : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[180px]">
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">Or custom</p>
              <input
                id="set-task-label-input"
                type="text"
                value={taskLabel}
                onChange={(e) => setTaskLabel(e.target.value)}
                placeholder="e.g. Follow up in July"
                className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all"
              />
            </div>
          </div>

          {taskError && (
            <div className="mb-3 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg px-3 py-2">
              <p className="text-risk text-sm">{taskError}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateTask}
              disabled={creatingTask || !taskLabel.trim() || !taskDate}
              className="bg-ink text-white text-sm font-medium rounded-full px-5 py-2 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creatingTask ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {creatingTask ? 'Saving...' : 'Save task'}
            </button>
            <button
              onClick={() => { setShowSetTask(false); setTaskError(null); }}
              disabled={creatingTask}
              className="text-ink-muted text-sm rounded-full px-4 py-2 hover:bg-[rgba(11,13,14,0.03)] transition-all disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Main content: tabs + sidebar ────────────────────── */}
      <div className="flex gap-8">
        {/* ── Left: tabbed content ──────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Quick note — always visible above the tabs */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-6">
            <textarea
              id="new-note-input"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (newNote.trim()) handleCreateNote();
                }
              }}
              placeholder="Add a note... (Enter to save, Shift+Enter for new line)"
              rows={2}
              className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all resize-none leading-relaxed mb-3"
            />
            <div className="flex justify-between items-center">
              <button
                onClick={toggleDictation}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  isDictating
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse'
                    : 'bg-tray text-ink-muted border border-hair-soft hover:text-ink hover:bg-[rgba(11,13,14,0.03)]'
                }`}
              >
                {isDictating ? <MicOff size={14} /> : <Mic size={14} />}
                {isDictating ? 'Stop' : 'Dictate'}
              </button>
              <button
                onClick={handleCreateNote}
                disabled={!newNote.trim()}
                className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Plus size={14} />
                Save Note
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 mb-6 bg-paper border border-hair-soft rounded-lg p-1 w-fit">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  tab === t.key
                    ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                    : 'text-ink-dim hover:text-ink-muted'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Activity tab ────────────────────────────────── */}
          {tab === 'activity' && (
            <>
              {loadingActivities && activities.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-ink-dim" />
                </div>
              ) : activities.length === 0 ? (
                <div className="text-center py-16">
                  <Clock size={32} className="text-ink-dim mx-auto mb-3" />
                  <p className="text-ink-muted text-sm mb-1">No activity yet</p>
                  <p className="text-ink-dim text-xs">Calls, notes, emails, and stage changes will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activities.map((act) => (
                    <div
                      key={act.id}
                      className={`bg-paper border border-hair-soft border-l-2 ${activityColorBar(act.type)} rounded-xl px-5 py-4 ${
                        act.description && act.description.length > 120 ? 'cursor-pointer hover:bg-[rgba(11,13,14,0.02)] transition-colors' : ''
                      }`}
                      onClick={act.description && act.description.length > 120 ? () => setExpandedActivityIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(act.id)) next.delete(act.id);
                        else next.add(act.id);
                        return next;
                      }) : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0">
                          {activityIcon(act.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-ink text-sm font-medium">{act.title}</p>
                          {act.description && (() => {
                            const text = humaniseDates(act.description);
                            const isLong = text.length > 120;
                            const isExpanded = expandedActivityIds.has(act.id);
                            return (
                              <p className="text-ink-muted text-sm mt-1 leading-relaxed whitespace-pre-wrap">
                                {isLong && !isExpanded ? text.slice(0, 120) + '...' : text}
                              </p>
                            );
                          })()}
                        </div>
                        <span className="text-ink-dim text-xs flex-shrink-0 mt-0.5">
                          {formatDate(act.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Load more */}
                  {activities.length < activityTotal && (
                    <div className="text-center pt-2">
                      <button
                        onClick={() => loadActivities(activities.length)}
                        disabled={loadingActivities}
                        className="text-ink-muted text-sm hover:text-ink transition-all flex items-center gap-2 mx-auto disabled:opacity-50"
                      >
                        {loadingActivities ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : null}
                        Load more ({activityTotal - activities.length} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Transcripts tab ─────────────────────────────── */}
          {tab === 'transcripts' && (
            <>
              {/* Dictation composer — Wispr Flow / built-in macOS dictation
                  drops voice into this textarea. No special integration needed. */}
              <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider">
                    Dictate a transcript
                  </h3>
                  <span className="text-ink-faint text-[11px]">
                    Tip: trigger Wispr Flow while focused here, then save.
                  </span>
                </div>
                <textarea
                  value={transcriptDraft}
                  onChange={(e) => setTranscriptDraft(e.target.value)}
                  placeholder="Click here, then dictate the call. Anything you say lands in this field — save when you're done."
                  rows={6}
                  className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all resize-y leading-relaxed"
                />

                {transcriptError && (
                  <div className="mt-3 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg px-3 py-2">
                    <p className="text-risk text-sm">{transcriptError}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => handleSaveTranscript(false)}
                    disabled={savingTranscript || !transcriptDraft.trim()}
                    className="bg-ink text-white text-sm font-medium rounded-full px-5 py-2 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {savingTranscript ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {savingTranscript ? 'Saving...' : 'Save transcript'}
                  </button>
                  <button
                    onClick={() => handleSaveTranscript(true)}
                    disabled={savingTranscript || !transcriptDraft.trim()}
                    className="border border-hair-strong text-ink text-sm font-medium rounded-full px-5 py-2 hover:bg-[rgba(11,13,14,0.03)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Mail size={14} />
                    Save and draft email
                  </button>
                </div>
              </div>

              {loadingCalls ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-ink-dim" />
                </div>
              ) : callLogs.length === 0 ? (
                <div className="text-center py-12 bg-paper border border-hair-soft rounded-xl">
                  <p className="text-ink-muted text-sm">No transcripts yet.</p>
                  <p className="text-ink-dim text-xs mt-1">Dictate one above to get started.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {callLogs.map((call) => {
                    const isExpanded = expandedCallId === call.id;
                    return (
                      <div
                        key={call.id}
                        className="bg-paper border border-hair-soft rounded-xl overflow-hidden"
                      >
                        <button
                          onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                          className="w-full px-5 py-4 flex items-center gap-4 hover:bg-[rgba(10,156,212,0.04)] transition-all text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="text-ink text-sm font-medium">
                                {formatDate(call.createdAt)}
                              </span>
                              <span className="text-ink-dim text-xs flex items-center gap-1">
                                <Clock size={10} />
                                {formatDuration(call.duration)}
                              </span>
                            </div>
                            {call.summary && (
                              <p className="text-ink-muted text-sm truncate">
                                {call.summary}
                              </p>
                            )}
                          </div>
                          <span className={`text-[10px] px-2.5 py-1 rounded-full flex-shrink-0 ${dispositionBadgeStyle(call.disposition)}`}>
                            {dispositionLabel(call.disposition)}
                          </span>
                          {isExpanded ? (
                            <ChevronUp size={14} className="text-ink-dim flex-shrink-0" />
                          ) : (
                            <ChevronDown size={14} className="text-ink-dim flex-shrink-0" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="px-5 pb-5 border-t border-hair-soft">
                            {/* Summary */}
                            {call.summary && (
                              <div className="mt-4 mb-4">
                                <h4 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                                  Summary
                                </h4>
                                <p className="text-ink-muted text-sm leading-relaxed">
                                  {call.summary}
                                </p>
                              </div>
                            )}

                            {/* Key topics */}
                            {call.keyTopics && call.keyTopics.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                                  Key Topics
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                  {call.keyTopics.map((topic, i) => (
                                    <span
                                      key={i}
                                      className="bg-tray text-ink-muted text-xs px-2.5 py-0.5 rounded-full"
                                    >
                                      {topic}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Action items */}
                            {call.actionItems && call.actionItems.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                                  Action Items
                                </h4>
                                <ul className="space-y-1">
                                  {call.actionItems.map((item, i) => (
                                    <li key={i} className="text-ink-muted text-sm flex items-start gap-2">
                                      <span className="text-sky-ink mt-0.5 flex-shrink-0">-</span>
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Full transcript */}
                            {call.transcript && (
                              <div className="mt-3">
                                <h4 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-1.5">
                                  Full Transcript
                                </h4>
                                <div className="bg-tray rounded-lg p-4 max-h-60 overflow-y-auto">
                                  <p className="text-ink-muted text-sm whitespace-pre-wrap leading-relaxed font-mono">
                                    {call.transcript}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Generate email from this transcript */}
                            {call.transcript && (
                              <div className="mt-3 flex items-center justify-end">
                                <button
                                  onClick={() => {
                                    try {
                                      sessionStorage.setItem(`transcript-context-${lead.id}`, call.transcript || '');
                                    } catch {
                                      // Non-critical — composer will still load.
                                    }
                                    navigate(`/compose/${lead.id}`);
                                  }}
                                  className="border border-hair-strong text-ink text-sm font-medium rounded-full px-4 py-1.5 hover:bg-[rgba(11,13,14,0.03)] transition-all flex items-center gap-2"
                                >
                                  <Mail size={13} />
                                  Send email based on this
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Notes tab ───────────────────────────────────── */}
          {tab === 'notes' && (
            <>
              {/* Notes list */}
              {loadingNotes ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-ink-dim" />
                </div>
              ) : notes.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={32} className="text-ink-dim mx-auto mb-3" />
                  <p className="text-ink-muted text-sm mb-1">No notes yet</p>
                  <p className="text-ink-dim text-xs">Use the form above to add your first note.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notes.map((note) => {
                    const isEditing = editingNoteId === note.id;
                    return (
                      <div
                        key={note.id}
                        className="bg-paper border border-hair-soft rounded-xl px-5 py-4"
                      >
                        {isEditing ? (
                          <>
                            <textarea
                              value={editingNoteContent}
                              onChange={(e) => setEditingNoteContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  if (editingNoteContent.trim()) handleUpdateNote(note.id);
                                }
                                if (e.key === 'Escape') {
                                  setEditingNoteId(null);
                                  setEditingNoteContent('');
                                }
                              }}
                              rows={3}
                              className="w-full bg-tray border border-[rgba(10,156,212,0.4)] rounded-lg px-4 py-3 text-ink text-sm focus:outline-none transition-all resize-none leading-relaxed mb-3"
                              autoFocus
                            />
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => {
                                  setEditingNoteId(null);
                                  setEditingNoteContent('');
                                }}
                                className="text-ink-dim hover:text-ink-muted text-sm transition-all flex items-center gap-1"
                              >
                                <X size={13} />
                                Cancel
                              </button>
                              <button
                                onClick={() => handleUpdateNote(note.id)}
                                className="bg-ink text-white font-bold rounded-lg px-4 py-1.5 text-sm hover:bg-ink/90 transition-all flex items-center gap-1"
                              >
                                <Check size={13} />
                                Save
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-ink-muted text-sm leading-relaxed whitespace-pre-wrap">
                                {note.content}
                              </p>
                              <p className="text-ink-dim text-xs mt-2">
                                {note.createdBy && note.createdBy !== 'unknown' && (
                                  <span className="text-sky-ink font-medium">{note.createdBy}</span>
                                )}
                                {note.createdBy && note.createdBy !== 'unknown' && ' · '}
                                {formatDate(note.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditingNoteContent(note.content);
                                }}
                                className="text-ink-dim hover:text-ink-muted p-1.5 rounded-md hover:bg-[rgba(11,13,14,0.03)] transition-all"
                                title="Edit note"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleDeleteNote(note.id)}
                                className="text-ink-dim hover:text-red-400 p-1.5 rounded-md hover:bg-[rgba(11,13,14,0.03)] transition-all"
                                title="Delete note"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Emails tab — conversation view ─────────────── */}
          {tab === 'emails' && (
            <>
              {loadingEmails ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-ink-dim" />
                </div>
              ) : emails.length === 0 ? (
                <div className="text-center py-16">
                  <Mail size={32} className="text-ink-dim mx-auto mb-3" />
                  <p className="text-ink-muted text-sm mb-1">No emails yet</p>
                  <p className="text-ink-dim text-xs mb-4">Sent and received emails with this lead will appear here as a conversation.</p>
                  <button
                    onClick={() => navigate(`/compose/${lead.id}`)}
                    className="bg-transparent text-ink-muted border border-hair-soft rounded-lg px-5 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all inline-flex items-center gap-2"
                  >
                    <Mail size={14} />
                    Send Email
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Group emails by subject thread — most recent thread first */}
                  {(() => {
                    // Group into conversation threads by normalised subject
                    // Emails arrive from API in DESC order (most recent first)
                    const threads = new Map<string, typeof emails>();
                    for (const email of emails) {
                      const normSubject = email.subject
                        .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
                        .trim()
                        .toLowerCase();
                      const key = normSubject || `standalone-${email.id}`;
                      if (!threads.has(key)) threads.set(key, []);
                      threads.get(key)!.push(email);
                    }

                    // Sort threads by most recent email (newest thread first).
                    // If an old chain gets a new reply, it jumps to the top.
                    const sortedThreads = Array.from(threads.entries()).sort(([, a], [, b]) => {
                      const latestA = a.reduce((max, e) => e.createdAt > max ? e.createdAt : max, '');
                      const latestB = b.reduce((max, e) => e.createdAt > max ? e.createdAt : max, '');
                      return latestB.localeCompare(latestA); // DESC
                    });

                    // Within each thread, sort chronologically (oldest first) for natural reading.
                    return sortedThreads.map(([threadKey, threadEmails]) => {
                      const chronological = [...threadEmails].sort((a, b) =>
                        a.createdAt.localeCompare(b.createdAt)
                      );
                      return (
                      <div key={threadKey} className="bg-paper border border-hair-soft rounded-xl overflow-hidden">
                        {/* Thread subject header */}
                        <div className="px-5 py-3 border-b border-hair-soft">
                          <p className="text-ink text-sm font-medium">
                            {chronological[0].subject.replace(/^(re:|fwd?:|fw:)\s*/gi, '').trim() || '(No subject)'}
                          </p>
                          <p className="text-ink-dim text-xs mt-0.5">
                            {chronological.length} message{chronological.length !== 1 ? 's' : ''}
                          </p>
                        </div>

                        {/* Messages in conversation layout — oldest at top, newest at bottom */}
                        <div className="px-4 py-3 space-y-3">
                          {chronological.map((email) => {
                            const isSent = email.direction === 'sent';
                            // Decode HTML entities so "&amp;" / "&#39;" render
                            // as "&" / "'" instead of literal escape sequences.
                            const decodedBody = decodeHtmlEntities(email.bodySnippet);
                            const isLong = decodedBody.length > 200;
                            const isExpanded = expandedEmails.has(email.id);
                            const displayText = decodedBody
                              ? (isLong && !isExpanded ? decodedBody.substring(0, 200) + '...' : decodedBody)
                              : null;

                            return (
                              <div
                                key={email.id}
                                className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  onClick={() => {
                                    if (isLong) {
                                      setExpandedEmails(prev => {
                                        const next = new Set(prev);
                                        if (next.has(email.id)) next.delete(email.id);
                                        else next.add(email.id);
                                        return next;
                                      });
                                    }
                                  }}
                                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                                    isLong ? 'cursor-pointer' : ''
                                  } ${
                                    isSent
                                      ? 'bg-[rgba(10,156,212,0.1)] border border-[rgba(10,156,212,0.15)]'
                                      : 'bg-tray border border-hair-soft'
                                  }`}
                                >
                                  {/* Sender / direction label */}
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`text-xs font-medium ${isSent ? 'text-sky-ink' : 'text-ink-muted'}`}>
                                      {isSent ? 'You' : lead.name.split(' ')[0]}
                                    </span>
                                    <span className="text-ink-dim text-[10px]">
                                      {formatDate(email.createdAt)}
                                    </span>
                                    {email.source === 'dialler' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(10,156,212,0.15)] text-sky-ink">
                                        Dialler
                                      </span>
                                    )}
                                  </div>

                                  {/* Email body */}
                                  {displayText ? (
                                    <>
                                      <p className="text-sm leading-relaxed whitespace-pre-line text-ink">
                                        {displayText}
                                      </p>
                                      {isLong && (
                                        <p className="text-ink-dim text-xs mt-2">
                                          {isExpanded ? 'Click to collapse' : 'Click to read full email'}
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-ink-dim text-sm italic">No preview available</p>
                                  )}

                                  {/* Engagement signals — populated by Resend webhook events. */}
                                  {isSent && (email.deliveredAt || email.openCount > 0 || email.clickCount > 0 || email.bouncedAt) && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-[rgba(10,156,212,0.12)]">
                                      {email.deliveredAt && (
                                        <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-tray text-ink-dim">
                                          Delivered
                                        </span>
                                      )}
                                      {email.openCount > 0 && (
                                        <span
                                          className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-wash text-sky-ink border border-sky-hair"
                                          title={email.lastOpenedAt ? `Last opened ${formatDate(email.lastOpenedAt)}` : ''}
                                        >
                                          Opened {email.openCount > 1 ? `${email.openCount}x` : ''}
                                        </span>
                                      )}
                                      {email.clickCount > 0 && (
                                        <span
                                          className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] text-ok border border-[rgba(16,185,129,0.22)]"
                                          title={email.lastClickedAt ? `Last clicked ${formatDate(email.lastClickedAt)}` : ''}
                                        >
                                          Clicked {email.clickCount > 1 ? `${email.clickCount}x` : ''}
                                        </span>
                                      )}
                                      {email.bouncedAt && (
                                        <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(239,68,68,0.08)] text-risk border border-[rgba(239,68,68,0.22)]">
                                          Bounced
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );});
                  })()}

                  {/* Send email button at bottom */}
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => navigate(`/compose/${lead.id}`)}
                      className="bg-transparent text-ink-muted border border-hair-soft rounded-lg px-5 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all inline-flex items-center gap-2"
                    >
                      <Send size={14} />
                      Send Email
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right sidebar ─────────────────────────────────── */}
        <div className="w-[280px] flex-shrink-0">
          {/* Lead details card */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-4">
            <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-4">
              Lead Details
            </h3>

            <div className="space-y-3">
              {/* Category — editable dropdown, with inline creation so a
                  new industry can be added mid-call without detouring
                  through Settings. Picking "Create category…" swaps the
                  select for a text field. */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Category</p>
                {creatingCategory ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => { setNewCategoryName(e.target.value); setCategoryError(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateCategory();
                        if (e.key === 'Escape') { setCreatingCategory(false); setNewCategoryName(''); setCategoryError(null); }
                      }}
                      placeholder="New category name"
                      maxLength={80}
                      className="flex-1 min-w-0 bg-paper border border-[rgba(10,156,212,0.3)] rounded-md px-2 py-1 text-ink text-sm focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCategory}
                      disabled={!newCategoryName.trim() || savingCategory}
                      className="text-sky-ink hover:text-ink transition-colors disabled:opacity-40"
                      title="Create and assign"
                    >
                      {savingCategory ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingCategory(false); setNewCategoryName(''); setCategoryError(null); }}
                      className="text-ink-dim hover:text-ink-muted transition-colors"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <select
                    value={lead.category || ''}
                    onChange={async (e) => {
                      if (e.target.value === CREATE_CATEGORY_VALUE) {
                        setCreatingCategory(true);
                        setNewCategoryName('');
                        return;
                      }
                      const newCategory = e.target.value || null;
                      try {
                        const updated = await api.updateLead(lead.id, { category: newCategory } as Partial<Lead>);
                        setLead(updated);
                      } catch (err) {
                        console.error('Failed to update category:', err);
                      }
                    }}
                    className="w-full bg-transparent text-ink-muted text-sm py-1 -ml-0.5 px-0.5 border-none focus:outline-none focus:ring-0 cursor-pointer hover:text-sky-ink transition-colors appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a95a0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center', paddingRight: '16px' }}
                  >
                    <option value="">None</option>
                    {/* Ensure current category is always visible even if not in managed list */}
                    {lead.category && !categoryOptions.includes(lead.category) && (
                      <option value={lead.category}>{lead.category}</option>
                    )}
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value={CREATE_CATEGORY_VALUE}>+ Create category…</option>
                  </select>
                )}
                {categoryError && (
                  <p className="text-risk text-xs mt-1">{categoryError}</p>
                )}
              </div>

              {/* Lead source — the channel this lead arrived through.
                  Sits directly under Category so the two dimensions read
                  as a pair: what industry they're in, how they got here. */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Lead Source</p>
                <select
                  value={lead.leadSource || ''}
                  onChange={async (e) => {
                    const newSource = e.target.value || null;
                    try {
                      const updated = await api.updateLead(lead.id, { leadSource: newSource } as Partial<Lead>);
                      setLead(updated);
                    } catch (err) {
                      console.error('Failed to update lead source:', err);
                    }
                  }}
                  className="w-full bg-transparent text-ink-muted text-sm py-1 -ml-0.5 px-0.5 border-none focus:outline-none focus:ring-0 cursor-pointer hover:text-sky-ink transition-colors appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a95a0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center', paddingRight: '16px' }}
                >
                  <option value="">None</option>
                  {/* Keep the current value selectable even if it's been
                      removed from the managed list in Settings. */}
                  {lead.leadSource && !leadSourceOptions.includes(lead.leadSource) && (
                    <option value={lead.leadSource}>{lead.leadSource}</option>
                  )}
                  {leadSourceOptions.map((src) => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              </div>

              {/* Campaign attribution — read-only. Comes from the ad
                  platform via the import, so it's a record of where the
                  lead actually came from rather than something to edit. */}
              {lead.campaign && (
                <div>
                  <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Campaign</p>
                  <p className="text-ink-muted text-sm">{lead.campaign}</p>
                  {lead.campaignContent && (
                    <p className="text-ink-dim text-xs mt-0.5">{lead.campaignContent}</p>
                  )}
                </div>
              )}

              {/* Lead Type row removed (July 2026). It was a leftover from
                  the original dialler's "New Leads vs Callback Leads"
                  session screens, which went with Twilio. Every lead is
                  written as 'new', nothing filters on it, and it was the
                  only place the field surfaced — so it was pure noise in
                  the sidebar. Column left in place; harmless. */}

              {/* Pipeline tier */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Tier</p>
                <p className="text-ink-muted text-sm">{stageLabel(lead.pipelineStage)}</p>
              </div>

              {/* Contacted status */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Status</p>
                {lead.contacted ? (
                  <span className="inline-block bg-[rgba(16,185,129,0.1)] text-[#10b981] text-xs px-2.5 py-1 rounded-full">
                    Contacted
                  </span>
                ) : (
                  <span className="inline-block bg-[rgba(239,68,68,0.08)] text-[#ef4444] text-xs px-2.5 py-1 rounded-full">
                    Not Contacted
                  </span>
                )}
              </div>

              {/* Money. For a prospect this is an estimate of what they'd
                  pay monthly; once they're a client the real figure comes
                  from the retainer history below and this is read-only. */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">
                  {lifecycle === 'client' ? 'Monthly Revenue' : 'Estimated Monthly Revenue'}
                </p>
                {lifecycle === 'client' ? (
                  <p className="text-ink text-sm font-medium">
                    {currentRetainer > 0
                      ? <>${currentRetainer.toLocaleString('en-AU')}<span className="text-ink-dim font-normal">/mo</span></>
                      : <span className="text-ink-dim italic font-normal">Not set</span>}
                  </p>
                ) : (
                  <DealValueEditor
                    value={lead.dealValue ?? 0}
                    onSave={async (val) => {
                      try {
                        const updated = await api.updateLead(lead.id, { dealValue: val } as Partial<Lead>);
                        setLead(updated);
                      } catch (err) {
                        console.error('Failed to update deal value:', err);
                      }
                    }}
                  />
                )}
              </div>

              {/* Last Called removed (July 2026) — call and contact dates
                  live in the notes and activity timeline, which carry the
                  context too. A bare date in the sidebar duplicated that
                  without adding anything. */}

              {/* Created */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Created</p>
                <p className="text-ink-muted text-sm">{formatShortDate(lead.createdAt)}</p>
              </div>
            </div>
          </div>

          {/* Tasks card — pending + completed tasks for this lead */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider">
                Tasks
              </h3>
              <button
                onClick={() => {
                  setShowSetTask(true);
                  // Scroll to the Set Task panel (which renders at top of
                  // page) and focus its first input so the click feels
                  // like it took you somewhere.
                  setTimeout(() => {
                    document.getElementById('set-task-panel')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                    document.getElementById('set-task-label-input')?.focus();
                  }, 50);
                }}
                className="text-sky-ink text-xs hover:underline flex items-center gap-1"
              >
                <Plus size={12} />
                Add
              </button>
            </div>

            {loadingTasks ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={14} className="animate-spin text-ink-dim" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="text-ink-dim text-xs italic">No tasks scheduled.</p>
            ) : (
              <ul className="space-y-2.5">
                {tasks.map((task) => {
                  const today = todayInSydney();
                  const overdue = !task.completed && task.dueDate < today;
                  const dueToday = !task.completed && task.dueDate === today;
                  const isEditing = editingTaskId === task.id;

                  if (isEditing) {
                    return (
                      <li
                        key={task.id}
                        className="bg-sky-wash border border-sky-hair rounded-lg p-2.5 space-y-2"
                      >
                        <input
                          type="text"
                          value={editingTaskLabel}
                          onChange={(e) => setEditingTaskLabel(e.target.value)}
                          placeholder="Task name"
                          className="w-full bg-paper border border-hair-soft rounded px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-sky transition-all"
                        />
                        <input
                          type="date"
                          value={editingTaskDate}
                          onChange={(e) => setEditingTaskDate(e.target.value)}
                          className="w-full bg-paper border border-hair-soft rounded px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-sky transition-all [color-scheme:light]"
                        />
                        {/* Push-back quick picks — same pattern as Set Task panel */}
                        <div className="flex gap-1">
                          {[2, 4, 6, 8].map((weeks) => (
                            <button
                              key={weeks}
                              type="button"
                              onClick={() => setEditingTaskDate(addWeeksFromToday(weeks))}
                              className="flex-1 text-xs rounded-full px-2 py-1 border bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
                            >
                              {weeks}w
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleSaveTaskEdit(task.id)}
                            disabled={savingTaskEdit || !editingTaskLabel.trim() || !editingTaskDate}
                            className="flex-1 bg-ink text-white text-xs font-medium rounded-full px-3 py-1.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                          >
                            {savingTaskEdit ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Save
                          </button>
                          <button
                            onClick={cancelEditingTask}
                            disabled={savingTaskEdit}
                            className="text-ink-muted text-xs px-3 py-1.5 rounded-full hover:bg-[rgba(11,13,14,0.03)] transition-all disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={task.id}
                      className={`flex items-start gap-2 group ${task.completed ? 'opacity-50' : ''}`}
                    >
                      <button
                        onClick={() => handleToggleTask(task)}
                        disabled={togglingTaskId === task.id}
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
                          task.completed
                            ? 'bg-sky-ink border-sky-ink'
                            : 'bg-paper border-hair-strong hover:border-sky-ink'
                        }`}
                        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                      >
                        {togglingTaskId === task.id ? (
                          <Loader2 size={9} className="animate-spin text-white" />
                        ) : task.completed ? (
                          <Check size={10} className="text-white" />
                        ) : null}
                      </button>
                      {/* Click the body to edit (faster than reaching for the pencil) */}
                      <button
                        type="button"
                        onClick={() => startEditingTask(task)}
                        disabled={task.completed}
                        className="flex-1 min-w-0 text-left disabled:cursor-default"
                      >
                        <p className={`text-sm leading-snug ${task.completed ? 'text-ink-dim line-through' : 'text-ink-muted hover:text-ink'}`}>
                          {task.label}
                        </p>
                        <p className={`text-[11px] mt-0.5 ${
                          overdue ? 'text-risk'
                          : dueToday ? 'text-warn'
                          : 'text-ink-dim'
                        }`}>
                          {overdue ? 'Overdue · ' : dueToday ? 'Due today · ' : ''}
                          {humaniseDates(task.dueDate)}
                        </p>
                      </button>
                      {!task.completed && (
                        <button
                          onClick={() => startEditingTask(task)}
                          className="text-ink-faint hover:text-sky-ink transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                          aria-label="Edit task"
                          title="Edit task"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTask(task)}
                        className="text-ink-faint hover:text-risk transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        aria-label="Delete task"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Stats card */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-4">
            <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-4">
              Activity Stats
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={13} className="text-blue-400" />
                  <span className="text-ink-muted text-sm">Notes</span>
                </div>
                <span className="text-ink text-sm font-bold">{totalNotesCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail size={13} className="text-amber-400" />
                  <span className="text-ink-muted text-sm">Emails Sent</span>
                </div>
                <span className="text-ink text-sm font-bold">{totalEmailsCount}</span>
              </div>
            </div>
          </div>

          {/* Projects + retainer. A contact can have many projects over
              time — the first build, then each new piece of work they
              commission. The retainer is per-client and independent of
              how many projects exist. */}
          <ClientPanel
            lead={lead}
            projects={leadProjects}
            retainers={retainers}
            onChanged={async () => {
              const [p, r, fresh] = await Promise.all([
                api.getLeadProjects(lead.id),
                api.getRetainers(lead.id),
                api.getLeadById(lead.id),
              ]);
              setLeadProjects(p);
              setRetainers(r);
              setLead(fresh);
            }}
            onOpenProject={(projectId) => navigate(`/projects/${projectId}`)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Client panel ─────────────────────────────────────────────
//
// Projects and retainer for one contact. A contact can have many
// projects over time — the first build, then each new piece of work.
// The retainer belongs to the CLIENT, so extra work bumps one monthly
// figure rather than opening a second billing line.

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  building: 'In Build',
  live: 'Live',
  ended: 'Ended',
};

function ClientPanel({
  lead,
  projects,
  retainers,
  onChanged,
  onOpenProject,
}: {
  lead: Lead;
  projects: Project[];
  retainers: api.ClientRetainerEntry[];
  onChanged: () => Promise<void>;
  onOpenProject: (projectId: number) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [retainerInput, setRetainerInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<number | null>(null);

  const isFirst = projects.length === 0;
  const isClient = projects.some((p) => p.status === 'live');
  const todayIso = new Date().toISOString().slice(0, 10);
  const current = retainers
    .filter((r) => r.effectiveFrom <= todayIso)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.id - a.id))[0];
  const currentAmount = current?.monthlyAmount ?? 0;

  const reset = () => {
    setShowForm(false);
    setName('');
    setBrief('');
    setRetainerInput('');
    setError(null);
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const amount = parseFloat(retainerInput);
      await api.startProject(lead.id, {
        name: name.trim() || undefined,
        description: brief.trim() || null,
        // A first project SETS the retainer; later work ADDS to it, so
        // the same input means "what this is worth per month" either way.
        ...(Number.isFinite(amount) && amount !== 0
          ? isFirst ? { monthlyRetainer: amount } : { retainerDelta: amount }
          : {}),
      });
      reset();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const setProjectStatus = async (projectId: number, status: ProjectStatus) => {
    setBusyProjectId(projectId);
    try {
      await api.updateProject(projectId, { status });
      await onChanged();
    } catch (err) {
      console.error('Failed to update project status:', err);
    } finally {
      setBusyProjectId(null);
    }
  };

  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider">
          {isClient ? 'Client' : 'Projects'}
        </h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sky-ink text-xs font-medium hover:underline flex items-center gap-1"
          >
            <Plus size={12} />
            {isFirst ? 'Convert to project' : 'New project'}
          </button>
        )}
      </div>

      {/* Retainer — the client's single monthly figure */}
      {(isClient || retainers.length > 0) && (
        <div className="mb-4 pb-4 border-b border-hair-soft">
          <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1">Monthly Revenue</p>
          <p className="text-ink text-xl font-bold">
            ${currentAmount.toLocaleString('en-AU')}
            <span className="text-ink-dim text-sm font-normal">/mo</span>
          </p>
          <p className="text-ink-dim text-xs mt-0.5">
            ${(currentAmount * 12).toLocaleString('en-AU')} a year
            {current?.effectiveFrom && ` · since ${current.effectiveFrom}`}
          </p>
          {retainers.length > 1 && (
            <details className="mt-2">
              <summary className="text-ink-dim text-xs cursor-pointer hover:text-ink-muted">
                History ({retainers.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {retainers.map((r) => (
                  <div key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-ink-muted">
                      ${r.monthlyAmount.toLocaleString('en-AU')}
                      <span className="text-ink-dim"> from {r.effectiveFrom}</span>
                    </span>
                    {r.note && <span className="text-ink-faint truncate max-w-[55%]">{r.note}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* New project form */}
      {showForm && (
        <div className="mb-4 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isFirst ? `${lead.company || lead.name} build` : 'What are we adding?'}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)]"
          />
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Brief — what's involved"
            rows={3}
            className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] resize-none"
          />
          <div>
            <input
              type="number"
              value={retainerInput}
              onChange={(e) => setRetainerInput(e.target.value)}
              placeholder={isFirst ? 'Monthly retainer' : 'Adds to retainer, e.g. 700'}
              className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)]"
            />
            {!isFirst && retainerInput && Number.isFinite(parseFloat(retainerInput)) && (
              <p className="text-ink-dim text-xs mt-1">
                ${currentAmount.toLocaleString('en-AU')} → $
                {Math.max(0, currentAmount + parseFloat(retainerInput)).toLocaleString('en-AU')}/mo
              </p>
            )}
          </div>
          {error && <p className="text-risk text-xs">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="bg-ink text-white text-xs font-medium rounded-full px-4 py-2 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Create project
            </button>
            <button onClick={reset} className="text-ink-dim hover:text-ink-muted text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        !showForm && (
          <p className="text-ink-dim text-xs italic">
            No projects yet. Convert this lead when the deal is done.
          </p>
        )
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div key={p.id} className="bg-cream border border-hair-soft rounded-lg px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onOpenProject(p.id)}
                  className="text-ink text-sm font-medium text-left hover:text-sky-ink transition-colors truncate"
                >
                  {p.name}
                </button>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                    p.status === 'live'
                      ? 'bg-[rgba(16,185,129,0.12)] text-[#0f9d70]'
                      : p.status === 'building'
                        ? 'bg-[rgba(245,158,11,0.15)] text-warn'
                        : 'bg-[rgba(11,13,14,0.05)] text-ink-dim'
                  }`}
                >
                  {PROJECT_STATUS_LABEL[p.status]}
                </span>
              </div>
              {/* Status controls. "Restore" is the way back for a client
                  who stopped and later returned — ending every project
                  drops them out of Active Clients, and bringing one back
                  to live returns them, history intact. */}
              <div className="flex items-center gap-2 mt-2">
                {p.status === 'building' && (
                  <button
                    onClick={() => setProjectStatus(p.id, 'live')}
                    disabled={busyProjectId === p.id}
                    className="text-[11px] text-sky-ink hover:underline disabled:opacity-40"
                  >
                    Mark live
                  </button>
                )}
                {p.status === 'live' && (
                  <button
                    onClick={() => setProjectStatus(p.id, 'ended')}
                    disabled={busyProjectId === p.id}
                    className="text-[11px] text-ink-dim hover:text-risk disabled:opacity-40"
                  >
                    End
                  </button>
                )}
                {p.status === 'ended' && (
                  <button
                    onClick={() => setProjectStatus(p.id, 'live')}
                    disabled={busyProjectId === p.id}
                    className="text-[11px] text-sky-ink hover:underline disabled:opacity-40"
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Deal Value editor ────────────────────────────────────────
// Click-to-edit AUD value with $ prefix. Empty = $0 / unset.

function DealValueEditor({
  value,
  onSave,
}: {
  value: number;
  onSave: (val: number) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value > 0 ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value > 0 ? String(value) : '');
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const cleaned = draft.replace(/[^\d.]/g, '');
    const num = cleaned ? Math.max(0, parseFloat(cleaned)) : 0;
    if (!isNaN(num) && num !== value) {
      await onSave(num);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value > 0 ? String(value) : '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-ink-dim text-sm">$</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          className="bg-cream border border-hair-soft rounded px-2 py-0.5 text-ink text-sm focus:outline-none focus:border-sky w-24"
          placeholder="0"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-ink-muted text-sm hover:text-sky-ink transition-colors text-left"
      title="Click to edit"
    >
      {value > 0
        ? `$${value.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
        : <span className="text-ink-dim italic">Not set</span>}
    </button>
  );
}
