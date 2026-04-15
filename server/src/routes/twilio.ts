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

    const to = req.body.To as string | undefined;
    const callerNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!to) {
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

    // Record the call at network level for transcription later
    // This records both sides — the person on the other end is NOT notified
    twiml.record({
      recordingStatusCallback: '/api/twilio/recording-status',
      recordingStatusCallbackMethod: 'POST',
    });

    // Dial the target number with our Twilio number as the caller ID
    const dial = twiml.dial({ callerId: callerNumber, record: 'record-from-answer-dual' });
    dial.number(to);

    logger.info({ to, callerId: callerNumber }, 'TwiML voice webhook — dialling');
    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    next(err);
  }
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
