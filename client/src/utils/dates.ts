// ============================================================
// Date helpers — always anchored to Sydney time
//
// Why this exists: `new Date().toISOString().split('T')[0]` returns
// today's date in UTC, NOT in the user's local time. At 9am Sydney
// (UTC+10/+11) on May 26, UTC is still May 25 — so the "today" we
// compute lags 24 hours and tasks due "today" show as "due tomorrow"
// (or due-today rows fall into Overdue, etc.).
//
// The whole app is for Aussie users on a Sydney-based business.
// Hard-anchor the day-boundary to Australia/Sydney with Intl so
// daylight saving is handled correctly.
// ============================================================

/**
 * Returns today's calendar date in Sydney time as YYYY-MM-DD.
 *
 * Uses Intl.DateTimeFormat('en-CA') because the Canadian English
 * locale formats dates as YYYY-MM-DD natively — no string surgery
 * required.
 */
export function todayInSydney(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Returns today + N days as YYYY-MM-DD in Sydney time.
 * Use negative N to go backwards.
 */
export function daysFromTodaySydney(days: number): string {
  // Start from Sydney's "now", advance by N * 86400 seconds, then
  // re-format in Sydney. Going through ms keeps daylight-saving
  // transitions correct (we don't try to do calendar math by hand).
  const todayStr = todayInSydney();
  const [y, m, d] = todayStr.split('-').map(Number);
  // Build a UTC midnight stamp for the Sydney date, then shift.
  // We only use this as an anchor — re-format back to Sydney to land
  // on the right calendar day even if DST flips mid-window.
  const anchorUtc = new Date(Date.UTC(y, m - 1, d));
  anchorUtc.setUTCDate(anchorUtc.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(anchorUtc);
}
