// ============================================================
// Auth middleware. Verifies the session cookie on every protected
// API request. Loads the matching user row and attaches it to req.
// Returns 401 with a clear payload so the frontend can redirect to
// /login. Refreshes the cookie on every successful request (sliding
// session).
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  createSessionToken,
  getCookieOptions,
} from '../services/auth.js';

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  title: string;
  phone: string;
  senderEmail: string;
  signOff: string;
  calendlyLink: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  title: string;
  phone: string;
  sender_email: string;
  sign_off: string;
  calendly_link: string;
}

function rowToUser(row: UserRow): AuthedUser {
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

/**
 * Reads the session cookie, verifies signature + expiry, loads the
 * user. On success, attaches `req.user` and refreshes the cookie.
 * On failure, responds 401 (the frontend redirects to /login).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const row = getDb()
    .prepare(
      `SELECT id, email, name, title, phone, sender_email, sign_off, calendly_link
       FROM users WHERE id = ?`,
    )
    .get(payload.userId) as UserRow | undefined;

  if (!row) {
    res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions());
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }

  req.user = rowToUser(row);

  // Slide the session forward — every authenticated request resets
  // the 30-day clock so active users are never logged out.
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(row.id), getCookieOptions());

  next();
}

/**
 * Soft variant — attaches req.user if a valid session exists, but
 * does NOT 401 on missing/invalid. Use for routes that change behaviour
 * based on auth state but should remain accessible (e.g. /api/auth/me
 * which returns null when not logged in).
 */
export function attachUserIfPresent(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) return next();

  const row = getDb()
    .prepare(
      `SELECT id, email, name, title, phone, sender_email, sign_off, calendly_link
       FROM users WHERE id = ?`,
    )
    .get(payload.userId) as UserRow | undefined;

  if (row) req.user = rowToUser(row);
  next();
}
