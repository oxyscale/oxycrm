// ============================================================
// AI Summary Service — Claude API for call summaries & email drafts
// Handles transcript summarisation and follow-up email generation
// ============================================================

import pino from 'pino';
import { EMAIL_STYLE_GUIDE } from '../prompts/emailDraft.js';

const logger = pino({ name: 'ai-summary-service' });

// ── Types ────────────────────────────────────────────────────

export interface CallSummaryResult {
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  sentiment: string;
}

export interface EmailDraftResult {
  subject: string;
  body: string;
}

// ── Claude API helper ────────────────────────────────────────

async function callClaude(prompt: string, maxTokens: number = 2000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Claude API error');
    throw new Error(`Claude API request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
  };

  return data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/**
 * Extracts a JSON object from Claude's response text.
 * Handles responses that may include markdown code fences or extra text.
 */
function extractJson<T>(text: string): T {
  // Try to find JSON in code fence first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim()) as T;
  }

  // Fall back to finding a raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No valid JSON found in AI response');
  }

  return JSON.parse(jsonMatch[0]) as T;
}

// ── Call Summarisation ───────────────────────────────────────

/**
 * Summarises a call transcript using Claude.
 * For callback leads with previous notes, produces a consolidated summary
 * that weaves together the full relationship history.
 */
export async function summariseCall(
  transcript: string,
  leadName: string,
  leadCompany: string | null,
  isCallback: boolean,
  previousNotes?: string
): Promise<CallSummaryResult> {
  const startTime = Date.now();
  logger.info(
    { leadName, leadCompany, isCallback, hasPreviousNotes: !!previousNotes },
    'Starting call summarisation'
  );

  const previousNotesSection = isCallback && previousNotes
    ? `
## Previous call notes (DO NOT discard these — consolidate them with the new call)
${previousNotes}
`
    : '';

  const consolidationInstruction = isCallback && previousNotes
    ? `This is a CALLBACK lead with prior call history. You MUST produce a CONSOLIDATED summary that weaves together ALL previous notes with the new call. Do not just summarise the latest call. The summary should read as a complete relationship history.`
    : `This is a NEW lead with no prior call history. Summarise only this call.`;

  const prompt = `You are a sales assistant for OxyScale, an AI and automation consultancy. Analyse this sales call transcript and produce a structured summary.

## Lead info
- Name: ${leadName}
- Company: ${leadCompany || 'Unknown'}
- Lead type: ${isCallback ? 'Callback (has been called before)' : 'New lead (first contact)'}

${consolidationInstruction}

${previousNotesSection}

## Call transcript
${transcript}

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "summary": "3-5 bullet points as a single string, each bullet on a new line starting with '- '. Be specific about what was discussed, not generic.",
  "keyTopics": ["topic 1", "topic 2", "topic 3"],
  "actionItems": ["action 1", "action 2"],
  "sentiment": "one of: very_positive, positive, neutral, negative, very_negative"
}

Guidelines:
- Summary bullet points should be concise and specific to what was discussed
- Key topics are the main subjects covered (e.g. "AI automation for recruitment", "current CRM setup")
- Action items are concrete next steps (e.g. "Send case study", "Schedule demo for next week")
- Sentiment reflects the prospect's overall interest and engagement level
- Keep it direct and practical. No corporate waffle.`;

  try {
    const responseText = await callClaude(prompt);
    const result = extractJson<CallSummaryResult>(responseText);

    // Validate the result has all required fields
    if (!result.summary || !Array.isArray(result.keyTopics) || !Array.isArray(result.actionItems) || !result.sentiment) {
      throw new Error('AI response missing required fields');
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        leadName,
        durationMs,
        topicsCount: result.keyTopics.length,
        actionItemsCount: result.actionItems.length,
        sentiment: result.sentiment,
      },
      'Call summarisation completed'
    );

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        leadName,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
      'Call summarisation failed'
    );
    throw error;
  }
}

// ── Email Drafting ───────────────────────────────────────────

/**
 * Drafts a follow-up email using Claude, based on the call transcript and summary.
 * Uses the email style guide from prompts/emailDraft.ts.
 * Returns plain text (the frontend wraps it in the branded HTML template).
 */
export async function draftFollowUpEmail(
  transcript: string,
  summary: string,
  leadName: string,
  leadCompany: string | null,
  callContext?: string,
  previousEmails?: string
): Promise<EmailDraftResult> {
  const startTime = Date.now();

  logger.info(
    { leadName, leadCompany, hasCallContext: !!callContext, hasPreviousEmails: !!previousEmails },
    'Starting email draft generation'
  );

  const previousEmailsSection = previousEmails
    ? `\n## Jordan's previously sent emails (match this style and tone closely)\n${previousEmails}\n`
    : '';

  const prompt = `You are writing a follow-up email for Jordan Bell from OxyScale (AI & Automation consultancy) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}.

A sales call just happened. Write a personalised follow-up email based on what was discussed.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}

## Structure
1. One line referencing the call warmly
2. "As promised, here is..." transition into the value proposition
3. Brief OxyScale positioning (1-2 sentences, tailored to their context)
4. Acknowledge what they already have in place, frame OxyScale as additive
5. Pull in 2-3 specific things discussed on the call and weave them in naturally
6. Clear next step (demo, catch up, meet face to face)
7. "Looking forward to hearing your thoughts."

## Call transcript
${transcript}

## Call summary
${summary}

${callContext ? `## Additional context\n${callContext}` : ''}

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short, casual subject line under 8 words. No em dashes. No corporate jargon. Examples: 'Great speaking with you today', 'Quick follow up from our chat', 'As promised, the overview'",
  "body": "The email body. No greeting (no 'Hi [name],' as it is added automatically). No signature block. Keep it between 100-200 words. Be specific to what was discussed, not generic. Plain text only."
}`;

  try {
    const responseText = await callClaude(prompt, 1500);
    const result = extractJson<EmailDraftResult>(responseText);

    if (!result.subject || !result.body) {
      throw new Error('AI response missing subject or body');
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        leadName,
        durationMs,
        subjectLength: result.subject.length,
        bodyLength: result.body.length,
      },
      'Email draft generation completed'
    );

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        leadName,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
      'Email draft generation failed'
    );
    throw error;
  }
}

// ── Draft voicemail follow-up email ──────────────────────────

export async function draftVoicemailEmail(
  leadName: string,
  leadCompany: string | null,
  leadCategory: string | null,
  previousEmails?: string
): Promise<EmailDraftResult> {
  const startTime = Date.now();

  logger.info({ leadName, leadCompany, leadCategory }, 'Starting voicemail follow-up email draft');

  const previousEmailsSection = previousEmails
    ? `\n## Jordan's previously sent emails (match this style and tone closely)\n${previousEmails}\n`
    : '';

  const prompt = `You are writing a short follow-up email for Jordan Bell from OxyScale (AI & Automation consultancy) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

Jordan just tried calling this person and left a voicemail. Now write a brief follow-up email to accompany the voicemail.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}

## Key points to cover
1. Mention you just tried calling and left a voicemail
2. Very briefly introduce OxyScale and what you do (AI and automation for service-based businesses)
3. Mention you've been working specifically with businesses in their industry (${leadCategory || 'their space'})
4. Ask them to call back or reply when they get a chance
5. Keep it casual, short, and non-pushy

## Rules
- Keep it under 80 words. This is a voicemail follow-up, not a sales pitch.
- No greeting line (no "Hi [name]," as it is added automatically).
- No signature block.
- Sound human. One person reaching out to another.

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short casual subject line, 5-7 words. e.g. 'Just tried giving you a call', 'Quick voicemail follow up'",
  "body": "The email body. Plain text only."
}`;

  try {
    const responseText = await callClaude(prompt, 1000);
    const result = extractJson<EmailDraftResult>(responseText);

    if (!result.subject || !result.body) {
      throw new Error('AI response missing subject or body');
    }

    const durationMs = Date.now() - startTime;
    logger.info({ leadName, durationMs }, 'Voicemail email draft completed');
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      { leadName, durationMs, error: error instanceof Error ? error.message : String(error) },
      'Voicemail email draft failed'
    );
    throw error;
  }
}

// ── Draft email from voice/text instructions ─────────────────

export async function draftEmailFromInstructions(
  instructions: string,
  leadName: string,
  leadCompany: string | null,
  leadCategory: string | null,
  existingContext?: string
): Promise<EmailDraftResult> {
  const startTime = Date.now();
  const firstName = leadName.split(' ')[0];

  logger.info(
    { leadName, leadCompany, instructionLength: instructions.length },
    'Starting email draft from instructions'
  );

  const prompt = `You are writing an email for Jordan Bell from OxyScale (AI & Automation consultancy) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

Jordan has given you these instructions on what the email should say:
"${instructions}"

${EMAIL_STYLE_GUIDE}

${existingContext ? `## Context about this lead (previous interactions)\n${existingContext}\n` : ''}

## Important
- This is NOT a post-call follow-up. Jordan is composing a fresh email from their CRM.
- Follow the instructions closely. If Jordan says "tell them X", write about X.
- If the instructions are brief, keep the email brief. Match the energy.
- Don't assume a call just happened unless Jordan says so.
- No greeting line (no "Hi ${firstName}," as it is added automatically).
- No signature block.

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short, casual subject line under 8 words. No em dashes.",
  "body": "The email body. Plain text only. Keep it concise and natural."
}`;

  try {
    const responseText = await callClaude(prompt, 1500);
    const result = extractJson<EmailDraftResult>(responseText);

    if (!result.subject || !result.body) {
      throw new Error('AI response missing subject or body');
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { leadName, durationMs, subjectLength: result.subject.length, bodyLength: result.body.length },
      'Email draft from instructions completed'
    );

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      { leadName, durationMs, error: error instanceof Error ? error.message : String(error) },
      'Email draft from instructions failed'
    );
    throw error;
  }
}
