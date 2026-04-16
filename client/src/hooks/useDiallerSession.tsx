import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  Lead,
  LeadType,
  CallState,
  SessionStatus,
  SessionStats,
  CallbackWithLead,
  Disposition,
} from '../types';
import * as api from '../services/api';

// ── Context shape ──────────────────────────────────────────────

interface DiallerSessionState {
  sessionStatus: SessionStatus;
  leadType: LeadType;
  leads: Lead[];
  currentLead: Lead | null;
  callState: CallState;
  callStartTime: number | null;
  callDuration: number;
  transcript: string;
  stats: SessionStats;
  todaysCallbacks: CallbackWithLead[];
  // AI-generated post-call data
  aiSummary: string | null;
  aiProcessing: boolean;
  draftEmailSubject: string | null;
  draftEmailBody: string | null;
  // Twilio call metadata
  twilioCallSid: string | null;
  // Email prep (filled in during the call)
  emailTo: string;
  emailCc: string;
}

interface DiallerSessionActions {
  startSession: (leadType: LeadType) => void;
  setLeads: (leads: Lead[]) => void;
  setLeadType: (type: LeadType) => void;
  loadNextLead: (category?: string) => Promise<void>;
  setCurrentLead: (lead: Lead | null) => void;
  updateCallState: (state: CallState) => void;
  setCallStartTime: (time: number | null) => void;
  appendTranscript: (text: string) => void;
  setCallDuration: (seconds: number) => void;
  disposeLead: (
    disposition: Disposition,
    transcript: string,
    callbackDate?: string,
    callbackNotes?: string,
    followUpDate?: string
  ) => Promise<void>;
  loadTodaysCallbacks: () => Promise<void>;
  refreshStats: () => void;
  resetSession: () => void;
  setTwilioCallSid: (sid: string | null) => void;
  setEmailTo: (to: string) => void;
  setEmailCc: (cc: string) => void;
}

type DiallerContextType = DiallerSessionState & DiallerSessionActions;

const DiallerContext = createContext<DiallerContextType | null>(null);

// ── Default state ──────────────────────────────────────────────

const defaultStats: SessionStats = {
  totalLeads: 0,
  leadsRemaining: 0,
  callsMade: 0,
  interested: 0,
  notInterested: 0,
  noAnswer: 0,
  voicemails: 0,
};

// ── Provider ───────────────────────────────────────────────────

export function DiallerProvider({ children }: { children: ReactNode }) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('setup');
  const [leadType, setLeadType] = useState<LeadType>('new');
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [stats, setStats] = useState<SessionStats>(defaultStats);
  const [todaysCallbacks, setTodaysCallbacks] = useState<CallbackWithLead[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [draftEmailSubject, setDraftEmailSubject] = useState<string | null>(null);
  const [draftEmailBody, setDraftEmailBody] = useState<string | null>(null);
  const [twilioCallSid, setTwilioCallSid] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');

  // ── Actions ────────────────────────────────────────────────

  const startSession = useCallback((type: LeadType) => {
    setLeadType(type);
    setSessionStatus('active');
  }, []);

  const setLeads = useCallback((newLeads: Lead[]) => {
    setLeadsState(newLeads);
    setStats((prev) => ({
      ...prev,
      totalLeads: newLeads.length,
      leadsRemaining: newLeads.filter((l) => l.status === 'not_called').length,
    }));
  }, []);

  const loadNextLead = useCallback(async (category?: string) => {
    try {
      const lead = await api.getNextLead(category);
      setCurrentLead(lead);
      setCallState('idle');
      setCallDuration(0);
      setCallStartTime(null);
      setTranscript('');
      setTwilioCallSid(null);
      setEmailTo(lead?.email || '');
      setEmailCc('');
    } catch (err) {
      console.error('Failed to load next lead:', err);
      throw err;
    }
  }, []);

  const updateCallState = useCallback((state: CallState) => {
    setCallState(state);
  }, []);

  const appendTranscript = useCallback((text: string) => {
    setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
  }, []);

  const disposeLead = useCallback(
    async (
      disposition: Disposition,
      callTranscript: string,
      callbackDate?: string,
      callbackNotes?: string,
      followUpDate?: string
    ) => {
      if (!currentLead) return;

      // Capture lead info before clearing state (needed for async work)
      const leadSnapshot = { ...currentLead };

      try {
        await api.disposeLead({
          leadId: currentLead.id,
          disposition,
          callDuration,
          transcript: callTranscript,
          twilioCallSid: twilioCallSid || undefined,
          callbackDate,
          callbackNotes,
          followUpDate,
        });

        // Trigger recording download + Whisper transcription in the background.
        // This polls Twilio's API directly for the recording (more reliable than webhooks).
        // The server will download the MP3, send to Whisper, and update the call log.
        if (twilioCallSid) {
          api.processRecording(twilioCallSid).catch((err) => {
            console.warn('Recording processing request failed (non-blocking):', err);
          });
        }

        // Update stats based on disposition
        setStats((prev) => ({
          ...prev,
          callsMade: prev.callsMade + 1,
          leadsRemaining: Math.max(0, prev.leadsRemaining - (
            disposition === 'interested' || disposition === 'not_interested' ? 1 : 0
          )),
          interested: prev.interested + (disposition === 'interested' ? 1 : 0),
          notInterested: prev.notInterested + (disposition === 'not_interested' ? 1 : 0),
          noAnswer: prev.noAnswer + (disposition === 'no_answer' ? 1 : 0),
          voicemails: prev.voicemails + (disposition === 'voicemail' ? 1 : 0),
        }));

        // Reset AI draft state for new disposition flow
        setAiSummary(null);
        setDraftEmailSubject(null);
        setDraftEmailBody(null);
        setAiProcessing(true);

        // Fire AI summarisation in the background (non-blocking)
        const runBackgroundProcessing = async () => {
          try {
            // Step 1: Get AI summary
            const summaryResult = await api.summariseCall({
              transcript: callTranscript,
              leadName: leadSnapshot.name,
              leadCompany: leadSnapshot.company,
              isCallback: leadType === 'callback',
              previousNotes: leadSnapshot.consolidatedSummary || undefined,
            });

            setAiSummary(summaryResult.summary);

            // Step 2: For "interested" — also draft a follow-up email
            if (disposition === 'interested') {
              try {
                const emailDraft = await api.draftFollowUpEmail({
                  transcript: callTranscript,
                  summary: summaryResult.summary,
                  leadName: leadSnapshot.name,
                  leadCompany: leadSnapshot.company,
                  leadCategory: leadSnapshot.category,
                });
                setDraftEmailSubject(emailDraft.subject);
                setDraftEmailBody(emailDraft.body);
              } catch (emailErr) {
                console.error('Email draft generation failed (non-blocking):', emailErr);
                // Email compose page will fall back to template
              }
            }
          } catch (summaryErr) {
            console.error('AI summarisation failed (non-blocking):', summaryErr);
          } finally {
            setAiProcessing(false);
          }
        };

        // Kick off background processing — don't await it
        runBackgroundProcessing();

        // Clear current lead state (but keep currentLead for interested/voicemail paths
        // so EmailComposePage and voicemail email modal can access lead info)
        if (disposition !== 'interested' && disposition !== 'voicemail') {
          setCurrentLead(null);
        }
        setCallState('idle');
        setCallDuration(0);
        setCallStartTime(null);
        setTranscript('');
      } catch (err) {
        console.error('Failed to dispose lead:', err);
        throw err;
      }
    },
    [currentLead, callDuration, leadType, twilioCallSid]
  );

  const loadTodaysCallbacks = useCallback(async () => {
    try {
      const callbacks = await api.getTodaysCallbacks();
      setTodaysCallbacks(callbacks);
    } catch (err) {
      console.error('Failed to load today\'s callbacks:', err);
      // Don't throw — callbacks are non-critical on page load
    }
  }, []);

  const refreshStats = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      leadsRemaining: leads.filter((l) => l.status === 'not_called').length,
    }));
  }, [leads]);

  const resetSession = useCallback(() => {
    setSessionStatus('setup');
    setCurrentLead(null);
    setCallState('idle');
    setCallDuration(0);
    setCallStartTime(null);
    setTranscript('');
    setAiSummary(null);
    setAiProcessing(false);
    setDraftEmailSubject(null);
    setDraftEmailBody(null);
    setTwilioCallSid(null);
    setEmailTo('');
    setEmailCc('');
  }, []);

  // ── Context value ──────────────────────────────────────────

  const value: DiallerContextType = {
    sessionStatus,
    leadType,
    leads,
    currentLead,
    callState,
    callStartTime,
    callDuration,
    transcript,
    stats,
    todaysCallbacks,
    aiSummary,
    aiProcessing,
    draftEmailSubject,
    draftEmailBody,
    twilioCallSid,
    emailTo,
    emailCc,
    startSession,
    setLeads,
    setLeadType,
    loadNextLead,
    setCurrentLead,
    updateCallState,
    setCallStartTime,
    appendTranscript,
    setCallDuration,
    disposeLead,
    loadTodaysCallbacks,
    refreshStats,
    resetSession,
    setTwilioCallSid,
    setEmailTo,
    setEmailCc,
  };

  return (
    <DiallerContext.Provider value={value}>
      {children}
    </DiallerContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────

export function useDialler(): DiallerContextType {
  const ctx = useContext(DiallerContext);
  if (!ctx) {
    throw new Error('useDialler must be used within a DiallerProvider');
  }
  return ctx;
}
