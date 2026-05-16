import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  ExternalLink,
  Send,
  Mic,
  MicOff,
} from 'lucide-react';
import * as api from '../services/api';
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
} from '../types';

// ── Constants ────────────────────────────────────────────────

const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'tier_1', label: 'Tier 1' },
  { value: 'tier_2', label: 'Tier 2' },
  { value: 'tier_3', label: 'Tier 3' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const ACTIVITY_LIMIT = 20;

// ── Tabs ─────────────────────────────────────────────────────

type Tab = 'activity' | 'transcripts' | 'notes' | 'emails';

// ── Helpers ──────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-AU', {
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

function stageLabel(stage: PipelineStage) {
  return PIPELINE_STAGES.find((s) => s.value === stage)?.label || stage;
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
  const leadId = Number(id);

  // Core data
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [tab, setTab] = useState<Tab>('activity');

  // Activity tab
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Calls tab
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);

  // Notes tab
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
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

  const handleStageChange = async (stage: PipelineStage) => {
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
      await api.createLeadTask(lead.id, {
        label: taskLabel.trim(),
        dueDate: taskDate,
      });

      // Reload the lead to pick up follow_up_date and any related changes
      const refreshed = await api.getLeadById(lead.id);
      setLead(refreshed);

      // Reset form + close panel
      setTaskLabel('');
      setTaskDate('');
      setShowSetTask(false);

      // Refresh tasks list + activity timeline
      loadTasks();
      if (tab === 'activity') loadActivities();
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
    setSavingNote(true);
    try {
      const note = await api.createNote({ leadId: lead.id, content: newNote.trim() });
      setNotes((prev) => [note, ...prev]);
      setNewNote('');
    } catch (err) {
      console.error('Failed to create note:', err);
    } finally {
      setSavingNote(false);
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
            onClick={() => navigate(-1)}
          >
            Go back
          </PillButton>
        </div>
      </div>
    );
  }

  // ── Stats for sidebar ──────────────────────────────────────

  const totalCallsCount = callLogs.length || 0;
  const totalNotesCount = notes.length || 0;
  const totalEmailsCount = emails.length || 0;

  // ── Render ─────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'activity', label: 'Activity' },
    { key: 'transcripts', label: 'Transcripts' },
    { key: 'notes', label: 'Notes' },
    { key: 'emails', label: 'Emails' },
  ];

  return (
    <div className="p-10 max-w-[1400px] mx-auto bg-cream min-h-full">
      {/* ── Back button ─────────────────────────────────────── */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-ink-dim hover:text-sky-ink transition-all text-sm mb-6"
      >
        <ArrowLeft size={16} />
        Back
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

        {/* Add Note button */}
        <button
          onClick={() => {
            setTab('notes');
            // Focus the note textarea after tab switch
            setTimeout(() => {
              document.getElementById('new-note-input')?.focus();
            }, 100);
          }}
          className="flex items-center gap-2 bg-transparent text-ink-muted border border-hair-soft rounded-lg px-4 py-2.5 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all"
        >
          <Plus size={15} />
          Add Note
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
        <div className="bg-paper border border-sky-hair rounded-xl p-5 mb-8 -mt-6">
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

          <div className="grid grid-cols-[1fr_180px] gap-3 mb-4">
            <div>
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">Task</p>
              <input
                type="text"
                value={taskLabel}
                onChange={(e) => setTaskLabel(e.target.value)}
                placeholder="e.g. Call in July"
                className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all"
              />
            </div>
            <div>
              <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-1.5">Due date</p>
              <input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all [color-scheme:light]"
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
          {/* Call Summary — pinned above the tabs so it's always visible
              before dialling. Shows the rolling AI summary across calls,
              with an empty state for never-called leads. */}
          <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider">
                Call Summary
              </h3>
              {totalCallsCount > 0 && (
                <span className="text-ink-dim text-[11px]">
                  {totalCallsCount} call{totalCallsCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {lead.consolidatedSummary ? (
              <p className="text-ink-muted text-sm leading-relaxed whitespace-pre-line">
                {lead.consolidatedSummary}
              </p>
            ) : (
              <p className="text-ink-dim text-sm italic">
                No call notes available for this lead yet.
              </p>
            )}
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
                      className={`bg-paper border border-hair-soft border-l-2 ${activityColorBar(act.type)} rounded-xl px-5 py-4`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0">
                          {activityIcon(act.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-ink text-sm font-medium">{act.title}</p>
                          {act.description && (
                            <p className="text-ink-muted text-sm mt-1 leading-relaxed">
                              {humaniseDates(act.description)}
                            </p>
                          )}
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
              {/* Add note form */}
              <div className="bg-paper border border-hair-soft rounded-xl p-5 mb-6">
                <textarea
                  id="new-note-input"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleCreateNote();
                    }
                  }}
                  placeholder="Add a note... (Cmd+Enter to save)"
                  rows={3}
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
                    disabled={!newNote.trim() || savingNote}
                    className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {savingNote ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    Save Note
                  </button>
                </div>
              </div>

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
                            const isLong = (email.bodySnippet?.length || 0) > 200;
                            const isExpanded = expandedEmails.has(email.id);
                            const displayText = email.bodySnippet
                              ? (isLong && !isExpanded ? email.bodySnippet.substring(0, 200) + '...' : email.bodySnippet)
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
              {/* Category */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Category</p>
                <p className="text-ink-muted text-sm">
                  {lead.category || (
                    <span className="text-ink-dim italic">None</span>
                  )}
                </p>
              </div>

              {/* Lead type */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Lead Type</p>
                <p className="text-ink-muted text-sm capitalize">{lead.leadType}</p>
              </div>

              {/* Pipeline tier */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Tier</p>
                <p className="text-ink-muted text-sm">{stageLabel(lead.pipelineStage)}</p>
              </div>

              {/* Deal value — inline editable */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Deal Value</p>
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
              </div>

              {/* Last called */}
              {lead.lastCalledAt && (
                <div>
                  <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Last Called</p>
                  <p className="text-ink-muted text-sm">{formatShortDate(lead.lastCalledAt)}</p>
                </div>
              )}

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
                onClick={() => setShowSetTask(true)}
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
                  const today = new Date().toISOString().split('T')[0];
                  const overdue = !task.completed && task.dueDate < today;
                  const dueToday = !task.completed && task.dueDate === today;
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
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug ${task.completed ? 'text-ink-dim line-through' : 'text-ink-muted'}`}>
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
                      </div>
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
                  <Phone size={13} className="text-sky-ink" />
                  <span className="text-ink-muted text-sm">Total Calls</span>
                </div>
                <span className="text-ink text-sm font-bold">{totalCallsCount}</span>
              </div>
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

          {/* Converted to project link */}
          {lead.convertedToProject && (
            <div className="bg-[rgba(10,156,212,0.08)] border border-[rgba(10,156,212,0.15)] rounded-xl p-5">
              <h3 className="text-sky-ink text-xs font-medium uppercase tracking-wider mb-2">
                Converted to Project
              </h3>
              <button
                onClick={() => navigate('/projects')}
                className="text-ink-muted text-sm hover:text-ink transition-all flex items-center gap-1.5"
              >
                <ExternalLink size={13} />
                View Project
              </button>
            </div>
          )}
        </div>
      </div>
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
