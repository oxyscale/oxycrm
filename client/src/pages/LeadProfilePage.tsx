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
  Temperature,
  ActivityType,
} from '../types';

// ── Constants ────────────────────────────────────────────────

const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'call_booked', label: 'Call Booked' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'five_strikes', label: 'Five Strikes' },
];

const TEMPERATURES: Temperature[] = ['hot', 'warm', 'cold'];

const ACTIVITY_LIMIT = 20;

// ── Tabs ─────────────────────────────────────────────────────

type Tab = 'activity' | 'calls' | 'notes' | 'emails';

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

function temperatureColor(temp: Temperature | null) {
  switch (temp) {
    case 'hot': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'warm': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'cold': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    default: return 'bg-tray text-ink-dim border-hair-soft';
  }
}

function temperatureActiveStyle(temp: Temperature) {
  switch (temp) {
    case 'hot': return 'bg-red-500/20 text-red-400 border-red-500/40';
    case 'warm': return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    case 'cold': return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
  }
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

  // Temperature
  const [updatingTemp, setUpdatingTemp] = useState(false);

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
    if (tab === 'calls') loadCalls();
    if (tab === 'notes') loadNotes();
    if (tab === 'emails') loadEmails();
  }, [tab, lead?.id]);

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

  // ── Actions ────────────────────────────────────────────────

  const handleUpdateField = async (field: string, value: string) => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, { [field]: value || null });
      setLead(updated);
    } catch (err) {
      console.error(`Failed to update ${field}:`, err);
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

  const handleTemperatureChange = async (temp: Temperature) => {
    if (!lead || lead.temperature === temp) return;
    setUpdatingTemp(true);
    try {
      const updated = await api.updateLeadTemperature(lead.id, temp);
      setLead(updated);
      if (tab === 'activity') loadActivities();
    } catch (err) {
      console.error('Failed to update temperature:', err);
    } finally {
      setUpdatingTemp(false);
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
    { key: 'calls', label: 'Calls' },
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
        {/* Call button */}
        <button
          onClick={() => navigate('/dialler', { state: { loadLeadId: lead.id } })}
          className="flex items-center gap-2 bg-ink text-white font-bold rounded-lg px-4 py-2.5 text-sm hover:bg-ink/90 transition-all"
        >
          <Phone size={15} />
          Call
        </button>

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

        {/* Follow-up date */}
        <div className="flex items-center gap-2 bg-paper border border-hair-soft rounded-lg px-3 py-1.5">
          <CalendarDays size={13} className="text-ink-dim flex-shrink-0" />
          <input
            type="date"
            value={lead.followUpDate || ''}
            onChange={async (e) => {
              const val = e.target.value || null;
              try {
                const updated = await api.updateLead(lead.id, {
                  followUpDate: val,
                  ...(val && lead.pipelineStage !== 'follow_up' ? { pipelineStage: 'follow_up' } : {}),
                } as Partial<Lead>);
                setLead(updated);
                if (tab === 'activity') loadActivities();
              } catch (err) {
                console.error('Failed to update follow-up date:', err);
              }
            }}
            className="bg-transparent text-ink-muted text-xs focus:outline-none [color-scheme:dark] cursor-pointer"
            title="Follow-up date"
          />
          {lead.followUpDate && (() => {
            const today = new Date().toISOString().split('T')[0];
            const isOverdue = lead.followUpDate < today;
            const isToday = lead.followUpDate === today;
            return isOverdue ? (
              <span className="text-red-400 text-[10px] font-medium">Overdue</span>
            ) : isToday ? (
              <span className="text-amber-400 text-[10px] font-medium">Today</span>
            ) : null;
          })()}
          {lead.followUpDate && (
            <button
              onClick={async () => {
                try {
                  const updated = await api.updateLead(lead.id, { followUpDate: null } as Partial<Lead>);
                  setLead(updated);
                } catch (err) {
                  console.error('Failed to clear follow-up date:', err);
                }
              }}
              className="text-ink-dim hover:text-ink-muted transition-colors"
              title="Clear follow-up date"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Temperature toggle */}
        <div className="flex items-center gap-1 bg-paper border border-hair-soft rounded-lg p-1">
          {TEMPERATURES.map((temp) => (
            <button
              key={temp}
              onClick={() => handleTemperatureChange(temp)}
              disabled={updatingTemp}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all border ${
                lead.temperature === temp
                  ? temperatureActiveStyle(temp)
                  : 'border-transparent text-ink-dim hover:text-ink-muted'
              } disabled:opacity-50`}
            >
              {temp}
            </button>
          ))}
        </div>
      </div>

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
                              {act.description}
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

          {/* ── Calls tab ───────────────────────────────────── */}
          {tab === 'calls' && (
            <>
              {loadingCalls ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-ink-dim" />
                </div>
              ) : callLogs.length === 0 ? (
                <div className="text-center py-16">
                  <Phone size={32} className="text-ink-dim mx-auto mb-3" />
                  <p className="text-ink-muted text-sm mb-1">No calls recorded</p>
                  <p className="text-ink-dim text-xs mb-4">Call this lead from the dialler to see call history here.</p>
                  <button
                    onClick={() => navigate('/dialler', { state: { loadLeadId: lead.id } })}
                    className="bg-ink text-white font-bold rounded-lg px-5 py-2.5 text-sm hover:bg-ink/90 transition-all inline-flex items-center gap-2"
                  >
                    <Phone size={14} />
                    Call Lead
                  </button>
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

              {/* Status */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Status</p>
                <span
                  className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                    lead.status === 'called'
                      ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                      : 'bg-tray text-ink-muted'
                  }`}
                >
                  {lead.status === 'called' ? 'Called' : 'Not Called'}
                </span>
              </div>

              {/* Pipeline stage */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Pipeline Stage</p>
                <p className="text-ink-muted text-sm">{stageLabel(lead.pipelineStage)}</p>
              </div>

              {/* Temperature */}
              <div>
                <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Temperature</p>
                {lead.temperature ? (
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-full border capitalize ${temperatureColor(lead.temperature)}`}>
                    {lead.temperature}
                  </span>
                ) : (
                  <span className="text-ink-dim text-sm italic">Not set</span>
                )}
              </div>

              {/* Unanswered calls */}
              {lead.unansweredCalls > 0 && (
                <div>
                  <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Unanswered Calls</p>
                  <p className="text-amber-400 text-sm">{lead.unansweredCalls}</p>
                </div>
              )}

              {/* Voicemail left */}
              {lead.voicemailLeft && (
                <div>
                  <p className="text-ink-dim text-[11px] uppercase tracking-wider mb-0.5">Voicemail Left</p>
                  <p className="text-blue-400 text-sm">
                    {lead.voicemailDate ? formatShortDate(lead.voicemailDate) : 'Yes'}
                  </p>
                </div>
              )}

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
