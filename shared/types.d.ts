export type PipelineStage = 'new_lead' | 'follow_up' | 'call_booked' | 'negotiation' | 'won' | 'lost' | 'not_interested' | 'five_strikes';
export type Temperature = 'hot' | 'warm' | 'cold';
export interface Lead {
    id: number;
    name: string;
    company: string | null;
    phone: string;
    email: string | null;
    website: string | null;
    leadType: 'new' | 'callback';
    category: string | null;
    status: 'not_called' | 'called';
    unansweredCalls: number;
    voicemailLeft: boolean;
    voicemailDate: string | null;
    consolidatedSummary: string | null;
    companyInfo: string | null;
    mondayItemId: string | null;
    pipelineStage: PipelineStage;
    temperature: Temperature | null;
    convertedToProject: boolean;
    followUpDate: string | null;
    queuePosition: number;
    lastCalledAt: string | null;
    createdAt: string;
    updatedAt: string;
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
    pipelineStage: 'follow_up' | 'call_booked';
    attachments?: string[];
}
export interface Note {
    id: number;
    leadId: number;
    content: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
export type ProjectStatus = 'onboarding' | 'in_progress' | 'review' | 'complete';
export interface Project {
    id: number;
    leadId: number | null;
    name: string;
    clientName: string;
    status: ProjectStatus;
    value: number;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
    updatedAt: string;
    tasks?: ProjectTask[];
}
export interface ProjectTask {
    id: number;
    projectId: number;
    title: string;
    completed: boolean;
    createdAt: string;
}
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
}
export type ActivityType = 'call' | 'note' | 'email' | 'stage_change' | 'meeting' | 'temperature_change';
export interface Activity {
    id: number;
    leadId: number;
    type: ActivityType;
    title: string;
    description: string | null;
    metadata: string | null;
    createdAt: string;
}
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
    suggestedStage: 'follow_up' | 'call_booked';
    status: EmailDraftStatus;
    generatedAt: string | null;
    sentAt: string | null;
    errorMessage: string | null;
    includeAfterCallHeader: boolean;
    includeCapabilities: boolean;
    includeBookACall: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface EmailDraftWithLead extends EmailDraft {
    leadName: string;
    leadCompany: string | null;
    leadPhone: string;
    leadCategory: string | null;
    categoryHasCta: boolean;
}
//# sourceMappingURL=types.d.ts.map