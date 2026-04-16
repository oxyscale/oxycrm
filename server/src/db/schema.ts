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
      FOREIGN KEY (lead_id) REFERENCES leads(id)
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
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    -- Project tasks table: checklist items within a project
    CREATE TABLE IF NOT EXISTS project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
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
      FOREIGN KEY (lead_id) REFERENCES leads(id)
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
      FOREIGN KEY (lead_id) REFERENCES leads(id)
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
  `);
}
