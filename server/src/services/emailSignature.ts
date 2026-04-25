// ============================================================
// Email Signature — Branded HTML signature block.
// Premium OxyScale design. Cream / Ink / Sky Ink editorial.
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
  "Geist, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function buildEmailSignature(settings: SignatureSettings): string {
  const {
    sender_name,
    sender_title,
    sender_phone,
    website_url,
  } = settings;

  const phoneTel = sender_phone.replace(/\s/g, '');
  const cleanWebsite = website_url.replace(/^https?:\/\//, '');

  return `
<table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse; margin-top: 24px; width: 100%;">

  <!-- Sky Ink hairline divider. 64px swatch, signature OxyScale mark. -->
  <tr>
    <td style="padding: 0 0 18px 0;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse;">
        <tr>
          <td style="width: 64px; height: 2px; background-color: #0a9cd4; font-size: 0; line-height: 2px;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Name -->
  <tr>
    <td style="padding: 0 0 2px 0;">
      <span style="color: #0b0d0e; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; font-family: ${FONT_STACK};">${sender_name}</span>
    </td>
  </tr>

  <!-- Title -->
  <tr>
    <td style="padding: 0 0 14px 0;">
      <span style="color: #55606a; font-size: 12.5px; font-weight: 400; font-family: ${FONT_STACK};">${sender_title}</span>
    </td>
  </tr>

  <!-- Contact line. Phone and website inline, separated by a sky-ink dot. -->
  <tr>
    <td style="padding: 0;">
      <a href="tel:${phoneTel}" style="color: #55606a; font-size: 12.5px; text-decoration: none; font-family: ${FONT_STACK};">${sender_phone}</a><span style="color: #0a9cd4; font-size: 12.5px; font-family: ${FONT_STACK}; padding: 0 10px;">&middot;</span><a href="${website_url}" style="color: #0a9cd4; font-size: 12.5px; text-decoration: none; font-weight: 500; font-family: ${FONT_STACK};">${cleanWebsite}</a>
    </td>
  </tr>

</table>`.trim();
}
