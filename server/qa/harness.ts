/**
 * QA harness — drives the real Express routes against a throwaway
 * database. Not a unit test suite: the point is to walk the journeys a
 * user actually takes and assert what the data does afterwards, because
 * the bugs that have hurt were never in a single function, they were in
 * the seams between screens.
 */
import express from 'express';
import Database from 'better-sqlite3';
import pino from 'pino';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeDatabase } from '../src/db/schema';
import { createErrorHandler } from '../src/middleware/errorHandler';

export interface Ctx {
  base: string;
  db: Database.Database;
  api: <T = any>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>;
  close: () => void;
}

export async function startHarness(): Promise<Ctx> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxyqa-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'qa-harness-secret-value-at-least-32-chars';

  let db = new Database(path.join(dir, 'dialler.db'));
  initializeDatabase(db);
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,password_hash,sender_email) VALUES (1,'qa@x.ai','QA','x','qa@x.ai')"
  ).run();
  // Leads require a category, so give the harness one to use.
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('QA')").run();
  db.close();
  db = new Database(path.join(dir, 'dialler.db'));

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(require('cookie-parser')());

  const investor = require('../src/routes/investor');
  app.use('/api/investor', investor.publicRouter);
  app.use('/api', (req: any, res: any, next: any) => {
    if (req.path.startsWith('/investor/shared/')) return next();
    return require('../src/middleware/auth').requireAuth(req, res, next);
  });
  app.use('/api/leads', require('../src/routes/leads').default);
  app.use('/api/projects', require('../src/routes/projects').default);
  app.use('/api/pipeline', require('../src/routes/pipeline').default);
  app.use('/api/investor', investor.default);
  app.use('/api/calls', require('../src/routes/calls').default);
  app.use('/api/notes', require('../src/routes/notes').default);
  app.use('/api/activities', require('../src/routes/activities').default);
  app.use('/api/settings', require('../src/routes/settings').default);
  app.use(createErrorHandler(pino({ level: 'silent' })));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const { createSessionToken, SESSION_COOKIE_NAME } = require('../src/services/auth');
  const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;
  const base = `http://127.0.0.1:${port}/api`;

  const api = async <T = any>(method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* non-JSON is fine */ }
    return { status: res.status, body: parsed as T };
  };

  return {
    base, db, api,
    close: () => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ── assertions ──────────────────────────────────────────────────

export interface Result { section: string; label: string; pass: boolean; detail?: string }
export const results: Result[] = [];
let section = 'general';
export const setSection = (s: string) => { section = s; };

export function check(label: string, pass: boolean, detail?: string) {
  results.push({ section, label, pass, detail });
}
export function eq(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, pass, pass ? undefined : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

export function report(): number {
  const bySection = new Map<string, Result[]>();
  for (const r of results) {
    const list = bySection.get(r.section);
    if (list) list.push(r); else bySection.set(r.section, [r]);
  }
  let failed = 0;
  for (const [name, list] of bySection) {
    const bad = list.filter((r) => !r.pass).length;
    failed += bad;
    console.log(`\n${bad === 0 ? 'OK  ' : 'FAIL'} ${name}  (${list.length - bad}/${list.length})`);
    for (const r of list) {
      if (!r.pass) console.log(`       ${r.label}\n         ${r.detail ?? ''}`);
    }
  }
  const total = results.length;
  console.log(`\n${total - failed}/${total} passed, ${failed} failed\n`);
  return failed;
}
