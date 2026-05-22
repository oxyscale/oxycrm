// ============================================================
// Email Signature — Branded HTML signature block.
// Matches Jordan's actual Gmail signature: name, title, OxyScale
// wordmark, phone, website, and "Book a call" button.
// Table-based layout with inline CSS for email-client compatibility.
// ============================================================

interface SignatureSettings {
  sender_name: string;
  sender_title: string;
  sender_phone: string;
  company_name: string;
  website_url: string;
  calendly_link: string;
}

const FONT_STACK =
  "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

export function buildEmailSignature(settings: SignatureSettings): string {
  const {
    sender_name,
    sender_title,
    sender_phone,
    calendly_link,
  } = settings;

  const calLink = calendly_link || 'https://calendly.com/jordan-oxyscale/discovery-call-30-minutes';

  return `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse: collapse; margin-top: 24px; font-family: ${FONT_STACK}; color: #0b0d0e; font-size: 14px; line-height: 1.4; mso-line-height-rule: exactly;">
  <tr>
    <td style="padding: 0 0 10px 0;">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="340" style="border-collapse: collapse; width: 340px;">
        <tr>
          <td height="2" style="height: 2px; background-color: #5ec5e6; line-height: 2px; font-size: 0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 0; color: #0b0d0e; font-family: ${FONT_STACK}; font-weight: 600; font-size: 16px; letter-spacing: -0.01em;">
      ${sender_name}
    </td>
  </tr>
  <tr>
    <td style="padding: 0 0 8px 0; color: #8a95a0; font-family: ${FONT_STACK}; font-size: 13px;">
      ${sender_title}
    </td>
  </tr>
  <tr>
    <td style="padding: 0 0 8px 0; font-family: ${FONT_STACK}; font-size: 19px; letter-spacing: -0.035em; font-weight: 600;">
      <span style="color: #0b0d0e;">Oxy</span><span style="color: #0c8dbf;">Scale</span>
    </td>
  </tr>
  <tr>
    <td style="padding: 0; color: #8a95a0; font-family: ${FONT_STACK}; font-size: 13px;">
      ${sender_phone}
    </td>
  </tr>
  <tr>
    <td style="padding: 0 0 14px 0; color: #0c8dbf; font-family: ${FONT_STACK}; font-size: 13px;">
      oxyscale&#8228;ai
    </td>
  </tr>
  <tr>
    <td>
      <a href="${calLink}" target="_blank" style="text-decoration: none; border: 0; outline: 0;"><img src="https://files.catbox.moe/864i9l.png" alt="Book a call" width="130" height="38" border="0" style="display: block; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;"></a>
    </td>
  </tr>
</table>`.trim();
}
