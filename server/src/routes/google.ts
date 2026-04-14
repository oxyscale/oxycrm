// ============================================================
// Google Routes — /api/google
// Handles OAuth2 flow and calendar event creation.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import pino from 'pino';
import * as googleCalendar from '../services/google-calendar.js';
import { startGmailSync, isGmailSyncRunning } from '../services/gmail-sync.js';
import { ApiError } from '../middleware/errorHandler.js';

const logger = pino({ name: 'google-routes' });
const router = Router();

// ── GET /auth — Returns the OAuth authorization URL ─────────

router.get('/auth', (_req, res, next) => {
  try {
    const url = googleCalendar.getAuthUrl();
    logger.info('Redirecting to Google OAuth authorization URL');
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

// ── GET /callback — Handles the OAuth redirect from Google ──

router.get('/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;

    if (!code) {
      throw new ApiError(400, 'Missing authorization code in callback');
    }

    logger.info('Handling Google OAuth callback');
    await googleCalendar.handleCallback(code);

    // Start Gmail sync if it's not already running (now that we have tokens)
    try {
      if (!isGmailSyncRunning()) {
        startGmailSync();
        logger.info('Gmail sync started after OAuth callback');
      }
    } catch (syncErr) {
      logger.warn({ err: syncErr }, 'Failed to start Gmail sync after OAuth callback');
    }

    // Redirect back to the app after successful auth
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}?googleAuth=success`);
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    next(err);
  }
});

// ── GET /status — Check if we're authenticated with Google ──

router.get('/status', (_req, res) => {
  const authenticated = googleCalendar.isAuthenticated();
  logger.info({ authenticated }, 'Google auth status check');
  res.json({ authenticated });
});

// ── GET /calendar/events — List events for a day ────────────

router.get('/calendar/events', async (req, res, next) => {
  try {
    const date = req.query.date as string | undefined;
    const timezone = req.query.timezone as string | undefined;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, 'date query parameter is required in YYYY-MM-DD format');
    }

    const events = await googleCalendar.listEventsForDay(date, timezone);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// ── POST /calendar/event — Create a calendar event ──────────

const createEventSchema = z.object({
  summary: z.string().min(1, 'Summary is required'),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),         // YYYY-MM-DD
  time: z.string().min(1, 'Time is required'),         // HH:mm
  duration: z.number().min(1).max(480).default(30),    // Minutes
  location: z.string().optional(),
  guests: z.array(z.string().email()).optional(),
  meetLink: z.boolean().optional().default(false),
  timezone: z.string().optional(),                      // IANA timezone (e.g. 'Australia/Sydney')
});

router.post('/calendar/event', async (req, res, next) => {
  try {
    const parsed = createEventSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message).join(', ');
      throw new ApiError(400, `Validation failed: ${errors}`);
    }

    const { summary, description, date, time, duration, location, guests, meetLink, timezone } = parsed.data;

    // Build start and end ISO datetime strings
    const startTime = new Date(`${date}T${time}:00`).toISOString();
    const endMs = new Date(`${date}T${time}:00`).getTime() + duration * 60 * 1000;
    const endTime = new Date(endMs).toISOString();

    logger.info(
      { summary, date, time, duration, guests: guests?.length ?? 0, meetLink, timezone },
      'Creating calendar event via route'
    );

    const result = await googleCalendar.createEvent({
      summary,
      description,
      startTime,
      endTime,
      location,
      guests,
      createMeetLink: meetLink,
      timezone,
    });

    res.json({
      eventId: result.eventId,
      htmlLink: result.htmlLink,
      meetLink: result.meetLink,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
