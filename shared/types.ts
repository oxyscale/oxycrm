// ============================================================
// OxyScale Dialler — Shared Types
// Used by both client and server
// ============================================================

// Pipeline stages — three working tiers, a warm-interest stage, + two outcomes
// A lead either sits in one of these stages, or has NO pipeline stage at all
// (pipeline_stage IS NULL in the DB). NULL = not yet placed in the kanban.
// The Lead profile dropdown includes a "Remove from pipeline" action that
// nulls the stage.
// Board order: New lead → Meeting booked → Proposal sent → Pulse → Won / Lost
// New lead       = freshly imported, not yet triaged. CSV imports land here.
// Proposal sent  = a quote is out, awaiting their decision
// Meeting booked = they've agreed to meet off the back of it
export type PipelineStage = 'new_lead' | 'meeting_booked' | 'proposal' | 'pulse' | 'won' | 'lost';

// Temperature
export type Temperature = 'hot' | 'warm' | 'cold';

export interface Lead {
  id: number;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  website: string | null;
  leadType: 'new' | 'callback';
  /** Industry the business operates in (Recruitment, Property, ...). */
  category: string | null;
  /** Channel the lead arrived through (Cold call, Meta ad, Miller-Leith
   *  network, ...). Deliberately separate from `category` — one channel
   *  brings in leads across many industries. */
  leadSource: string | null;
  /** Which offer/campaign the lead came through (utm_campaign), one
   *  level below leadSource. "Meta ad" is the channel; this is the
   *  specific offer being run on it. */
  campaign: string | null;
  /** Creative/angle within the campaign (utm_content) — tells you which
   *  hook produced the lead, not just which offer. */
  campaignContent: string | null;
  status: 'not_called' | 'called';
  unansweredCalls: number;
  voicemailLeft: boolean;
  voicemailDate: string | null;
  consolidatedSummary: string | null;
  companyInfo: string | null;
  mondayItemId: string | null;
  pipelineStage: PipelineStage | null;
  temperature: Temperature | null;
  convertedToProject: boolean;
  followUpDate: string | null;
  /** Annual / lifetime $ value for this lead. 0 = unset. Used by Reports. */
  dealValue: number;
  queuePosition: number;
  lastCalledAt: string | null;
  /** Bumped every time the lead profile is opened. Drives the Leads
   *  page default sort so recently-visited leads bubble to the top. */
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Manual override — when true, lead counts as "contacted" regardless
   *  of whether it has notes/emails/call logs. */
  manuallyContacted?: boolean;
  /** Computed — true if the lead has any notes, emails, or call logs
   *  OR manuallyContacted is set. */
  contacted?: boolean;
  /** Count of open (completed=0) tasks attached to this lead. Computed
   *  at list time so the Leads page can show a "Task set / No task"
   *  pill without a per-row fetch. */
  openTaskCount?: number;
  /** Email engagement rollup from Resend webhooks, summed across every
   *  email sent to this lead. Computed at list time. */
  emailOpens?: number;
  emailClicks?: number;
  lastEmailOpenedAt?: string | null;
  emailBounced?: boolean;
  /** Derived lifecycle stage — computed from any linked project, so it
   *  can never drift from reality. Drives the Leads / In Build /
   *  Active Clients tabs. */
  lifecycle?: Lifecycle;
  /** Most recent linked project, for deep-linking from the contact. */
  projectId?: number | null;
  /** How many projects this contact has — the initial build plus any
   *  extra work commissioned since. */
  projectCount?: number;
  /** Monthly retainer in effect today, when this contact is a client. */
  currentRetainer?: number;
}

export interface CallLog {
  id: number;
  leadId: number;
  duration: number | null;
  transcript: string | null;
  summary: string | null;
  keyTopics: string[];
  actionItems: string[];
  sentiment: string | null;
  disposition: Disposition;
  createdAt: string;
}

export interface Callback {
  id: number;
  leadId: number;
  callbackDate: string;
  notes: string | null;
  completed: boolean;
  createdAt: string;
}

export interface CallbackWithLead extends Callback {
  lead: Lead;
  lastCallLog: CallLog | null;
}

export type Disposition = 'no_answer' | 'voicemail' | 'not_interested' | 'interested' | 'wrong_number';

export type LeadType = 'new' | 'callback';

export type CallState = 'idle' | 'ringing' | 'connected' | 'ended';

export type SessionStatus = 'setup' | 'active' | 'paused';

// API request/response types

export interface DispositionPayload {
  leadId: number;
  disposition: Disposition;
  callDuration: number;
  transcript: string;
  callbackDate?: string;
  callbackNotes?: string;
  followUpDate?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

export interface DuplicateLead {
  id: number;
  name: string;
  phone: string;
  status: Lead['status'];
  lastCalledAt: string | null;
  callCount: number;
}

export interface SessionStats {
  totalLeads: number;
  leadsRemaining: number;
  callsMade: number;
  interested: number;
  notInterested: number;
  noAnswer: number;
  voicemails: number;
}

export interface CallIntelligence {
  id: number;
  analysisType: 'full' | 'objections' | 'wins';
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  totalCallsAnalysed: number;
  commonObjections: string[];
  winningPatterns: string[];
  recommendations: string[];
  rawAnalysis: string | null;
  createdAt: string;
}

export interface CallIntelligenceStats {
  totalCalls: number;
  interestedCalls: number;
  notInterestedCalls: number;
  noAnswerCalls: number;
  voicemailCalls: number;
  conversionRate: number;
  avgCallDuration: number;
  callsByCategory: Record<string, number>;
  callsByDisposition: Record<string, number>;
}

export interface CallLogWithLead extends CallLog {
  leadName: string;
  leadCompany: string | null;
  leadCategory: string | null;
}

export interface SendEmailPayload {
  leadId: number;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  pipelineStage?: PipelineStage;
  attachments?: string[];
}

// ============================================================
// CRM Types — Notes, Projects, Emails, Activities
// ============================================================

// Notes (standalone, not call-related)
export interface Note {
  id: number;
  leadId: number;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Projects
//
// A client can have MANY projects over time: the initial build, then
// each new piece of work they commission. 'ended' retires a project
// without deleting it — it's what lets a client be stood down and
// brought back if they return.
//   building — work in progress
//   live     — delivered and running
//   ended    — finished or churned; no longer counts as active
export type ProjectStatus = 'building' | 'live' | 'ended';

export interface Project {
  id: number;
  leadId: number | null;
  name: string;
  clientName: string;
  status: ProjectStatus;
  /** Legacy one-off value. Superseded by the retainer history — kept so
   *  older rows still render. New money goes through `currentRetainer`. */
  value: number;
  description: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  /** When the build went live — the start of the free period. Distinct
   *  from endDate, which used to be overloaded for this. */
  liveFrom: string | null;
  /** Length of the complimentary period after go-live, in days.
   *  Not surfaced yet — kept for a later revision. */
  freeDays: number;
  /** Upfront one-off fee for building this, separate from the monthly
   *  retainer. Together they are the full revenue picture. */
  buildFee: number;
  createdAt: string;
  updatedAt: string;
  tasks?: ProjectTask[];
  /** Monthly retainer in effect today, from the retainer history.
   *  0 when the client has no retainer set. */
  currentRetainer?: number;
  /** When the current retainer took effect (YYYY-MM-DD). */
  retainerSince?: string | null;
  totalTasks?: number;
  completedTasks?: number;
}

/** One dated change to a client's monthly retainer. Never overwritten —
 *  a change adds a row, so history stays intact and MRR is computable
 *  for any month. */
export interface ClientRetainer {
  id: number;
  /** The client this retainer belongs to. Retainers are per-CLIENT,
   *  not per-project — extra work bumps the one monthly figure rather
   *  than opening a second billing line. */
  leadId: number;
  monthlyAmount: number;
  /** YYYY-MM-DD — date-only, matches the follow-up date convention. */
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Where a contact sits in the lifecycle. Derived from their projects
 *  rather than stored, so it can't drift out of sync:
 *    any live project  -> client   (stays a client even with new work
 *                                   in flight, which is the whole point)
 *    any building only -> in_build
 *    none / all ended  -> lead */
export type Lifecycle = 'lead' | 'in_build' | 'client';

export interface ProjectTask {
  id: number;
  projectId: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

// Email log
export interface EmailSent {
  id: number;
  leadId: number;
  toAddress: string;
  fromAddress: string | null;
  subject: string;
  bodySnippet: string | null;
  gmailMessageId: string | null;
  source: 'dialler' | 'gmail';
  direction: 'sent' | 'received';
  createdAt: string;
  /** Resend webhook engagement signals — null until the event fires. */
  deliveredAt: string | null;
  openedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  lastClickedAt: string | null;
  clickCount: number;
  bouncedAt: string | null;
}

// Activity timeline
export type ActivityType = 'call' | 'note' | 'email' | 'stage_change' | 'meeting' | 'temperature_change';

export interface Activity {
  id: number;
  leadId: number;
  type: ActivityType;
  title: string;
  description: string | null;
  metadata: string | null;
  createdAt: string;
  createdBy: string | null;
}

// ============================================================
// Email Bank — AI-drafted follow-up emails awaiting review
// ============================================================

export type EmailDraftStatus = 'pending' | 'ready' | 'sent' | 'discarded' | 'failed';

export interface EmailDraft {
  id: number;
  leadId: number;
  callLogId: number | null;
  disposition: 'interested' | 'voicemail';
  toEmail: string | null;
  ccEmail: string | null;
  subject: string | null;
  body: string | null;
  // Template hint left over from the old pipeline ('follow_up' or 'call_booked').
  // No longer maps to a real PipelineStage value — kept as a free-form string
  // so legacy drafts still load. Email send no longer auto-moves leads.
  suggestedStage: string;
  status: EmailDraftStatus;
  generatedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  /** "A note after our chat" editorial header at the top of the email. */
  includeAfterCallHeader: boolean;
  /** Capabilities-document blue button. Only effective if the lead's
   *  category has a configured CTA URL in category_prompts. */
  includeCapabilities: boolean;
  /** Second capabilities-style button. Drives the broad
   *  "View our capabilities" doc (details.oxyscale.ai by default)
   *  while includeCapabilities drives the recruitment-specific hook. */
  includeSecondaryDoc: boolean;
  /** Black "Book a call" button to the campaign-wide Calendly. */
  includeBookACall: boolean;
  /** When true, the email renders WITHOUT the branded OxyScale shell
   *  (header card, editorial entry, footer colophon). Just the body
   *  text + signature + optional CTA box. Reads as personal outreach
   *  rather than a marketing template. */
  plainTextMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDraftWithLead extends EmailDraft {
  leadName: string;
  leadCompany: string | null;
  leadPhone: string;
  leadCategory: string | null;
  /** True when the lead's category has a configured capabilities CTA URL. */
  categoryHasCta: boolean;
}
