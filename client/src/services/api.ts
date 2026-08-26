import type {
  Lead,
  CallLog,
  ImportResult,
  DispositionPayload,
  SendEmailPayload,
  LeadType,
  CallIntelligence,
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
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (res.status === 401 && !endpoint.startsWith('/auth/')) {
    // Session expired or never existed. Bounce to /login and abort.
    // The login page reads ?next= to send the user back after sign-in.
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/reset-password')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
    throw new Error('Not authenticated');
  }

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
  category?: string;
  contacted?: 'true' | 'false';
  /** Filter to a single pipeline stage server-side. */
  stage?: string;
}): Promise<Lead[]> {
  const searchParams = new URLSearchParams();
  if (params?.leadType) searchParams.set('leadType', params.leadType);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.contacted) searchParams.set('contacted', params.contacted);
  const query = searchParams.toString();
  return request<Lead[]>(`/leads${query ? `?${query}` : ''}`);
}

export async function getLeadById(id: number): Promise<Lead> {
  return request<Lead>(`/leads/${id}`);
}

export async function importLeadsCSV(
  file: File,
  leadType: LeadType,
  category?: string,
  leadSource?: string
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('leadType', leadType);
  if (category) formData.append('category', category);
  if (leadSource) formData.append('leadSource', leadSource);

  const res = await fetch(`${BASE_URL}/leads/import`, {
    method: 'POST',
    credentials: 'include',
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

/** Campaign attribution one level below lead source — which offer a
 *  lead came through. Derived from what's actually on the leads rather
 *  than a managed list, since campaign names come from the ad platform. */
export interface CampaignSummary {
  name: string;
  lead_count: number;
  last_seen: string;
}

export async function getCampaigns(): Promise<CampaignSummary[]> {
  return request<CampaignSummary[]>('/leads/campaigns');
}

// ── Clients: projects + retainers ────────────────────────────
//
// A contact can have many projects over time — the first build, then
// each new piece of work. The retainer belongs to the CLIENT, not to
// any one project, and every change is a dated row so history survives.

/**
 * Starts a project for a contact. Works for a first build (converting a
 * won lead) and for extra work commissioned by an existing client.
 * `retainerDelta` adjusts their monthly figure; `monthlyRetainer` sets
 * it outright, which is what a first project uses.
 */
export async function startProject(
  leadId: number,
  data: {
    name?: string;
    description?: string | null;
    retainerDelta?: number;
    monthlyRetainer?: number;
    startDate?: string;
  },
): Promise<{ projectId: number; name: string; clientName: string; retainer: number | null }> {
  return request(`/leads/${leadId}/projects`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface ClientRetainerEntry {
  id: number;
  leadId: number;
  monthlyAmount: number;
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export async function getRetainers(leadId: number): Promise<ClientRetainerEntry[]> {
  return request<ClientRetainerEntry[]>(`/leads/${leadId}/retainers`);
}

export async function addRetainer(
  leadId: number,
  data: { monthlyAmount: number; effectiveFrom?: string; note?: string | null },
): Promise<{ id: number; leadId: number; monthlyAmount: number; effectiveFrom: string }> {
  return request(`/leads/${leadId}/retainers`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteRetainer(leadId: number, retainerId: number): Promise<{ success: true }> {
  return request(`/leads/${leadId}/retainers/${retainerId}`, { method: 'DELETE' });
}

/** Projects belonging to one contact, newest first. */
export async function getLeadProjects(leadId: number): Promise<Project[]> {
  const all = await request<Project[]>('/projects');
  return all.filter((p) => p.leadId === leadId);
}

// ── Managed categories (Settings) ────────────────────────────

export interface Category {
  id: number;
  name: string;
  created_at: string;
  /** Count of leads whose `category` matches this category name (case-insensitive).
   *  Lets the Settings UI show "Property Styling · 12 leads" and prompt
   *  Jordan with a "delete the leads too?" option when the count is > 0. */
  lead_count?: number;
}

export async function getManagedCategories(): Promise<Category[]> {
  return request<Category[]>('/categories');
}

export async function createCategory(name: string): Promise<Category> {
  return request<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * Delete a managed category. By default only removes the dropdown entry;
 * leads keep their category string. Pass `deleteLeads: true` to also
 * delete every lead currently carrying this category (cascades through
 * FK so call logs, notes, tasks, activities, emails all go with them).
 */
export async function deleteCategory(
  id: number,
  options?: { deleteLeads?: boolean },
): Promise<{ name: string; leadsDeleted: number }> {
  const qs = options?.deleteLeads ? '?deleteLeads=true' : '';
  return request<{ name: string; leadsDeleted: number }>(`/categories/${id}${qs}`, {
    method: 'DELETE',
  });
}

// ── Lead sources (Settings) ──────────────────────────────────
//
// The CHANNEL a lead arrived through, kept separate from `category`
// (the industry the business is in). Same managed-list pattern as
// categories, but deleting a source never deletes leads — a channel
// going away shouldn't take its leads with it.

export interface LeadSource {
  id: number;
  name: string;
  created_at: string;
  /** Display grouping — lower sorts first, ties broken alphabetically.
   *  Networks use 100 so they group below the everyday channels. */
  sort_order?: number;
  /** Count of leads currently tagged with this source (case-insensitive). */
  lead_count?: number;
}

export async function getLeadSources(): Promise<LeadSource[]> {
  return request<LeadSource[]>('/lead-sources');
}

export async function createLeadSource(name: string): Promise<LeadSource> {
  return request<LeadSource>('/lead-sources', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Renames the source AND re-stamps every lead carrying the old string,
 *  so historical data never orphans out of the Reports breakdown. */
export async function renameLeadSource(
  id: number,
  name: string,
): Promise<{ id: number; name: string; leadsUpdated: number }> {
  return request<{ id: number; name: string; leadsUpdated: number }>(`/lead-sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteLeadSource(
  id: number,
): Promise<{ name: string; leadsStillTagged: number }> {
  return request<{ name: string; leadsStillTagged: number }>(`/lead-sources/${id}`, {
    method: 'DELETE',
  });
}


// ── Duplicate flagging (inline pills on Leads page) ───────────────

export interface DuplicateFlag {
  suspectId: number;
  targetId: number;
  confidence: 'high' | 'medium';
  reasons: string[];
  detectedAt: string;
  suspect: { id: number; name: string; company: string | null; phone: string };
  target: {
    id: number; name: string; company: string | null; phone: string;
    email: string | null; website: string | null;
  };
}

/** Active (non-dismissed) flags. The Leads page uses these to render
 *  inline "Likely duplicate of X" pills under each suspect row. */
export async function getDuplicateFlags(): Promise<DuplicateFlag[]> {
  return request<DuplicateFlag[]>('/leads/duplicate-flags');
}

/** Safe field-level merge: target keeps everything, suspect contributes
 *  only to target's empty fields. Activity reassigned, suspect deleted. */
export async function foldLead(suspectId: number, targetId: number): Promise<{
  success: true;
  survivorId: number;
  fieldsFilled: string[];
  rowsReassigned: number;
}> {
  return request(`/leads/${suspectId}/fold-into/${targetId}`, { method: 'POST' });
}

/** "Not a duplicate." Sets dismissed_at on the flag — future scans skip. */
export async function dismissDuplicate(suspectId: number, targetId: number): Promise<{ success: true }> {
  return request(`/leads/${suspectId}/dismiss-duplicate-of/${targetId}`, { method: 'POST' });
}

// ── Undo a CSV import ────────────────────────────────────────

export interface UndoImportResult {
  dryRun: boolean;
  csvRows: number;
  csvPhonesFound: number;
  /** Total leads whose phone matches a row in the CSV. */
  matched: number;
  /** Leads matched but PROTECTED from deletion (have notes/tasks/calls/
   *  emails/activity, are placed in a pipeline tier, have a deal value,
   *  or are manually flagged contacted). These stay put. */
  protected: number;
  /** Leads that WILL be deleted (matched - protected). */
  toDelete: number;
  deleted: number;
  sample: { id: number; name: string; phone: string }[];
  /** First 10 protected leads with the reason they were spared. */
  protectedSample: { id: number; name: string; phone: string; reason: string | null }[];
}

/**
 * Re-uploads a CSV used in a previous import and deletes every lead
 * whose phone (last 9 digits, country-code normalised) matches a row
 * in the file. Pass `dryRun: true` to preview the count + sample first.
 */
export async function undoImport(file: File, dryRun: boolean): Promise<UndoImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  const qs = dryRun ? '?dryRun=true' : '';
  const res = await fetch(`${BASE_URL}/leads/undo-import${qs}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const errorBody = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.error || parsed.message || `Undo import failed: ${res.status}`;
    } catch {
      message = `Undo import failed: ${res.status} ${res.statusText}`;
    }
    throw new Error(message);
  }
  return res.json();
}

// ── Tasks ─────────────────────────────────────────────────────

export interface LeadTask {
  id: number;
  leadId: number;
  label: string;
  dueDate: string;
  googleCalendarEventId: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithLead extends LeadTask {
  leadName: string;
  leadCompany: string | null;
}

export interface TaskStats {
  overdue: number;
  dueToday: number;
  upcoming: number;
  completedTotal: number;
}

export async function getLeadTasks(leadId: number): Promise<LeadTask[]> {
  return request<LeadTask[]>(`/leads/${leadId}/tasks`);
}

export async function createLeadTask(
  leadId: number,
  data: { label: string; dueDate: string },
): Promise<LeadTask & { calendarLink: string | null }> {
  return request<LeadTask & { calendarLink: string | null }>(
    `/leads/${leadId}/tasks`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function updateLeadTask(
  taskId: number,
  data: { label?: string; dueDate?: string; completed?: boolean },
): Promise<LeadTask> {
  return request<LeadTask>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteLeadTask(taskId: number): Promise<void> {
  return request<void>(`/tasks/${taskId}`, { method: 'DELETE' });
}

// Global tasks (all leads)
export async function getAllTasks(): Promise<TaskWithLead[]> {
  return request<TaskWithLead[]>('/tasks');
}

export async function getTaskStats(): Promise<TaskStats> {
  return request<TaskStats>('/tasks/stats');
}

export async function completeTask(taskId: number): Promise<LeadTask> {
  return request<LeadTask>(`/tasks/${taskId}/complete`, { method: 'PATCH' });
}

// ── Reports ───────────────────────────────────────────────────

export interface ReportTierBucket {
  tier: 'new_lead' | 'meeting_booked' | 'proposal' | 'pulse' | 'won' | 'lost';
  label: string;
  count: number;
  totalValue: number;
}

export interface ReportData {
  window: { from: string; to: string; category: string | null };
  categories: string[];
  summary: {
    totalPipelineCount: number;
    totalPipelineValue: number;
    weightedPipelineValue: number;
    newLeadCount: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    lostValue: number;
    tasksDueCount: number;
    contactedCount: number;
    totalLeadCount: number;
    totalContactedCount: number;
    conversionRate: number;
    tasksCreated: number;
    tasksCompleted: number;
  };
  byTier: ReportTierBucket[];
  newLeads: Array<{
    id: number; name: string; company: string | null; category: string | null;
    tier: string; dealValue: number; createdAt: string;
  }>;
  won: Array<{
    id: number; name: string; company: string | null; category: string | null;
    tier: string; dealValue: number; closedAt: string;
  }>;
  lost: Array<{
    id: number; name: string; company: string | null; category: string | null;
    tier: string; dealValue: number; closedAt: string;
  }>;
  tasksDue: Array<{
    id: number; label: string; dueDate: string; completed: number;
    leadId: number; leadName: string; leadCompany: string | null;
  }>;
  pipelineLeads: Array<{
    id: number; name: string; company: string | null; category: string | null;
    tier: string; dealValue: number; followUpDate: string | null;
    contacted: boolean; latestNote: string | null;
  }>;
}

export async function getReport(params: { from?: string; to?: string; category?: string } = {}): Promise<ReportData> {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.category) search.set('category', params.category);
  const qs = search.toString();
  return request<ReportData>(`/reports${qs ? `?${qs}` : ''}`);
}

// ── Transcripts ───────────────────────────────────────────────

/**
 * Saves a manually-dictated transcript on a lead. Returns the new
 * call_log id so the client can refresh its transcript list.
 */
export async function saveLeadTranscript(
  leadId: number,
  data: { transcript: string; durationMinutes?: number },
): Promise<{ callLogId: number; leadId: number }> {
  return request<{ callLogId: number; leadId: number }>(
    `/leads/${leadId}/transcripts`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function renameCategory(from: string, to: string): Promise<{ from: string; to: string; updated: number }> {
  return request<{ from: string; to: string; updated: number }>('/leads/categories/rename', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

export interface DedupeResult {
  dryRun: boolean;
  groups: number;
  totalDuplicatesToDelete?: number;
  leadsDeleted?: number;
  rowsReassigned?: number;
  plans?: Array<{
    groupKey: string;
    survivorId: number;
    survivorScore?: number;
    duplicateIds: number[];
    sample: { name: string; phone: string };
  }>;
}

export async function dedupeLeads(dryRun: boolean): Promise<DedupeResult> {
  return request<DedupeResult>('/leads/dedupe', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

/**
 * Bulk-clear pipeline_stage (set to NULL) so the kanban is empty.
 * Won/Lost are preserved by default.
 */
export async function resetPipeline(
  preserveWonLost: boolean,
): Promise<{ updated: number; eligible: number; preserveWonLost: boolean }> {
  return request<{ updated: number; eligible: number; preserveWonLost: boolean }>(
    '/leads/reset-pipeline',
    {
      method: 'POST',
      body: JSON.stringify({ preserveWonLost }),
    },
  );
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

/**
 * Permanently delete a lead. Cascades via FK to call_logs / notes /
 * tasks / activities / emails_sent etc. Irreversible.
 */
export async function deleteLead(id: number): Promise<void> {
  return request<void>(`/leads/${id}`, { method: 'DELETE' });
}

/** Toggle the manual contacted flag on a lead */
export async function markLeadContacted(id: number, contacted: boolean): Promise<Lead> {
  return request<Lead>(`/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ manuallyContacted: contacted }),
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

// ── Email ──────────────────────────────────────────────────────

export async function sendEmail(
  payload: SendEmailPayload
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/email/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
  phone?: string;
  company?: string;
  email?: string;
  website?: string;
  category?: string;
  /** Channel the lead arrived through. Optional — often unknown when
   *  creating a lead by hand. */
  leadSource?: string;
  /** Which offer produced the lead. Imports read this from utm columns;
   *  a hand-added lead needs it set explicitly or attribution is lost. */
  campaign?: string;
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

// stage = null removes the lead from the kanban (still visible in /leads)
export async function updateLeadStage(leadId: number, stage: string | null): Promise<Lead> {
  return request<Lead>(`/pipeline/${leadId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage }),
  });
}


export async function getPipelineStats(category?: string): Promise<{
  byStage: Record<string, number>;
  conversionRate: number;
  /** Still in play — new lead, meeting booked, proposal, pulse. Excludes Won. */
  totalPipelineValue: number;
  /** Closed and won, reported separately from the above. */
  wonValue: number;
  /** Monthly recurring revenue from live clients, counted per client. */
  activeClientMrr: number;
  /** Every lead, whether or not it sits on the kanban. */
  totalLeads: number;
  /** Only leads placed in a kanban column. */
  placedLeads: number;
  byTemperature: Record<string, number>;
}> {
  const qs = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : '';
  return request(`/pipeline/stats${qs}`);
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
  /** Capabilities-document URL the blue button points to. Null when no
   *  CTA is configured for this category — the toggle stays hidden in
   *  the Email Bank for leads in this category. */
  cta_doc_url: string | null;
  cta_doc_label: string | null;
  cta_intro: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCategoryPrompts(): Promise<CategoryPrompt[]> {
  return request<CategoryPrompt[]>('/settings/prompts');
}

export async function saveCategoryPrompt(
  category: string,
  data: {
    prompt: string;
    ctaDocUrl?: string | null;
    ctaDocLabel?: string | null;
    ctaIntro?: string | null;
  },
): Promise<CategoryPrompt> {
  return request<CategoryPrompt>(`/settings/prompts/${encodeURIComponent(category)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
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

export async function createEmailDraft(data: {
  leadId: number;
  toEmail?: string;
  ccEmail?: string;
  subject: string;
  body: string;
  attachments?: { filename: string; mimeType: string; contentBase64: string }[];
}): Promise<EmailDraftWithLead> {
  return request<EmailDraftWithLead>('/email-drafts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
    includeAfterCallHeader?: boolean;
    includeCapabilities?: boolean;
    includeSecondaryDoc?: boolean;
    includeBookACall?: boolean;
    plainTextMode?: boolean;
  },
): Promise<EmailDraft> {
  return request<EmailDraft>(`/email-drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function previewEmailDraft(
  id: number,
  overrides: {
    subject?: string;
    body?: string;
    includeAfterCallHeader?: boolean;
    includeCapabilities?: boolean;
    includeSecondaryDoc?: boolean;
    includeBookACall?: boolean;
    plainTextMode?: boolean;
  },
): Promise<{ html: string }> {
  return request<{ html: string }>(`/email-drafts/${id}/preview`, {
    method: 'POST',
    body: JSON.stringify(overrides),
  });
}

export async function sendEmailDraft(id: number): Promise<{ success: true; messageId: string | null }> {
  return request<{ success: true; messageId: string | null }>(`/email-drafts/${id}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Draft Attachments ───────────────────────────────────────

export interface DraftAttachment {
  id: number;
  draftId: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt?: string;
}

export async function getDraftAttachments(draftId: number): Promise<DraftAttachment[]> {
  return request<DraftAttachment[]>(`/email-drafts/${draftId}/attachments`);
}

export async function addDraftAttachment(
  draftId: number,
  data: { filename: string; mimeType: string; contentBase64: string },
): Promise<DraftAttachment> {
  return request<DraftAttachment>(`/email-drafts/${draftId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteDraftAttachment(draftId: number, attachmentId: number): Promise<void> {
  return request<void>(`/email-drafts/${draftId}/attachments/${attachmentId}`, {
    method: 'DELETE',
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

// ── Auth ────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  title: string;
  phone: string;
  senderEmail: string;
  signOff: string;
  calendlyLink: string;
}

export async function login(email: string, password: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ success: true }> {
  return request<{ success: true }>('/auth/logout', { method: 'POST' });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const { user } = await request<{ user: AuthUser }>('/auth/me');
    return user;
  } catch {
    return null;
  }
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: true }> {
  return request<{ success: true }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// ============================================================
// Investor Report
// ============================================================

export interface InvestorPipelineRow {
  leadId: number;
  company: string;
  contact: string;
  retainer: number;
  oneOff: number;
  latestNote: string | null;
  latestNoteAt: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
}

export interface InvestorStageGroup {
  stage: string;
  label: string;
  count: number;
  retainerTotal: number;
  rows: InvestorPipelineRow[];
}

export interface InvestorSignedClient {
  leadId: number;
  company: string;
  contact: string;
  signedOn: string;
  retainer: number;
  oneOff: number;
  revenueStartsOn: string;
  daysUntilLive: number;
  isLive: boolean;
}

export interface InvestorReport {
  month: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  preparedBy: string;
  status: 'draft' | 'final';
  finalisedAt: string | null;
  settings: { revenueLeadDays: number };
  tiles: {
    liveMrr: number;
    committedMrr: number;
    notYetLiveMrr: number;
    bankBalance: number;
    runwayMonths: number | null;
    forecastRunwayMonths: number | null;
    openPipelineMrr: number;
    signedThisMonth: { count: number; mrr: number; oneOff: number };
  };
  funnel: Array<{
    stage: string; label: string; openNow: number;
    enteredThisMonth: number; enteredLastMonth: number; change: number;
  }>;
  leadSources: {
    months: string[];
    monthLabels: string[];
    totals: number[];
    sources: Array<{
      source: string;
      counts: number[];
      total: number;
      thisMonth: number;
      lastMonth: number;
      change: number;
    }>;
  };
  pipeline: {
    openCount: number;
    openPipelineMrr: number;
    openPipelineOneOff: number;
    byStage: InvestorStageGroup[];
  };
  signedNotYetLive: InvestorSignedClient[];
  investment: {
    ringfence: {
      total: number; paid: number; remaining: number;
      payments: Array<{ id: number; paidOn: string; item: string; amount: number }>;
    };
    wages: { total: number; drawn: number; remaining: number };
  };
  position: {
    bankBalance: number; liveMrr: number; committedMrr: number;
    committedIncoming: number;
    runwayMonths: number | null; forecastRunwayMonths: number | null;
  };
  plannedSpend: Array<{
    id: number; item: string; estimatedCost: number;
    timing: string | null; purpose: string | null; status: string;
  }>;
  risks: Array<{ id: number; risk: string; mitigation: string | null; status: string }>;
  inputs: {
    bankBalance: number | null;
    liveMrrOverride: number | null;
    crmLiveMrr: number;
    potWagesDrawn: number;
  };
}

export interface InvestorHistoryPoint {
  month: string;
  monthLabel: string;
  liveMrr: number;
  committedMrr: number;
  notYetLiveMrr: number;
  bankBalance: number;
  runwayMonths: number | null;
  ringfenceRemaining: number;
  wagesRemaining: number;
  funnel: Record<string, number>;
}

export interface InvestorReportResponse {
  report: InvestorReport;
  previous: InvestorReport | null;
  history: InvestorHistoryPoint[];
  forward: Array<{ month: string; monthLabel: string; liveMrr: number; notYetLiveMrr: number; projected: true }>;
}

export interface InvestorSettings {
  revenueLeadDays: number;
  monthlyCostBase: number;
  potRingfenceTotal: number;
  potWagesTotal: number;
  distributionList: string[];
}

export async function getInvestorReport(month: string): Promise<InvestorReportResponse> {
  return request(`/investor/report/${month}`);
}

export async function getInvestorMonths(): Promise<
  Array<{ month: string; monthLabel: string; status: string; finalisedAt: string | null }>
> {
  return request('/investor/months');
}

export async function saveInvestorInputs(
  month: string,
  data: { bankBalance?: number | null; liveMrrOverride?: number | null; potWagesDrawn?: number },
): Promise<InvestorReport> {
  return request(`/investor/report/${month}/inputs`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function finaliseInvestorReport(month: string): Promise<{ success: true; finalisedAt: string }> {
  return request(`/investor/report/${month}/finalise`, { method: 'POST' });
}

export async function reopenInvestorReport(month: string): Promise<{ success: true }> {
  return request(`/investor/report/${month}/reopen`, { method: 'POST' });
}

export async function addRingfencePayment(
  data: { paidOn: string; item: string; amount: number },
): Promise<{ id: number }> {
  return request('/investor/ringfence', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteRingfencePayment(id: number): Promise<void> {
  await request(`/investor/ringfence/${id}`, { method: 'DELETE' });
}

export async function addPlannedSpend(data: {
  item: string; estimatedCost?: number; timing?: string | null;
  purpose?: string | null; status?: string;
}): Promise<{ id: number }> {
  return request('/investor/planned-spend', { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePlannedSpend(
  id: number,
  data: Partial<{ item: string; estimatedCost: number; timing: string | null; purpose: string | null; status: string }>,
): Promise<{ success: true }> {
  return request(`/investor/planned-spend/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deletePlannedSpend(id: number): Promise<void> {
  await request(`/investor/planned-spend/${id}`, { method: 'DELETE' });
}

export async function addInvestorRisk(
  data: { risk: string; mitigation?: string | null; status?: string },
): Promise<{ id: number }> {
  return request('/investor/risks', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateInvestorRisk(
  id: number,
  data: Partial<{ risk: string; mitigation: string | null; status: string }>,
): Promise<{ success: true }> {
  return request(`/investor/risks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteInvestorRisk(id: number): Promise<void> {
  await request(`/investor/risks/${id}`, { method: 'DELETE' });
}

export async function getInvestorSettings(): Promise<InvestorSettings> {
  return request('/investor/settings');
}

export async function updateInvestorSettings(
  data: Partial<InvestorSettings>,
): Promise<InvestorSettings> {
  return request('/investor/settings', { method: 'PATCH', body: JSON.stringify(data) });
}

export async function emailInvestorReport(
  month: string,
  data: { html: string; subject?: string; to?: string[] },
): Promise<{ success: true; sentTo: string[] }> {
  return request(`/investor/report/${month}/email`, { method: 'POST', body: JSON.stringify(data) });
}
