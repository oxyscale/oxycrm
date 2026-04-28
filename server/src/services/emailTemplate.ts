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
  intro: string;
  /** Optional headline shown above the intro line. */
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
  /** Capabilities button. Renders when present. */
  capabilitiesCta?: CapabilitiesCta | null;
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
    .replace(/>/g, '&gt;');
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
 */
function renderBodyParagraphs(body: string): string {
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
      const html = escapeHtml(p)
        .replace(ITALIC_ACCENT_PATTERN, (_m, phrase: string) => `<em style="${ITALIC_ACCENT_STYLE}">${phrase}</em>`)
        .replace(/\n/g, '<br />');
      const style = i === chunks.length - 1 ? lastParagraphStyle : paragraphStyle;
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
            <tr><td style="background-color: #ffffff; padding: 56px 64px 6px 64px;">
              <p style="margin: 0 0 18px 0; color: #0a9cd4; font-family: ${MONO_STACK}; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600;">
                ${labelLine}
              </p>
              <p style="margin: 0; color: #0b0d0e; font-family: ${SERIF_STACK}; font-style: italic; font-weight: 400; font-size: 36px; line-height: 1.18; letter-spacing: -0.025em;">
                A note after<br />our chat.
              </p>
            </td></tr>

            <tr><td style="background-color: #ffffff; padding: 36px 64px 0 64px;">
              <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                <td style="width: 32px; height: 2px; background-color: #0b0d0e; font-size: 0; line-height: 2px;">&nbsp;</td>
              </tr></table>
            </td></tr>`;
}

function renderStandardGreeting(name: string): string {
  const first = escapeHtml(firstNameOf(name));
  return `
            <tr><td style="background-color: #ffffff; padding: 44px 64px 0 64px;">
              <p style="margin: 0; color: #0b0d0e; font-size: 19px; line-height: 1.4; font-weight: 500; font-family: ${FONT_STACK}; letter-spacing: -0.015em;">
                Hi ${first},
              </p>
            </td></tr>`;
}

function renderCapabilitiesRow(cta: CapabilitiesCta): string {
  const safeUrl = escapeHtml(cta.url);
  const safeLabel = escapeHtml(cta.label || 'View capabilities document');
  const safeTitle = cta.title ? escapeHtml(cta.title) : '';
  const safeIntro = escapeHtml(cta.intro || '');

  const titleHtml = safeTitle
    ? `<p style="margin: 0 0 6px 0; color: #0b0d0e; font-size: 17px; line-height: 1.4; font-weight: 500; font-family: ${FONT_STACK}; letter-spacing: -0.015em;">${safeTitle}</p>`
    : '';

  const introHtml = safeIntro
    ? `<p style="margin: 0 0 22px 0; color: #55606a; font-size: 14px; line-height: 1.6; font-weight: 400; font-family: ${FONT_STACK};">${safeIntro}</p>`
    : '';

  return `
                <tr><td style="padding: 30px 32px 28px 32px;">
                  <p style="margin: 0 0 12px 0; color: #8a95a0; font-family: ${MONO_STACK}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600;">
                    01 &nbsp;&middot;&nbsp; Capabilities document
                  </p>
                  ${titleHtml}
                  ${introHtml}
                  <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;"><tr>
                    <td align="center" style="background-color: #0c8dbf; border-radius: 999px;">
                      <a href="${safeUrl}" style="display: inline-block; padding: 14px 30px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; letter-spacing: -0.005em; line-height: 1; border-radius: 999px; font-family: ${FONT_STACK};">${safeLabel} &nbsp;&rarr;</a>
                    </td>
                  </tr></table>
                </td></tr>`;
}

function renderBookACallRow(url: string): string {
  const safeUrl = escapeHtml(url);
  return `
                <tr><td style="padding: 26px 32px 30px 32px;">
                  <p style="margin: 0 0 10px 0; color: #8a95a0; font-family: ${MONO_STACK}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600;">
                    02 &nbsp;&middot;&nbsp; Book a call
                  </p>
                  <p style="margin: 0 0 18px 0; color: #55606a; font-size: 14px; line-height: 1.55; font-weight: 400; font-family: ${FONT_STACK};">
                    Thirty minutes, on us. We dig into how your operation actually runs, what systems you've got in place, and where OxyScale would slot in for your business. You leave the call with a clear picture of the fit, and exactly how we'd build it for you.
                  </p>
                  <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;"><tr>
                    <td align="center" style="background-color: #0b0d0e; border-radius: 999px;">
                      <a href="${safeUrl}" style="display: inline-block; padding: 11px 22px; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 500; letter-spacing: -0.005em; line-height: 1; border-radius: 999px; font-family: ${FONT_STACK};">Book a call</a>
                    </td>
                  </tr></table>
                </td></tr>`;
}

function renderCtaCard(
  capabilitiesCta: CapabilitiesCta | null | undefined,
  bookACallUrl: string | null | undefined,
): string {
  const showCapabilities = !!(capabilitiesCta && capabilitiesCta.url);
  const showBookACall = !!bookACallUrl;
  if (!showCapabilities && !showBookACall) return '';

  const capabilitiesRow = showCapabilities ? renderCapabilitiesRow(capabilitiesCta!) : '';
  const dividerRow =
    showCapabilities && showBookACall
      ? `<tr><td style="padding: 0 32px;"><hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 0;" /></td></tr>`
      : '';
  const bookACallRow = showBookACall ? renderBookACallRow(bookACallUrl!) : '';

  return `
            <tr><td style="background-color: #ffffff; padding: 44px 64px 8px 64px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #faf9f5; border: 1px solid rgba(11,13,14,0.06); border-radius: 14px;">
                <tr><td style="height: 2px; font-size: 0; line-height: 0; background-color: #0a9cd4; border-radius: 14px 14px 0 0;">&nbsp;</td></tr>
                ${capabilitiesRow}
                ${dividerRow}
                ${bookACallRow}
              </table>
            </td></tr>`;
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
    bookACallUrl = null,
  } = params;

  const dateStamp = formatStampDate(new Date());
  const bodyHtml = renderBodyParagraphs(body);

  const greetingBlock =
    mode === 'post-call'
      ? renderEditorialEntry(recipientName, recipientCompany)
      : renderStandardGreeting(recipientName);

  // Top padding above the body differs depending on whether the editorial
  // entry block has already drawn its own bottom rule and 36px padding.
  const bodyTopPadding = mode === 'post-call' ? '28px' : '20px';

  const ctaCard = renderCtaCard(capabilitiesCta, bookACallUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>OxyScale</title>
</head>
<body style="margin: 0; padding: 0; background-color: #faf9f5; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #0b0d0e;">

  <!-- Hidden preheader — sits in the inbox preview line, invisible in the body -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#faf9f5;">
    A note from OxyScale. Intelligence your team will actually use.
  </div>

  <!-- Outer frame: Cream page bg -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #faf9f5; padding: 72px 16px 56px 16px;">
    <tr>
      <td align="center">

        <!-- Tray ring -->
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 640px; width: 100%; background-color: #f2f0e8; border-radius: 24px; padding: 7px;">
          <tr>
            <td style="padding: 0;">

              <!-- Inner card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; border-radius: 17px; border: 1px solid rgba(11,13,14,0.05); box-shadow: 0 40px 100px -50px rgba(11,13,14,0.22);">

                <!-- Header -->
                <tr><td style="background-color: #ffffff; padding: 40px 64px 28px 64px; border-radius: 17px 17px 0 0;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                    <td valign="middle">
                      <a href="https://oxyscale.ai" style="text-decoration: none; font-family: ${FONT_STACK}; font-weight: 600; font-size: 22px; letter-spacing: -0.035em; line-height: 1;">
                        <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                      </a>
                    </td>
                    <td align="right" valign="middle">
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
                <tr><td style="background-color: #ffffff; padding: ${bodyTopPadding} 64px 0 64px;">
                  ${bodyHtml}
                </td></tr>

                ${ctaCard}

                <!-- Sign-off + signature -->
                <tr><td style="background-color: #ffffff; padding: 44px 64px 48px 64px;">
                  <p style="margin: 0 0 4px 0; color: #2a3138; font-size: 16px; line-height: 1.7; font-family: ${FONT_STACK};">
                    ${escapeHtml(signOff)},
                  </p>
                  ${signature}
                </td></tr>

                <!-- Footer divider -->
                <tr><td style="background-color: #ffffff; padding: 0 64px;">
                  <hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 0;" />
                </td></tr>

                <!-- Footer (colophon) -->
                <tr><td style="background-color: #faf9f5; padding: 40px 64px 44px 64px; border-radius: 0 0 17px 17px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                    <td valign="top" width="60%">
                      <span style="font-family: ${FONT_STACK}; font-weight: 600; font-size: 14px; letter-spacing: -0.035em; line-height: 1;"><span style="color: #55606a;">Oxy</span><span style="color: #0a9cd4;">Scale</span></span>
                      <p style="margin: 14px 0 0 0; color: #55606a; font-family: ${SERIF_STACK}; font-style: italic; font-size: 15px; line-height: 1.45; font-weight: 400;">
                        Intelligence your team will&nbsp;<span style="color: #0a9cd4;">actually&nbsp;use.</span>
                      </p>
                    </td>
                    <td valign="top" width="40%" align="right">
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
