// ============================================================
// Email Template — Builds branded HTML email wrapper.
//
// Two render modes:
//   - 'post-call'   Editorial entry block: TO {NAME · COMPANY} mono
//                   label + Fraunces italic "A note after our chat."
//                   display headline. Default for Email Bank drafts
//                   (post-call follow-ups).
//   - 'standard'    Simple "Hi {firstname}," greeting. Default for
//                   manual compose / ad-hoc CRM emails.
//
// Optional CTA card renders before the sign-off when either
// `capabilitiesCta` or `bookACallUrl` is supplied. Rows are
// independent — pass one, the other, or both.
//
// Table-based layout with inline CSS for email-client compatibility.
// ============================================================

interface CapabilitiesCta {
  url: string;
  label: string;
  /** Kept on the type for backwards-compat with old callers — the
   *  simplified button renderer no longer displays intro text. */
  intro: string;
  /** Kept for backwards-compat. Not rendered by the simplified
   *  standalone-button design. */
  title?: string;
}

interface BuildBrandedEmailParams {
  body: string;
  recipientName: string;
  /** Company name shown next to recipient in the post-call header. Optional. */
  recipientCompany?: string;
  senderName: string;
  signOff: string;
  signature: string;
  /** Which top-of-letter block to render. Defaults to 'standard'. */
  mode?: 'post-call' | 'standard';
  /** Primary capabilities button. Jordan uses this slot for the
   *  recruitment-specific hook (info.oxyscale.ai by default). */
  capabilitiesCta?: CapabilitiesCta | null;
  /** Secondary capabilities button. Jordan uses this slot for the
   *  broad capabilities doc (details.oxyscale.ai by default). Either
   *  slot can be active independently. */
  secondaryCta?: CapabilitiesCta | null;
  /** Calendly / book-a-call URL. Renders the black pill button when present. */
  bookACallUrl?: string | null;
}

const FONT_STACK =
  "Geist, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF_STACK =
  "'Fraunces', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
const MONO_STACK =
  "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace";

// Editorial date stamp — e.g. "25 · 04 · 26"
function formatStampDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} &nbsp;&middot;&nbsp; ${pad(d.getMonth() + 1)} &nbsp;&middot;&nbsp; ${String(d.getFullYear()).slice(-2)}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Defence-in-depth on URL fields used in href attributes. Reject any
// scheme that isn't http or https — kills javascript:, data:, vbscript:
// and friends. Untrusted URLs come from the category_prompts table
// (admin-controlled via Settings, but a defensive layer is cheap).
function safeHref(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return 'about:blank';
  }
  return escapeHtml(trimmed);
}

function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

// Match `*phrase*` patterns where the phrase is 5–80 chars, single-line, no
// nested asterisks. Used to render Claude's chosen italic accent in the body.
// Length floor avoids stylising stray characters; length cap avoids
// italicising whole paragraphs by accident.
const ITALIC_ACCENT_PATTERN = /\*([^*\n]{5,80})\*/g;
const ITALIC_ACCENT_STYLE = `font-family: ${SERIF_STACK}; font-style: italic; color: #0a9cd4; font-weight: 400;`;

// Body token that lets Jordan position the CTA card mid-email. Put it
// on its own line (blank line above + below) and at render time it gets
// replaced with the bordered CTA box (capabilities + book-a-call). If
// the token isn't present, the CTA card defaults to its usual position
// just above the sign-off.
const CTA_TOKEN = '{{cta}}';

// Common sign-off phrases the template auto-strips from the bottom of
// the body so it doesn't render alongside the template's own sign-off
// line (which always shows the user's configured value just above the
// signature). Without this, AI-generated bodies that end with "Kind
// regards," produce a double sign-off — "Kind regards," in the body
// AND "Cheers," appended by the template. Matched case-insensitively
// with optional trailing comma/period.
const COMMON_SIGNOFFS = new Set([
  'cheers', 'kind regards', 'regards', 'best', 'best regards',
  'best wishes', 'thanks', 'thank you', 'many thanks', 'talk soon',
  'speak soon', 'warmly', 'sincerely', 'yours sincerely', 'yours',
  'all the best', 'with thanks', 'thanks again', 'much appreciated',
  'appreciate it',
]);

/**
 * Strip a trailing sign-off line from the body if present, so the
 * template's appended sign-off doesn't show up alongside one in the
 * body. Matches the user's configured `signOff` first, then falls back
 * to a list of common alternatives. Case-insensitive, tolerant of
 * trailing punctuation. Only the LAST meaningful line is checked.
 */
function stripTrailingSignoff(body: string, configuredSignOff: string): string {
  if (!body || !body.trim()) return body;
  // Split into trimmed-line entries; preserve original for re-joining.
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  // Walk from the end, skipping pure-blank lines.
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx--;
  if (lastIdx < 0) return body;

  const lastLine = lines[lastIdx].trim();
  // Normalise: drop trailing comma, period, exclamation, dash etc.
  const normalised = lastLine.toLowerCase().replace(/[\s,.!\-—–]+$/, '').trim();

  const configured = configuredSignOff.trim().toLowerCase().replace(/[\s,.!\-—–]+$/, '').trim();
  const isMatch =
    (configured && normalised === configured) || COMMON_SIGNOFFS.has(normalised);

  if (!isMatch) return body;

  // Drop the matched sign-off line AND any trailing blank lines above
  // it so the rendered body doesn't end with awkward whitespace.
  let cutTo = lastIdx;
  while (cutTo > 0 && lines[cutTo - 1].trim() === '') cutTo--;
  return lines.slice(0, cutTo).join('\n').replace(/\s+$/, '');
}

/**
 * Auto-link bare URLs in already-escaped HTML text. Matches http/https
 * URLs and wraps them in styled <a> tags. Trailing sentence punctuation
 * (periods, commas, etc.) is stripped from the URL so "visit https://oxyscale.ai/."
 * links correctly without including the full stop.
 */
function autoLinkUrls(escapedHtml: string): string {
  const linkStyle = 'color: #0a9cd4; text-decoration: underline;';

  // Step 1: Link full URLs (http:// or https://)
  let result = escapedHtml.replace(
    /https?:\/\/[^\s<]+/g,
    (match) => {
      let url = match;
      let suffix = '';
      const trailing = url.match(/([.,;:!?)\]]+)$/);
      if (trailing) {
        suffix = trailing[1];
        url = url.slice(0, -suffix.length);
      }
      return `<a href="${url}" style="${linkStyle}">${url}</a>${suffix}`;
    },
  );

  // Step 2: Link bare domains (e.g. "oxyscale.ai", "example.com/path")
  // Only matches words that contain a dot followed by a valid TLD,
  // and aren't already inside an <a> tag from step 1.
  // Negative lookbehind ensures we skip anything preceded by :// or "
  result = result.replace(
    /(?<![/":])\b([a-zA-Z0-9][\w.-]*\.(?:com|ai|au|co|io|org|net|dev|app|xyz|info|biz|me|uk|nz|com\.au|co\.uk|co\.nz)(?:\/[^\s<]*)?)/g,
    (match) => {
      let url = match;
      let suffix = '';
      const trailing = url.match(/([.,;:!?)\]]+)$/);
      if (trailing) {
        suffix = trailing[1];
        url = url.slice(0, -suffix.length);
      }
      return `<a href="https://${url}" style="${linkStyle}">${url}</a>${suffix}`;
    },
  );

  return result;
}

/**
 * Convert plain-text body (Jordan's textarea content) into HTML paragraphs.
 * Blank lines separate paragraphs. Single newlines inside a paragraph
 * become <br />. All content is HTML-escaped — Jordan can never break
 * the wrapper from inside the body.
 *
 * One italic accent: a phrase wrapped in single asterisks (e.g. *like this*)
 * renders in Fraunces italic sky-ink. Claude is prompted to pick one
 * distinctive phrase per email; Jordan can move or remove the asterisks
 * in the textarea.
 *
 * Bare URLs (http/https) are auto-linked into clickable <a> tags.
 */
function renderBodyParagraphs(body: string, ctaInlineHtml: string | null = null): string {
  const paragraphStyle =
    `margin: 0 0 22px 0; color: #2a3138; font-size: 16px; line-height: 1.8; font-weight: 400; font-family: ${FONT_STACK};`;
  const lastParagraphStyle =
    `margin: 0; color: #2a3138; font-size: 16px; line-height: 1.8; font-weight: 400; font-family: ${FONT_STACK};`;

  const chunks = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (chunks.length === 0) return '';

  return chunks
    .map((p, i) => {
      const isLast = i === chunks.length - 1;
      // A paragraph that's JUST the CTA token gets replaced with the
      // bordered CTA box, inlined into the body flow. Spacing above and
      // below mirrors the normal paragraph rhythm. If no CTA is
      // configured for this email, the token paragraph is silently
      // dropped so the body doesn't show a literal "{{cta}}".
      if (p === CTA_TOKEN) {
        if (!ctaInlineHtml) return '';
        const margin = isLast ? '0 0 0 0' : '0 0 22px 0';
        return `<div style="margin: ${margin};">${ctaInlineHtml}</div>`;
      }
      const html = autoLinkUrls(
        escapeHtml(p)
          .replace(ITALIC_ACCENT_PATTERN, (_m, phrase: string) => `<em style="${ITALIC_ACCENT_STYLE}">${phrase}</em>`),
      ).replace(/\n/g, '<br />');
      const style = isLast ? lastParagraphStyle : paragraphStyle;
      return `<p style="${style}">${html}</p>`;
    })
    .join('\n');
}

function renderEditorialEntry(name: string, company: string | undefined): string {
  const safeName = escapeHtml(name).toUpperCase();
  const safeCompany = company ? escapeHtml(company).toUpperCase() : '';
  const labelLine = safeCompany
    ? `To ${safeName} &nbsp;&middot;&nbsp; ${safeCompany}`
    : `To ${safeName}`;

  return `
            <tr><td class="ox-entry-pad" style="background-color: #ffffff; padding: 56px 64px 6px 64px;">
              <p style="margin: 0 0 18px 0; color: #0a9cd4; font-family: ${MONO_STACK}; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600;">
                ${labelLine}
              </p>
              <p class="ox-hero" style="margin: 0; color: #0b0d0e; font-family: ${SERIF_STACK}; font-style: italic; font-weight: 400; font-size: 36px; line-height: 1.18; letter-spacing: -0.025em;">
                A note after<br />our chat.
              </p>
            </td></tr>

            <tr><td class="ox-card-pad-h" style="background-color: #ffffff; padding: 36px 64px 0 64px;">
              <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                <td style="width: 32px; height: 2px; background-color: #0b0d0e; font-size: 0; line-height: 2px;">&nbsp;</td>
              </tr></table>
            </td></tr>`;
}

function renderStandardGreeting(name: string): string {
  const first = escapeHtml(firstNameOf(name));
  return `
            <tr><td class="ox-greeting-pad" style="background-color: #ffffff; padding: 44px 64px 0 64px;">
              <p style="margin: 0; color: #0b0d0e; font-size: 19px; line-height: 1.4; font-weight: 500; font-family: ${FONT_STACK}; letter-spacing: -0.015em;">
                Hi ${first},
              </p>
            </td></tr>`;
}

// Standalone blue pill button. Used for both Recruitment Capabilities
// and the broad Capabilities Document. No bordered card around it, no
// mono overline, no trailing arrow — just a clean inline button.
function renderStandaloneCapabilitiesButton(cta: CapabilitiesCta): string {
  const safeUrl = safeHref(cta.url);
  const safeLabel = escapeHtml(cta.label || 'View our capabilities');
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;"><tr>
    <td style="background-color: #0c8dbf; border-radius: 999px;">
      <a href="${safeUrl}" class="ox-cta-btn" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; letter-spacing: -0.005em; line-height: 1; border-radius: 999px; font-family: ${FONT_STACK};">${safeLabel}</a>
    </td>
  </tr></table>`;
}

// Standalone "Book a call" pill — kept symmetric with the capabilities
// button. Currently unused in production (the email signature already
// has a Book-a-call button) but the renderer still supports it if a
// caller passes bookACallUrl.
function renderStandaloneBookACallButton(url: string): string {
  const safeUrl = safeHref(url);
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;"><tr>
    <td style="background-color: #0b0d0e; border-radius: 999px;">
      <a href="${safeUrl}" class="ox-cta-btn" style="display: inline-block; padding: 14px 30px; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; letter-spacing: -0.005em; line-height: 1; border-radius: 999px; font-family: ${FONT_STACK};">Book a call</a>
    </td>
  </tr></table>`;
}

/**
 * The CTA block — just a vertical stack of standalone pill buttons.
 * No card border, no overline labels, no intro text. Used in two
 * places: wrapped in its own table row at the default position (just
 * above the sign-off), OR inlined into the body when Jordan drops the
 * `{{cta}}` token mid-message.
 */
function renderCtaBoxInner(
  capabilitiesCta: CapabilitiesCta | null | undefined,
  secondaryCta: CapabilitiesCta | null | undefined,
  bookACallUrl: string | null | undefined,
): string {
  const buttons: string[] = [];
  if (capabilitiesCta?.url) buttons.push(renderStandaloneCapabilitiesButton(capabilitiesCta));
  if (secondaryCta?.url) buttons.push(renderStandaloneCapabilitiesButton(secondaryCta));
  if (bookACallUrl) buttons.push(renderStandaloneBookACallButton(bookACallUrl));

  if (buttons.length === 0) return '';

  // Stack vertically with 12px spacing between buttons. First button
  // sits flush; subsequent buttons get a top margin via a wrapper div.
  return buttons
    .map((btn, i) => (i === 0 ? btn : `<div style="margin-top: 12px;">${btn}</div>`))
    .join('');
}

function renderCtaCard(
  capabilitiesCta: CapabilitiesCta | null | undefined,
  secondaryCta: CapabilitiesCta | null | undefined,
  bookACallUrl: string | null | undefined,
): string {
  const inner = renderCtaBoxInner(capabilitiesCta, secondaryCta, bookACallUrl);
  if (!inner) return '';
  return `
            <tr><td class="ox-cta-outer-pad" style="background-color: #ffffff; padding: 12px 64px 12px 64px;">
              ${inner}
            </td></tr>`;
}

/**
 * Plain-text-style email renderer.
 *
 * Strips the OxyScale branded shell (header card, editorial entry,
 * footer colophon, tray-and-card design) and produces an email that
 * reads as a personal message — body text in standard inline styling
 * with the user's HTML signature at the bottom, exactly like a Gmail
 * message would look.
 *
 * Optional: the capabilities and book-a-call buttons can still be
 * included via {{cta}} token or default position. They render as the
 * same bordered card the branded mode uses (Jordan asked for the
 * capabilities button to remain available in plain mode).
 *
 * The italic accent (asterisks → blue Fraunces in branded mode)
 * downgrades to plain HTML <em> here — no colour or serif treatment,
 * just standard italics, which read as natural emphasis.
 */
export function buildPlainEmailHtml(params: BuildBrandedEmailParams): string {
  const {
    body,
    signOff,
    signature,
    capabilitiesCta = null,
    secondaryCta = null,
    bookACallUrl = null,
  } = params;

  const cleanBody = stripTrailingSignoff(body, signOff);
  const bodyHasCtaToken = cleanBody.includes(CTA_TOKEN);
  const inlineCtaHtml = bodyHasCtaToken
    ? renderCtaBoxInner(capabilitiesCta, secondaryCta, bookACallUrl)
    : null;
  const bodyHtml = renderPlainBodyParagraphs(cleanBody, inlineCtaHtml);
  const ctaCard = bodyHasCtaToken
    ? ''
    : renderPlainCtaBlock(capabilitiesCta, secondaryCta, bookACallUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>OxyScale</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; padding: 24px 16px;">
    <tr><td align="left">
      <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 640px; width: 100%;">
        <tr><td style="padding: 0;">
          ${bodyHtml}
          ${ctaCard}
          <p style="margin: 26px 0 4px 0; color: #1a1a1a; font-size: 15px; line-height: 1.6; font-family: ${FONT_STACK};">
            ${escapeHtml(signOff)},
          </p>
          ${signature}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Body paragraphs for plain mode — same flow as the branded renderer
// (split on blank lines, escape, auto-link URLs, support the {{cta}}
// token) but using plain HTML <em> for italic accents instead of the
// Fraunces sky-ink styling.
function renderPlainBodyParagraphs(body: string, ctaInlineHtml: string | null): string {
  const paragraphStyle =
    `margin: 0 0 16px 0; color: #1a1a1a; font-size: 15px; line-height: 1.55; font-family: ${FONT_STACK};`;

  const chunks = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (chunks.length === 0) return '';

  return chunks
    .map((p) => {
      if (p === CTA_TOKEN) {
        if (!ctaInlineHtml) return '';
        return `<div style="margin: 0 0 16px 0;">${ctaInlineHtml}</div>`;
      }
      const html = autoLinkUrls(
        escapeHtml(p).replace(ITALIC_ACCENT_PATTERN, (_m, phrase: string) => `<em>${phrase}</em>`),
      ).replace(/\n/g, '<br />');
      return `<p style="${paragraphStyle}">${html}</p>`;
    })
    .join('\n');
}

// CTA card at the default position in plain mode. Same bordered box
// renderer the branded template uses; just sits inline in the simple
// HTML flow instead of wrapped in a table row.
function renderPlainCtaBlock(
  capabilitiesCta: CapabilitiesCta | null | undefined,
  secondaryCta: CapabilitiesCta | null | undefined,
  bookACallUrl: string | null | undefined,
): string {
  const inner = renderCtaBoxInner(capabilitiesCta, secondaryCta, bookACallUrl);
  if (!inner) return '';
  return `<div style="margin: 22px 0 6px 0;">${inner}</div>`;
}

export function buildBrandedEmailHtml(params: BuildBrandedEmailParams): string {
  const {
    body,
    recipientName,
    recipientCompany,
    signOff,
    signature,
    mode = 'standard',
    capabilitiesCta = null,
    secondaryCta = null,
    bookACallUrl = null,
  } = params;

  const dateStamp = formatStampDate(new Date());

  // Strip any trailing sign-off in the body so it doesn't render
  // alongside the template's own appended sign-off line. Catches both
  // AI-generated drafts (Claude was instructed to include one) and
  // manually-typed sign-offs.
  const cleanBody = stripTrailingSignoff(body, signOff);

  // If the body contains the `{{cta}}` token, the CTA box renders
  // inline at that spot (and the default position above the sign-off
  // is skipped). Otherwise the CTA card stays in its default slot.
  const bodyHasCtaToken = cleanBody.includes(CTA_TOKEN);
  const inlineCtaHtml = bodyHasCtaToken
    ? renderCtaBoxInner(capabilitiesCta, secondaryCta, bookACallUrl)
    : null;
  const bodyHtml = renderBodyParagraphs(cleanBody, inlineCtaHtml);

  // In standard mode the greeting is now included in the body text
  // (either typed by the user or generated by the AI), so we skip the
  // HTML greeting block. Post-call mode still uses the editorial entry.
  const greetingBlock =
    mode === 'post-call'
      ? renderEditorialEntry(recipientName, recipientCompany)
      : '';

  // Top padding above the body differs depending on whether the editorial
  // entry block has already drawn its own bottom rule and 36px padding.
  const bodyTopPadding = mode === 'post-call' ? '28px' : '20px';

  // Skip the default-position CTA card when the token already placed
  // it inline in the body — otherwise it'd render twice.
  const ctaCard = bodyHasCtaToken ? '' : renderCtaCard(capabilitiesCta, secondaryCta, bookACallUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>OxyScale</title>
  <style>
    /* Mobile overrides — clients that respect <style> in <head>
       (iOS Mail, Apple Mail, Gmail iOS/Android, Outlook iOS, etc).
       Outlook desktop ignores @media but keeps the 640px desktop layout
       which is what we want. !important is required to beat the inline
       styles further down. */
    @media only screen and (max-width: 600px) {
      .ox-outer-pad { padding: 28px 12px 32px 12px !important; }
      .ox-card-pad-h { padding-left: 24px !important; padding-right: 24px !important; }
      .ox-header-pad { padding: 28px 24px 20px 24px !important; }
      .ox-entry-pad { padding: 36px 24px 6px 24px !important; }
      .ox-greeting-pad { padding: 32px 24px 0 24px !important; }
      .ox-body-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .ox-signoff-pad { padding: 32px 24px 36px 24px !important; }
      .ox-footer-pad { padding: 28px 24px 32px 24px !important; }
      .ox-cta-outer-pad { padding: 8px 24px 12px 24px !important; }
      .ox-cta-row-pad { padding: 22px 22px 24px 22px !important; }
      /* Hero italic headline shrinks so "A note after our chat." doesn't
         break awkwardly or overflow on narrow screens. */
      .ox-hero { font-size: 28px !important; line-height: 1.2 !important; }
      /* Editorial date stamp on mobile — hide so the wordmark gets the
         full row instead of squishing both. */
      .ox-date-stamp { display: none !important; }
      /* Footer: stack the two columns vertically. */
      .ox-footer-stack { display: block !important; width: 100% !important; max-width: 100% !important; text-align: left !important; padding: 0 !important; }
      .ox-footer-right { padding-top: 18px !important; }
      /* CTA button — give it more breathing room so the tap target
         comfortably clears 44px tall (Apple HIG) on small screens. */
      .ox-cta-btn { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #faf9f5; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #0b0d0e;">

  <!-- Hidden preheader — sits in the inbox preview line, invisible in the body -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#faf9f5;">
    A note from OxyScale. Intelligence your team will actually use.
  </div>

  <!-- Outer frame: Cream page bg -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="ox-outer-pad" style="background-color: #faf9f5; padding: 72px 16px 56px 16px;">
    <tr>
      <td align="center">

        <!-- Tray ring -->
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 640px; width: 100%; background-color: #f2f0e8; border-radius: 24px; padding: 7px;">
          <tr>
            <td style="padding: 0;">

              <!-- Inner card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; border-radius: 17px; border: 1px solid rgba(11,13,14,0.05); box-shadow: 0 40px 100px -50px rgba(11,13,14,0.22);">

                <!-- Header -->
                <tr><td class="ox-header-pad" style="background-color: #ffffff; padding: 40px 64px 28px 64px; border-radius: 17px 17px 0 0;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                    <td valign="middle">
                      <a href="https://oxyscale.ai" style="text-decoration: none; font-family: ${FONT_STACK}; font-weight: 600; font-size: 22px; letter-spacing: -0.035em; line-height: 1;">
                        <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                      </a>
                    </td>
                    <td align="right" valign="middle" class="ox-date-stamp">
                      <span style="color: #8a95a0; font-family: ${MONO_STACK}; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 500;">${dateStamp}</span>
                    </td>
                  </tr></table>
                </td></tr>

                <!-- Sky accent bar -->
                <tr><td style="height: 2px; font-size: 0; line-height: 0;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                    <td style="width: 32%; background-color: #0a9cd4; height: 2px; line-height: 2px; font-size: 0;">&nbsp;</td>
                    <td style="width: 68%; background-color: rgba(11,13,14,0.08); height: 2px; line-height: 2px; font-size: 0;">&nbsp;</td>
                  </tr></table>
                </td></tr>

                ${greetingBlock}

                <!-- Body -->
                <tr><td class="ox-body-pad" style="background-color: #ffffff; padding: ${bodyTopPadding} 64px 0 64px;">
                  ${bodyHtml}
                </td></tr>

                ${ctaCard}

                <!-- Sign-off + signature -->
                <tr><td class="ox-signoff-pad" style="background-color: #ffffff; padding: 44px 64px 48px 64px;">
                  <p style="margin: 0 0 4px 0; color: #2a3138; font-size: 16px; line-height: 1.7; font-family: ${FONT_STACK};">
                    ${escapeHtml(signOff)},
                  </p>
                  ${signature}
                </td></tr>

                <!-- Footer divider -->
                <tr><td class="ox-card-pad-h" style="background-color: #ffffff; padding: 0 64px;">
                  <hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 0;" />
                </td></tr>

                <!-- Footer (colophon) -->
                <tr><td class="ox-footer-pad" style="background-color: #faf9f5; padding: 40px 64px 44px 64px; border-radius: 0 0 17px 17px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                    <td valign="top" width="60%" class="ox-footer-stack">
                      <span style="font-family: ${FONT_STACK}; font-weight: 600; font-size: 14px; letter-spacing: -0.035em; line-height: 1;"><span style="color: #55606a;">Oxy</span><span style="color: #0a9cd4;">Scale</span></span>
                      <p style="margin: 14px 0 0 0; color: #55606a; font-family: ${SERIF_STACK}; font-style: italic; font-size: 15px; line-height: 1.45; font-weight: 400;">
                        Intelligence your team will&nbsp;<span style="color: #0a9cd4;">actually&nbsp;use.</span>
                      </p>
                    </td>
                    <td valign="top" width="40%" align="right" class="ox-footer-stack ox-footer-right">
                      <p style="margin: 0 0 6px 0; color: #8a95a0; font-family: ${MONO_STACK}; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600;">
                        Web
                      </p>
                      <a href="https://oxyscale.ai" style="color: #0a9cd4; text-decoration: none; font-size: 13px; font-weight: 500; letter-spacing: -0.005em; font-family: ${FONT_STACK};">oxyscale.ai&nbsp;&#x2197;</a>
                    </td>
                  </tr></table>
                </td></tr>

              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
