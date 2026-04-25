// ============================================================
// Email Template — Builds branded HTML email wrapper
// Premium OxyScale design — light editorial brand (Cream / Ink / Sky)
// Table-based layout with inline CSS for email-client compatibility.
// Targets premium prospects: editorial typography, generous breathing
// room, breathing-ring glyph, Sky Ink accent system, Ink pill CTA,
// Fraunces italic accent on the tagline.
// ============================================================

interface BuildBrandedEmailParams {
  body: string;
  recipientName: string;
  senderName: string;
  signOff: string;
  signature: string;
}

const FONT_STACK =
  "Geist, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF_STACK =
  "'Fraunces', 'Iowan Old Style', Georgia, 'Times New Roman', serif";

// Editorial date stamp — e.g. "25 · 04 · 26"
function formatStampDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} · ${pad(d.getMonth() + 1)} · ${String(d.getFullYear()).slice(-2)}`;
}

export function buildBrandedEmailHtml(params: BuildBrandedEmailParams): string {
  const {
    body,
    recipientName,
    senderName: _senderName,
    signOff,
    signature,
  } = params;

  const htmlBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');

  const dateStamp = formatStampDate(new Date());

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
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #faf9f5; padding: 56px 16px 40px 16px;">
    <tr>
      <td align="center">

        <!-- Tray ring — soft cream-on-cream bezel that gives the card a premium 'mounted' feel -->
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 640px; width: 100%; background-color: #f2f0e8; border-radius: 22px; padding: 6px;">
          <tr>
            <td style="padding: 0;">

              <!-- Inner card — paper white, hair-soft border, soft sky shadow halo -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; border-radius: 16px; border: 1px solid rgba(11,13,14,0.05); box-shadow: 0 30px 80px -40px rgba(11,13,14,0.18);">

                <!-- Header — glyph + wordmark left, mono date stamp right -->
                <tr>
                  <td style="background-color: #ffffff; padding: 36px 56px 22px 56px; border-radius: 16px 16px 0 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td valign="middle">
                          <a href="https://oxyscale.ai" style="text-decoration: none; font-family: ${FONT_STACK}; font-weight: 600; font-size: 22px; letter-spacing: -0.035em; line-height: 1;">
                            <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                          </a>
                        </td>
                        <td align="right" valign="middle">
                          <span style="color: #8a95a0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600; font-family: ${FONT_STACK};">
                            ${dateStamp}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Sky accent bar — 32% sky-ink, 68% hair (signature OxyScale split) -->
                <tr>
                  <td style="height: 2px; font-size: 0; line-height: 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                      <td style="width: 32%; background-color: #0a9cd4; height: 2px; line-height: 2px; font-size: 0;">&nbsp;</td>
                      <td style="width: 68%; background-color: rgba(11,13,14,0.08); height: 2px; line-height: 2px; font-size: 0;">&nbsp;</td>
                    </tr></table>
                  </td>
                </tr>

                <!-- Greeting -->
                <tr>
                  <td style="background-color: #ffffff; padding: 44px 56px 0 56px;">
                    <p style="margin: 0; color: #0b0d0e; font-size: 19px; line-height: 1.4; font-weight: 500; font-family: ${FONT_STACK}; letter-spacing: -0.015em;">
                      Hi ${recipientName},
                    </p>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="background-color: #ffffff; padding: 20px 56px 8px 56px;">
                    <div style="margin: 0; color: #2a3138; font-size: 15.5px; line-height: 1.78; font-weight: 400; font-family: ${FONT_STACK};">
                      ${htmlBody}
                    </div>
                  </td>
                </tr>

                <!-- Sign-off + signature block -->
                <tr>
                  <td style="background-color: #ffffff; padding: 16px 56px 40px 56px;">
                    <p style="margin: 0 0 4px 0; color: #2a3138; font-size: 15.5px; line-height: 1.7; font-family: ${FONT_STACK};">
                      ${signOff},
                    </p>
                    ${signature}
                  </td>
                </tr>

                <!-- Hairline divider before footer -->
                <tr>
                  <td style="background-color: #ffffff; padding: 0 56px;">
                    <hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 0;" />
                  </td>
                </tr>

                <!-- Footer — cream wash, three-column architecture -->
                <tr>
                  <td style="background-color: #faf9f5; padding: 32px 56px 36px 56px; border-radius: 0 0 16px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td valign="top" width="65%">
                          <span style="font-family: ${FONT_STACK}; font-weight: 600; font-size: 14px; letter-spacing: -0.035em; line-height: 1;">
                            <span style="color: #55606a;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                          </span>
                          <p style="margin: 10px 0 0 0; color: #8a95a0; font-size: 12px; line-height: 1.65; font-family: ${FONT_STACK}; font-weight: 400;">
                            Intelligence your team will&nbsp;<em style="font-family: ${SERIF_STACK}; font-style: italic; color: #0a9cd4; font-weight: 400;">actually&nbsp;use.</em>
                          </p>
                        </td>
                        <td valign="top" width="35%" align="right">
                          <span style="color: #8a95a0; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 600; font-family: ${FONT_STACK}; display: inline-block; padding-bottom: 6px;">Website</span><br />
                          <a href="https://oxyscale.ai" style="color: #0a9cd4; text-decoration: none; font-size: 12px; font-weight: 500; font-family: ${FONT_STACK}; letter-spacing: -0.005em;">oxyscale.ai&nbsp;↗</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

        <!-- Legal — sits OUTSIDE the card, on cream background, very subtle -->
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 640px; width: 100%;">
          <tr>
            <td align="center" style="padding: 22px 32px 0 32px;">
              <p style="margin: 0; color: #b8bfc6; font-size: 11px; line-height: 1.6; text-align: center; font-family: ${FONT_STACK};">
                You're receiving this because you spoke with the OxyScale team. Reply directly if you'd rather not hear from us again.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
