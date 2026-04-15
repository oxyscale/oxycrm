import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Mic,
  MicOff,
  Loader2,
  Paperclip,
  X,
  Eye,
  Sparkles,
} from 'lucide-react';
import * as api from '../services/api';
import type { Lead } from '../types';
import { buildEmailText } from '../utils/emailTemplate';
import { getContactFirstName } from '../utils/names';

// Browser Speech Recognition types
interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
  resultIndex: number;
}

export default function ComposeEmailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();

  // Lead data
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(true);

  // Voice / instructions
  const [instructions, setInstructions] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // AI draft
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);

  // Email fields
  const [greetingName, setGreetingName] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);

  // Send state
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Preview toggle
  const [showPreview, setShowPreview] = useState(false);

  // Load lead data
  useEffect(() => {
    if (!leadId) return;
    (async () => {
      try {
        const data = await api.getLeadById(parseInt(leadId, 10));
        setLead(data);
        if (data.email) setToEmail(data.email);
        setGreetingName(getContactFirstName(data.name));
      } catch {
        // Lead not found
      } finally {
        setLoadingLead(false);
      }
    })();
  }, [leadId]);

  // Set up speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-AU';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result[0]) {
          if ((result as any).isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript = result[0].transcript;
          }
        }
      }

      if (finalTranscript) {
        setInstructions(prev => prev + (prev ? ' ' : '') + finalTranscript.trim());
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Draft email from instructions using Claude
  const handleDraft = async () => {
    if (!lead || !instructions.trim()) return;

    setDrafting(true);
    try {
      // Fetch previously sent emails for style learning
      let existingContext = '';
      try {
        const emails = await api.getEmailsForLead(lead.id);
        const sentEmails = emails
          .filter(e => e.direction === 'sent')
          .slice(0, 5); // Last 5 sent emails for context
        if (sentEmails.length > 0) {
          existingContext = 'Here are Jordan\'s previously sent emails to this lead (use these to match his writing style and tone):\n\n' +
            sentEmails.map(e => `Subject: ${e.subject}\n${e.bodySnippet || ''}`).join('\n---\n');
        }
      } catch {
        // Non-critical — proceed without context
      }

      const result = await api.composeEmailFromInstructions({
        instructions: instructions.trim(),
        leadId: lead.id,
        leadName: lead.name,
        leadCompany: lead.company,
        leadCategory: lead.category,
        existingContext: existingContext || undefined,
      });

      setSubject(result.subject);
      setBody(result.body);
      setDrafted(true);
    } catch (err) {
      console.error('Draft failed:', err);
    } finally {
      setDrafting(false);
    }
  };

  // Send email
  const handleSend = async () => {
    if (!lead || !toEmail || !subject || !body) return;

    setSending(true);
    try {
      await api.sendEmail({
        leadId: lead.id,
        to: toEmail,
        cc: ccEmail || undefined,
        subject,
        body: buildEmailText(body, greetingName || 'there'),
        pipelineStage: 'follow_up',
      });

      // Auto-update lead's email if user entered a different one
      if (toEmail && toEmail !== lead.email) {
        try {
          await api.updateLead(lead.id, { email: toEmail });
        } catch {
          // Non-critical
        }
      }

      setSent(true);
      setTimeout(() => navigate(`/leads/${lead.id}`), 2000);
    } catch (err) {
      console.error('Send failed:', err);
      setSending(false);
    }
  };

  // Attachments
  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) setAttachments(prev => [...prev, ...Array.from(files)]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  if (loadingLead) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[#52525b]" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[#a1a1aa]">Lead not found</p>
        <button onClick={() => navigate(-1)} className="text-[#34d399] text-sm hover:underline">
          Go back
        </button>
      </div>
    );
  }

  // Success state
  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-16 h-16 rounded-full bg-[rgba(52,211,153,0.15)] flex items-center justify-center">
          <Send size={24} className="text-[#34d399]" />
        </div>
        <p className="text-[#fafafa] font-bold text-lg">Email sent</p>
        <p className="text-[#52525b] text-sm">Redirecting to profile...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/leads/${lead.id}`)}
            className="text-[#52525b] hover:text-[#a1a1aa] transition-colors p-1"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-[#fafafa] font-bold">Compose Email</h1>
            <span className="text-[#52525b] text-sm">
              {lead.name}
              {lead.company ? ` \u00b7 ${lead.company}` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`flex items-center gap-2 border rounded-lg px-4 py-2.5 text-sm transition-all ${
              showPreview
                ? 'bg-[rgba(52,211,153,0.1)] border-[rgba(52,211,153,0.2)] text-[#34d399]'
                : 'bg-transparent border-white/[0.06] text-[#a1a1aa] hover:bg-white/[0.03]'
            }`}
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            onClick={handleSend}
            disabled={!toEmail || !subject || !body || sending}
            className="bg-[#34d399] text-[#09090b] font-bold text-sm rounded-lg px-5 py-2.5 hover:bg-[#34d399]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={14} />
                Send Email
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left column — compose */}
        <div className={`flex-1 flex flex-col overflow-y-auto ${showPreview ? 'border-r border-white/[0.06]' : ''}`}>
          <div className="p-6 space-y-4 flex-1">

            {/* Voice instructions panel — shown before draft */}
            {!drafted && (
              <div className="bg-[#1f1f23] border border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-[#34d399]" />
                  <p className="text-[#fafafa] text-sm font-medium">What do you want to say?</p>
                </div>
                <p className="text-[#52525b] text-xs mb-3">
                  Type your instructions or hit the mic to dictate. Claude will draft the email for you.
                </p>

                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder='e.g. "Send David an email checking in on the project timeline, ask if he needs anything from us before Friday"'
                  rows={4}
                  className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all resize-none leading-relaxed mb-3"
                />

                <div className="flex items-center gap-3">
                  {/* Voice button */}
                  <button
                    onClick={toggleListening}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                      isListening
                        ? 'bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse'
                        : 'bg-[#18181b] text-[#a1a1aa] border border-white/[0.06] hover:bg-white/[0.03] hover:text-[#fafafa]'
                    }`}
                  >
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                    {isListening ? 'Stop Recording' : 'Dictate'}
                  </button>

                  {/* Draft button */}
                  <button
                    onClick={handleDraft}
                    disabled={!instructions.trim() || drafting}
                    className="bg-[#34d399] text-[#09090b] font-bold text-sm rounded-lg px-5 py-2.5 hover:bg-[#34d399]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {drafting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Drafting...
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        Draft Email
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Re-draft button when already drafted */}
            {drafted && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDrafted(false)}
                  className="flex items-center gap-2 text-[#a1a1aa] text-sm hover:text-[#34d399] transition-colors"
                >
                  <Sparkles size={14} />
                  Re-draft with new instructions
                </button>
              </div>
            )}

            {/* Email fields — always visible so you can manually compose too */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">To</label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="recipient@company.com"
                  className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>
              <div className="w-48">
                <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">Greeting name</label>
                <input
                  type="text"
                  value={greetingName}
                  onChange={(e) => setGreetingName(e.target.value)}
                  placeholder="e.g. Brianna"
                  className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">CC</label>
              <input
                type="text"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                placeholder="cc@company.com"
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              />
            </div>

            <div>
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              />
            </div>

            <div className="flex-1">
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">Email Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                placeholder={drafted ? '' : 'Use the voice/text instructions above to generate a draft, or type your email directly here'}
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all resize-none leading-relaxed"
              />
            </div>

            {/* Attachments */}
            <div>
              <label className="inline-flex items-center gap-1.5 text-[#a1a1aa] text-sm cursor-pointer hover:text-[#34d399] transition-colors">
                <Paperclip size={14} />
                Attach file
                <input type="file" multiple onChange={handleAttach} className="hidden" />
              </label>
              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((file, i) => (
                    <span key={i} className="flex items-center gap-1.5 bg-[#1f1f23] text-[#a1a1aa] text-xs px-3 py-1.5 rounded-lg">
                      <Paperclip size={12} />
                      {file.name}
                      <button onClick={() => removeAttachment(i)} className="text-[#52525b] hover:text-red-400 transition-colors">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column — Preview (toggleable) */}
        {showPreview && (
          <div className="flex-1 overflow-y-auto bg-[#1f1f23]">
            <div className="p-6">
              <span className="text-[#52525b] text-xs uppercase tracking-wider block mb-4">
                Email Preview
              </span>
              <div className="bg-white rounded-xl p-8 shadow-lg">
                <p className="text-[#52525b] text-xs mb-4 font-mono">
                  To: {toEmail || '...'}{ccEmail ? ` | CC: ${ccEmail}` : ''}
                </p>
                <p className="text-[#18181b] text-sm font-semibold mb-4 pb-3 border-b border-gray-200">
                  {subject || 'No subject'}
                </p>
                <pre className="text-[#3f3f46] text-sm whitespace-pre-wrap font-sans leading-relaxed">
                  {buildEmailText(body || '...', greetingName || 'there')}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
