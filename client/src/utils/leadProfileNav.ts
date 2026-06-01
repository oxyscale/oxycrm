// ============================================================
// Lead profile "back button" helpers
//
// Every page that links into a lead profile should call
// `rememberLeadProfileReturn()` right before navigating. The lead
// profile's Back button then reads the saved URL and goes there
// instead of always dumping the user on /leads.
//
// Example: Tasks page → click a task row → lead profile → click Back
// → land back on /tasks (not /leads).
//
// Intermediate transit pages (the lead profile itself, Compose, Book
// Meeting) DO NOT overwrite the saved URL — those are side trips,
// not parent pages. So Tasks → Lead → Compose → Lead → Back still
// lands on Tasks, which matches the "last meaningful place" mental
// model the user actually has.
// ============================================================

const RETURN_URL_KEY = 'leads:return-url';

// Pages that are themselves "transit" — opened FROM a lead context.
// Visiting one of these never updates the saved return URL.
const TRANSIT_PATH_PREFIXES = ['/leads/', '/compose/', '/book-meeting/'];

function isTransitPath(path: string): boolean {
  return TRANSIT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Stash the current page so the lead profile's Back button can return
 * to it. Skips transit pages so side-trips don't clobber the original
 * starting point. Safe to call from anywhere — sessionStorage failures
 * (private mode etc.) are swallowed.
 */
export function rememberLeadProfileReturn(): void {
  try {
    const here = window.location.pathname + window.location.search;
    if (isTransitPath(here)) return;
    sessionStorage.setItem(RETURN_URL_KEY, here);
  } catch {
    // ignore — non-critical
  }
}

/**
 * Read the saved return URL, or null if nothing was stashed.
 */
export function getLeadProfileReturn(): string | null {
  try {
    return sessionStorage.getItem(RETURN_URL_KEY);
  } catch {
    return null;
  }
}

/**
 * Drop the saved return URL. Call this after acting on it (e.g. when
 * the lead profile's Back button has navigated).
 */
export function clearLeadProfileReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_URL_KEY);
  } catch {
    // ignore
  }
}

/**
 * Friendly label for the Back button, derived from where the user
 * actually came from. Falls back to "Back to leads" when no return
 * URL was stashed (matches the legacy default).
 */
export function getLeadProfileBackLabel(returnUrl: string | null): string {
  if (!returnUrl) return 'Back to leads';
  const path = returnUrl.split('?')[0];
  if (path.startsWith('/tasks')) return 'Back to tasks';
  if (path.startsWith('/pipeline')) return 'Back to pipeline';
  if (path === '/' || path === '') return 'Back to home';
  if (path.startsWith('/reports')) return 'Back to reports';
  if (path.startsWith('/email-bank')) return 'Back to email bank';
  if (path.startsWith('/projects')) return 'Back to projects';
  if (path.startsWith('/leads')) return 'Back to leads';
  return 'Back';
}
