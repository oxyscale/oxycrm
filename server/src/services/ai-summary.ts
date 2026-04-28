// ============================================================
// AI Summary Service — Claude API for call summaries & email drafts
// Handles transcript summarisation and follow-up email generation.
//
// Email drafting is mode-aware. The renderer (emailTemplate.ts) appends
// optional blocks — editorial post-call header, capabilities button,
// book-a-call button — based on per-draft toggles. This file's job is
// to make Claude write a body that COMPOSES with whichever blocks are
// going to appear: e.g. when a "Book a call" button will be attached,
// the body must not paste the Calendly link inline.
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

/**
 * Draft mode tells the prompt what blocks the renderer will append
 * around the body so Claude composes with them in mind.
 */
export interface FollowUpDraftMode {
  includeAfterCallHeader: boolean;
  includeCapabilities: boolean;
  includeBookACall: boolean;
}

const POST_CALL_DEFAULT_MODE: FollowUpDraftMode = {
  includeAfterCallHeader: true,
  includeCapabilities: false,
  includeBookACall: true,
};

// ── Claude API helper ────────────────────────────────────────

async function callClaude(prompt: string, maxTokens: number = 2000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  // 60s timeout. Claude calls usually finish in ~5s; without a cap a
  // hung request would tie up a Node thread indefinitely.
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
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
    // Log only the status — error bodies can include rate-limit metadata
    // and tokens we don't want in centralised logs.
    logger.error({ status: response.status }, 'Claude API error');
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

// ── Playbook + Settings context helpers ──────────────────────

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

interface CategoryCta {
  url: string;
  label: string;
  intro: string;
}

/**
 * Returns CTA config for a category if cta_doc_url is populated, else null.
 * Used at draft creation to decide whether the capabilities toggle starts ON.
 */
export function getCategoryCta(category: string | null): CategoryCta | null {
  if (!category) return null;
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT cta_doc_url, cta_doc_label, cta_intro FROM category_prompts WHERE category = ?')
      .get(category) as { cta_doc_url: string | null; cta_doc_label: string | null; cta_intro: string | null } | undefined;
    if (!row?.cta_doc_url?.trim()) return null;
    return {
      url: row.cta_doc_url.trim(),
      label: (row.cta_doc_label?.trim() || 'View capabilities document'),
      intro: (row.cta_intro?.trim() || ''),
    };
  } catch (err) {
    // Treat as "no CTA configured" to keep the email flow working,
    // but log so a transient DB issue doesn't degrade silently.
    logger.warn({ err, category }, 'getCategoryCta lookup failed');
    return null;
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
 * Read the campaign-wide book-a-call URL from settings. Falls back to the
 * sender's per-user calendly_link if unset, then to a hardcoded default.
 */
export function getBookACallUrl(fallback?: string | null): string {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'book_a_call_url'")
      .get() as { value: string } | undefined;
    if (row?.value?.trim()) return row.value.trim();
  } catch {
    /* fall through */
  }
  if (fallback?.trim()) return fallback.trim();
  return 'https://calendly.com/jordan-oxyscale/discovery-call-30-minutes';
}

/**
 * Decide which toggles start ON for a freshly created Email Bank draft.
 * After-call header and book-a-call default ON for all post-call drafts.
 * Capabilities defaults ON only when the lead's category has a CTA URL
 * configured in category_prompts.
 */
export function computeInitialDraftMode(category: string | null): FollowUpDraftMode {
  return {
    includeAfterCallHeader: true,
    includeCapabilities: !!getCategoryCta(category),
    includeBookACall: true,
  };
}

/**
 * Build the per-prompt instructions explaining which blocks the renderer
 * will append, so Claude writes a body that composes with them.
 */
function buildRenderContextSection(mode: FollowUpDraftMode, calendlyLink: string): string {
  const appended: string[] = [];
  if (mode.includeAfterCallHeader) {
    appended.push(
      'an editorial header block ABOVE your body — a mono "TO {recipient}" label and an italic display headline reading "A note after our chat."',
    );
  }
  if (mode.includeCapabilities) {
    appended.push(
      'a "View capabilities document" button BELOW your body, linking to our manufacturing capabilities site',
    );
  }
  if (mode.includeBookACall) {
    appended.push(
      'a "Book a call" button BELOW your body, linking to our discovery-call Calendly',
    );
  }

  const constraints: string[] = [];
  constraints.push('No greeting line ("Hi name,") — the wrapper adds the recipient framing automatically.');
  constraints.push('No signature block — the wrapper adds it.');
  if (mode.includeBookACall) {
    constraints.push(
      'Do NOT paste the Calendly URL or any "book a time here" link in the body. The button handles the click. Close on a forward-looking line that makes the discovery call feel like the obvious next step (without typing the link).',
    );
  } else {
    constraints.push(`Close with a clear next step. Include this booking link inline: ${calendlyLink}`);
  }
  if (mode.includeCapabilities) {
    constraints.push(
      'Do NOT paste any document URL or "here is our capabilities doc at..." link in the body. The button handles it. You can refer to "the picture below" or similar.',
    );
  }

  if (appended.length === 0) {
    return `\n## Render context\nNo CTA buttons are being appended. Write a self-contained body.\n${constraints.map((c) => `- ${c}`).join('\n')}\n`;
  }

  return `\n## Render context (changes how you write the body)\nThe system will wrap your body in branded HTML. It will also append: ${appended.join('; ')}.\n\nConstraints:\n${constraints.map((c) => `- ${c}`).join('\n')}\n`;
}

/**
 * Universal italic accent instruction. Locked across all email drafts.
 * Wrap exactly one OUTCOME-focused phrase in single asterisks. The renderer
 * converts asterisks to Fraunces italic sky-ink. The italic represents
 * the change OxyScale brings — never the prospect's current pain.
 */
const ITALIC_ACCENT_INSTRUCTION = `\n## Italic accent (mandatory)
Wrap exactly ONE phrase or short sentence (5-15 words) in single asterisks, e.g. *like this*. The renderer turns it into a sky-blue italic that catches the eye.

The italic must highlight the OUTCOME OxyScale brings — the change, the future state, the new operating picture, the moment things click for them. Never italicise the prospect's current pain or problem; the blue represents what changes for them, not what's wrong now.

Choose a phrase that is concrete, specific to what was discussed, and reads naturally inside the surrounding sentence. Examples of good outcome italics:
- "*surface what each department needs to handle today*"
- "*one live picture of every corner of the business*"
- "*caught the day it happens, not at month-end*"
- "*the numbers your Monday meeting goes hunting for arrive on their own*"

If the body genuinely has no clear outcome phrase to italicise, omit the asterisks. But on a real follow-up after a working call there should almost always be one.
`;

/**
 * Extracts a JSON object from Claude's response text.
 * Handles responses that may include markdown code fences or extra text.
 */
function extractJson<T>(text: string): T {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim()) as T;
  }
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
 * Drafts a follow-up email after a real call.
 * Mode-aware: the prompt adapts to which renderer blocks (editorial header,
 * capabilities button, book-a-call button) will be appended.
 */
export async function draftFollowUpEmail(
  transcript: string,
  summary: string,
  leadName: string,
  leadCompany: string | null,
  callContext?: string,
  previousEmails?: string,
  leadCategory?: string | null,
  senderName: string = 'Jordan Bell',
  mode: FollowUpDraftMode = POST_CALL_DEFAULT_MODE,
): Promise<EmailDraftResult> {
  const startTime = Date.now();

  logger.info(
    { leadName, leadCompany, leadCategory, senderName, hasCallContext: !!callContext, hasPreviousEmails: !!previousEmails, mode },
    'Starting email draft generation',
  );

  const previousEmailsSection = previousEmails
    ? `\n## ${senderName.split(' ')[0]}'s previously sent emails (match this style and tone closely)\n${previousEmails}\n`
    : '';

  const playbookSection = getCategoryPrompt(leadCategory || null);
  const ctx = getSettingsContext();
  const renderContext = buildRenderContextSection(mode, ctx.calendlyLink);

  const prompt = `You are writing a follow-up email for ${senderName} from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

A real sales call just happened. Write a personalised follow-up email based on what was discussed.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}
${playbookSection}
${renderContext}
${ITALIC_ACCENT_INSTRUCTION}

## Structure
1. Open with a one-line warm reference to the call. Pick up something specific they said, not generic ("Great chat just then..." style).
2. Tie what they raised on the call directly to what OxyScale would deliver. This is the heart of the email — weave 2-3 specific things they discussed into how OxyScale would handle them. Frame OxyScale as additive to what they already have, not a replacement.
3. Forward-looking close that sets up the next step (see the render-context constraints above for whether to paste the Calendly link).
4. Sign off with "${ctx.signOff},"

Total length 110-180 words. Concrete and specific to the call, not generic.

## Call transcript
${transcript}

## Call summary
${summary}

${callContext ? `## Additional context\n${callContext}` : ''}

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short, casual subject line under 8 words. Never include 'OxyScale' (it's already in the from-address). No em dashes. Examples: 'Quick follow up from our chat', 'After our chat — the picture below', 'On the margin question you raised'",
  "body": "The email body, plain text. No greeting line, no signature block. One italic-accented phrase wrapped in single asterisks per the rule above. Match the EMAIL_STYLE_GUIDE precisely: never use em dashes."
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
      'Email draft generation completed',
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
      'Email draft generation failed',
    );
    throw error;
  }
}

// ── Draft voicemail follow-up email ──────────────────────────

export async function draftVoicemailEmail(
  leadName: string,
  leadCompany: string | null,
  leadCategory: string | null,
  previousEmails?: string,
  senderName: string = 'Jordan Bell',
  mode: FollowUpDraftMode = POST_CALL_DEFAULT_MODE,
): Promise<EmailDraftResult> {
  const startTime = Date.now();

  logger.info({ leadName, leadCompany, leadCategory, senderName, mode }, 'Starting voicemail follow-up email draft');

  const senderFirstName = senderName.split(' ')[0];
  const previousEmailsSection = previousEmails
    ? `\n## ${senderFirstName}'s previously sent emails (match this style and tone closely)\n${previousEmails}\n`
    : '';

  const playbookSection = getCategoryPrompt(leadCategory);
  const ctx = getSettingsContext();
  const renderContext = buildRenderContextSection(mode, ctx.calendlyLink);

  const prompt = `You are writing a short follow-up email for ${senderName} from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

${senderFirstName} just tried calling this person and left a voicemail. Now write a brief follow-up email to accompany the voicemail.

${EMAIL_STYLE_GUIDE}
${previousEmailsSection}
${playbookSection}
${renderContext}
${ITALIC_ACCENT_INSTRUCTION}

## Structure
1. Mention you just tried calling and left a voicemail.
2. Very briefly introduce OxyScale, tailored to their industry if playbook context is available above.
3. If playbook context is available, mention 1-2 specific outcomes that would matter for their business. Frame as "if any of this sounds useful" rather than assuming pain.
4. Forward-looking close per the render-context constraints above.
5. Sign off with "${ctx.signOff},"

Total length under 110 words.

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short casual subject line, 5-7 words. e.g. 'Just tried giving you a call', 'Quick voicemail follow up'. Never include 'OxyScale'.",
  "body": "The email body, plain text. No greeting, no signature. One italic-accented outcome phrase in single asterisks per the rule. Never use em dashes."
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
      'Voicemail email draft failed',
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
  existingContext?: string,
): Promise<EmailDraftResult> {
  const startTime = Date.now();
  const firstName = leadName.split(' ')[0];

  logger.info(
    { leadName, leadCompany, instructionLength: instructions.length },
    'Starting email draft from instructions',
  );

  const playbookSection = getCategoryPrompt(leadCategory);
  const ctx = getSettingsContext();

  const prompt = `You are writing an email for Jordan Bell from OxyScale (${ctx.companyDescription}) to ${leadName}${leadCompany ? ` at ${leadCompany}` : ''}${leadCategory ? ` (industry: ${leadCategory})` : ''}.

Jordan has given you these instructions on what the email should say:
"${instructions}"

${EMAIL_STYLE_GUIDE}
${playbookSection}
${ITALIC_ACCENT_INSTRUCTION}

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
- Never use em dashes. Comma, full stop, or semicolon instead.

## Output format
Return ONLY valid JSON in this exact format, no other text:
{
  "subject": "Short, casual subject line under 8 words. Never include 'OxyScale'. No em dashes.",
  "body": "The email body, plain text only. Concise and natural. One italic-accented outcome phrase in single asterisks per the rule above (skip if the email genuinely has no outcome moment, e.g. a quick logistics note)."
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
      'Email draft from instructions completed',
    );

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      { leadName, durationMs, error: error instanceof Error ? error.message : String(error) },
      'Email draft from instructions failed',
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

    const SUMMARY_CAP = 16_000;
    let summary = result.summary;
    if (summary.length > SUMMARY_CAP) {
      summary = summary.slice(0, SUMMARY_CAP) + '\n\n[older entries trimmed]';
      logger.info({ leadId, originalLen: result.summary.length, cappedLen: summary.length }, 'Consolidated summary truncated');
    }
    db.prepare('UPDATE leads SET consolidated_summary = ?, updated_at = ? WHERE id = ?').run(
      summary,
      now,
      leadId,
    );

    logger.info({ callLogId, leadId }, 'Post-Whisper summarisation persisted');
  } catch (error) {
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

// ── Email Bank: draft + store a follow-up email ────────────────
//
// Runs after summariseAndPersistCall once the real transcript is on the
// call_log row. Looks up the pending email_drafts row for this call,
// generates the appropriate email (follow-up or voicemail) based on the
// row's disposition, and flips status to 'ready' so the draft appears
// in Jordan's Email Bank.
//
// Idempotent — if the draft already reached 'ready' or 'sent', skip.
// Never throws; all errors are captured to error_message on the draft.
export async function draftAndStoreEmailForCall(callLogId: number, leadId: number): Promise<void> {
  const db = getDb();

  const draft = db
    .prepare('SELECT id, disposition, status FROM email_drafts WHERE call_log_id = ?')
    .get(callLogId) as { id: number; disposition: string; status: string } | undefined;

  if (!draft) {
    logger.info({ callLogId }, 'No email_draft row for this call — skipping email bank draft');
    return;
  }

  if (draft.status !== 'pending' && draft.status !== 'failed') {
    logger.info({ callLogId, draftId: draft.id, status: draft.status }, 'Email draft already resolved — skipping');
    return;
  }

  try {
    const lead = db
      .prepare('SELECT name, company, email, category FROM leads WHERE id = ?')
      .get(leadId) as { name: string; company: string | null; email: string | null; category: string | null } | undefined;

    if (!lead) {
      throw new Error('Lead not found');
    }

    const callLog = db
      .prepare('SELECT transcript, summary, user_id FROM call_logs WHERE id = ?')
      .get(callLogId) as { transcript: string | null; summary: string | null; user_id: number | null } | undefined;

    const sender = callLog?.user_id
      ? (db
          .prepare('SELECT name FROM users WHERE id = ?')
          .get(callLog.user_id) as { name: string } | undefined)
      : undefined;
    const senderName = sender?.name || 'Jordan Bell';

    const transcript = callLog?.transcript?.trim() || '';
    const summary = callLog?.summary || '';

    if (transcript.length < 20 && draft.disposition === 'interested') {
      throw new Error('Transcript unavailable — cannot draft from empty call audio');
    }

    const recentEmailsRows = db
      .prepare(
        `SELECT subject, body_snippet FROM emails_sent
         WHERE direction = 'sent' AND body_snippet IS NOT NULL
         ORDER BY created_at DESC LIMIT 5`,
      )
      .all() as Array<{ subject: string; body_snippet: string }>;

    const previousEmails = recentEmailsRows.length > 0
      ? recentEmailsRows.map((e) => `Subject: ${e.subject}\n${e.body_snippet}`).join('\n---\n')
      : undefined;

    // Compute the toggle defaults for this draft based on the lead's
    // category. Header + book-a-call default ON; capabilities default ON
    // only when the category has a configured CTA URL.
    const mode = computeInitialDraftMode(lead.category);

    let result: EmailDraftResult;
    if (draft.disposition === 'voicemail') {
      result = await draftVoicemailEmail(lead.name, lead.company, lead.category, previousEmails, senderName, mode);
    } else {
      result = await draftFollowUpEmail(
        transcript,
        summary,
        lead.name,
        lead.company,
        undefined,
        previousEmails,
        lead.category,
        senderName,
        mode,
      );
    }

    db.prepare(
      `UPDATE email_drafts
       SET subject = ?, body = ?, to_email = COALESCE(to_email, ?),
           include_after_call_header = ?, include_capabilities = ?, include_book_a_call = ?,
           status = 'ready', generated_at = ?, error_message = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      result.subject,
      result.body,
      lead.email,
      mode.includeAfterCallHeader ? 1 : 0,
      mode.includeCapabilities ? 1 : 0,
      mode.includeBookACall ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString(),
      draft.id,
    );

    logger.info(
      { callLogId, leadId, draftId: draft.id, mode },
      'Email draft generated and stored in Email Bank',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ callLogId, leadId, draftId: draft.id, error: message }, 'Email draft generation failed');
    db.prepare(
      `UPDATE email_drafts SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
    ).run(message, new Date().toISOString(), draft.id);
  }
}
