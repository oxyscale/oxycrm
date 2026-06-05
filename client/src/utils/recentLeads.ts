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

/** Remove a single lead from the recently-visited list. Called when a
 *  lead is deleted from the profile so the dropdown doesn't show stale
 *  ghosts. Safe to call with an ID that isn't in the list. */
export function removeRecentLead(id: number): void {
  try {
    const recent = getRecentLeads().filter((r) => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    /* ignore — non-critical */
  }
}

/**
 * Refresh the recently-visited list against the server's source of truth.
 * - Drops entries whose lead no longer exists (handles deletes done
 *   anywhere — this tab, another tab, by George, etc.)
 * - Updates entries with the current name/company (handles renames).
 * - Preserves the visit order from localStorage.
 *
 * Call this when opening any UI that displays the recents dropdown.
 * Returns the refreshed list; also writes it back to localStorage.
 */
export async function refreshRecentLeads(): Promise<RecentLead[]> {
  const existing = getRecentLeads();
  if (existing.length === 0) return [];
  try {
    const ids = existing.map((r) => r.id);
    const res = await fetch('/api/leads/validate-ids', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return existing; // fail open — keep showing what we have
    const fresh = (await res.json()) as { id: number; name: string; company: string | null }[];
    const freshById = new Map(fresh.map((r) => [r.id, r]));
    // Walk the original (preserves visit order), drop missing, swap in
    // the up-to-date name/company for the survivors.
    const refreshed: RecentLead[] = [];
    for (const entry of existing) {
      const current = freshById.get(entry.id);
      if (!current) continue; // lead was deleted
      refreshed.push({
        id: current.id,
        name: current.name,
        company: current.company,
        visitedAt: entry.visitedAt,
      });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    return refreshed;
  } catch {
    return existing; // network blip — keep showing what we have
  }
}
