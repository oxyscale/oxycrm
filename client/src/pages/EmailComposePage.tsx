import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  Paperclip,
  SkipForward,
  Loader2,
  X,
  ArrowLeft,
} from 'lucide-react';
import { useDialler } from '../hooks/useDiallerSession';
import { getContactFirstName } from '../utils/names';
import { sendEmail, updateLeadStage } from '../services/api';
import { buildEmailText } from '../utils/emailTemplate';

const FOLLOW_UP_SUBJECT = 'Great speaking with you today';
const CALL_BOOKED_SUBJECT = 'Confirming our catch up';

const FOLLOW_UP_BODY = `Great speaking with you today, thanks for your time.

As promised, here is a quick overview of what we do so you can see if there is room for this within your business.

For context, we are an AI solutions business that builds bespoke systems for service based businesses. We work closely with each client to make sure everything fits the way their business already runs.

[Key points from the call]

Everything we build is fully custom and tailored around the way each business runs. Happy to walk you through a live demo so you can see it in action.

Looking forward to hearing your thoughts.`;

const CALL_BOOKED_BODY = `Great speaking with you today, thanks for your time.

Just confirming our catch up for [date/time]. I'll send through a calendar invite shortly.

In the meantime, if you have any questions or anything else comes to mind, feel free to reply to this email.

Looking forward to it.`;

export default function EmailComposePage() {
  const navigate = useNavigate();
  const { currentLead, draftEmailSubject, draftEmailBody, aiProcessing, emailCc } = useDialler();

  // Track whether we've already applied the AI draft (so user edits aren't overwritten)
  const [draftApplied, setDraftApplied] = useState(false);

  const [greetingName, setGreetingName] = useState(
    currentLead ? getContactFirstName(currentLead.name) : 'there'
  );
  const [toEmail, setToEmail] = useState(currentLead?.email || '');
  const [ccEmail, setCcEmail] = useState(emailCc || '');
  const [bccEmail, setBccEmail] = useState('');
  const [subject, setSubject] = useState(FOLLOW_UP_SUBJECT);
  const [body, setBody] = useState(FOLLOW_UP_BODY);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pipelineStage, setPipelineStage] = useState<'follow_up' | 'call_booked'>(
    'follow_up'
  );
  const [sending, setSending] = useState(false);

  // When the AI draft becomes available, populate the fields (only once)
  useEffect(() => {
    if (!draftApplied && draftEmailSubject && draftEmailBody) {
      setSubject(draftEmailSubject);
      setBody(draftEmailBody);
      setDraftApplied(true);
    }
  }, [draftEmailSubject, draftEmailBody, draftApplied]);

  const handleGroupChange = (group: 'follow_up' | 'call_booked') => {
    setPipelineStage(group);
    if (group === 'call_booked') {
      setSubject(CALL_BOOKED_SUBJECT);
      setBody(CALL_BOOKED_BODY);
    } else {
      // Use AI draft if available, otherwise fall back to template
      setSubject(draftEmailSubject || FOLLOW_UP_SUBJECT);
      setBody(draftEmailBody || FOLLOW_UP_BODY);
    }
  };

  // Handle file attachment
  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Send email
  const handleSend = async () => {
    if (!currentLead) return;
    setSending(true);
    try {
      const fullBody = buildEmailText(body, greetingName);
      await sendEmail({
        leadId: currentLead.id,
        to: toEmail,
        cc: ccEmail || undefined,
        bcc: bccEmail || undefined,
        subject,
        body: fullBody,
        pipelineStage,
      });

      // Update the lead's pipeline stage
      try {
        await updateLeadStage(currentLead.id, pipelineStage);
      } catch {
        // Non-critical — email was sent, stage update is secondary
      }

      navigate('/dialler');
    } catch (err) {
      console.error('Failed to send email:', err);
      // Still navigate — the email may have been saved even if sending failed
      navigate('/dialler');
    } finally {
      setSending(false);
    }
  };

  // Skip email
  const handleSkip = () => {
    navigate('/dialler');
  };

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dialler')}
            className="text-[#52525b] hover:text-[#a1a1aa] transition-colors p-1"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-[#fafafa] font-bold">
              {currentLead?.name || 'Follow-up Email'}
            </h1>
            <span className="text-[#52525b] text-sm">
              {currentLead?.company || ''}
              {currentLead?.company && currentLead?.category ? ' \u00b7 ' : ''}
              {currentLead?.category || ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSkip}
            className="bg-transparent text-[#a1a1aa] border border-white/[0.06] rounded-lg px-4 py-2.5 hover:bg-white/[0.03] transition-all flex items-center gap-2 text-sm"
          >
            <SkipForward size={14} />
            Skip
          </button>
          <button
            onClick={handleSend}
            disabled={!toEmail || sending}
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

      {/* Main content — two columns */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left column — Editor */}
        <div className="flex-1 flex flex-col overflow-y-auto border-r border-white/[0.06]">
          <div className="p-6 space-y-4 flex-1">
            {/* AI draft loading indicator */}
            {aiProcessing && !draftApplied && (
              <div className="flex items-center gap-3 bg-[#1f1f23] border border-[rgba(52,211,153,0.2)] rounded-lg px-4 py-3">
                <Loader2 size={16} className="animate-spin text-[#34d399]" />
                <span className="text-[#a1a1aa] text-sm">
                  Generating personalised email draft...
                </span>
              </div>
            )}

            {/* To + Greeting name */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                  To
                </label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="recipient@company.com"
                  className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>
              <div className="w-48">
                <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                  Greeting name
                </label>
                <input
                  type="text"
                  value={greetingName}
                  onChange={(e) => setGreetingName(e.target.value)}
                  placeholder="e.g. Brianna"
                  className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
                />
              </div>
            </div>

            {/* CC field */}
            <div>
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                CC
              </label>
              <input
                type="text"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                placeholder="cc@company.com, another@company.com"
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              />
            </div>

            {/* BCC field */}
            <div>
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                BCC
              </label>
              <input
                type="text"
                value={bccEmail}
                onChange={(e) => setBccEmail(e.target.value)}
                placeholder="bcc@company.com"
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              />
            </div>

            {/* Subject field */}
            <div>
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              />
            </div>

            {/* Body textarea */}
            <div className="flex-1">
              <label className="text-[#52525b] text-xs uppercase tracking-wider mb-1.5 block">
                Email Body
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="w-full bg-[#18181b] border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#fafafa] placeholder-[#52525b] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all resize-none leading-relaxed"
              />
            </div>

            {/* Attachments */}
            <div>
              <label className="inline-flex items-center gap-1.5 text-[#a1a1aa] text-sm cursor-pointer hover:text-[#34d399] transition-colors">
                <Paperclip size={14} />
                Attach file
                <input
                  type="file"
                  multiple
                  onChange={handleAttach}
                  className="hidden"
                />
              </label>
              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((file, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1.5 bg-[#1f1f23] text-[#a1a1aa] text-xs px-3 py-1.5 rounded-lg"
                    >
                      <Paperclip size={12} />
                      {file.name}
                      <button
                        onClick={() => removeAttachment(i)}
                        className="text-[#52525b] hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="px-6 py-4 border-t border-white/[0.06] flex items-center">
            <div className="flex items-center gap-3">
              <label className="text-[#52525b] text-xs uppercase tracking-wider">
                Move to pipeline stage:
              </label>
              <select
                value={pipelineStage}
                onChange={(e) =>
                  handleGroupChange(e.target.value as 'follow_up' | 'call_booked')
                }
                className="bg-[#18181b] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-[#a1a1aa] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              >
                <option value="follow_up">Follow Up</option>
                <option value="call_booked">Call Booked</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right column — Plain text preview */}
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
      </div>
    </div>
  );
}
