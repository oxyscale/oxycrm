// ============================================================
// Auth service — bcrypt password verification, signed session
// cookies (HMAC), password reset tokens.
//
// Sessions are stateless: the cookie carries `{userId, iat}` signed
// with a server-side secret. No session table to manage. Logout just
// clears the cookie. Cookie lifetime = 30 days, sliding (refreshed on
// each request via the auth middleware).
//
// The session secret is generated on first boot and persisted to a
// file in the data dir so sessions survive restarts. A fresh secret
// invalidates every active session — useful for an emergency logout.
// ============================================================

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { customAlphabet } from 'nanoid';
import { getDataDir } from '../utils/dataDir.js';
import pino from 'pino';

const logger = pino({ name: 'auth-service' });

const BCRYPT_COST = 12;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
const RESET_TOKEN_TTL_MS = 60 * 60_000;       // 60 minutes

// URL-safe alphabet for reset tokens. 32 chars from a 64-char alphabet
// = 192 bits of entropy. Plenty.
const generateResetToken = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  32,
);

// ── Session secret ──────────────────────────────────────────

let cachedSecret: Buffer | null = null;

function getSessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cachedSecret = Buffer.from(fromEnv, 'utf-8');
    return cachedSecret;
  }

  const secretPath = path.join(getDataDir(), 'session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      cachedSecret = fs.readFileSync(secretPath);
      return cachedSecret;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read persisted session secret — generating new one');
  }

  const fresh = crypto.randomBytes(48);
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, fresh, { mode: 0o600 });
    logger.info('Generated and persisted new session secret');
  } catch (err) {
    logger.error({ err }, 'Failed to persist session secret — sessions will be lost on restart');
  }
  cachedSecret = fresh;
  return cachedSecret;
}

// ── Password hashing ─────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// ── Session cookies ──────────────────────────────────────────

interface SessionPayload {
  userId: number;
  iat: number; // ms epoch
}

function sign(data: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64url');
}

export function createSessionToken(userId: number): string {
  const payload: SessionPayload = { userId, iat: Date.now() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = sign(body);
  // Constant-time compare to prevent timing attacks.
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as SessionPayload;
    if (typeof payload.userId !== 'number' || typeof payload.iat !== 'number') return null;
    if (Date.now() - payload.iat > SESSION_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = 'oxy_session';

export function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

// ── Reset tokens ─────────────────────────────────────────────

export function generateResetTokenWithExpiry(): { token: string; expiresAt: string } {
  return {
    token: generateResetToken(),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
  };
}

export function isResetTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) < Date.now();
}
