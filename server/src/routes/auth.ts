// ============================================================
// Auth routes — /api/auth/*
// Login, logout, current-user, forgot-password (emailed link),
// reset-password (consume token), change-password (logged-in).
// ============================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  getCookieOptions,
  SESSION_COOKIE_NAME,
  generateResetTokenWithExpiry,
  isResetTokenExpired,
} from '../services/auth.js';
import { sendEmail } from '../services/email.js';
import { requireAuth } from '../middleware/auth.js';

const logger = pino({ name: 'auth-routes' });
const router = Router();

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  title: string;
  phone: string;
  sender_email: string;
  sign_off: string;
  calendly_link: string;
  reset_token: string | null;
  reset_token_expires_at: string | null;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    phone: row.phone,
    senderEmail: row.sender_email,
    signOff: row.sign_off,
    calendlyLink: row.calendly_link,
  };
}

// ── POST /login ──────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const row = getDb()
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(email) as UserRow | undefined;

    // Always run bcrypt even if user is missing — prevents user-enumeration
    // via response-time differences.
    const dummyHash = '$2b$12$abcdefghijklmnopqrstuv0000000000000000000000000000000000';
    const valid = row
      ? await verifyPassword(password, row.password_hash)
      : (await verifyPassword(password, dummyHash), false);

    if (!row || !valid) {
      logger.warn({ email }, 'Failed login attempt');
      throw new ApiError(401, 'Invalid email or password');
    }

    res.cookie(SESSION_COOKIE_NAME, createSessionToken(row.id), getCookieOptions());
    logger.info({ userId: row.id }, 'User logged in');
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

// ── POST /logout ─────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions());
  res.json({ success: true });
});

// ── GET /me ──────────────────────────────────────────────────
// Requires auth — frontend uses this to gate the app shell.

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── POST /forgot — request a reset link ─────────────────────

const forgotSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
});

router.post('/forgot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    const row = getDb()
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(email) as UserRow | undefined;

    // Respond identically whether the user exists or not (avoid
    // revealing which addresses have accounts).
    const respond = () => res.json({
      success: true,
      message: 'If that email matches an account, a reset link is on the way.',
    });

    if (!row) {
      logger.info({ email }, 'Forgot-password requested for unknown email — silent no-op');
      respond();
      return;
    }

    const { token, expiresAt } = generateResetTokenWithExpiry();
    getDb()
      .prepare(
        `UPDATE users SET reset_token = ?, reset_token_expires_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(token, expiresAt, row.id);

    const baseUrl = req.headers.origin
      || process.env.CLIENT_URL
      || `https://${req.headers.host}`;
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendEmail({
        to: row.email,
        subject: 'Reset your OxyScale dashboard password',
        textBody: `Hi ${row.name.split(' ')[0]},

Someone (hopefully you) asked to reset your OxyScale password.

Click the link below to choose a new one. It expires in 60 minutes.

${resetUrl}

If you didn't ask for this, you can ignore this email — your current password keeps working.

OxyScale`,
        htmlBody: `<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #faf9f5; padding: 40px 16px; color: #0b0d0e;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #faf9f5;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; border: 1px solid rgba(11,13,14,0.05); padding: 40px;">
        <tr><td>
          <p style="font-size: 22px; font-weight: 600; letter-spacing: -0.035em; margin: 0 0 8px 0;">
            <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
          </p>
          <p style="color: #0a9cd4; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.24em; font-weight: 700; margin: 18px 0 12px 0;">Password reset</p>
          <p style="color: #0b0d0e; font-size: 17px; font-weight: 500; margin: 0 0 16px 0;">Hi ${row.name.split(' ')[0]},</p>
          <p style="color: #2a3138; font-size: 15px; line-height: 1.7; margin: 0 0 16px 0;">
            Someone (hopefully you) asked to reset your OxyScale dashboard password. Click the button below to choose a new one. The link expires in 60 minutes.
          </p>
          <table cellpadding="0" cellspacing="0" role="presentation" style="margin: 24px 0;"><tr>
            <td style="background-color: #0b0d0e; border-radius: 999px; padding: 14px 26px;">
              <a href="${resetUrl}" style="color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none;">Choose a new password</a>
            </td>
          </tr></table>
          <p style="color: #55606a; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">
            If the button does not work, paste this link into your browser:
          </p>
          <p style="color: #0a9cd4; font-size: 12px; word-break: break-all; margin: 0 0 24px 0;">${resetUrl}</p>
          <hr style="border: none; border-top: 1px solid rgba(11,13,14,0.08); margin: 16px 0;" />
          <p style="color: #8a95a0; font-size: 12px; line-height: 1.6; margin: 0;">
            If you did not ask for this, you can ignore this email. Your current password keeps working.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        fromName: 'OxyScale',
        fromAddress: process.env.EMAIL_FROM_ADDRESS || 'jordan@oxyscale.ai',
      });
      logger.info({ userId: row.id }, 'Sent password reset email');
    } catch (err) {
      logger.error({ err, userId: row.id }, 'Failed to send password reset email');
      // Still respond identically — don't leak the failure to the client.
    }

    respond();
  } catch (err) {
    next(err);
  }
});

// ── POST /reset — consume a reset token ─────────────────────

const resetSchema = z.object({
  token: z.string().min(8),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

router.post('/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = resetSchema.parse(req.body);
    const row = getDb()
      .prepare('SELECT * FROM users WHERE reset_token = ?')
      .get(token) as UserRow | undefined;

    if (!row || isResetTokenExpired(row.reset_token_expires_at)) {
      throw new ApiError(400, 'This reset link is invalid or has expired. Request a new one.');
    }

    const hash = await hashPassword(newPassword);
    getDb()
      .prepare(
        `UPDATE users
         SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(hash, row.id);

    // Log them in straight away so they don't need to type the new
    // password they just typed twice.
    res.cookie(SESSION_COOKIE_NAME, createSessionToken(row.id), getCookieOptions());
    logger.info({ userId: row.id }, 'Password reset successfully');
    res.json({ success: true, user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

// ── POST /change-password — for already-logged-in users ─────

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

router.post('/change-password', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changeSchema.parse(req.body);
    const userId = req.user!.id;
    const row = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow;

    const valid = await verifyPassword(currentPassword, row.password_hash);
    if (!valid) throw new ApiError(401, 'Current password is incorrect');

    const hash = await hashPassword(newPassword);
    getDb()
      .prepare(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(hash, userId);

    logger.info({ userId }, 'User changed their password');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
