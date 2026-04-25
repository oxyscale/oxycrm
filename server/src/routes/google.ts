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

router.get('/auth', (req, res, next) => {
  try {
    // Optional ?returnTo=/some/path so the OAuth callback can send the
    // user back to where they came from instead of always landing on /.
    const rawReturnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
    // Only allow same-origin paths, never absolute URLs (open redirect guard).
    const safeReturnTo = rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : undefined;
    const url = googleCalendar.getAuthUrl(safeReturnTo);
    logger.info({ returnTo: safeReturnTo }, 'Redirecting to Google OAuth authorization URL');
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

// ── GET /callback — Handles the OAuth redirect from Google ──

router.get('/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    const stateRaw = typeof req.query.state === 'string' ? req.query.state : undefined;

    if (!code) {
      throw new ApiError(400, 'Missing authorization code in callback');
    }

    logger.info('Handling Google OAuth callback');
    await googleCalendar.handleCallback(code);
    googleCalendar.invalidateAuthCache();

    // Start Gmail sync if it's not already running (now that we have tokens)
    try {
      if (!isGmailSyncRunning()) {
        startGmailSync();
        logger.info('Gmail sync started after OAuth callback');
      }
    } catch (syncErr) {
      logger.warn({ err: syncErr }, 'Failed to start Gmail sync after OAuth callback');
    }

    // Redirect back to the app after successful auth.
    // Use the request's origin so it works in both local dev and production
    // without needing CLIENT_URL to be perfectly set.
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5173';
    const baseUrl = process.env.CLIENT_URL || `${protocol}://${host}`;

    // Read the returnTo path back out of `state`. Express has already
    // decoded the query once; the value sits raw. Re-validate before
    // honouring (open-redirect guard, identical rule to /auth).
    let returnTo = '/';
    if (stateRaw && stateRaw.startsWith('/') && !stateRaw.startsWith('//')) {
      returnTo = stateRaw;
    }
    const sep = returnTo.includes('?') ? '&' : '?';
    res.redirect(`${baseUrl}${returnTo}${sep}googleAuth=success`);
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    next(err);
  }
});

// ── GET /status — Check if we're authenticated with Google ──
// Verifies tokens still work (catches Google's 7-day refresh-token
// revocation for unverified apps). Cached for 5 min server-side.
// Pass ?force=1 to bypass the cache (e.g. just after a fresh callback).

router.get('/status', async (req, res, next) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const authenticated = await googleCalendar.isAuthenticatedAndValid({ force });
    res.json({ authenticated });
  } catch (err) {
    next(err);
  }
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
