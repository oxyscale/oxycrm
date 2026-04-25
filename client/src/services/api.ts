import type {
  Lead,
  CallLog,
  CallbackWithLead,
  ImportResult,
  DispositionPayload,
  SendEmailPayload,
  LeadType,
  CallIntelligence,
  CallIntelligenceStats,
  CallLogWithLead,
  Note,
  Project,
  ProjectTask,
  Activity,
  EmailSent,
  EmailDraft,
  EmailDraftWithLead,
} from '../types';

const BASE_URL = '/api';

// ── Fetch wrapper with error handling ──────────────────────────

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.error || parsed.message || `Request failed: ${res.status}`;
    } catch {
      message = `Request failed: ${res.status} ${res.statusText}`;
    }
    throw new Error(message);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// ── Leads ──────────────────────────────────────────────────────

export async function getLeads(params?: {
  leadType?: LeadType;
  status?: string;
}): Promise<Lead[]> {
  const searchParams = new URLSearchParams();
  if (params?.leadType) searchParams.set('leadType', params.leadType);
  if (params?.status) searchParams.set('status', params.status);
  const query = searchParams.toString();
  return request<Lead[]>(`/leads${query ? `?${query}` : ''}`);
}

export async function getLeadById(id: number): Promise<Lead> {
  return request<Lead>(`/leads/${id}`);
}

export async function importLeadsCSV(
  file: File,
  leadType: LeadType,
  category?: string
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('leadType', leadType);
  if (category) formData.append('category', category);

  const res = await fetch(`${BASE_URL}/leads/import`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.error || parsed.message || `Import failed: ${res.status}`;
    } catch {
      message = `Import failed: ${res.status} ${res.statusText}`;
    }
    throw new Error(message);
  }

  return res.json();
}

export async function getNextLead(category?: string): Promise<Lead | null> {
  return request<Lead | null>('/leads/next', {
    method: 'POST',
    body: category && category !== 'all' ? JSON.stringify({ category }) : undefined,
  });
}

export async function getCategories(): Promise<string[]> {
  return request<string[]>('/leads/categories');
}

export async function updateLead(
  id: number,
  data: Partial<Lead>
): Promise<Lead> {
  return request<Lead>(`/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function disposeLead(
  payload: DispositionPayload
): Promise<(Lead & { callLogId: number | null }) | { deleted: true; id: number }> {
  return request<(Lead & { callLogId: number | null }) | { deleted: true; id: number }>(
    `/leads/${payload.leadId}/disposition`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

/**
 * Persists AI-generated summary fields onto an existing call log.
 * Called after the client receives a summary from Claude for a just-dispositioned call.
 */
export async function updateCallSummary(
  callLogId: number,
  data: {
    summary?: string;
    keyTopics?: string[];
    actionItems?: string[];
    sentiment?: string;
  }
): Promise<CallLog> {
  return request<CallLog>(`/calls/${callLogId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function searchLeadByPhone(phone: string): Promise<(Lead & { lastCallLog: CallLog | null })[]> {
  return request<(Lead & { lastCallLog: CallLog | null })[]>(`/leads/search?phone=${encodeURIComponent(phone)}`);
}

/** General text search across lead name, company, phone, and email */
export async function searchLeads(query: string): Promise<(Lead & { lastCallLog: CallLog | null })[]> {
  return request<(Lead & { lastCallLog: CallLog | null })[]>(`/leads/search?q=${encodeURIComponent(query)}`);
}

// ── Callbacks ──────────────────────────────────────────────────

export async function getTodaysCallbacks(): Promise<CallbackWithLead[]> {
  return request<CallbackWithLead[]>('/callbacks/today');
}

export async function createCallback(data: {
  leadId: number;
  callbackDate: string;
  notes?: string;
}): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/callbacks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Call history ───────────────────────────────────────────────

export async function getCallHistory(leadId: number): Promise<CallLog[]> {
  return request<CallLog[]>(`/calls/lead/${leadId}`);
}

export async function changeCallDisposition(
  callId: number,
  disposition: string
): Promise<CallLog> {
  return request<CallLog>(`/calls/${callId}/disposition`, {
    method: 'PATCH',
    body: JSON.stringify({ disposition }),
  });
}

// ── Twilio ─────────────────────────────────────────────────────

export async function getTwilioToken(): Promise<{ token: string }> {
  return request<{ token: string }>('/twilio/token');
}

// Fetch the real CallSid for a phone number from the server
// (server captures it reliably in the voice webhook)
export async function getTwilioCallSid(phone: string): Promise<string | null> {
  const result = await request<{ callSid: string | null }>(`/twilio/call-sid?phone=${encodeURIComponent(phone)}`);
  return result.callSid;
}

// Trigger server-side recording polling + Whisper transcription
// Called after disposition to actively fetch the recording from Twilio
export async function processRecording(callSid: string): Promise<void> {
  await request('/twilio/process-recording', {
    method: 'POST',
    body: JSON.stringify({ callSid }),
  });
}

// ── Email ──────────────────────────────────────────────────────

export async function sendEmail(
  payload: SendEmailPayload
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/email/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Call Intelligence ─────────────────────────────────────────

export async function getIntelligenceCalls(params?: {
  disposition?: string;
  category?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ calls: CallLogWithLead[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.disposition) searchParams.set('disposition', params.disposition);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return request<{ calls: CallLogWithLead[]; total: number }>(`/intelligence/calls${query ? `?${query}` : ''}`);
}

export async function getIntelligenceStats(): Promise<CallIntelligenceStats> {
  return request<CallIntelligenceStats>('/intelligence/stats');
}

export async function runAnalysis(params?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<CallIntelligence> {
  return request<CallIntelligence>('/intelligence/analyse', {
    method: 'POST',
    body: JSON.stringify(params || {}),
  });
}

export async function getAnalyses(): Promise<CallIntelligence[]> {
  return request<CallIntelligence[]>('/intelligence/analyses');
}

export async function deleteAnalysis(id: number): Promise<void> {
  return request<void>(`/intelligence/analyses/${id}`, {
    method: 'DELETE',
  });
}

// ── Google Calendar ─────────────────────────────────────────

export async function getGoogleAuthUrl(): Promise<{ url: string }> {
  return request<{ url: string }>('/google/auth');
}

export async function getGoogleAuthStatus(opts?: { force?: boolean }): Promise<{ authenticated: boolean }> {
  const qs = opts?.force ? '?force=1' : '';
  return request<{ authenticated: boolean }>(`/google/status${qs}`);
}

/**
 * Build the URL that kicks off the Google OAuth flow. Pass the page the
 * user is currently on as `returnTo` so the OAuth callback can land them
 * back where they started instead of bouncing them home.
 */
export function buildGoogleAuthUrl(returnTo?: string): string {
  if (!returnTo) return '/api/google/auth';
  return `/api/google/auth?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function getCalendarEvents(
  date: string,
  timezone?: string
): Promise<Array<{ summary: string; startTime: string; endTime: string }>> {
  const params = new URLSearchParams({ date });
  if (timezone) params.set('timezone', timezone);
  return request<Array<{ summary: string; startTime: string; endTime: string }>>(
    `/google/calendar/events?${params.toString()}`
  );
}

export async function createCalendarEvent(params: {
  summary: string;
  description?: string;
  date: string;
  time: string;
  duration: number;
  location?: string;
  guests?: string[];
  meetLink?: boolean;
  timezone?: string;
}): Promise<{ eventId: string; htmlLink: string; meetLink?: string }> {
  return request<{ eventId: string; htmlLink: string; meetLink?: string }>(
    '/google/calendar/event',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

// ── Transcription & AI ───────────────────────────────────────

export async function transcribeAudio(
  audioFile: File
): Promise<{ transcript: string }> {
  const formData = new FormData();
  formData.append('audio', audioFile);

  const res = await fetch(`${BASE_URL}/transcribe`, {
    method: 'POST',
    body: formData,
    // No Content-Type header — browser sets it with boundary for multipart
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.error || parsed.message || `Transcription failed: ${res.status}`;
    } catch {
      message = `Transcription failed: ${res.status} ${res.statusText}`;
    }
    throw new Error(message);
  }

  return res.json();
}

export async function summariseCall(params: {
  transcript: string;
  leadName: string;
  leadCompany?: string | null;
  isCallback: boolean;
  previousNotes?: string;
}): Promise<{
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  sentiment: string;
}> {
  return request<{
    summary: string;
    keyTopics: string[];
    actionItems: string[];
    sentiment: string;
  }>('/ai/summarise', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function draftFollowUpEmail(params: {
  transcript: string;
  summary: string;
  leadName: string;
  leadCompany?: string | null;
  leadCategory?: string | null;
  callContext?: string;
}): Promise<{ subject: string; body: string }> {
  return request<{ subject: string; body: string }>('/ai/draft-email', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function composeEmailFromInstructions(params: {
  instructions: string;
  leadId: number;
  leadName: string;
  leadCompany?: string | null;
  leadCategory?: string | null;
  existingContext?: string;
}): Promise<{ subject: string; body: string }> {
  return request<{ subject: string; body: string }>('/ai/compose', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function draftVoicemailEmail(params: {
  leadName: string;
  leadCompany?: string | null;
  leadCategory?: string | null;
}): Promise<{ subject: string; body: string }> {
  return request<{ subject: string; body: string }>('/ai/voicemail-email', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Create Lead (direct, not CSV) ───────────────────────────

export async function createLead(data: {
  name: string;
  phone: string;
  company?: string;
  email?: string;
  website?: string;
  category?: string;
  temperature?: 'hot' | 'warm' | 'cold';
  pipelineStage?: string;
}): Promise<Lead> {
  return request<Lead>('/leads', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Notes ────────────────────────────────────────────────────

export async function getNotesForLead(leadId: number): Promise<Note[]> {
  return request<Note[]>(`/notes/lead/${leadId}`);
}

export async function createNote(data: { leadId: number; content: string }): Promise<Note> {
  return request<Note>('/notes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateNote(id: number, content: string): Promise<Note> {
  return request<Note>(`/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteNote(id: number): Promise<void> {
  return request<void>(`/notes/${id}`, { method: 'DELETE' });
}

// ── Projects ─────────────────────────────────────────────────

export async function getProjects(status?: string): Promise<(Project & { totalTasks: number; completedTasks: number })[]> {
  const params = status ? `?status=${status}` : '';
  return request(`/projects${params}`);
}

export async function getProject(id: number): Promise<Project> {
  return request<Project>(`/projects/${id}`);
}

export async function createProject(data: {
  name: string;
  clientName: string;
  leadId?: number;
  value?: number;
  description?: string;
  startDate?: string;
}): Promise<Project> {
  return request<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProject(id: number, data: Partial<Project>): Promise<Project> {
  return request<Project>(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: number): Promise<void> {
  return request<void>(`/projects/${id}`, { method: 'DELETE' });
}

export async function addProjectTask(projectId: number, title: string): Promise<ProjectTask> {
  return request<ProjectTask>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function updateProjectTask(projectId: number, taskId: number, data: { title?: string; completed?: boolean }): Promise<ProjectTask> {
  return request<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProjectTask(projectId: number, taskId: number): Promise<void> {
  return request<void>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });
}

// ── Activities ───────────────────────────────────────────────

export async function getActivitiesForLead(leadId: number, params?: { limit?: number; offset?: number }): Promise<{ activities: Activity[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return request(`/activities/lead/${leadId}${query ? `?${query}` : ''}`);
}

export async function getRecentActivities(): Promise<(Activity & { leadName: string; leadCompany: string | null })[]> {
  return request('/activities/recent');
}

// ── Pipeline ─────────────────────────────────────────────────

export async function getPipeline(filters?: { temperature?: string; category?: string }): Promise<Record<string, Lead[]>> {
  const params = new URLSearchParams();
  if (filters?.temperature) params.set('temperature', filters.temperature);
  if (filters?.category) params.set('category', filters.category);
  const query = params.toString();
  const data = await request<{ stages: Record<string, Lead[]>; counts: Record<string, number> }>(`/pipeline${query ? `?${query}` : ''}`);
  return data.stages;
}

export async function updateLeadStage(leadId: number, stage: string): Promise<Lead> {
  return request<Lead>(`/pipeline/${leadId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage }),
  });
}

export async function updateLeadTemperature(leadId: number, temperature: string | null): Promise<Lead> {
  return request<Lead>(`/pipeline/${leadId}/temperature`, {
    method: 'PATCH',
    body: JSON.stringify({ temperature }),
  });
}

export async function getPipelineStats(): Promise<{
  byStage: Record<string, number>;
  conversionRate: number;
  totalPipelineValue: number;
  byTemperature: Record<string, number>;
}> {
  return request('/pipeline/stats');
}

export async function getFollowUpQueue(): Promise<(Lead & { isOverdue: boolean })[]> {
  return request<(Lead & { isOverdue: boolean })[]>('/pipeline/follow-ups');
}

// ── Emails Sent ──────────────────────────────────────────────

export async function getEmailsForLead(leadId: number): Promise<EmailSent[]> {
  return request<EmailSent[]>(`/leads/${leadId}/emails`);
}

// ── Settings ────────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, string>> {
  return request<Record<string, string>>('/settings');
}

export async function updateSettings(data: Record<string, string>): Promise<Record<string, string>> {
  return request<Record<string, string>>('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Category Prompts ────────────────────────────────────────

export interface CategoryPrompt {
  id: number;
  category: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export async function getCategoryPrompts(): Promise<CategoryPrompt[]> {
  return request<CategoryPrompt[]>('/settings/prompts');
}

export async function saveCategoryPrompt(category: string, prompt: string): Promise<CategoryPrompt> {
  return request<CategoryPrompt>(`/settings/prompts/${encodeURIComponent(category)}`, {
    method: 'PUT',
    body: JSON.stringify({ prompt }),
  });
}

export async function deleteCategoryPrompt(category: string): Promise<void> {
  return request<void>(`/settings/prompts/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  });
}

// ── Email Bank ───────────────────────────────────────────────

export interface EmailBankResponse {
  drafts: EmailDraftWithLead[];
  stats: {
    ready: number;
    pending: number;
    failed: number;
    sentLast24h: number;
  };
}

export async function getEmailDrafts(status?: string): Promise<EmailBankResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<EmailBankResponse>(`/email-drafts${qs}`);
}

export async function getEmailDraft(id: number): Promise<EmailDraftWithLead> {
  return request<EmailDraftWithLead>(`/email-drafts/${id}`);
}

export async function updateEmailDraft(
  id: number,
  data: {
    toEmail?: string | null;
    ccEmail?: string | null;
    subject?: string;
    body?: string;
    suggestedStage?: 'follow_up' | 'call_booked';
  },
): Promise<EmailDraft> {
  return request<EmailDraft>(`/email-drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function sendEmailDraft(id: number): Promise<{ success: true; messageId: string | null }> {
  return request<{ success: true; messageId: string | null }>(`/email-drafts/${id}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function retryEmailDraft(id: number): Promise<{ success: true }> {
  return request<{ success: true }>(`/email-drafts/${id}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function discardEmailDraft(id: number): Promise<{ success: true }> {
  return request<{ success: true }>(`/email-drafts/${id}`, {
    method: 'DELETE',
  });
}
