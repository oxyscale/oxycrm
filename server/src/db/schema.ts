// ============================================================
// Database Schema — SQLite table definitions
// Creates tables for leads, call_logs, and callbacks
// ============================================================

import type Database from 'better-sqlite3';

/**
 * Initializes the database schema.
 * Creates all required tables if they don't already exist.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export function initializeDatabase(db: Database.Database): void {
  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Leads table: stores all imported leads and their current state
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      lead_type TEXT NOT NULL DEFAULT 'new',
      category TEXT,
      status TEXT NOT NULL DEFAULT 'not_called',
      unanswered_calls INTEGER NOT NULL DEFAULT 0,
      voicemail_left INTEGER NOT NULL DEFAULT 0,
      voicemail_date TEXT,
      consolidated_summary TEXT,
      company_info TEXT,
      monday_item_id TEXT,
      queue_position INTEGER NOT NULL DEFAULT 0,
      last_called_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Call logs table: one record per call attempt
    CREATE TABLE IF NOT EXISTS call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      duration INTEGER,
      transcript TEXT,
      summary TEXT,
      key_topics TEXT,
      action_items TEXT,
      sentiment TEXT,
      disposition TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Callbacks table: scheduled callback reminders
    CREATE TABLE IF NOT EXISTS callbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      callback_date TEXT NOT NULL,
      notes TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Index for fast queue queries (finding next lead to call)
    CREATE INDEX IF NOT EXISTS idx_leads_queue
      ON leads(status, queue_position)
      WHERE status = 'not_called';

    -- Index for callback date lookups
    CREATE INDEX IF NOT EXISTS idx_callbacks_date
      ON callbacks(callback_date)
      WHERE completed = 0;

    -- Index for call logs by lead
    CREATE INDEX IF NOT EXISTS idx_call_logs_lead
      ON call_logs(lead_id, created_at);

    -- Index for duplicate detection by phone
    CREATE INDEX IF NOT EXISTS idx_leads_phone
      ON leads(phone);

    -- Call intelligence table: stores AI analysis snapshots
    CREATE TABLE IF NOT EXISTS call_intelligence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_type TEXT NOT NULL,
      date_range_start TEXT,
      date_range_end TEXT,
      total_calls_analysed INTEGER NOT NULL DEFAULT 0,
      common_objections TEXT,
      winning_patterns TEXT,
      recommendations TEXT,
      raw_analysis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate old status values to new simplified statuses
  db.exec(`
    UPDATE leads SET status = 'not_called' WHERE status IN ('queued', 'active', 'post_call');
    UPDATE leads SET status = 'called' WHERE status IN ('completed', 'removed');
  `);

  // Add website column if it doesn't exist (migration for existing DBs)
  const columns = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'website')) {
    db.exec('ALTER TABLE leads ADD COLUMN website TEXT');
  }

  // ============================================================
  // CRM Migration — new columns on leads table
  // ============================================================

  // Add pipeline_stage column
  if (!columns.some((c) => c.name === 'pipeline_stage')) {
    db.exec("ALTER TABLE leads ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new_lead'");
  }

  // Add temperature column
  if (!columns.some((c) => c.name === 'temperature')) {
    db.exec('ALTER TABLE leads ADD COLUMN temperature TEXT DEFAULT NULL');
  }

  // Add converted_to_project flag
  if (!columns.some((c) => c.name === 'converted_to_project')) {
    db.exec('ALTER TABLE leads ADD COLUMN converted_to_project INTEGER DEFAULT 0');
  }

  // Add twilio_call_sid column to call_logs for linking recordings
  const callLogColumns = db.prepare("PRAGMA table_info(call_logs)").all() as { name: string }[];
  if (!callLogColumns.some((c) => c.name === 'twilio_call_sid')) {
    db.exec('ALTER TABLE call_logs ADD COLUMN twilio_call_sid TEXT');
  }

  // Pending transcripts — holds transcripts from Twilio recordings
  // that arrive before the call is dispositioned
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_transcripts (
      call_sid TEXT PRIMARY KEY,
      transcript TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Call sessions — maps Twilio CallSid to phone numbers
  // Populated by the voice webhook (server-side, guaranteed accurate)
  // Used to match recordings to call logs even when client-side CallSid capture fails
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_sessions (
      call_sid TEXT PRIMARY KEY,
      phone_to TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add follow_up_date column for scheduling follow-up calls
  if (!columns.some((c) => c.name === 'follow_up_date')) {
    db.exec('ALTER TABLE leads ADD COLUMN follow_up_date TEXT DEFAULT NULL');
  }

  // Note: monday_item_id column is retained for backward compatibility but no longer used.
  // SQLite does not support DROP COLUMN easily, so we leave it in place.

  // ============================================================
  // CRM Migration — new tables
  // ============================================================

  db.exec(`
    -- Notes table: standalone notes attached to leads
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT DEFAULT 'jordan',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    -- Projects table: leads that converted into active projects
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'onboarding',
      value REAL DEFAULT 0,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    -- Project tasks table: checklist items within a project
    CREATE TABLE IF NOT EXISTS project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Emails table: log of all emails (sent and received)
    CREATE TABLE IF NOT EXISTS emails_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      to_address TEXT NOT NULL,
      from_address TEXT,
      subject TEXT NOT NULL,
      body_snippet TEXT,
      gmail_message_id TEXT,
      source TEXT DEFAULT 'dialler',
      direction TEXT DEFAULT 'sent',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    -- Activities table: timeline of all lead interactions
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    -- Index for notes by lead
    CREATE INDEX IF NOT EXISTS idx_notes_lead
      ON notes(lead_id, created_at);

    -- Index for projects by lead
    CREATE INDEX IF NOT EXISTS idx_projects_lead
      ON projects(lead_id);

    -- Index for project tasks by project
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project
      ON project_tasks(project_id);

    -- Index for emails by lead
    CREATE INDEX IF NOT EXISTS idx_emails_sent_lead
      ON emails_sent(lead_id, created_at);

    -- Index for activities by lead (most common query)
    CREATE INDEX IF NOT EXISTS idx_activities_lead
      ON activities(lead_id, created_at);

    -- Index for pipeline stage filtering
    CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage
      ON leads(pipeline_stage);

    -- Index for follow-up date queries
    CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date
      ON leads(follow_up_date)
      WHERE pipeline_stage = 'follow_up' AND follow_up_date IS NOT NULL;

    -- Settings table: key-value pairs for app configuration
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Category prompts: free-text AI context per industry category
    CREATE TABLE IF NOT EXISTS category_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- Email Bank — AI-generated follow-up email drafts
    -- Populated server-side after a call is dispositioned (interested/voicemail)
    -- and its Whisper transcript is ready. Jordan reviews + sends at his own pace.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS email_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      call_log_id INTEGER UNIQUE,             -- One draft per call. UNIQUE prevents double-generation.
      disposition TEXT NOT NULL,              -- 'interested' | 'voicemail'
      to_email TEXT,
      cc_email TEXT,
      subject TEXT,
      body TEXT,
      suggested_stage TEXT DEFAULT 'follow_up', -- 'follow_up' | 'call_booked'
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'ready' | 'sent' | 'discarded' | 'failed'
      generated_at TEXT,                      -- when AI finished writing
      sent_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (call_log_id) REFERENCES call_logs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_drafts_status
      ON email_drafts(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_email_drafts_lead
      ON email_drafts(lead_id);

    -- ============================================================
    -- Users — internal team accounts (George + Jordan)
    -- Identity for sending emails (sender_email + signature) and
    -- attribution on calls / drafts. Password reset via emailed token.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Co-founder',
      phone TEXT NOT NULL DEFAULT '',
      sender_email TEXT NOT NULL,
      sign_off TEXT NOT NULL DEFAULT 'Cheers',
      calendly_link TEXT NOT NULL DEFAULT '',
      reset_token TEXT,
      reset_token_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)
      WHERE reset_token IS NOT NULL;
  `);

  // Add user_id columns to call_logs and email_drafts (idempotent migration).
  // Nullable — legacy rows backfilled to Jordan during user seed.
  addColumnIfMissing(db, 'call_logs', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfMissing(db, 'email_drafts', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

  // Capture who performed each activity. Free-text name (not a FK) so
  // a deleted user's history doesn't disappear and so legacy rows
  // can carry "Jordan Bell" as the safe assumption.
  addColumnIfMissing(db, 'activities', 'created_by', 'TEXT');

  // Retrofit ON DELETE CASCADE on the legacy tables that were created
  // before cascading was added. Wrong-Number disposition deletes the
  // lead row and used to leave orphan notes / projects / activities /
  // emails behind. SQLite cannot ALTER FK constraints in place — the
  // helper recreates the table only when the existing FK is wrong.
  retrofitCascadeIfMissing(db, 'notes', 'lead_id', 'leads');
  retrofitCascadeIfMissing(db, 'projects', 'lead_id', 'leads');
  retrofitCascadeIfMissing(db, 'project_tasks', 'project_id', 'projects');
  retrofitCascadeIfMissing(db, 'emails_sent', 'lead_id', 'leads');
  retrofitCascadeIfMissing(db, 'activities', 'lead_id', 'leads');
}

/**
 * Add a column to an existing table if it does not already exist.
 * SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we check
 * PRAGMA table_info first.
 */
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

interface ForeignKeyInfo {
  table: string;
  from: string;
  on_delete: string;
}

/**
 * Recreate a table with `ON DELETE CASCADE` on its FK to `parentTable`
 * if the existing FK uses NO ACTION (the SQLite default). No-op
 * otherwise. Safe to call repeatedly; idempotent.
 */
function retrofitCascadeIfMissing(
  db: Database.Database,
  table: string,
  fkColumn: string,
  parentTable: string,
): void {
  const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
  const existing = fks.find((f) => f.from === fkColumn && f.table === parentTable);
  if (!existing) return;
  if (existing.on_delete === 'CASCADE') return; // already correct

  // Look up the original CREATE TABLE so we can rebuild it byte-for-byte
  // with the FK clause swapped. Falling back to the parsed PRAGMA info
  // would risk losing column defaults / collation hints.
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(table) as { sql: string } | undefined;
  if (!row?.sql) return;

  const fkPattern = new RegExp(
    `FOREIGN KEY\\s*\\(\\s*${fkColumn}\\s*\\)\\s*REFERENCES\\s+${parentTable}\\s*\\(\\s*id\\s*\\)(?!\\s*ON DELETE)`,
    'i',
  );
  const newSql = row.sql.replace(
    fkPattern,
    `FOREIGN KEY (${fkColumn}) REFERENCES ${parentTable}(id) ON DELETE CASCADE`,
  );
  if (newSql === row.sql) return; // pattern didn't match — bail safely

  // SQLite's officially supported pattern for changing constraints:
  // turn FK enforcement off, swap the table inside one transaction.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const tmpTable = `${table}_new_cascade_migration`;
      db.exec(newSql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${tmpTable}`).replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE ${tmpTable}`));
      db.exec(`INSERT INTO ${tmpTable} SELECT * FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${tmpTable} RENAME TO ${table}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
