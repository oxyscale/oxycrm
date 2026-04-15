// ============================================================
// Twilio Routes — /api/twilio
// Handles Twilio access tokens for browser-based calling
// and the TwiML webhook for outbound call routing
// ============================================================

import { Router } from 'express';
import twilio from 'twilio';
import pino from 'pino';

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
 * The `To` parameter is passed by the Twilio Device.connect() call
 * from the frontend.
 */
router.post('/voice', (req, res, next) => {
  try {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const rawTo = req.body.To as string | undefined;
    // Use the Twilio number as caller ID for outbound calls
    // TWILIO_CALLER_ID (Jordan's mobile) is used for incoming call forwarding only
    const callerNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!rawTo) {
      twiml.say('No phone number provided.');
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    if (!callerNumber) {
      logger.error('TWILIO_CALLER_ID and TWILIO_PHONE_NUMBER not set — cannot make outbound call');
      twiml.say('Caller ID not configured. Please set up your Twilio phone number.');
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // Convert Australian local numbers to E.164 format (+61...)
    // Twilio requires international format to place calls
    const to = formatAusNumberToE164(rawTo);

    // Dial the target number with Jordan's mobile as the caller ID
    // record: 'record-from-answer-dual' records both sides of the call for transcription
    const dial = twiml.dial({
      callerId: callerNumber,
      record: 'record-from-answer-dual',
      recordingStatusCallback: '/api/twilio/recording-status',
      recordingStatusCallbackMethod: 'POST',
    });
    dial.number(to);

    logger.info({ rawTo, to, callerId: callerNumber }, 'TwiML voice webhook — dialling');
    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    next(err);
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
 * We log the recording URL for later transcription processing.
 */
router.post('/recording-status', (req, res) => {
  const { RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration, CallSid } = req.body;

  logger.info({
    recordingSid: RecordingSid,
    recordingUrl: RecordingUrl,
    status: RecordingStatus,
    duration: RecordingDuration,
    callSid: CallSid,
  }, 'Recording status update received');

  // Acknowledge receipt — Twilio expects a 200
  res.sendStatus(200);
});

export default router;
