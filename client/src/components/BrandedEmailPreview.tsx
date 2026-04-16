// Renders a preview of the branded OxyScale HTML email template
// This is what the recipient will see in their inbox

interface BrandedEmailPreviewProps {
  subject: string;
  body: string;
  recipientName: string;
  senderName?: string;
  ctaLabel?: string | null; // null = no CTA button shown
  ctaUrl?: string;
}

export default function BrandedEmailPreview({
  body,
  recipientName,
  senderName = 'Jordan',
  ctaLabel = null,
  ctaUrl = 'https://calendly.com/jordan-oxyscale/30min',
}: BrandedEmailPreviewProps) {
  // Convert newlines to <br> for HTML rendering
  const htmlBody = body.replace(/\n/g, '<br />');

  const ctaHtml = ctaLabel
    ? `
      <tr>
        <td style="background-color: #ffffff; padding: 4px 48px 40px 48px;">
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="background-color: #34d399; border-radius: 10px; padding: 16px 32px;">
                <a href="${ctaUrl}" style="color: #09090b; font-size: 14px; font-weight: 700; text-decoration: none; display: block; text-align: center; letter-spacing: 0.01em;">
                  ${ctaLabel}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin: 0; padding: 0; background-color: #f0f0f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f0f2; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

              <!-- Header -->
              <tr>
                <td style="background-color: #09090b; padding: 32px 48px; border-radius: 16px 16px 0 0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <a href="https://oxyscale.ai" style="text-decoration: none; font-family: 'Outfit', -apple-system, sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -0.03em;">
                          <span style="color: #fafafa;">Oxy</span><span style="color: #34d399;">Scale</span>
                        </a>
                      </td>
                      <td align="right" valign="middle">
                        <span style="color: #52525b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 500;">
                          AI &amp; Automation
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Accent bar -->
              <tr>
                <td style="height: 3px; font-size: 0; line-height: 0;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="width: 35%; background-color: #34d399; height: 3px;"></td>
                    <td style="width: 65%; background-color: #18181b; height: 3px;"></td>
                  </tr></table>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color: #ffffff; padding: 44px 48px 20px 48px;">
                  <p style="margin: 0 0 24px 0; color: #18181b; font-size: 15.5px; line-height: 1.75; font-weight: 400;">
                    Hi ${recipientName},
                  </p>
                  <div style="margin: 0 0 32px 0; color: #3f3f46; font-size: 15px; line-height: 1.8;">
                    ${htmlBody}
                  </div>
                </td>
              </tr>

              <!-- Sign off -->
              <tr>
                <td style="background-color: #ffffff; padding: 0 48px 36px 48px;">
                  <p style="margin: 0 0 4px 0; color: #3f3f46; font-size: 15px; line-height: 1.7;">
                    Kind regards,
                  </p>
                  <p style="margin: 0 0 2px 0; color: #18181b; font-size: 15px; font-weight: 600; line-height: 1.7;">
                    ${senderName}
                  </p>
                  <p style="margin: 0; color: #a1a1aa; font-size: 13px; line-height: 1.5;">
                    OxyScale<br />
                    0478 197 600
                  </p>
                </td>
              </tr>

              <!-- CTA Button (conditional) -->
              ${ctaHtml}

              <!-- Footer divider -->
              <tr>
                <td style="background-color: #ffffff; padding: 0 48px;">
                  <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 0;" />
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #ffffff; padding: 28px 48px 36px 48px; border-radius: 0 0 16px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td valign="top">
                        <span style="font-family: 'Outfit', -apple-system, sans-serif; font-weight: 800; font-size: 13px; letter-spacing: -0.03em;">
                          <span style="color: #a1a1aa;">Oxy</span><span style="color: #34d399;">Scale</span>
                        </span>
                        <p style="margin: 6px 0 0 0; color: #a1a1aa; font-size: 11.5px; line-height: 1.65;">
                          AI &amp; Automation Consultancy<br />
                          Melbourne, Australia
                        </p>
                      </td>
                      <td align="right" valign="top">
                        <a href="https://oxyscale.ai" style="color: #34d399; text-decoration: none; font-size: 12px; font-weight: 500;">oxyscale.ai</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Legal -->
              <tr>
                <td style="padding: 20px 48px 0 48px;">
                  <p style="margin: 0; color: #a1a1aa; font-size: 11px; text-align: center; line-height: 1.5;">
                    This email was sent by OxyScale. If you believe this was sent in error, please disregard.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return (
    <div className="bg-[#e8e8ea] rounded-xl overflow-hidden">
      <div
        className="w-full"
        dangerouslySetInnerHTML={{ __html: emailHtml }}
      />
    </div>
  );
}
