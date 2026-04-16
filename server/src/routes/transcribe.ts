// ============================================================
// Transcription & AI Routes — /api/transcribe, /api/ai
// Handles audio transcription, call summarisation, and email drafting
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import pino from 'pino';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler.js';
import { transcribeAudio } from '../services/transcription.js';
import { summariseCall, draftFollowUpEmail, draftEmailFromInstructions, draftVoicemailEmail } from '../services/ai-summary.js';
import { getDb } from '../db/index.js';

const logger = pino({ name: 'transcribe-routes' });
const router = Router();

// ── Multer config for audio uploads ──────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max (Whisper API limit)
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg',
      'audio/mp4',
      'audio/m4a',
      'audio/wav',
      'audio/webm',
      'audio/ogg',
      'audio/x-wav',
      'audio/mp3',
      'video/webm', // Some browsers report webm audio as video/webm
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, `Unsupported audio format: ${file.mimetype}. Accepted formats: mp3, mp4, m4a, wav, webm, ogg`));
    }
  },
});

// ── Validation schemas ───────────────────────────────────────

const summariseSchema = z.object({
  transcript: z.string().min(1, 'Transcript is required'),
  leadName: z.string().min(1, 'Lead name is required'),
  leadCompany: z.string().nullable().optional(),
  isCallback: z.boolean(),
  previousNotes: z.string().optional(),
});

const draftEmailSchema = z.object({
  transcript: z.string().min(1, 'Transcript is required'),
  summary: z.string().min(1, 'Summary is required'),
  leadName: z.string().min(1, 'Lead name is required'),
  leadCompany: z.string().nullable().optional(),
  leadCategory: z.string().nullable().optional(),
  callContext: z.string().optional(),
});

// ── Routes ───────────────────────────────────────────────────

/**
 * POST /api/transcribe
 * Accepts a multipart audio file and returns the transcript text.
 */
router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, 'No audio file provided. Send a file in the "audio" field.');
    }

    logger.info(
      {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        sizeBytes: req.file.size,
      },
      'Received audio file for transcription'
    );

    const transcript = await transcribeAudio(
      req.file.buffer,
      req.file.originalname
    );

    res.json({ transcript });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/summarise
 * Accepts call transcript and lead context, returns structured summary.
 */
router.post('/ai/summarise', async (req, res, next) => {
  try {
    const data = summariseSchema.parse(req.body);

    logger.info(
      { leadName: data.leadName, isCallback: data.isCallback },
      'Summarise request received'
    );

    const result = await summariseCall(
      data.transcript,
      data.leadName,
      data.leadCompany ?? null,
      data.isCallback,
      data.previousNotes
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/draft-email
 * Accepts transcript, summary, and lead context, returns email subject + body.
 */
router.post('/ai/draft-email', async (req, res, next) => {
  try {
    const data = draftEmailSchema.parse(req.body);

    logger.info(
      { leadName: data.leadName },
      'Email draft request received'
    );

    // Fetch recent sent emails for style learning
    let previousEmails: string | undefined;
    try {
      const db = getDb();
      const recentEmails = db.prepare(`
        SELECT subject, body_snippet FROM emails_sent
        WHERE direction = 'sent' AND body_snippet IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5
      `).all() as Array<{ subject: string; body_snippet: string }>;

      if (recentEmails.length > 0) {
        previousEmails = recentEmails
          .map((e) => `Subject: ${e.subject}\n${e.body_snippet}`)
          .join('\n---\n');
      }
    } catch {
      // Non-critical
    }

    const result = await draftFollowUpEmail(
      data.transcript,
      data.summary,
      data.leadName,
      data.leadCompany ?? null,
      data.callContext,
      previousEmails,
      data.leadCategory ?? null
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/compose — Draft email from voice/text instructions
// ============================================================

const composeEmailSchema = z.object({
  instructions: z.string().min(1, 'Instructions are required'),
  leadId: z.number().int().positive(),
  leadName: z.string().min(1),
  leadCompany: z.string().nullable().optional(),
  leadCategory: z.string().nullable().optional(),
  existingContext: z.string().optional(),
});

router.post('/ai/compose', async (req, res, next) => {
  try {
    const data = composeEmailSchema.parse(req.body);

    logger.info(
      { leadName: data.leadName, instructionLength: data.instructions.length },
      'Email compose request from instructions'
    );

    const result = await draftEmailFromInstructions(
      data.instructions,
      data.leadName,
      data.leadCompany ?? null,
      data.leadCategory ?? null,
      data.existingContext
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/voicemail-email — Draft voicemail follow-up email
// ============================================================

const voicemailEmailSchema = z.object({
  leadName: z.string().min(1),
  leadCompany: z.string().nullable().optional(),
  leadCategory: z.string().nullable().optional(),
});

router.post('/ai/voicemail-email', async (req, res, next) => {
  try {
    const data = voicemailEmailSchema.parse(req.body);

    logger.info({ leadName: data.leadName }, 'Voicemail email draft request');

    // Fetch recent sent emails for style learning
    let previousEmails: string | undefined;
    try {
      const db = getDb();
      const recentEmails = db.prepare(`
        SELECT subject, body_snippet FROM emails_sent
        WHERE direction = 'sent' AND body_snippet IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5
      `).all() as Array<{ subject: string; body_snippet: string }>;

      if (recentEmails.length > 0) {
        previousEmails = recentEmails
          .map((e) => `Subject: ${e.subject}\n${e.body_snippet}`)
          .join('\n---\n');
      }
    } catch {
      // Non-critical
    }

    const result = await draftVoicemailEmail(
      data.leadName,
      data.leadCompany ?? null,
      data.leadCategory ?? null,
      previousEmails
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
