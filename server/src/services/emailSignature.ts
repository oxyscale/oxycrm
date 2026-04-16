// ============================================================
// Email Signature — Builds a branded HTML signature block
// Uses table-based layout with inline CSS for email client compatibility
// ============================================================

interface SignatureSettings {
  sender_name: string;
  sender_title: string;
  sender_phone: string;
  company_name: string;
  website_url: string;
  calendly_link: string;
}

/**
 * Builds a branded OxyScale HTML email signature.
 * Uses table layout and inline styles for maximum email client compatibility.
 */
export function buildEmailSignature(settings: SignatureSettings): string {
  const {
    sender_name,
    sender_title,
    sender_phone,
    website_url,
    calendly_link,
  } = settings;

  return `
<table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-top: 24px; width: 100%;">
  <!-- Divider -->
  <tr>
    <td style="padding: 0 0 16px 0;">
      <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="width: 60px; height: 2px; background-color: #34d399; font-size: 0; line-height: 0;"></td>
          <td style="height: 2px; font-size: 0; line-height: 0;"></td>
        </tr>
      </table>
    </td>
  </tr>
  <!-- Name and title -->
  <tr>
    <td style="padding: 0 0 2px 0;">
      <span style="color: #18181b; font-size: 14px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${sender_name}</span>
    </td>
  </tr>
  <tr>
    <td style="padding: 0 0 10px 0;">
      <span style="color: #71717a; font-size: 12px; font-weight: 400; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${sender_title}</span>
    </td>
  </tr>
  <!-- Logo -->
  <tr>
    <td style="padding: 0 0 8px 0;">
      <a href="${website_url}" style="text-decoration: none; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 800; font-size: 15px; letter-spacing: -0.03em;"><!--
        --><span style="color: #18181b;">Oxy</span><!--
        --><span style="color: #34d399;">Scale</span><!--
      --></a>
    </td>
  </tr>
  <!-- Phone -->
  <tr>
    <td style="padding: 0 0 4px 0;">
      <a href="tel:${sender_phone.replace(/\s/g, '')}" style="color: #71717a; font-size: 12px; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${sender_phone}</a>
    </td>
  </tr>
  <!-- Website -->
  <tr>
    <td style="padding: 0 0 12px 0;">
      <a href="${website_url}" style="color: #34d399; font-size: 12px; text-decoration: none; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${website_url.replace(/^https?:\/\//, '')}</a>
    </td>
  </tr>
  <!-- Calendly CTA -->
  <tr>
    <td style="padding: 0;">
      <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="background-color: #34d399; border-radius: 6px; padding: 8px 16px;">
            <a href="${calendly_link}" style="color: #09090b; font-size: 12px; font-weight: 700; text-decoration: none; display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">Book a call</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}
