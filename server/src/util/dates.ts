// ============================================================
// Date helpers — always anchored to Melbourne time
//
// Railway runs in UTC. `new Date().toISOString().split('T')[0]`
// returns UTC's calendar day, not Melbourne's. At 9am Melbourne on
// May 26, UTC is still May 25 — so the "today" we compute lags
// 24 hours and date-based filters (overdue / due-today / etc.)
// silently bucket things into the wrong day.
//
// OxyCRM is for an Aussie business — anchor every "today" lookup
// to Australia/Melbourne via Intl so daylight saving is correct.
// ============================================================

/**
 * Returns today's calendar date in Melbourne as YYYY-MM-DD.
 */
export function todayInMelbourne(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
