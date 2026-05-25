// ============================================================
// Text helpers
// ============================================================

/**
 * Decode HTML entities in a string ("Caitie &amp; Lyndel" -> "Caitie & Lyndel").
 *
 * Uses a detached <textarea> element so the browser's own HTML parser
 * handles every named and numeric entity — no hand-rolled table to
 * maintain. Setting innerHTML on a textarea is safe: textarea content
 * is rendered as plain text, so script tags etc. don't execute.
 *
 * Returns the input unchanged if it has no entities, runs server-side
 * during SSR (defensive), or if the DOM isn't available.
 */
export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  if (typeof document === 'undefined') return input;
  if (!input.includes('&')) return input;
  const txt = document.createElement('textarea');
  txt.innerHTML = input;
  return txt.value;
}
