// ============================================================
// AI Summary Service — Claude API for call summaries & email drafts
// Handles transcript summarisation and follow-up email generation
// ============================================================

import pino from 'pino';
import { EMAIL_STYLE_GUIDE } from '../prompts/emailDraft.js';
import { getDb } from '../db/index.js';

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

// ── Playbook + Settings context helper ──────────────────────

function getCategoryPrompt(category: string | null): string {
  if (!category) return '';
  try {
    const db = getDb();
    const row = db.prepare('SELECT prompt FROM category_prompts WHERE category = ?').get(category) as {
      prompt: string;
    } | undefined;
    if (!row || !row.prompt?.trim()) return '';
    return `\n## Industry context for ${category}\n${row.prompt}\n\nUse the above context to make the email specific to their industry. Weave in the most relevant points naturally, don't list them all.\n`;
  } catch {
    return '';
  }
}

function getSettingsContext(): { calendlyLink: string; calendlyDuration: string; companyDescription: string; signOff: string } {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      calendlyLink: map.calendly_link || 'https://calendly.com/jordan-oxyscale/30min',
      calendlyDuration: map.calendly_duration || '20',
      companyDescription: map.company_description || 'AI and automation consultancy that helps businesses cut down on repetitive manual work.',
      signOff: map.email_sign_off || 'Cheers',
    };
  } catch {
    return {
      calendlyLink: 'https://calendly.com/jordan-oxyscale/30min',
      calendlyDuration: '30',
      companyDescription: 'AI and automation consultancy that helps businesses cut down on repetitive manual work.',
      signOff: 'Cheers',
    };
  }
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
  const hasPreviousNotes = !!(previousNotes && previousNotes.trim().length > 0);

  logger.info(
    { leadName, leadCompany, isCallback, hasPreviousNotes },
    'Starting call summarisation'
  );

  // Consolidation is driven by whether prior notes exist, NOT by the session's
  // leadType flag. A lead marked "new" in a dialler session can still have
  // prior call history — we must honour it.
  const previousNotesSection = hasPreviousNotes
    ? `
## Previous relationship history (consolidate this with the new call — DO NOT discard)
${previousNotes}
`
    : '';

  const consolidationInstruction = hasPreviousNotes
    ? `This lead has prior call history. Produce a CONSOLIDATED summary that weaves the new call together with everything above. Preserve every personable detail from prior calls (family, hobbies, personal milestones, inside jokes) even if not discussed in this specific call. The summary should read as the complete relationship story up to and including this call.`
    : `This is the first recorded call with this lead. Summarise only this call.`;

  const prompt = `You are a sales assistant for OxyScale, an AI and automation consultancy. Analyse this sales call transcript and produce a structured summary that keeps the relationship personal and compounding across every call.

## Lead info
- Name: ${leadName}
- Company: ${leadCompany || 'Unknown'}

${consolidationInstruction}

${previousNotesSection}

## Call transcript
${transcript}

## What to capture
A good summary mixes BUSINESS signal with PERSONABLE detail. Jordan should be able to open this lead's profile a month from now and instantly remember who they are as a person, not just as a prospect.

- **Business bullets**: what was discussed, pain points surfaced, current tools, decision makers, budget signals, timeline.
- **Personable bullets**: anything the lead mentioned about their life outside work — family ("son plays footy"), hobbies, travel ("just back from Bali"), health, personal milestones, off-hand remarks, inside jokes from the call. Tag these with a leading "(personal)" so they're easy to spot. These are gold for future rapport — never drop them.
- **Objections**: anything they pushed back on.

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "summary": "Bullet points as a single string, each bullet on a new line starting with '- '. Mix business and personable bullets. Keep the TOTAL length under ~400 words. If consolidating a long history, compress older business chatter but NEVER drop personable details — they stay verbatim.",
  "keyTopics": ["topic 1", "topic 2", "topic 3"],
  "actionItems": ["action 1", "action 2"],
  "sentiment": "one of: very_positive, positive, neutral, negative, very_negative"
}

Guidelines:
- Personable details are FIRST-CLASS — they carry across every consolidation.
- Bullet points should be concrete and specific. No corporate waffle.
- Key topics: main business subjects (e.g. "AI automation for recruitment", "current CRM setup").
- Action items: concrete next steps (e.g. "Ask about son's footy final", "Send case study", "Schedule demo next week").
- Sentiment reflects the prospect's overall interest and engagement.
- If the transcript is empty or only contains call status markers like "[Call connected]", return a minimal summary that only preserves prior personable details (if any) — do not invent content.`;

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
  previousEmails?: string,
  leadCategory?: string | null
): Promise<EmailDraftResult> {
  const startTime = Date.now();

  logger.info(
    { leadName, leadCompany, leadCategory, hasCallContext: !!callContext, hasPreviousEmails: !!previousEmails },
    'Starting email draft generation'
  );

  const previousEmailsSection = previousEmails
    ? `\n## Jordan's previously sent emails (match this style and tone closely)\n${previousEmails}\n`
    : '';

  const playbookSection = getCategoryPrompt(leadCategory || null);
  const ctx = getSettingsContext();

  const prompt = `You are writing a follow-up email for Jordan Bell from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

A sales call just happened. Write a personalised follow-up email based on what was discussed.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}
${playbookSection}

## Structure
1. One line referencing the call warmly
2. "As promised, here is..." transition into the value proposition
3. Brief OxyScale positioning (1-2 sentences, tailored to their context)
4. Acknowledge what they already have in place, frame OxyScale as additive
5. Pull in 2-3 specific things discussed on the call and weave them in naturally
6. Clear next step (demo, catch up, meet face to face). If appropriate, include the booking link: ${ctx.calendlyLink}
7. "Looking forward to hearing your thoughts."
8. Sign off with "${ctx.signOff},"

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

  const playbookSection = getCategoryPrompt(leadCategory);
  const ctx = getSettingsContext();

  const prompt = `You are writing a short follow-up email for Jordan Bell from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

Jordan just tried calling this person and left a voicemail. Now write a brief follow-up email to accompany the voicemail.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}
${playbookSection}

## Key points to cover
1. Mention you just tried calling and left a voicemail
2. Very briefly introduce OxyScale and what you do, tailored to their industry if playbook context is available above
3. If playbook context is available, mention 1-2 specific pain points that are relevant to their business. Frame it as "if any of these sound familiar" rather than assuming.
4. End with a soft invite to book a chat: "If you're keen for a quick ${ctx.calendlyDuration} minute chat to see where AI could help in your business, feel free to book a time here: ${ctx.calendlyLink}"
5. Keep it casual, short, and non-pushy

## Rules
- Keep it under 100 words. This is a voicemail follow-up, not a sales pitch.
- The Calendly link (${ctx.calendlyLink}) MUST appear in the email body. Never skip it.
- No greeting line (no "Hi [name]," as it is added automatically).
- No signature block.
- Sound human. One person reaching out to another.
- Sign off with "${ctx.signOff},"

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

  const playbookSection = getCategoryPrompt(leadCategory);
  const ctx = getSettingsContext();

  const prompt = `You are writing an email for Jordan Bell from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

Jordan has given you these instructions on what the email should say:
"${instructions}"

${EMAIL_STYLE_GUIDE}
${playbookSection}

${existingContext ? `## Context about this lead (previous interactions)\n${existingContext}\n` : ''}

## Important
- This is NOT a post-call follow-up. Jordan is composing a fresh email from their CRM.
- Follow the instructions closely. If Jordan says "tell them X", write about X.
- If the instructions are brief, keep the email brief. Match the energy.
- Don't assume a call just happened unless Jordan says so.
- If the instructions mention booking a call or meeting, include this Calendly link: ${ctx.calendlyLink}
- No greeting line (no "Hi ${firstName}," as it is added automatically).
- No signature block.
- Sign off with "${ctx.signOff},"

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

// ── Post-transcript summarisation + persistence ────────────────
//
// The source-of-truth summariser. Runs AFTER Whisper has deposited the real
// transcript on a call_log row. Reads the transcript + the lead's current
// consolidated_summary, calls Claude, then writes the result back to both:
//   - call_logs.{summary, key_topics, action_items, sentiment}  (per-call row)
//   - leads.consolidated_summary                                (rolling history)
//
// Fire-and-forget — never throws. Safe to call from webhook handlers where
// failure must not block the primary flow (e.g. Twilio recording webhook).
export async function summariseAndPersistCall(callLogId: number, leadId: number): Promise<void> {
  try {
    const db = getDb();

    const callLog = db
      .prepare('SELECT transcript FROM call_logs WHERE id = ?')
      .get(callLogId) as { transcript: string | null } | undefined;

    // Guard: if transcript is missing or too short to extract meaning, skip.
    // A 20-char threshold avoids wasting a Claude call on "[Call connected]\n[Call ended]".
    const transcript = callLog?.transcript?.trim() || '';
    if (transcript.length < 20) {
      logger.info(
        { callLogId, transcriptLength: transcript.length },
        'Skipping post-transcript summarisation — transcript too short to be meaningful',
      );
      return;
    }

    const lead = db
      .prepare('SELECT name, company, consolidated_summary FROM leads WHERE id = ?')
      .get(leadId) as { name: string; company: string | null; consolidated_summary: string | null } | undefined;

    if (!lead) {
      logger.warn({ callLogId, leadId }, 'Lead not found for post-transcript summarisation');
      return;
    }

    logger.info(
      { callLogId, leadId, hasPrior: !!lead.consolidated_summary },
      'Running post-Whisper summarisation',
    );

    // isCallback here is just for logging inside summariseCall; the real switch
    // is whether previousNotes is populated, which is what drives consolidation.
    const result = await summariseCall(
      transcript,
      lead.name,
      lead.company,
      !!lead.consolidated_summary,
      lead.consolidated_summary || undefined,
    );

    const now = new Date().toISOString();

    // Persist per-call fields on the call_log row
    db.prepare(
      `UPDATE call_logs
       SET summary = ?, key_topics = ?, action_items = ?, sentiment = ?
       WHERE id = ?`,
    ).run(
      result.summary,
      JSON.stringify(result.keyTopics),
      JSON.stringify(result.actionItems),
      result.sentiment,
      callLogId,
    );

    // Persist rolling relationship summary on the lead
    db.prepare('UPDATE leads SET consolidated_summary = ?, updated_at = ? WHERE id = ?').run(
      result.summary,
      now,
      leadId,
    );

    logger.info({ callLogId, leadId }, 'Post-Whisper summarisation persisted');
  } catch (error) {
    // Never throw — this runs off the main request path.
    logger.error(
      {
        callLogId,
        leadId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Post-Whisper summarisation failed (non-blocking)',
    );
  }
}
