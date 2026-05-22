// ============================================================
// Recent Leads — localStorage-backed history of visited lead profiles
// Used by the sidebar (quick-return), search bar (pre-search suggestions),
// and the leads page search input.
// ============================================================

const STORAGE_KEY = 'oxycrm_recent_leads';
const MAX_RECENT = 10;

export interface RecentLead {
  id: number;
  name: string;
  company: string | null;
  /** ISO timestamp of the last visit */
  visitedAt: string;
}

/** Get the list of recently visited leads, most recent first. */
export function getRecentLeads(): RecentLead[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentLead[];
  } catch {
    return [];
  }
}

/**
 * Record a visit to a lead profile. Moves the lead to the top
 * of the list if already present, otherwise prepends it.
 * Caps the list at MAX_RECENT entries.
 */
export function recordLeadVisit(lead: { id: number; name: string; company: string | null }) {
  const recent = getRecentLeads().filter((r) => r.id !== lead.id);
  recent.unshift({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    visitedAt: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

/** Get the most recently visited lead (for the sidebar quick-return). */
export function getLastVisitedLead(): RecentLead | null {
  const recent = getRecentLeads();
  return recent.length > 0 ? recent[0] : null;
}
