import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Paperclip,
  X,
  FileText,
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [drafts, setDrafts] = useState<EmailDraftWithLead[]>([]);
  const [stats, setStats] = useState({ ready: 0, pending: 0, failed: 0, sentLast24h: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>(
    (searchParams.get('filter') as StatusFilter) || 'ready'
  );

  // Sync filter to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'ready') params.set('filter', filter);
    setSearchParams(params, { replace: true });
  }, [filter, setSearchParams]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Review panel state (edits to the selected draft)
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTo, setEditTo] = useState('');
  const [editCc, setEditCc] = useState('');
  const [editIncludeHeader, setEditIncludeHeader] = useState(true);
  const [editIncludeCapabilities, setEditIncludeCapabilities] = useState(false);
  const [attachments, setAttachments] = useState<api.DraftAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  const [savingExplicit, setSavingExplicit] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Live preview state
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

  // Auto-refresh every 5s
  useEffect(() => {
    const id = window.setInterval(() => {
      loadRef.current();
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // When the selected draft changes, hydrate the editor + load attachments
  const selected = drafts.find((d) => d.id === selectedId) || null;
  useEffect(() => {
    if (selected) {
      setEditSubject(selected.subject || '');
      setEditBody(selected.body || '');
      setEditTo(selected.toEmail || '');
      setEditCc(selected.ccEmail || '');
      setEditIncludeHeader(selected.includeAfterCallHeader);
      setEditIncludeCapabilities(selected.includeCapabilities);
      setAttachments([]);
      setDirty(false);
      setActionError(null);
      setActionSuccess(null);
      setPreviewHtml('');
      // Load attachments for this draft
      api.getDraftAttachments(selected.id)
        .then((atts) => setAttachments(atts))
        .catch(() => {});
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first ready draft when list arrives
  useEffect(() => {
    if (!selectedId && drafts.length > 0) {
      const firstReady = drafts.find((d) => d.status === 'ready');
      if (firstReady) setSelectedId(firstReady.id);
    }
  }, [drafts, selectedId]);

  // Debounced + serialised save
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
        includeAfterCallHeader: editIncludeHeader,
        includeCapabilities: editIncludeCapabilities,
        includeBookACall: false,
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
    editIncludeHeader,
    editIncludeCapabilities,
    load,
  ]);

  const saveEdits = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, 250);
  }, [flushSave]);

  // Cancel pending save on unmount
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // ── Live preview ─────────────────────────────────────────────
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
          includeBookACall: false,
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
  ]);

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setActionError(null);
    try {
      if (dirty) {
        await api.updateEmailDraft(selected.id, {
          subject: editSubject,
          body: editBody,
          toEmail: editTo || null,
          ccEmail: editCc || null,
          includeAfterCallHeader: editIncludeHeader,
          includeCapabilities: editIncludeCapabilities,
          includeBookACall: false,
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
      setActionSuccess('Regenerating...');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

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
        includeAfterCallHeader: editIncludeHeader,
        includeCapabilities: editIncludeCapabilities,
        includeBookACall: false,
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

  const handleAddAttachment = async (file: File) => {
    if (!selected) return;
    setUploadingAttachment(true);
    try {
      const base64 = await fileToBase64(file);
      const att = await api.addDraftAttachment(selected.id, {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: base64,
      });
      setAttachments((prev) => [...prev, att]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to upload attachment');
    } finally {
      setUploadingAttachment(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = async (attachmentId: number) => {
    if (!selected) return;
    try {
      await api.deleteDraftAttachment(selected.id, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove attachment');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

      {/* Horizontal draft strip */}
      <div className="mb-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-ink-dim" />
          </div>
        ) : drafts.length === 0 ? (
          <div className="bg-paper border border-hair-soft rounded-2xl py-10 text-center">
            <Inbox size={32} className="mx-auto text-sky-ink mb-3" />
            <p className="text-ink-muted text-sm">Nothing in the bank</p>
            <p className="text-ink-dim text-xs mt-1">
              Drafts appear here after Interested or Voicemail dispositions.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {drafts.map((d) => {
              const isSelected = selectedId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`flex-shrink-0 w-[260px] text-left rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-sky-wash border-sky-hair shadow-sky-elevated ring-1 ring-sky-hair'
                      : 'bg-paper border-hair-soft hover:border-sky-hair hover:bg-[rgba(10,156,212,0.02)]'
                  } ${d.status === 'pending' ? 'opacity-70' : ''} px-4 py-3`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-ink font-medium text-sm truncate">
                      {d.leadName}
                    </span>
                    {statusChip(d.status)}
                  </div>
                  {d.leadCompany && (
                    <p className="text-ink-dim text-xs truncate mb-1">{d.leadCompany}</p>
                  )}
                  <p className="text-ink-muted text-xs truncate">
                    {d.subject || (d.status === 'pending' ? 'Drafting...' : d.status === 'failed' ? 'Draft failed' : '(no subject)')}
                  </p>
                  <p className="font-mono text-[10px] text-ink-dim tracking-wide mt-1.5">
                    {d.disposition.toUpperCase()} · {formatAge(d.createdAt)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Editor + Preview — full-width two-column layout */}
      {!selected ? (
        <div className="bg-paper border border-hair-soft rounded-2xl py-14 text-center">
          <Mail size={32} className="mx-auto text-ink-dim mb-3" />
          <p className="text-ink-muted text-sm">
            Pick a draft from the queue to review and send.
          </p>
        </div>
      ) : selected.status === 'pending' ? (
        <PanelCard eyebrow="DRAFTING" title={selected.leadName} elevated>
          <div className="py-14 text-center">
            <Loader2 size={28} className="mx-auto animate-spin text-sky-ink mb-3" />
            <p className="text-ink text-sm font-medium">Still cooking...</p>
            <p className="text-ink-muted text-xs mt-2 max-w-sm mx-auto">
              The call recording is being transcribed and summarised. This usually takes 30-120 seconds after the call ends.
            </p>
            <p className="font-mono text-[10.5px] text-ink-dim tracking-wide mt-4">
              Started {formatAge(selected.createdAt)}
            </p>
          </div>
        </PanelCard>
      ) : selected.status === 'failed' ? (
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
              {retrying ? 'Retrying...' : 'Retry'}
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
                  Usually means Claude hit an error. Click Retry to try again, or open the lead profile to write the email manually.
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
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {/* Editor */}
          <PanelCard
            eyebrow={selected.disposition.toUpperCase()}
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
            {/* Lead identity */}
            <div className="pb-4 mb-4 border-b border-hair-soft">
              <h3 className="text-ink text-[20px] font-medium leading-tight tracking-card">
                {selected.leadName}
              </h3>
              {selected.leadCompany && (
                <p className="text-ink-muted text-sm mt-1">{selected.leadCompany}</p>
              )}
            </div>

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
                  rows={18}
                  className="w-full bg-paper border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm focus:outline-none focus:border-sky-hair resize-none leading-relaxed font-mono"
                />
                <p className="text-ink-dim text-[11px] mt-1.5 leading-relaxed">
                  Wrap one outcome phrase in <code className="font-mono text-sky-ink">*asterisks*</code> to render it in italic sky-blue.
                </p>
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <EyebrowLabel variant="bare">
                    Attachments {attachments.length > 0 && `(${attachments.length})`}
                  </EyebrowLabel>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="inline-flex items-center gap-1.5 text-sky-ink text-xs font-medium hover:underline disabled:opacity-50"
                  >
                    {uploadingAttachment ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Paperclip size={12} />
                    )}
                    {uploadingAttachment ? 'Uploading...' : 'Add file'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleAddAttachment(file);
                    }}
                  />
                </div>
                {attachments.length > 0 ? (
                  <div className="space-y-1.5">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 bg-tray border border-hair-soft rounded-lg px-3 py-2"
                      >
                        <FileText size={14} className="text-sky-ink flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-ink text-xs font-medium truncate">{att.filename}</p>
                          <p className="text-ink-dim text-[10px]">{formatFileSize(att.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id)}
                          className="text-ink-dim hover:text-risk transition-colors flex-shrink-0 p-0.5"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-dim text-[11px]">No files attached. Click "Add file" to attach.</p>
                )}
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
                    {savingExplicit ? 'Saving...' : savedFlash ? 'Saved' : 'Save'}
                  </PillButton>
                  <PillButton
                    variant="primary"
                    size="md"
                    trailing="none"
                    icon={sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    onClick={handleSend}
                    disabled={!canSend || sending}
                  >
                    {sending ? 'Sending...' : 'Send email'}
                  </PillButton>
                </div>
              </div>
            </div>
          </PanelCard>

          {/* Live preview */}
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
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Toggle row ───────────────────────────────────────────────
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
