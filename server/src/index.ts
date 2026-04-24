// ============================================================
// OxyScale Dialler — Server Entry Point
// Express API server with SQLite, Twilio, and AI integration
// ============================================================

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import cors from 'cors';
import path from 'path';
import pino from 'pino';

// Import database initialisation (runs schema creation on import)
import './db/index.js';

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

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// --- Middleware ---

// CORS — allow the Vite dev server in development, or same-origin in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : CLIENT_URL,
  credentials: true,
}));

// Parse JSON request bodies (up to 10mb for transcripts)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies (for Twilio webhook callbacks)
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request');
  next();
});

// --- Routes ---

app.use('/api/leads', leadsRouter);
app.use('/api/callbacks', callbacksRouter);
app.use('/api/twilio', twilioRouter);
app.use('/api/calls', callsRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/email', emailRouter);
app.use('/api/email-drafts', emailDraftsRouter);
app.use('/api/google', googleRouter);
app.use('/api', transcribeRouter);
app.use('/api/notes', notesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/settings', settingsRouter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.listen(PORT, () => {
  logger.info({ port: PORT, clientUrl: CLIENT_URL }, 'OxyScale Dialler server is running');

  // Start Gmail auto-sync in the background.
  // Wrapped in try/catch so it never prevents the server from starting.
  try {
    startGmailSync();
  } catch (err) {
    logger.warn({ err }, 'Failed to start Gmail sync on startup — will retry when Google auth completes');
  }
});

export default app;
