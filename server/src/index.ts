// ============================================================
// OxyScale Dialler — Server Entry Point
// Express API server with SQLite, Twilio, and AI integration
// ============================================================

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import pino from 'pino';

// Import database initialisation (runs schema creation on import)
import { getDb } from './db/index.js';
import { seedUsersIfEmpty } from './db/seed-users.js';
import { seedManufacturingIfMissing } from './db/seed-manufacturing.js';
import { requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';

// Import route handlers
import leadsRouter from './routes/leads.js';
import callbacksRouter from './routes/callbacks.js';
import twilioRouter from './routes/twilio.js';
import callsRouter from './routes/calls.js';
import intelligenceRouter from './routes/intelligence.js';
import emailRouter from './routes/email.js';
import emailDraftsRouter from './routes/emailDrafts.js';
import googleRouter from './routes/google.js';
import transcribeRouter from './routes/transcribe.js';
import notesRouter from './routes/notes.js';
import projectsRouter from './routes/projects.js';
import activitiesRouter from './routes/activities.js';
import pipelineRouter from './routes/pipeline.js';
import settingsRouter from './routes/settings.js';
import { startGmailSync } from './services/gmail-sync.js';

// Import error handling middleware
import { createErrorHandler } from './middleware/errorHandler.js';

// ============================================================
// Logger setup
// ============================================================

export const logger = pino({
  name: 'oxyscale-dialler',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// ============================================================
// Express app
// ============================================================

// ============================================================
// Required env vars — fail fast on misconfiguration so we never
// boot a half-broken server that only fails when a user clicks the
// affected feature. Anything below in `OPTIONAL_VARS` is allowed to
// be missing but is logged so it's easy to spot.
// ============================================================
const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_PHONE_NUMBER',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
];
const OPTIONAL_VARS = ['EMAIL_FROM_NAME', 'CLIENT_URL', 'DATA_DIR', 'PORT', 'LOG_LEVEL', 'TWILIO_CALLER_ID', 'UNANSWERED_CALL_THRESHOLD'];

if (process.env.NODE_ENV === 'production') {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    // Use console.error directly — the pino logger isn't constructed yet here.
    console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  const missingOptional = OPTIONAL_VARS.filter((v) => !process.env[v]);
  if (missingOptional.length > 0) {
    console.warn(`[WARN] Optional env vars unset (defaults used): ${missingOptional.join(', ')}`);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Trust Railway's proxy so req.ip + x-forwarded-proto resolve correctly.
// Required for the rate limiter (which keys off IP) and the Twilio
// signature middleware (which rebuilds the original URL).
app.set('trust proxy', 1);

// --- Middleware ---

// HTTPS enforcement (production only). Railway terminates TLS at its
// edge proxy and forwards as HTTP, so we trust x-forwarded-proto.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// Security headers via helmet. CSP is intentionally relaxed because
// the React build inlines small Vite runtime scripts and Twilio's
// Voice SDK requires its own connect-src + media-src origins.
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production'
      ? {
          useDefaults: true,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"], // Vite runtime + Twilio SDK
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:', 'https:'],
            'font-src': ["'self'", 'data:'],
            'connect-src': [
              "'self'",
              'https://*.twilio.com',
              'wss://*.twilio.com',
              'https://eventgw.twilio.com',
              'https://api.anthropic.com',
            ],
            'media-src': ["'self'", 'blob:'],
            'frame-ancestors': ["'none'"],
          },
        }
      : false, // CSP off in dev — Vite hot reload + websocket would break
    crossOriginEmbedderPolicy: false, // Twilio iframe + audio won't load with this
    // HSTS: tell the browser "always use https for this domain for the
    // next 6 months". Only meaningful in prod where we actually serve over HTTPS.
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 60 * 60 * 24 * 180, includeSubDomains: true, preload: false }
      : false,
  }),
);

// CORS — same-origin in production (server serves the React build),
// Vite dev server in development. credentials:true so the session
// cookie crosses origins in dev.
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : CLIENT_URL,
  credentials: true,
}));

// Gzip JSON + static asset responses. Lead lists, activity timelines,
// and the React bundle benefit most. Tiny CPU hit, big bandwidth win
// over slow connections.
app.use(compression());

// Parse JSON request bodies (up to 10mb for transcripts)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies (for Twilio webhook callbacks)
app.use(express.urlencoded({ extended: true }));

// Cookie parser — required by the auth middleware to read the
// session cookie. Must come BEFORE any route that uses requireAuth.
app.use(cookieParser());

// Request logging — log path only (NOT full URL) so query strings
// containing reset tokens, search terms, or other sensitive data
// don't leak into the log stream.
app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Incoming request');
  next();
});

// --- Routes ---

// Health check — unauthenticated. Useful for Railway's health probe
// and for confirming the server is alive without needing to log in.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rate limiters. Keyed by IP via trust proxy. Defaults are
// generous for one-team internal use but block runaway loops.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,   // 15 min
  limit: 30,               // 30 login/forgot/reset attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — try again in 15 minutes.' },
});
const expensiveLimiter = rateLimit({
  windowMs: 60_000,        // per minute
  limit: 30,               // 30 hits per IP per minute on AI / email / transcribe routes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit hit — slow down.' },
});

// Auth routes — /login, /logout, /forgot, /reset are unauthenticated
// by design (you can't already be logged in). /me + /change-password
// apply requireAuth themselves inside the router.
app.use('/api/auth', authLimiter, authRouter);

// Public-by-design routes that need to bypass session-cookie auth:
//   - Twilio webhooks (called by Twilio's servers, not a browser).
//     Signature verification protects them — separate blocker.
//   - Google OAuth callback (called by the user's browser after
//     Google redirects). The OAuth `code` itself is the credential.
const PUBLIC_API_PATHS = new Set<string>([
  '/twilio/voice',
  '/twilio/incoming',
  '/twilio/recording-status',
  '/google/callback',
]);

app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  return requireAuth(req, res, next);
});

app.use('/api/leads', leadsRouter);
app.use('/api/callbacks', callbacksRouter);
app.use('/api/twilio', twilioRouter);
app.use('/api/calls', callsRouter);
app.use('/api/intelligence', expensiveLimiter, intelligenceRouter);
app.use('/api/email', expensiveLimiter, emailRouter);
app.use('/api/email-drafts', expensiveLimiter, emailDraftsRouter);
app.use('/api/google', googleRouter);
app.use('/api', expensiveLimiter, transcribeRouter);
app.use('/api/notes', notesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/settings', settingsRouter);

// --- Serve React frontend in production ---
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.resolve(process.cwd(), '../client/dist');
  app.use(express.static(clientDistPath));
  // All non-API routes serve the React app (client-side routing)
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// --- Error handling (must be after routes) ---
app.use(createErrorHandler(logger));

// ============================================================
// Start server
// ============================================================

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, clientUrl: CLIENT_URL }, 'OxyScale Dialler server is running');

  // Seed the two team accounts on first boot (no-op if already present).
  try {
    seedUsersIfEmpty(getDb());
  } catch (err) {
    logger.error({ err }, 'User seeding failed — login will not work until resolved');
  }

  // Seed the Manufacturing playbook + CTA URL + book-a-call URL on
  // first boot. Idempotent — never overwrites edits made via the UI.
  try {
    seedManufacturingIfMissing(getDb());
  } catch (err) {
    logger.error({ err }, 'Manufacturing seed failed (non-blocking)');
  }

  // Start Gmail auto-sync in the background.
  // Wrapped in try/catch so it never prevents the server from starting.
  try {
    startGmailSync();
  } catch (err) {
    logger.warn({ err }, 'Failed to start Gmail sync on startup — will retry when Google auth completes');
  }
});

// Graceful shutdown. Railway sends SIGTERM on every redeploy; without
// this, in-flight requests (AI summarisation, email sends, Twilio
// recording downloads) would be killed mid-flight. We stop accepting
// new connections, give existing ones up to 25s to finish, then exit.
function shutdown(signal: string): void {
  logger.info({ signal }, 'Received shutdown signal — closing server');
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }
    logger.info('Server closed cleanly');
    process.exit(0);
  });
  // Hard cap so a hung request can't block redeploys forever.
  setTimeout(() => {
    logger.warn('Shutdown timeout reached — forcing exit');
    process.exit(1);
  }, 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
