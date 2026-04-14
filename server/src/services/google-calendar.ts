// ============================================================
// Google Calendar Service
// Handles OAuth2 authentication and calendar event creation.
// Tokens are persisted to disk so re-auth isn't needed each restart.
// ============================================================

import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ name: 'google-calendar-service' });

// ── Token storage path ──────────────────────────────────────

const TOKEN_PATH = path.resolve(
  __dirname,
  '../../../data/google-tokens.json'
);

// ── OAuth2 client ───────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Google OAuth2 credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── Token persistence ───────────────────────────────────────

function loadTokens(): Record<string, unknown> | null {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
      const tokens = JSON.parse(raw);
      logger.info('Loaded saved Google OAuth tokens from disk');
      return tokens;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load Google tokens from disk');
  }
  return null;
}

function saveTokens(tokens: Record<string, unknown>): void {
  try {
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
    logger.info('Saved Google OAuth tokens to disk');
  } catch (err) {
    logger.error({ err }, 'Failed to save Google tokens to disk');
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Returns the Google OAuth2 authorization URL.
 * The frontend should redirect the user here to grant calendar access.
 */
export function getAuthUrl(): string {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get a refresh token
  });
  logger.info('Generated Google OAuth authorization URL');
  return url;
}

/**
 * Exchanges the authorization code from the OAuth callback for tokens.
 * Saves the tokens to disk for future use.
 */
export async function handleCallback(code: string): Promise<void> {
  const client = getOAuth2Client();

  logger.info('Exchanging Google OAuth authorization code for tokens');
  const { tokens } = await client.getToken(code);

  if (!tokens) {
    throw new Error('Failed to exchange authorization code — no tokens returned');
  }

  saveTokens(tokens as Record<string, unknown>);
  logger.info('Google OAuth tokens saved successfully');
}

/**
 * Checks whether we have valid saved tokens.
 * Returns true if tokens exist on disk (does not verify expiry —
 * the googleapis library handles refresh automatically).
 */
export function isAuthenticated(): boolean {
  const tokens = loadTokens();
  return tokens !== null;
}

/**
 * Returns an authenticated OAuth2 client with saved tokens loaded.
 * Throws if no tokens are saved.
 */
export function getAuthenticatedClient() {
  const client = getOAuth2Client();
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error(
      'Not authenticated with Google. Visit /api/google/auth to connect your account.'
    );
  }

  client.setCredentials(tokens);

  // Listen for token refresh events so we persist updated tokens
  client.on('tokens', (newTokens) => {
    logger.info('Google OAuth tokens refreshed — saving to disk');
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
  });

  return client;
}

// ── Calendar event creation ─────────────────────────────────

export interface CreateEventParams {
  summary: string;
  description?: string;
  startTime: string;   // ISO 8601 datetime string
  endTime: string;     // ISO 8601 datetime string
  location?: string;
  guests?: string[];   // Array of email addresses
  createMeetLink?: boolean;
  timezone?: string;   // IANA timezone string (e.g. 'Australia/Sydney')
}

export interface CreateEventResult {
  eventId: string;
  htmlLink: string;
  meetLink?: string;
}

/**
 * Lists calendar events for a given day.
 * Returns a simplified list of events with summary, start time, and end time.
 */
export async function listEventsForDay(
  date: string,
  timezone?: string
): Promise<Array<{ summary: string; startTime: string; endTime: string }>> {
  const auth = getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const timeZone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  logger.info({ date, timeZone }, 'Listing calendar events for day');

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    timeZone,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];

  return events.map((event) => ({
    summary: event.summary || '(No title)',
    startTime: event.start?.dateTime || event.start?.date || '',
    endTime: event.end?.dateTime || event.end?.date || '',
  }));
}

/**
 * Creates a Google Calendar event with optional Google Meet link and guest invitations.
 */
export async function createEvent(params: CreateEventParams): Promise<CreateEventResult> {
  const auth = getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const eventTimeZone = params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const eventBody: calendar_v3.Schema$Event = {
    summary: params.summary,
    description: params.description,
    start: {
      dateTime: params.startTime,
      timeZone: eventTimeZone,
    },
    end: {
      dateTime: params.endTime,
      timeZone: eventTimeZone,
    },
  };

  if (params.location) {
    eventBody.location = params.location;
  }

  if (params.guests && params.guests.length > 0) {
    eventBody.attendees = params.guests.map((email) => ({ email }));
  }

  // Add Google Meet conference if requested
  if (params.createMeetLink) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `oxyscale-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  logger.info(
    { summary: params.summary, start: params.startTime, guests: params.guests?.length ?? 0 },
    'Creating Google Calendar event'
  );

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventBody,
    conferenceDataVersion: params.createMeetLink ? 1 : 0,
    sendUpdates: params.guests && params.guests.length > 0 ? 'all' : 'none',
  });

  const event = response.data;

  const result: CreateEventResult = {
    eventId: event.id ?? '',
    htmlLink: event.htmlLink ?? '',
  };

  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video'
    );
    if (videoEntry?.uri) {
      result.meetLink = videoEntry.uri;
    }
  }

  logger.info(
    { eventId: result.eventId, meetLink: result.meetLink },
    'Google Calendar event created successfully'
  );

  return result;
}
