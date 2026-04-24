// Renders a preview of the branded OxyScale HTML email template
// This is what the recipient will see in their inbox

interface BrandedEmailPreviewProps {
  subject: string;
  body: string;
  recipientName: string;
  senderName?: string;
  senderTitle?: string;
  senderPhone?: string;
  websiteUrl?: string;
  calendlyLink?: string;
  signOff?: string;
  ctaLabel?: string | null; // null = no CTA button shown
  ctaUrl?: string;
}

export default function BrandedEmailPreview({
  body,
  recipientName,
  senderName = 'Jordan Bell',
  senderTitle = 'Co-Founder',
  senderPhone = '0478 197 600',
  websiteUrl = 'https://oxyscale.ai',
  calendlyLink = 'https://calendly.com/jordan-oxyscale/30min',
  signOff = 'Cheers',
  ctaLabel = null,
  ctaUrl = 'https://calendly.com/jordan-oxyscale/30min',
}: BrandedEmailPreviewProps) {
  const htmlBody = body.replace(/\n/g, '<br />');
  const cleanWebsiteUrl = websiteUrl.replace(/^https?:\/\//, '');

  const fontStack =
    "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

  const ctaHtml = ctaLabel
    ? `
      <tr>
        <td style="background-color: #ffffff; padding: 4px 48px 40px 48px;">
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="background-color: #0b0d0e; border-radius: 999px; padding: 16px 32px;">
                <a href="${ctaUrl}" style="color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; display: block; text-align: center; letter-spacing: 0.01em; font-family: ${fontStack};">
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
    <body style="margin: 0; padding: 0; background-color: #faf9f5; font-family: ${fontStack};">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf9f5; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; border: 1px solid rgba(11,13,14,0.05); box-shadow: 0 30px 80px -40px rgba(11,13,14,0.2);">

              <!-- Header -->
              <tr>
                <td style="background-color: #ffffff; padding: 32px 48px 20px 48px; border-radius: 16px 16px 0 0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <a href="https://oxyscale.ai" style="text-decoration: none; font-family: ${fontStack}; font-weight: 600; font-size: 22px; letter-spacing: -0.035em;">
                          <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                        </a>
                      </td>
                      <td align="right" valign="middle">
                        <span style="color: #8a95a0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2em; font-weight: 600; font-family: ${fontStack};">
                          AI &amp; Automation
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Accent bar -->
              <tr>
                <td style="height: 2px; font-size: 0; line-height: 0;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="width: 35%; background-color: #0a9cd4; height: 2px;"></td>
                    <td style="width: 65%; background-color: rgba(11,13,14,0.08); height: 2px;"></td>
                  </tr></table>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color: #ffffff; padding: 40px 48px 20px 48px;">
                  <p style="margin: 0 0 24px 0; color: #0b0d0e; font-size: 15.5px; line-height: 1.75; font-weight: 500; font-family: ${fontStack};">
                    Hi ${recipientName},
                  </p>
                  <div style="margin: 0 0 32px 0; color: #55606a; font-size: 15px; line-height: 1.8; font-family: ${fontStack};">
                    ${htmlBody}
                  </div>
                </td>
              </tr>

              <!-- Sign off + Signature -->
              <tr>
                <td style="background-color: #ffffff; padding: 0 48px 36px 48px;">
                  <p style="margin: 0 0 4px 0; color: #55606a; font-size: 15px; line-height: 1.7; font-family: ${fontStack};">
                    ${signOff},
                  </p>
                  <!-- Signature block -->
                  <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-top: 24px; width: 100%;">
                    <tr>
                      <td style="padding: 0 0 16px 0;">
                        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%;">
                          <tr>
                            <td style="width: 60px; height: 2px; background-color: #0a9cd4; font-size: 0; line-height: 0;"></td>
                            <td style="height: 2px; font-size: 0; line-height: 0;"></td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 0 2px 0;">
                        <span style="color: #0b0d0e; font-size: 14px; font-weight: 600; font-family: ${fontStack};">${senderName}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 0 10px 0;">
                        <span style="color: #8a95a0; font-size: 12px; font-family: ${fontStack};">${senderTitle}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 0 8px 0;">
                        <span style="font-family: ${fontStack}; font-weight: 600; font-size: 15px; letter-spacing: -0.035em;">
                          <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 0 4px 0;">
                        <span style="color: #8a95a0; font-size: 12px; font-family: ${fontStack};">${senderPhone}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 0 12px 0;">
                        <a href="${websiteUrl}" style="color: #0a9cd4; font-size: 12px; text-decoration: none; font-weight: 500; font-family: ${fontStack};">${cleanWebsiteUrl}</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0;">
                        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                          <tr>
                            <td style="background-color: #0b0d0e; border-radius: 999px; padding: 8px 18px;">
                              <a href="${calendlyLink}" style="color: #ffffff; font-size: 12px; font-weight: 600; text-decoration: none; display: block; font-family: ${fontStack};">Book a call</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- CTA Button (conditional) -->
              ${ctaHtml}

              <!-- Footer divider -->
              <tr>
                <td style="background-color: #ffffff; padding: 0 48px;">
                  <hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 0;" />
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #faf9f5; padding: 28px 48px 36px 48px; border-radius: 0 0 16px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td valign="top">
                        <span style="font-family: ${fontStack}; font-weight: 600; font-size: 13px; letter-spacing: -0.035em;">
                          <span style="color: #55606a;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
                        </span>
                        <p style="margin: 6px 0 0 0; color: #8a95a0; font-size: 11.5px; line-height: 1.65; font-family: ${fontStack};">
                          AI &amp; Automation Consultancy<br />
                          Melbourne, Australia
                        </p>
                      </td>
                      <td align="right" valign="top">
                        <a href="https://oxyscale.ai" style="color: #0a9cd4; text-decoration: none; font-size: 12px; font-weight: 500; font-family: ${fontStack};">oxyscale.ai</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Legal -->
              <tr>
                <td style="padding: 20px 48px 0 48px;">
                  <p style="margin: 0; color: #8a95a0; font-size: 11px; text-align: center; line-height: 1.5; font-family: ${fontStack};">
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
    <div className="bg-tray rounded-xl overflow-hidden">
      <div
        className="w-full"
        dangerouslySetInnerHTML={{ __html: emailHtml }}
      />
    </div>
  );
}
