// ============================================================
// Email Draft Prompt — generates follow-up emails in Jordan's voice
// Fed the call transcript + lead context, returns a ready-to-send email
// ============================================================

export const EMAIL_STYLE_GUIDE = `
## Writing style rules (mandatory)
- Write like a real person, not a language model. Short sentences. Get to the point.
- Australian casual but professional. "Mate" is acceptable. "Cheers" or "Kind regards" to close.
- NEVER use em dashes. Use commas, full stops, or semicolons instead.
- NEVER use: "leverage", "synergy", "streamline", "optimize", "delighted", "thrilled", "excited to share", "I hope this finds you well", "circle back", "touch base", "at your earliest convenience", "please don't hesitate to reach out".
- Short paragraphs, 1-3 sentences max each.
- Use "we" for the company, "I" for personal connection. Switch naturally.
- Be concrete and specific. No vague benefit statements.
- When referencing what was discussed on the call, weave it in naturally, not as a bullet list of "key takeaways."
- Sign off: Kind regards, Jordan
`;

export function buildEmailDraftPrompt(params: {
  leadName: string;
  company: string | null;
  category: string | null;
  transcript: string;
  callSummary: string | null;
  emailType: 'follow_up' | 'call_booked';
}): string {
  const { leadName, company, category, transcript, callSummary, emailType } = params;
  const firstName = leadName.split(' ')[0];

  if (emailType === 'call_booked') {
    return `You are writing a follow-up email for Jordan Bell from OxyScale (AI & Automation consultancy) to ${leadName}${company ? ` at ${company}` : ''}.

A call just happened and a meeting has been booked. Write a short confirmation email.

${EMAIL_STYLE_GUIDE}

## Structure
1. "Great speaking with you today" or similar one-liner
2. Confirm the meeting (leave [date/time] as a placeholder)
3. One line about sending a calendar invite
4. One line inviting them to reply with questions
5. "Looking forward to it."

## Call transcript for context
${transcript}

${callSummary ? `## Call summary\n${callSummary}` : ''}

Write the email body only (no subject line, no "Hi ${firstName}," greeting as that is added automatically, no signature block). Keep it under 80 words.`;
  }

  return `You are writing a follow-up email for Jordan Bell from OxyScale (AI & Automation consultancy) to ${leadName}${company ? ` at ${company}` : ''}${category ? ` (industry: ${category})` : ''}.

A sales call just happened. Write a follow-up email based on what was discussed.

${EMAIL_STYLE_GUIDE}

## Structure
1. One line referencing the call warmly
2. "As promised, here is..." transition into the value proposition
3. Brief OxyScale positioning (1-2 sentences, tailored to their industry)
4. Acknowledge what they already have in place, frame OxyScale as additive
5. Pull in 2-3 specific things discussed on the call and weave them in naturally
6. Clear next step (demo, catch up, meet face to face)
7. "Looking forward to hearing your thoughts."

## Call transcript
${transcript}

${callSummary ? `## Call summary\n${callSummary}` : ''}

Write the email body only (no subject line, no "Hi ${firstName}," greeting as that is added automatically, no signature block). Keep it between 100-200 words. Be specific to what was discussed, not generic.`;
}

export function buildEmailSubjectPrompt(params: {
  leadName: string;
  company: string | null;
  transcript: string;
}): string {
  return `Based on this sales call transcript, write a short, casual email subject line (under 8 words). No em dashes. No corporate jargon. Examples of good subject lines: "Great speaking with you today", "Quick follow up from our chat", "As promised, the overview".

Transcript excerpt: ${params.transcript.substring(0, 500)}

Return ONLY the subject line, nothing else.`;
}
