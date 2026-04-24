import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Device, Call } from '@twilio/voice-sdk';
import {
  Phone,
  PhoneOff,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Pencil,
  Check,
  X,
  Clock,
  ShieldAlert,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Globe,
  User,
  Mail,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useDialler } from '../hooks/useDiallerSession';
import * as api from '../services/api';
import type { Lead, CallLog } from '../types';

// ── Previous Call Intel Panel ─────────────────────────────────
// Shows a clean summary of past calls when the lead has been called before.

function PreviousCallIntel({ calls, loading }: { calls: CallLog[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (loading || calls.length === 0) return null;

  const lastCall = calls[0]; // most recent
  const dispositionLabel: Record<string, string> = {
    interested: 'Interested',
    not_interested: 'Not Interested',
    no_answer: 'No Answer',
    voicemail: 'Left Voicemail',
  };
  const dispositionColor: Record<string, string> = {
    interested: 'text-sky-ink',
    not_interested: 'text-red-400',
    no_answer: 'text-ink-dim',
    voicemail: 'text-amber-400',
  };

  const formatDur = (s: number | null) => {
    if (!s) return 'N/A';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  // Extract objections / key phrases from summaries and topics
  const allTopics = calls.flatMap((c) => c.keyTopics || []);
  const uniqueTopics = [...new Set(allTopics)].slice(0, 6);

  return (
    <div className="bg-gradient-to-b from-sky-wash to-paper rounded-xl border border-sky-hair mb-6 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-hair-soft">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[rgba(10,156,212,0.12)] flex items-center justify-center">
            <ShieldAlert size={16} className="text-sky-ink" />
          </div>
          <div>
            <h3 className="text-ink text-sm font-bold">Previous Call Intel</h3>
            <p className="text-ink-dim text-xs">{calls.length} previous call{calls.length > 1 ? 's' : ''} on record</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-ink-dim hover:text-ink-muted transition-colors p-1"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Last call summary — always visible */}
      <div className="px-5 py-4 space-y-3">
        {/* Last call meta */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-ink-muted flex items-center gap-1.5">
            <Clock size={12} />
            Last called: {new Date(lastCall.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className={`font-medium ${dispositionColor[lastCall.disposition] || 'text-ink-muted'}`}>
            {dispositionLabel[lastCall.disposition] || lastCall.disposition}
          </span>
          <span className="text-ink-dim">{formatDur(lastCall.duration)}</span>
        </div>

        {/* Summary */}
        {lastCall.summary && (
          <div>
            <p className="text-ink-dim text-[10px] font-bold uppercase tracking-wider mb-1.5">Summary</p>
            <p className="text-ink-muted text-sm leading-relaxed">{lastCall.summary}</p>
          </div>
        )}

        {/* Key topics as tags */}
        {uniqueTopics.length > 0 && (
          <div>
            <p className="text-ink-dim text-[10px] font-bold uppercase tracking-wider mb-1.5">Key Topics</p>
            <div className="flex flex-wrap gap-1.5">
              {uniqueTopics.map((topic) => (
                <span key={topic} className="bg-[rgba(10,156,212,0.08)] text-sky-ink text-[10px] px-2 py-0.5 rounded-full">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action items from last call */}
        {lastCall.actionItems && lastCall.actionItems.length > 0 && (
          <div>
            <p className="text-ink-dim text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <TrendingUp size={10} />
              Action Items / Talking Points
            </p>
            <ul className="space-y-1">
              {lastCall.actionItems.map((item, i) => (
                <li key={i} className="text-ink-muted text-sm flex items-start gap-2">
                  <span className="text-sky-ink mt-0.5">&#8226;</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sentiment */}
        {lastCall.sentiment && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-dim">Sentiment:</span>
            <span className={`font-medium ${
              lastCall.sentiment.toLowerCase().includes('positive') ? 'text-sky-ink' :
              lastCall.sentiment.toLowerCase().includes('negative') ? 'text-red-400' :
              'text-amber-400'
            }`}>{lastCall.sentiment}</span>
          </div>
        )}
      </div>

      {/* Expanded — older calls */}
      {expanded && calls.length > 1 && (
        <div className="border-t border-hair-soft px-5 py-4 space-y-4">
          <p className="text-ink-dim text-[10px] font-bold uppercase tracking-wider">Older Calls</p>
          {calls.slice(1).map((call) => (
            <div key={call.id} className="bg-paper rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-ink-muted">
                  {new Date(call.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className={`font-medium ${dispositionColor[call.disposition] || 'text-ink-muted'}`}>
                  {dispositionLabel[call.disposition] || call.disposition}
                </span>
                <span className="text-ink-dim">{formatDur(call.duration)}</span>
              </div>
              {call.summary && (
                <p className="text-ink-muted text-sm leading-relaxed">{call.summary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DiallerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    currentLead,
    callState,
    callStartTime,
    callDuration,
    transcript,
    stats,
    emailTo,
    emailCc,
    setTwilioCallSid,
    setEmailTo,
    setEmailCc,
    setCurrentLead,
    updateCallState,
    setCallStartTime,
    setCallDuration,
    appendTranscript,
  } = useDialler();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Category filter state
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // Previous call history for the selected lead
  const [previousCalls, setPreviousCalls] = useState<CallLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Inline editing state
  // Twilio Device SDK state
  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const [twilioReady, setTwilioReady] = useState(false);
  const [twilioError, setTwilioError] = useState<string | null>(null);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (field: string) => {
    if (!currentLead) return;
    setSaving(true);
    try {
      const updated = await api.updateLead(currentLead.id, { [field]: editValue || null });
      setCurrentLead(updated);
      // Also update in the leads list
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (err) {
      console.error('Failed to update lead:', err);
    } finally {
      setSaving(false);
      setEditingField(null);
      setEditValue('');
    }
  };

  // ── Fetch previous call history when lead is selected ───────

  useEffect(() => {
    if (!currentLead) {
      setPreviousCalls([]);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    api.getCallHistory(currentLead.id)
      .then((calls) => {
        if (!cancelled) setPreviousCalls(calls);
      })
      .catch(() => {
        if (!cancelled) setPreviousCalls([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => { cancelled = true; };
  }, [currentLead?.id]);

  // ── Initialise Twilio Device on mount ───────────────────────

  useEffect(() => {
    let device: Device | null = null;

    async function initTwilio() {
      try {
        setTwilioError(null);
        const { token } = await api.getTwilioToken();

        device = new Device(token, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          logLevel: 1, // errors only in production
        });

        device.on('error', (err) => {
          console.error('[Twilio] Device error:', err);
          setTwilioError(err.message || 'Twilio device error');
        });

        device.on('tokenWillExpire', async () => {
          // Refresh the token before it expires
          try {
            const { token: newToken } = await api.getTwilioToken();
            device?.updateToken(newToken);
            console.log('[Twilio] Token refreshed');
          } catch (err) {
            console.error('[Twilio] Failed to refresh token:', err);
          }
        });

        // Device is ready for outgoing calls as soon as it's created with a valid token
        // No need to call register() — that's only for incoming calls
        deviceRef.current = device;
        setTwilioReady(true);
        console.log('[Twilio] Device initialised and ready for outgoing calls');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to initialise Twilio';
        console.error('[Twilio] Init failed:', msg);
        setTwilioError(msg);
      }
    }

    initTwilio();

    return () => {
      if (device) {
        device.destroy();
        deviceRef.current = null;
        setTwilioReady(false);
      }
    };
  }, []);

  // ── Load categories + leads on mount ────────────────────────
  // If navigated from a lead profile with loadLeadId, auto-select that lead

  const loadLeadIdFromState = (location.state as { loadLeadId?: number } | null)?.loadLeadId;

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    loadLeads();
  }, []);

  // Auto-select lead when navigating from profile page
  useEffect(() => {
    if (loadLeadIdFromState && !currentLead) {
      api.getLeadById(loadLeadIdFromState)
        .then((lead) => {
          setCurrentLead(lead);
          updateCallState('idle');
          setCallDuration(0);
          setCallStartTime(null);
          setEmailTo(lead.email || '');
          setEmailCc('');
        })
        .catch((err) => console.error('Failed to load lead:', err));
      // Clear the state so refreshing doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [loadLeadIdFromState]);

  const loadLeads = async (category?: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { status: 'not_called' };
      if (category && category !== 'all') params.category = category;
      const data = await api.getLeads(params);
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    loadLeads(cat);
  };

  const selectLead = (lead: Lead) => {
    setCurrentLead(lead);
    updateCallState('idle');
    setCallDuration(0);
    setCallStartTime(null);
    setEmailTo(lead.email || '');
    setEmailCc('');
  };

  // ── Auto-navigate to disposition on call end ─────────────────

  useEffect(() => {
    if (callState === 'ended') {
      const timeout = setTimeout(() => {
        navigate('/disposition');
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [callState, navigate]);

  // ── Call timer ───────────────────────────────────────────────

  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => {
        if (callStartTime) {
          setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState, callStartTime, setCallDuration]);

  // ── Call actions ─────────────────────────────────────────────

  const handleCall = useCallback(async () => {
    if (!currentLead?.phone || !deviceRef.current) {
      console.error('[Twilio] No phone number or device not ready');
      return;
    }

    try {
      updateCallState('ringing');
      setCallDuration(0);

      // Make the call via Twilio Device SDK
      const call = await deviceRef.current.connect({
        params: {
          To: currentLead.phone,
        },
      });

      activeCallRef.current = call;

      // Listen for call events
      call.on('ringing', () => {
        console.log('[Twilio] Call ringing');
        updateCallState('ringing');
      });

      call.on('accept', () => {
        console.log('[Twilio] Call accepted/connected');
        updateCallState('connected');
        setCallStartTime(Date.now());

        // Try client-side CallSid first (works sometimes)
        const clientCallSid = call.parameters?.CallSid || null;
        if (clientCallSid) {
          setTwilioCallSid(clientCallSid);
          console.log('[Twilio] CallSid from client:', clientCallSid);
        }

        // Always fetch the real CallSid from the server (reliable)
        // The server captures it in the voice webhook before the call connects
        if (currentLead?.phone) {
          api.getTwilioCallSid(currentLead.phone).then((serverCallSid) => {
            if (serverCallSid) {
              setTwilioCallSid(serverCallSid);
              console.log('[Twilio] CallSid from server:', serverCallSid);
            }
          }).catch((err) => {
            console.warn('[Twilio] Failed to fetch CallSid from server:', err);
          });
        }

        appendTranscript('[Call connected]');
      });

      call.on('disconnect', () => {
        console.log('[Twilio] Call disconnected');
        updateCallState('ended');
        appendTranscript('[Call ended]');
        activeCallRef.current = null;
      });

      call.on('cancel', () => {
        console.log('[Twilio] Call cancelled');
        updateCallState('idle');
        activeCallRef.current = null;
      });

      call.on('error', (err) => {
        console.error('[Twilio] Call error:', err);
        updateCallState('idle');
        activeCallRef.current = null;
        setTwilioError(`Call failed: ${err.message || 'Unknown error'}`);
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to make call';
      console.error('[Twilio] Connect failed:', msg);
      updateCallState('idle');
      setTwilioError(msg);
    }
  }, [currentLead, updateCallState, setCallStartTime, setCallDuration, appendTranscript]);

  const handleHangUp = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect();
      activeCallRef.current = null;
    }
    updateCallState('ended');
    appendTranscript('[Call ended]');
  }, [updateCallState, appendTranscript]);

  // ── Helpers ──────────────────────────────────────────────────

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Main view ───────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-cream">
      {/* Stats bar */}
      <div className="bg-paper border-b border-hair-soft px-8 py-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-6">
          <span className="text-ink-muted">
            Leads:{' '}
            <span className="text-ink font-medium">
              {leads.length}
            </span>
          </span>
          {categories.length > 0 && (
            <>
              <span className="text-ink-dim">|</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCategoryChange('all')}
                  className={`text-xs px-3 py-1 rounded-full transition-all ${
                    activeCategory === 'all'
                      ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                      : 'text-ink-dim hover:text-ink-muted'
                  }`}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleCategoryChange(cat)}
                    className={`text-xs px-3 py-1 rounded-full transition-all ${
                      activeCategory === cat
                        ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                        : 'text-ink-dim hover:text-ink-muted'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-6">
          <span className="text-ink-muted">
            Calls made:{' '}
            <span className="text-ink font-medium">
              {stats.callsMade}
            </span>
          </span>
          <span className="text-ink-dim">|</span>
          <span className="text-ink-muted">
            Interested:{' '}
            <span className="text-sky-ink font-medium">
              {stats.interested}
            </span>
          </span>
        </div>
        {/* Twilio status indicator */}
        <div className="flex items-center gap-2">
          {twilioReady ? (
            <span className="flex items-center gap-1.5 text-xs text-sky-ink">
              <Wifi size={12} />
              Phone Ready
            </span>
          ) : twilioError ? (
            <span className="flex items-center gap-1.5 text-xs text-red-400" title={twilioError}>
              <WifiOff size={12} />
              Phone Offline
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-ink-dim">
              <Loader2 size={12} className="animate-spin" />
              Connecting...
            </span>
          )}
        </div>
      </div>

      {/* Main content — two columns */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left column — Lead list */}
        <div className="w-[40%] border-r border-hair-soft flex flex-col bg-paper">
          <div className="px-5 py-3 border-b border-hair-soft">
            <h3 className="font-mono text-sky-ink text-[10.5px] font-bold uppercase tracking-[0.22em]">
              Lead Queue
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-ink-dim" />
              </div>
            ) : leads.length === 0 ? (
              <div className="text-center py-12 px-5">
                <Phone size={24} className="text-ink-dim mx-auto mb-3" />
                <p className="text-ink-dim text-sm">No leads in queue</p>
              </div>
            ) : (
              leads.map((lead) => {
                const isSelected = currentLead?.id === lead.id;
                return (
                  <div
                    key={lead.id}
                    onClick={() => selectLead(lead)}
                    className={`w-full text-left px-5 py-4 border-b border-hair-soft transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[rgba(10,156,212,0.08)] border-l-2 border-l-sky-ink'
                        : 'hover:bg-[rgba(10,156,212,0.04)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-sm font-medium truncate hover:text-sky-ink transition-colors ${lead.name ? 'text-ink' : 'text-ink-dim italic'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/leads/${lead.id}`);
                        }}
                      >
                        {lead.name || 'Unknown'}
                      </span>
                      {lead.category && (
                        <span className="bg-[rgba(10,156,212,0.15)] text-sky-ink text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
                          {lead.category}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-ink-dim">{lead.company || 'No company'}</span>
                      <span className="text-ink-dim">&middot;</span>
                      <span className="text-ink-dim">{lead.phone}</span>
                    </div>
                    {lead.website && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Globe size={10} className="text-ink-dim" />
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-ink-dim text-[11px] hover:text-sky-ink transition-colors truncate max-w-[200px]"
                        >
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      </div>
                    )}
                    {lead.unansweredCalls > 0 && (
                      <div className="flex items-center gap-2 mt-1.5">
                        {lead.voicemailLeft && (
                          <span className="flex items-center gap-1 text-amber-400 text-[10px]">
                            <AlertTriangle size={10} />
                            VM left
                          </span>
                        )}
                        <span className="text-ink-dim text-[10px]">
                          {lead.unansweredCalls} attempt{lead.unansweredCalls > 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column — Selected lead + call controls */}
        <div className="w-[60%] flex flex-col">
          {currentLead ? (
            <>
              {/* Lead info */}
              <div className="p-8 overflow-y-auto flex-1">
                {/* Editable Name */}
                <div className="mb-1 group">
                  {editingField === 'name' ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit('name'); if (e.key === 'Escape') cancelEdit(); }}
                        className="bg-tray border border-[rgba(10,156,212,0.4)] rounded-lg px-3 py-1.5 text-ink text-2xl font-bold tracking-tight focus:outline-none w-full"
                      />
                      <button onClick={() => saveEdit('name')} disabled={saving} className="text-sky-ink hover:text-sky-ink/80 p-1"><Check size={18} /></button>
                      <button onClick={cancelEdit} className="text-ink-dim hover:text-ink-muted p-1"><X size={18} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h1 className="text-ink text-2xl font-bold tracking-tight">
                        {currentLead.name || <span className="text-ink-dim italic">No name</span>}
                      </h1>
                      <button onClick={() => startEdit('name', currentLead.name)} className="opacity-0 group-hover:opacity-100 text-ink-dim hover:text-ink-muted transition-all p-1"><Pencil size={14} /></button>
                    </div>
                  )}
                </div>

                {/* Editable Company */}
                <div className="mb-1 group">
                  {editingField === 'company' ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit('company'); if (e.key === 'Escape') cancelEdit(); }}
                        className="bg-tray border border-[rgba(10,156,212,0.4)] rounded-lg px-3 py-1.5 text-ink-muted text-lg focus:outline-none w-full"
                      />
                      <button onClick={() => saveEdit('company')} disabled={saving} className="text-sky-ink hover:text-sky-ink/80 p-1"><Check size={18} /></button>
                      <button onClick={cancelEdit} className="text-ink-dim hover:text-ink-muted p-1"><X size={18} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-ink-muted text-lg">
                        {currentLead.company || <span className="text-ink-dim italic">No company</span>}
                      </p>
                      <button onClick={() => startEdit('company', currentLead.company || '')} className="opacity-0 group-hover:opacity-100 text-ink-dim hover:text-ink-muted transition-all p-1"><Pencil size={14} /></button>
                    </div>
                  )}
                </div>

                {/* Phone (not editable — display only) */}
                <p className="text-sky-ink font-mono text-lg mb-1">
                  {currentLead.phone || <span className="text-ink-dim italic font-sans">No phone</span>}
                </p>

                {/* Editable Email */}
                <div className="mb-1 group">
                  {editingField === 'email' ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="email"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit('email'); if (e.key === 'Escape') cancelEdit(); }}
                        className="bg-tray border border-[rgba(10,156,212,0.4)] rounded-lg px-3 py-1.5 text-ink-muted text-sm focus:outline-none w-full"
                      />
                      <button onClick={() => saveEdit('email')} disabled={saving} className="text-sky-ink hover:text-sky-ink/80 p-1"><Check size={16} /></button>
                      <button onClick={cancelEdit} className="text-ink-dim hover:text-ink-muted p-1"><X size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-ink-muted text-sm">
                        {currentLead.email || <span className="text-ink-dim italic">No email</span>}
                      </p>
                      <button onClick={() => startEdit('email', currentLead.email || '')} className="opacity-0 group-hover:opacity-100 text-ink-dim hover:text-ink-muted transition-all p-1"><Pencil size={12} /></button>
                    </div>
                  )}
                </div>

                {/* Clickable Website */}
                <div className="mb-6 group">
                  {editingField === 'website' ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit('website'); if (e.key === 'Escape') cancelEdit(); }}
                        placeholder="https://example.com"
                        className="bg-tray border border-[rgba(10,156,212,0.4)] rounded-lg px-3 py-1.5 text-ink-muted text-sm focus:outline-none w-full"
                      />
                      <button onClick={() => saveEdit('website')} disabled={saving} className="text-sky-ink hover:text-sky-ink/80 p-1"><Check size={16} /></button>
                      <button onClick={cancelEdit} className="text-ink-dim hover:text-ink-muted p-1"><X size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {currentLead.website ? (
                        <a
                          href={currentLead.website.startsWith('http') ? currentLead.website : `https://${currentLead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-ink text-sm hover:underline flex items-center gap-1"
                        >
                          {currentLead.website}
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-ink-dim italic text-sm">No website</span>
                      )}
                      <button onClick={() => startEdit('website', currentLead.website || '')} className="opacity-0 group-hover:opacity-100 text-ink-dim hover:text-ink-muted transition-all p-1"><Pencil size={12} /></button>
                    </div>
                  )}
                </div>

                {/* Call button area */}
                <div className="flex items-center gap-4 mb-8">
                  {callState === 'idle' && (
                    <>
                      <button
                        onClick={handleCall}
                        disabled={!twilioReady || !currentLead?.phone || currentLead.phone === 'TBD'}
                        className={`font-bold rounded-xl px-8 py-3 transition-all flex items-center gap-2 shadow-lg ${
                          twilioReady && currentLead?.phone && currentLead.phone !== 'TBD'
                            ? 'bg-ink text-white hover:bg-ink/90 shadow-emerald-500/20'
                            : 'bg-tray text-ink-dim cursor-not-allowed shadow-none'
                        }`}
                      >
                        <Phone size={18} />
                        {!twilioReady ? 'Phone Not Ready' : !currentLead?.phone || currentLead.phone === 'TBD' ? 'No Phone Number' : 'Call'}
                      </button>
                      <button
                        onClick={() => navigate(`/leads/${currentLead.id}`)}
                        className="bg-tray border border-hair-soft text-ink-muted font-medium rounded-xl px-6 py-3 hover:text-ink hover:border-hair-strong transition-all flex items-center gap-2"
                      >
                        <User size={18} />
                        View Profile
                      </button>
                    </>
                  )}

                  {callState === 'ringing' && (
                    <div className="flex items-center gap-4">
                      <div className="bg-amber-500 text-white font-bold rounded-xl px-8 py-3 flex items-center gap-2 animate-pulse">
                        <Phone size={18} />
                        Ringing...
                      </div>
                      <button
                        onClick={handleHangUp}
                        className="bg-red-500 hover:bg-red-600 text-ink font-bold rounded-xl px-6 py-3 transition-all flex items-center gap-2"
                      >
                        <PhoneOff size={18} />
                        Cancel
                      </button>
                    </div>
                  )}

                  {callState === 'connected' && (
                    <div className="flex items-center gap-4">
                      <div className="bg-ink text-white font-bold rounded-xl px-8 py-3 flex items-center gap-2 ring-2 ring-emerald-500/30">
                        <Phone size={18} />
                        Connected — {formatDuration(callDuration)}
                      </div>
                      <button
                        onClick={handleHangUp}
                        className="bg-red-500 hover:bg-red-600 text-ink font-bold rounded-xl px-6 py-3 transition-all flex items-center gap-2"
                      >
                        <PhoneOff size={18} />
                        Hang Up
                      </button>
                    </div>
                  )}

                  {callState === 'ended' && (
                    <div className="bg-tray text-ink-dim font-bold rounded-xl px-8 py-3 flex items-center gap-2">
                      <PhoneOff size={18} />
                      Call Ended — {formatDuration(callDuration)}
                    </div>
                  )}
                </div>

                {/* Email prep — visible during/after call so email + CC can be added mid-call */}
                {(callState === 'ringing' || callState === 'connected' || callState === 'ended') && (
                  <div className="bg-tray rounded-xl p-5 mb-6 border border-hair-soft">
                    <h3 className="text-ink text-sm font-bold mb-3 flex items-center gap-2">
                      <Mail size={14} className="text-sky-ink" />
                      Email Prep
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-ink-dim text-xs font-medium block mb-1">To</label>
                        <input
                          type="email"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          placeholder="recipient@company.com"
                          className="w-full bg-paper border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-ink-dim text-xs font-medium block mb-1">CC</label>
                        <input
                          type="text"
                          value={emailCc}
                          onChange={(e) => setEmailCc(e.target.value)}
                          placeholder="e.g. partner@company.com, assistant@company.com"
                          className="w-full bg-paper border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                        />
                        <p className="text-ink-dim text-[10px] mt-1">These carry through to the follow-up email</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Call history */}
                {(currentLead.unansweredCalls > 0 || currentLead.voicemailLeft) && (
                  <div className="bg-tray rounded-xl p-5 mb-6">
                    <h3 className="text-ink text-sm font-bold mb-3">
                      Call History
                    </h3>
                    <div className="space-y-2 text-sm">
                      <p className="text-ink-muted">
                        Call attempts:{' '}
                        <span className="text-ink">
                          {currentLead.unansweredCalls}
                        </span>
                      </p>
                      {currentLead.voicemailLeft && (
                        <p className="text-amber-400 flex items-center gap-2">
                          <AlertTriangle size={14} />
                          Voicemail left
                          {currentLead.voicemailDate &&
                            ` on ${new Date(currentLead.voicemailDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Previous Call Intel — only shows if lead has been called before */}
                {previousCalls.length > 0 && (
                  <PreviousCallIntel calls={previousCalls} loading={loadingHistory} />
                )}
                {loadingHistory && previousCalls.length === 0 && (
                  <div className="bg-tray rounded-xl p-5 mb-6 flex items-center gap-3">
                    <Loader2 size={16} className="animate-spin text-ink-dim" />
                    <span className="text-ink-dim text-sm">Loading call history...</span>
                  </div>
                )}

                {/* Live transcript */}
                {transcript && (
                  <div className="bg-tray rounded-xl p-5">
                    <h3 className="text-ink-dim text-xs font-bold uppercase tracking-wider mb-2">
                      Live Transcript
                    </h3>
                    <p className="text-ink-muted text-sm whitespace-pre-wrap leading-relaxed">
                      {transcript}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Phone size={32} className="text-ink-dim mx-auto mb-3" />
                <p className="text-ink-dim text-sm">
                  Select a lead from the list to start calling
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
