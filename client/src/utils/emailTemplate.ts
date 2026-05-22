/**
 * Builds a plain text email with sign-off.
 * The greeting (e.g. "Hi James,") is already included in the body
 * by the AI or typed manually by the user.
 */
export function buildEmailText(body: string): string {
  return `${body}

Kind regards,
Jordan
OxyScale
0478 197 600`;
}
