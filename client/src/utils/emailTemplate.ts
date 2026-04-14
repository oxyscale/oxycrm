/**
 * Builds a plain text email with greeting and sign-off.
 * Simple, human, lands in inbox not junk.
 */
export function buildEmailText(body: string, greetingName: string): string {
  return `Hi ${greetingName},

${body}

Kind regards,
Jordan
OxyScale
0478 197 600`;
}
