// ============================================================
// User seed — runs once on first boot when the users table is empty.
// Inserts the two team accounts (Jordan + George) with bcrypt-hashed
// passwords. Plaintext passwords are revealed to the team out-of-band
// and rotated via the forgot-password flow on first login.
//
// The hashes below are bcrypt cost-12 — one-way, safe to commit.
// ============================================================

import type Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ name: 'seed-users' });

interface SeedUser {
  email: string;
  passwordHash: string;
  name: string;
  title: string;
  phone: string;
  senderEmail: string;
  signOff: string;
  calendlyLink: string;
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'jordan@oxyscale.ai',
    passwordHash: '$2b$12$1Boy7hutjZC94V/VS0NDDuAItLpsNZAn4Mth6GAlAPYgW3QxWfkJy',
    name: 'Jordan Bell',
    title: 'Co-founder',
    phone: '+61 478 197 600',
    senderEmail: 'jordan@oxyscale.ai',
    signOff: 'Cheers',
    calendlyLink: 'https://calendly.com/jordan-oxyscale/30min',
  },
  {
    email: 'george@oxyscale.ai',
    passwordHash: '$2b$12$FrYNBbcL6zca2ZXbXkHi5.KtYNoxzMKhKprR6TKisOteFdIeAiPAG',
    name: 'George Harrad',
    title: 'Co-founder',
    // George explicitly chose to use Jordan's number — Jordan handles sales calls.
    phone: '+61 478 197 600',
    senderEmail: 'george@oxyscale.ai',
    signOff: 'Cheers',
    calendlyLink: '',
  },
];

/**
 * Seeds the users table on first boot. No-op if any users exist.
 * Also backfills existing call_logs and email_drafts with Jordan's
 * user_id since he was the only operator before this change.
 */
export function seedUsersIfEmpty(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (existing.n === 0) {
    logger.info('Users table empty — seeding initial team accounts');

    const insert = db.prepare(`
      INSERT INTO users (email, password_hash, name, title, phone, sender_email, sign_off, calendly_link, created_at, updated_at)
      VALUES (@email, @passwordHash, @name, @title, @phone, @senderEmail, @signOff, @calendlyLink, datetime('now'), datetime('now'))
    `);

    db.transaction(() => {
      for (const u of SEED_USERS) {
        const r = insert.run(u);
        logger.info({ email: u.email, id: r.lastInsertRowid }, 'Seeded user');
      }
    })();
  }

  // Backfill runs every boot but is idempotent — only touches rows
  // whose attribution column is still NULL. Lets us add later
  // attribution migrations without re-seeding users.
  const jordan = db
    .prepare("SELECT id FROM users WHERE email = 'jordan@oxyscale.ai'")
    .get() as { id: number } | undefined;
  if (jordan) {
    const calls = db.prepare('UPDATE call_logs SET user_id = ? WHERE user_id IS NULL').run(jordan.id);
    const drafts = db.prepare('UPDATE email_drafts SET user_id = ? WHERE user_id IS NULL').run(jordan.id);
    const acts = db
      .prepare("UPDATE activities SET created_by = 'Jordan Bell' WHERE created_by IS NULL")
      .run();
    if (calls.changes + drafts.changes + acts.changes > 0) {
      logger.info(
        { calls: calls.changes, drafts: drafts.changes, activities: acts.changes },
        'Backfilled legacy rows to Jordan',
      );
    }
  }
}
