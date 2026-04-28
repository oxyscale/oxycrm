import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail,
  Send,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle,
  Check,
  Clock,
  Sparkles,
  Inbox,
  ExternalLink,
  Eye,
  Save,
} from 'lucide-react';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import StatCard from '../components/ui/StatCard';
import PanelCard from '../components/ui/PanelCard';
import PillButton from '../components/ui/PillButton';
import * as api from '../services/api';
import type { EmailDraftWithLead } from '../types';

type StatusFilter = 'ready' | 'pending' | 'failed' | 'all';

export default function EmailBankPage() {
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState<EmailDraftWithLead[]>([]);
  const [stats, setStats] = useState({ ready: 0, pending: 0, failed: 0, sentLast24h: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('ready');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Review panel state (edits to the selected draft)
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTo, setEditTo] = useState('');
  const [editCc, setEditCc] = useState('');
  const [editStage, setEditStage] = useState<'follow_up' | 'call_booked'>('follow_up');
  const [editIncludeHeader, setEditIncludeHeader] = useState(true);
  const [editIncludeCapabilities, setEditIncludeCapabilities] = useState(false);
  const [editIncludeBookACall, setEditIncludeBookACall] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [savingExplicit, setSavingExplicit] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Live preview state — refreshed via debounced /preview endpoint
  // whenever any field that affects rendering changes.
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadRef = useRef<(filterOverride?: StatusFilter) => Promise<void>>(() => Promise.resolve());

  const load = useCallback(
    async (filterOverride?: StatusFilter) => {
      try {
        const status = filterOverride ?? filter;
        const res = await api.getEmailDrafts(status === 'all' ? undefined : status);
        setDrafts(res.drafts);
        setStats(res.stats);
      } catch (err) {
        console.error('Failed to load email drafts:', err);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Initial + filter-triggered load
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-refresh every 5s so new drafts (and status transitions) appear live.
  useEffect(() => {
    const id = window.setInterval(() => {
      loadRef.current();
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // When the selected draft changes, hydrate the editor
  const selected = drafts.find((d) => d.id === selectedId) || null;
  useEffect(() => {
    if (selected) {
      setEditSubject(selected.subject || '');
      setEditBody(selected.body || '');
      setEditTo(selected.toEmail || '');
      setEditCc(selected.ccEmail || '');
      setEditStage(selected.suggestedStage || 'follow_up');
      setEditIncludeHeader(selected.includeAfterCallHeader);
      setEditIncludeCapabilities(selected.includeCapabilities);
      setEditIncludeBookACall(selected.includeBookACall);
      setDirty(false);
      setActionError(null);
      setActionSuccess(null);
      // Clear preview while we wait for the first render of the new draft.
      setPreviewHtml('');
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first ready draft when list arrives
  useEffect(() => {
    if (!selectedId && drafts.length > 0) {
      const firstReady = drafts.find((d) => d.status === 'ready');
      if (firstReady) setSelectedId(firstReady.id);
    }
  }, [drafts, selectedId]);

  // Saves are debounced + serialised. Tabbing rapidly through To, CC,
  // Subject and Body fields used to fire 4 concurrent PATCH requests
  // whose responses could arrive out of order, leaving the server with
  // a stale value. Now: 250ms debounce coalesces a tab-burst into one
  // request, and the in-flight guard ensures the next save waits for
  // the previous to land.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  const flushSave = useCallback(async () => {
    if (!selected || !dirty) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      await api.updateEmailDraft(selected.id, {
        subject: editSubject,
        body: editBody,
        toEmail: editTo || null,
        ccEmail: editCc || null,
        suggestedStage: editStage,
        includeAfterCallHeader: editIncludeHeader,
        includeCapabilities: editIncludeCapabilities,
        includeBookACall: editIncludeBookACall,
      });
      setDirty(false);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        flushSave();
      }
    }
  }, [
    selected,
    dirty,
    editSubject,
    editBody,
    editTo,
    editCc,
    editStage,
    editIncludeHeader,
    editIncludeCapabilities,
    editIncludeBookACall,
    load,
  ]);

  const saveEdits = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, 250);
  }, [flushSave]);

  // Cancel any pending debounced save when the component unmounts so a
  // late-firing setTimeout doesn't write into a stale draft after the
  // user has navigated away.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // ── Live preview ─────────────────────────────────────────────
  // Whenever any rendered-affecting field changes, debounce 400ms then
  // ask the server for the rendered HTML. Single source of truth: the
  // preview endpoint runs the same buildBrandedEmailHtml the /send
  // endpoint uses, so what Jordan sees is exactly what the recipient
  // gets.
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    if (!selected || selected.status !== 'ready') return;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await api.previewEmailDraft(selectedId, {
          subject: editSubject,
          body: editBody,
          includeAfterCallHeader: editIncludeHeader,
          includeCapabilities: editIncludeCapabilities,
          includeBookACall: editIncludeBookACall,
        });
        setPreviewHtml(res.html);
      } catch (err) {
        console.error('Preview render failed:', err);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [
    selectedId,
    selected,
    editSubject,
    editBody,
    editIncludeHeader,
    editIncludeCapabilities,
    editIncludeBookACall,
  ]);

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setActionError(null);
    try {
      // Save current edits first so sent content matches screen
      if (dirty) {
        await api.updateEmailDraft(selected.id, {
          subject: editSubject,
          body: editBody,
          toEmail: editTo || null,
          ccEmail: editCc || null,
          suggestedStage: editStage,
          includeAfterCallHeader: editIncludeHeader,
          includeCapabilities: editIncludeCapabilities,
          includeBookACall: editIncludeBookACall,
        });
      }
      await api.sendEmailDraft(selected.id);
      setActionSuccess('Sent');
      setSelectedId(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleRetry = async () => {
    if (!selected) return;
    setRetrying(true);
    setActionError(null);
    try {
      await api.retryEmailDraft(selected.id);
      setActionSuccess('Regenerating…');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  // Explicit save — for when Jordan wants to lock in edits without sending
  // and without waiting for the on-blur auto-save to fire.
  const handleSave = async () => {
    if (!selected) return;
    setSavingExplicit(true);
    setActionError(null);
    try {
      await api.updateEmailDraft(selected.id, {
        subject: editSubject,
        body: editBody,
        toEmail: editTo || null,
        ccEmail: editCc || null,
        suggestedStage: editStage,
        includeAfterCallHeader: editIncludeHeader,
        includeCapabilities: editIncludeCapabilities,
        includeBookACall: editIncludeBookACall,
      });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingExplicit(false);
    }
  };

  const handleDiscard = async () => {
    if (!selected) return;
    setDiscarding(true);
    setActionError(null);
    try {
      await api.discardEmailDraft(selected.id);
      setSelectedId(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Discard failed');
    } finally {
      setDiscarding(false);
    }
  };

  const formatAge = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const statusChip = (status: EmailDraftWithLead['status']) => {
    const style = {
      ready: 'bg-sky-wash border-sky-hair text-sky-ink',
      pending: 'bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.24)] text-warn',
      failed: 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.22)] text-risk',
      sent: 'bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.22)] text-ok',
      discarded: 'bg-tray border-hair-soft text-ink-dim',
    }[status];
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.18em] uppercase ${style}`}
      >
        {status}
      </span>
    );
  };

  const canSend = !!selected && selected.status === 'ready' && !!editTo && !!editSubject.trim() && !!editBody.trim();

  // Visibility of the capabilities toggle: only show when the lead's
  // category has a configured CTA URL. Hides clutter for non-manufacturing
  // leads (and any future category we haven't configured CTAs for).
  const showCapabilitiesToggle = !!selected?.categoryHasCta;

  return (
    <div className="p-10 min-h-full bg-cream">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            INBOX · EMAIL BANK
          </EyebrowLabel>
          <SectionHeading size="section">Drafts waiting.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3 max-w-xl">
            AI-written follow-up emails queued from your calls. Review, edit, send at your pace.
          </p>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          eyebrow="Ready"
          value={stats.ready}
          sub={stats.ready > 0 ? 'awaiting review' : 'all clear'}
          subTone={stats.ready > 0 ? 'sky' : 'neutral'}
          icon={<Inbox size={16} />}
          elevated
        />
        <StatCard
          eyebrow="Drafting"
          value={stats.pending}
          sub={stats.pending > 0 ? 'AI is cooking' : '—'}
          subTone={stats.pending > 0 ? 'sky' : 'neutral'}
          icon={<Sparkles size={16} />}
          elevated
        />
        <StatCard
          eyebrow="Failed"
          value={stats.failed}
          sub={stats.failed > 0 ? 'retry or write manually' : '—'}
          subTone={stats.failed > 0 ? 'risk' : 'neutral'}
          icon={<AlertCircle size={16} />}
          elevated
        />
        <StatCard
          eyebrow="Sent today"
          value={stats.sentLast24h}
          sub="last 24h"
          icon={<CheckCircle size={16} />}
          elevated
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(['ready', 'pending', 'failed', 'all'] as StatusFilter[]).map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase transition-all border ${
                active
                  ? 'bg-ink border-ink text-white shadow-btn-hover'
                  : 'bg-paper border-hair-soft text-ink-muted hover:border-sky-hair hover:text-sky-ink'
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* Three-column layout: list | editor | preview */}
      <div className="grid grid-cols-12 gap-5">
        {/* Draft list */}
        <div className="col-span-3">
          <PanelCard eyebrow="QUEUE" title={`${drafts.length} drafts`} elevated padded={false}>
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <Loader2 size={20} className="animate-spin text-ink-dim" />
              </div>
            ) : drafts.length === 0 ? (
              <div className="text-center py-14 px-6">
                <Inbox size={32} className="mx-auto text-sky-ink mb-3" />
                <p className="text-ink-muted text-sm">Nothing in the bank</p>
                <p className="text-ink-dim text-xs mt-1">
                  Drafts appear here after Interested or Voicemail dispositions.
                </p>
              </div>
            ) : (
              <div className="max-h-[720px] overflow-y-auto divide-y divide-hair-soft">
                {drafts.map((d) => {
                  const isSelected = selectedId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className={`w-full text-left px-5 py-4 transition-all ${
                        isSelected
                          ? 'bg-sky-wash border-l-2 border-l-sky-ink'
                          : 'hover:bg-[rgba(10,156,212,0.04)]'
                      } ${d.status === 'pending' ? 'opacity-70' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <span className="text-ink font-medium text-sm truncate">
                          {d.leadName}
                        </span>
                        {statusChip(d.status)}
                      </div>
                      {d.leadCompany && (
                        <p className="text-ink-dim text-xs truncate mb-1">{d.leadCompany}</p>
                      )}
                      <p className="text-ink-muted text-xs truncate">
                        {d.subject || (d.status === 'pending' ? 'Drafting…' : d.status === 'failed' ? 'Draft failed' : '(no subject)')}
                      </p>
                      <p className="font-mono text-[10.5px] text-ink-dim tracking-wide mt-1.5">
                        {d.disposition.toUpperCase()} · {formatAge(d.createdAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </PanelCard>
        </div>

        {/* Right side — editor + preview, or status panel for non-ready states */}
        {!selected ? (
          <div className="col-span-9">
            <PanelCard eyebrow="REVIEW" title="No draft selected" elevated>
              <div className="py-14 text-center">
                <Mail size={32} className="mx-auto text-ink-dim mb-3" />
                <p className="text-ink-muted text-sm">
                  Pick a draft from the queue to review and send.
                </p>
              </div>
            </PanelCard>
          </div>
        ) : selected.status === 'pending' ? (
          <div className="col-span-9">
            <PanelCard eyebrow="DRAFTING" title={selected.leadName} elevated>
              <div className="py-14 text-center">
                <Loader2 size={28} className="mx-auto animate-spin text-sky-ink mb-3" />
                <p className="text-ink text-sm font-medium">Still cooking…</p>
                <p className="text-ink-muted text-xs mt-2 max-w-sm mx-auto">
                  The call recording is being transcribed and summarised. This usually takes 30–120 seconds after the call ends.
                </p>
                <p className="font-mono text-[10.5px] text-ink-dim tracking-wide mt-4">
                  Started {formatAge(selected.createdAt)}
                </p>
              </div>
            </PanelCard>
          </div>
        ) : selected.status === 'failed' ? (
          <div className="col-span-9">
            <PanelCard
              eyebrow="FAILED"
              title={selected.leadName}
              elevated
              right={
                <PillButton
                  variant="outline"
                  size="sm"
                  trailing="none"
                  icon={<RefreshCw size={13} />}
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? 'Retrying…' : 'Retry'}
                </PillButton>
              }
            >
              <div className="py-8 px-2">
                <div className="flex items-start gap-3 bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)] rounded-xl p-4">
                  <AlertCircle size={16} className="text-risk mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="text-risk font-medium">Draft generation failed</p>
                    <p className="text-ink-muted text-xs mt-1">
                      {selected.errorMessage || 'Unknown error'}
                    </p>
                    <p className="text-ink-dim text-xs mt-2">
                      Usually means the Twilio recording never arrived or Claude hit an error. Click Retry to try again, or open the lead profile to write the email manually.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <PillButton
                    variant="ghost"
                    size="sm"
                    trailing="none"
                    icon={<ExternalLink size={13} />}
                    onClick={() => navigate(`/leads/${selected.leadId}`)}
                  >
                    Open lead
                  </PillButton>
                  <PillButton
                    variant="ghost"
                    size="sm"
                    trailing="none"
                    icon={<Trash2 size={13} />}
                    onClick={handleDiscard}
                    disabled={discarding}
                  >
                    Discard
                  </PillButton>
                </div>
              </div>
            </PanelCard>
          </div>
        ) : (
          <>
            {/* Editor — col-span-4 */}
            <div className="col-span-4">
              <PanelCard
                eyebrow={`${selected.disposition.toUpperCase()} · READY`}
                title={
                  <span className="flex items-center gap-2">
                    {selected.leadName}
                    {selected.leadCompany && (
                      <span className="text-ink-muted font-normal">· {selected.leadCompany}</span>
                    )}
                  </span>
                }
                elevated
                right={
                  <button
                    onClick={() => navigate(`/leads/${selected.leadId}`)}
                    className="text-sky-ink text-xs font-medium hover:underline inline-flex items-center gap-1"
                  >
                    Open lead <ExternalLink size={12} />
                  </button>
                }
              >
                <div className="space-y-4">
                  {!editTo && (
                    <div className="bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.24)] rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle size={14} className="text-warn mt-0.5 flex-shrink-0" />
                      <p className="text-warn text-xs">
                        No email on file for this lead. Add a recipient below before sending.
                      </p>
                    </div>
                  )}

                  {/* To / CC row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <EyebrowLabel variant="bare" className="mb-1.5">
                        To
                      </EyebrowLabel>
                      <input
                        type="email"
                        value={editTo}
                        onChange={(e) => {
                          setEditTo(e.target.value);
                          setDirty(true);
                        }}
                        onBlur={saveEdits}
                        placeholder="recipient@company.com"
                        className="w-full bg-tray border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-sky-hair"
                      />
                    </div>
                    <div>
                      <EyebrowLabel variant="bare" className="mb-1.5">
                        CC (optional)
                      </EyebrowLabel>
                      <input
                        type="text"
                        value={editCc}
                        onChange={(e) => {
                          setEditCc(e.target.value);
                          setDirty(true);
                        }}
                        onBlur={saveEdits}
                        placeholder=""
                        className="w-full bg-tray border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-sky-hair"
                      />
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <EyebrowLabel variant="bare" className="mb-1.5">
                      Subject
                    </EyebrowLabel>
                    <input
                      type="text"
                      value={editSubject}
                      onChange={(e) => {
                        setEditSubject(e.target.value);
                        setDirty(true);
                      }}
                      onBlur={saveEdits}
                      className="w-full bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-sky-hair"
                    />
                  </div>

                  {/* Render-blocks toggles */}
                  <div className="bg-tray border border-hair-soft rounded-xl p-3 space-y-2.5">
                    <EyebrowLabel variant="bare">Email blocks</EyebrowLabel>
                    <ToggleRow
                      label='"A note after our chat" header'
                      hint="Editorial italic display headline above the body. Untick for follow-ups after the first."
                      checked={editIncludeHeader}
                      onChange={(v) => {
                        setEditIncludeHeader(v);
                        setDirty(true);
                        saveEdits();
                      }}
                    />
                    {showCapabilitiesToggle && (
                      <ToggleRow
                        label="Capabilities document button"
                        hint="Blue button below the body linking to the manufacturing capabilities site."
                        checked={editIncludeCapabilities}
                        onChange={(v) => {
                          setEditIncludeCapabilities(v);
                          setDirty(true);
                          saveEdits();
                        }}
                      />
                    )}
                    <ToggleRow
                      label='"Book a call" button'
                      hint="Black pill linking to the discovery-call Calendly."
                      checked={editIncludeBookACall}
                      onChange={(v) => {
                        setEditIncludeBookACall(v);
                        setDirty(true);
                        saveEdits();
                      }}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <EyebrowLabel variant="bare" className="mb-1.5">
                      Body
                    </EyebrowLabel>
                    <textarea
                      value={editBody}
                      onChange={(e) => {
                        setEditBody(e.target.value);
                        setDirty(true);
                      }}
                      onBlur={saveEdits}
                      rows={12}
                      className="w-full bg-paper border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm focus:outline-none focus:border-sky-hair resize-none leading-relaxed font-mono"
                    />
                    <p className="text-ink-dim text-[11px] mt-1.5 leading-relaxed">
                      Wrap one outcome phrase in <code className="font-mono text-sky-ink">*asterisks*</code> to render it in italic sky-blue.
                    </p>
                  </div>

                  {/* Pipeline stage toggle */}
                  <div className="flex items-center gap-3">
                    <EyebrowLabel variant="bare">Sends move lead to</EyebrowLabel>
                    <div className="flex gap-1.5">
                      {(['follow_up', 'call_booked'] as const).map((s) => {
                        const active = editStage === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setEditStage(s);
                              setDirty(true);
                              saveEdits();
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-bold tracking-[0.16em] uppercase transition-all border ${
                              active
                                ? 'bg-sky-ink border-sky-ink text-white'
                                : 'bg-paper border-hair-soft text-ink-dim hover:text-ink-muted hover:border-hair'
                            }`}
                          >
                            {s.replace('_', ' ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Feedback + actions */}
                  {actionError && (
                    <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.18)] rounded-xl p-3">
                      <p className="text-risk text-xs">{actionError}</p>
                    </div>
                  )}
                  {actionSuccess && (
                    <div className="bg-sky-wash border border-sky-hair rounded-xl p-3">
                      <p className="text-sky-ink text-xs">{actionSuccess}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-hair-soft">
                    <div className="flex items-center gap-2 text-ink-dim text-xs">
                      <Clock size={12} />
                      Generated {selected.generatedAt ? formatAge(selected.generatedAt) : 'just now'}
                      {dirty && !savedFlash && <span className="text-warn">· unsaved edits</span>}
                      {savedFlash && <span className="text-ok">· saved</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <PillButton
                        variant="ghost"
                        size="sm"
                        trailing="none"
                        icon={<Trash2 size={13} />}
                        onClick={handleDiscard}
                        disabled={discarding}
                      >
                        Discard
                      </PillButton>
                      <PillButton
                        variant="outline"
                        size="sm"
                        trailing="none"
                        icon={
                          savingExplicit
                            ? <Loader2 size={13} className="animate-spin" />
                            : savedFlash
                            ? <Check size={13} />
                            : <Save size={13} />
                        }
                        onClick={handleSave}
                        disabled={!dirty || savingExplicit || sending}
                      >
                        {savingExplicit ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}
                      </PillButton>
                      <PillButton
                        variant="primary"
                        size="md"
                        trailing="none"
                        icon={sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        onClick={handleSend}
                        disabled={!canSend || sending}
                      >
                        {sending ? 'Sending…' : 'Send email'}
                      </PillButton>
                    </div>
                  </div>
                </div>
              </PanelCard>
            </div>

            {/* Live preview — col-span-5 */}
            <div className="col-span-5">
              <PanelCard
                eyebrow="LIVE PREVIEW"
                title="What the recipient sees"
                elevated
                padded={false}
                right={
                  previewLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-ink-dim text-xs font-mono tracking-wider uppercase">
                      <Loader2 size={11} className="animate-spin" />
                      Rendering
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sky-ink text-xs font-mono tracking-wider uppercase">
                      <Eye size={11} />
                      Live
                    </span>
                  )
                }
              >
                <div className="bg-tray rounded-b-2xl overflow-hidden">
                  {previewHtml ? (
                    <iframe
                      title="Email preview"
                      srcDoc={previewHtml}
                      sandbox=""
                      className="w-full bg-cream block"
                      style={{ height: '900px', border: '0' }}
                    />
                  ) : (
                    <div className="flex items-center justify-center" style={{ height: '900px' }}>
                      <Loader2 size={20} className="animate-spin text-ink-dim" />
                    </div>
                  )}
                </div>
              </PanelCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Toggle row ───────────────────────────────────────────────
// A single labelled checkbox with hint copy. Used for the three
// render-block toggles in the editor pane.
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-hair text-sky-ink focus:ring-sky-hair cursor-pointer"
      />
      <div className="flex-1">
        <p className="text-ink text-sm font-medium leading-tight">{label}</p>
        <p className="text-ink-dim text-[11px] leading-snug mt-0.5">{hint}</p>
      </div>
    </label>
  );
}
