// ============================================================
// Twilio Routes — /api/twilio
// Handles Twilio access tokens for browser-based calling
// and the TwiML webhook for outbound call routing
// ============================================================

import { Router } from 'express';
import twilio from 'twilio';
import pino from 'pino';
import { getDb } from '../db/index.js';
import { transcribeAudio } from '../services/transcription.js';

const logger = pino({ name: 'twilio-routes' });
const router = Router();

/**
 * Converts Australian phone numbers to E.164 format (+61...).
 * Handles formats like:
 *   0438 577 512   → +61438577512
 *   (03) 9118 0696 → +6139118069
 *   04 1234 5678   → +61412345678
 *   1300 669 766   → +611300669766
 *   +61438577512   → +61438577512 (already correct)
 */
function formatAusNumberToE164(phone: string): string {
  // Strip all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Already in E.164 format
  if (cleaned.startsWith('+61')) return cleaned;
  if (cleaned.startsWith('+')) return cleaned; // non-AU international number

  // Remove leading 0 and prepend +61
  if (cleaned.startsWith('0')) {
    cleaned = '+61' + cleaned.substring(1);
  } else if (cleaned.startsWith('61') && cleaned.length >= 11) {
    // Already has country code but missing +
    cleaned = '+' + cleaned;
  } else {
    // 1300/1800 numbers or other formats — prepend +61
    cleaned = '+61' + cleaned;
  }

  return cleaned;
}

/**
 * GET /api/twilio/token
 * Generates a Twilio access token with a Voice grant.
 * The frontend uses this token to initialise the Twilio Device (browser SDK)
 * so calls can be made directly from the browser.
 */
router.get('/token', (req, res, next) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    // Check for required Twilio env vars
    if (!accountSid || !twimlAppSid) {
      logger.warn('Twilio environment variables not configured');
      res.status(503).json({
        error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID in your .env file.',
      });
      return;
    }

    // Prefer API key auth (recommended by Twilio) but fall back to account auth
    const keySid = apiKeySid || accountSid;
    const keySecret = apiKeySecret || authToken;

    if (!keySecret) {
      res.status(503).json({
        error: 'Twilio credentials incomplete. Set either TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN.',
      });
      return;
    }

    // Create an access token with a Voice grant
    const identity = 'oxyscale-dialler-user';

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, keySid, keySecret, {
      identity,
      ttl: 3600, // Token valid for 1 hour
    });

    // Grant voice capabilities — outgoing calls via our TwiML app
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: false, // We don't receive inbound calls
    });

    token.addGrant(voiceGrant);

    logger.info({ identity }, 'Twilio access token generated');
    res.json({
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/twilio/voice
 * TwiML webhook — Twilio calls this when an outbound call is initiated
 * from the browser SDK. Returns TwiML XML that tells Twilio to dial
 * the target phone number with our Twilio number as caller ID.
 *
 * IMPORTANT: This is where we reliably capture the CallSid.
 * Twilio sends it as req.body.CallSid. We save it to call_sessions
 * so it can be matched later when the recording arrives.
 */
router.post('/voice', (req, res, next) => {
  try {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const rawTo = req.body.To as string | undefined;
    const callSid = req.body.CallSid as string | undefined;
    // Use the Twilio number as caller ID for outbound calls
    const callerNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!rawTo) {
      twiml.say('No phone number provided.');
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    if (!callerNumber) {
      logger.error('TWILIO_PHONE_NUMBER not set — cannot make outbound call');
      twiml.say('Caller ID not configured. Please set up your Twilio phone number.');
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // Convert Australian local numbers to E.164 format (+61...)
    // Twilio requires international format to place calls
    const to = formatAusNumberToE164(rawTo);

    // Save the CallSid → phone mapping for reliable transcript matching later.
    // This is the ONLY place we can reliably capture the CallSid for outgoing calls.
    if (callSid) {
      try {
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO call_sessions (call_sid, phone_to, created_at)
          VALUES (?, ?, datetime('now'))
        `).run(callSid, to);
        logger.info({ callSid, to }, 'Saved call session for transcript matching');
      } catch (dbErr) {
        logger.error({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to save call session (non-blocking)');
      }
    }

    // Build the absolute callback URL for recording status
    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://oxycrm-production.up.railway.app'
      : `http://localhost:${process.env.PORT || 3001}`;

    // Dial the target number — record both sides for Whisper transcription
    const dial = twiml.dial({
      callerId: callerNumber,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${baseUrl}/api/twilio/recording-status`,
      recordingStatusCallbackMethod: 'POST',
    });
    dial.number(to);

    logger.info({ rawTo, to, callerId: callerNumber, callSid }, 'TwiML voice webhook — dialling');
    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/twilio/call-sid
 * Returns the most recent CallSid for a given phone number.
 * The client calls this after connecting to get the real CallSid
 * (since the browser SDK doesn't reliably expose it for outgoing calls).
 */
router.get('/call-sid', (req, res) => {
  const phone = req.query.phone as string | undefined;
  if (!phone) {
    res.status(400).json({ error: 'phone query parameter required' });
    return;
  }

  const e164Phone = formatAusNumberToE164(phone);
  const db = getDb();

  // Find the most recent call session for this phone number (within last 5 minutes)
  const session = db.prepare(`
    SELECT call_sid FROM call_sessions
    WHERE phone_to = ?
    AND created_at >= datetime('now', '-5 minutes')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(e164Phone) as { call_sid: string } | undefined;

  if (session) {
    logger.info({ phone: e164Phone, callSid: session.call_sid }, 'Returned CallSid for phone');
    res.json({ callSid: session.call_sid });
  } else {
    logger.warn({ phone: e164Phone }, 'No recent call session found for phone');
    res.json({ callSid: null });
  }
});

/**
 * POST /api/twilio/incoming
 * Handles incoming calls to the Twilio number — forwards them to Jordan's mobile.
 * This means when a lead calls back the Twilio number, it rings Jordan's phone.
 */
router.post('/incoming', (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const forwardTo = process.env.TWILIO_CALLER_ID || '+61478197600';
  const from = req.body.From || 'Unknown';

  logger.info({ from, forwardTo }, 'Incoming call — forwarding to Jordan');

  const dial = twiml.dial({ callerId: req.body.To });
  dial.number(forwardTo);

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/twilio/recording-status
 * Twilio sends recording status updates here when a recording completes.
 * Downloads the recording, sends it to Whisper for transcription,
 * and updates the matching call log with the transcript.
 *
 * Matching strategy (in order):
 * 1. Direct match: call_logs.twilio_call_sid = CallSid
 * 2. Phone match: look up phone from call_sessions, find lead, find recent call_log
 * 3. Pending: save to pending_transcripts for later matching on disposition
 */
router.post('/recording-status', async (req, res) => {
  const { RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration, CallSid } = req.body;

  logger.info({
    recordingSid: RecordingSid,
    recordingUrl: RecordingUrl,
    status: RecordingStatus,
    duration: RecordingDuration,
    callSid: CallSid,
  }, 'Recording status update received');

  // Acknowledge receipt immediately — Twilio expects a fast 200
  res.sendStatus(200);

  // Only process completed recordings
  if (RecordingStatus !== 'completed' || !RecordingUrl) return;

  // Process transcription in the background
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      logger.error('Missing Twilio credentials for recording download');
      return;
    }

    // Download the recording from Twilio (add .mp3 extension for Whisper compatibility)
    const recordingMp3Url = `${RecordingUrl}.mp3`;
    logger.info({ url: recordingMp3Url }, 'Downloading recording from Twilio');

    const response = await fetch(recordingMp3Url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status, statusText: response.statusText }, 'Failed to download recording');
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    logger.info({ sizeBytes: audioBuffer.length }, 'Recording downloaded, sending to Whisper');

    // Transcribe via Whisper
    const transcript = await transcribeAudio(audioBuffer, `${RecordingSid}.mp3`);
    logger.info({ callSid: CallSid, transcriptLength: transcript.length }, 'Transcription complete');

    // Try to find and update the matching call log
    const db = getDb();
    let updated = false;

    // Strategy 1: Direct match by CallSid
    if (CallSid) {
      const callLog = db.prepare('SELECT id FROM call_logs WHERE twilio_call_sid = ?').get(CallSid) as { id: number } | undefined;
      if (callLog) {
        db.prepare('UPDATE call_logs SET transcript = ? WHERE id = ?').run(transcript, callLog.id);
        logger.info({ callLogId: callLog.id, strategy: 'direct-callsid' }, 'Call log updated with transcript');
        updated = true;
      }
    }

    // Strategy 2: Look up phone from call_sessions → find lead → find recent call_log
    if (!updated && CallSid) {
      const session = db.prepare('SELECT phone_to FROM call_sessions WHERE call_sid = ?').get(CallSid) as { phone_to: string } | undefined;
      if (session) {
        // Find lead by phone (E.164 format or local format)
        const phone = session.phone_to;
        const localPhone = phone.startsWith('+61') ? '0' + phone.substring(3) : phone;

        const lead = db.prepare(`
          SELECT id FROM leads WHERE phone = ? OR phone = ? OR phone = ?
        `).get(phone, localPhone, phone.replace(/\+/, '')) as { id: number } | undefined;

        if (lead) {
          // Find the most recent call_log for this lead (within last 10 minutes)
          // that has a placeholder transcript (contains "[Call" status messages)
          const recentCallLog = db.prepare(`
            SELECT id FROM call_logs
            WHERE lead_id = ?
            AND created_at >= datetime('now', '-10 minutes')
            ORDER BY created_at DESC
            LIMIT 1
          `).get(lead.id) as { id: number } | undefined;

          if (recentCallLog) {
            db.prepare('UPDATE call_logs SET transcript = ?, twilio_call_sid = ? WHERE id = ?')
              .run(transcript, CallSid, recentCallLog.id);
            logger.info({ callLogId: recentCallLog.id, leadId: lead.id, strategy: 'phone-match' }, 'Call log updated with transcript via phone match');
            updated = true;
          }
        }
      }
    }

    // Strategy 3: Save to pending_transcripts for later matching
    if (!updated) {
      logger.warn({ callSid: CallSid }, 'No call log found — saving to pending_transcripts');
      db.prepare(`
        INSERT OR REPLACE INTO pending_transcripts (call_sid, transcript, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(CallSid, transcript);
    }

    // Clean up old call sessions (older than 1 hour)
    db.prepare("DELETE FROM call_sessions WHERE created_at < datetime('now', '-1 hour')").run();
    // Clean up old pending transcripts (older than 24 hours)
    db.prepare("DELETE FROM pending_transcripts WHERE created_at < datetime('now', '-24 hours')").run();

  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), callSid: CallSid }, 'Failed to process recording');
  }
});

/**
 * GET /api/twilio/debug
 * Diagnostic endpoint — shows the state of the recording/transcription pipeline.
 * Helps identify exactly where things are breaking.
 */
router.get('/debug', (_req, res) => {
  try {
    const db = getDb();

    // Recent call sessions (voice webhook → CallSid capture)
    const callSessions = db.prepare(`
      SELECT * FROM call_sessions ORDER BY created_at DESC LIMIT 10
    `).all();

    // Pending transcripts (Whisper completed but no matching call_log)
    const pendingTranscripts = db.prepare(`
      SELECT call_sid, LENGTH(transcript) as transcript_length, created_at
      FROM pending_transcripts ORDER BY created_at DESC LIMIT 10
    `).all();

    // Recent call logs with their CallSid and transcript preview
    const recentCallLogs = db.prepare(`
      SELECT cl.id, cl.lead_id, cl.twilio_call_sid, cl.disposition,
             SUBSTR(cl.transcript, 1, 100) as transcript_preview,
             LENGTH(cl.transcript) as transcript_length,
             cl.created_at,
             l.name as lead_name, l.phone as lead_phone
      FROM call_logs cl
      LEFT JOIN leads l ON l.id = cl.lead_id
      ORDER BY cl.created_at DESC LIMIT 10
    `).all();

    // Environment check
    const envCheck = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'SET (' + process.env.TWILIO_ACCOUNT_SID?.substring(0, 6) + '...)' : 'MISSING',
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'MISSING',
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || 'MISSING',
      TWILIO_TWIML_APP_SID: process.env.TWILIO_TWIML_APP_SID || 'MISSING',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY?.substring(0, 6) + '...)' : 'MISSING',
      NODE_ENV: process.env.NODE_ENV || 'not set',
      recordingCallbackUrl: process.env.NODE_ENV === 'production'
        ? 'https://oxycrm-production.up.railway.app/api/twilio/recording-status'
        : `http://localhost:${process.env.PORT || 3001}/api/twilio/recording-status`,
    };

    res.json({
      message: 'Twilio recording/transcription pipeline debug info',
      envCheck,
      callSessions,
      pendingTranscripts,
      recentCallLogs,
      diagnosis: {
        voiceWebhookCapturingCallSids: callSessions.length > 0,
        whisperProcessedAny: pendingTranscripts.length > 0 || recentCallLogs.some((cl: Record<string, unknown>) => {
          const preview = cl.transcript_preview as string | null;
          return preview && !preview.includes('[Call connected]');
        }),
        callLogsHaveCallSids: recentCallLogs.filter((cl: Record<string, unknown>) => cl.twilio_call_sid).length,
        callLogsWithRealTranscripts: recentCallLogs.filter((cl: Record<string, unknown>) => {
          const preview = cl.transcript_preview as string | null;
          return preview && !preview.includes('[Call connected]') && !preview.includes('[Call ended]');
        }).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
