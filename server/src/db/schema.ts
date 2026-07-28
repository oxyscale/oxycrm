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

  // Add pipeline_stage column. Default for new installs is NULL (no tier).
  if (!columns.some((c) => c.name === 'pipeline_stage')) {
    db.exec("ALTER TABLE leads ADD COLUMN pipeline_stage TEXT DEFAULT NULL");
  }

  // ─────────────────────────────────────────────────────────────────
  // Migration (May 2026): drop NOT NULL constraint from pipeline_stage.
  // NULL = "lead is in /leads but not placed on the kanban". The reset
  // endpoint and CSV import both rely on being able to write NULL here.
  //
  // SQLite has no ALTER COLUMN. We rewrite the table's CREATE statement
  // in-place via PRAGMA writable_schema. Safer than the rename/recreate
  // dance because no FK references from child tables need to be touched.
  // ─────────────────────────────────────────────────────────────────
  const pipelineStageInfo = (
    db.prepare('PRAGMA table_info(leads)').all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === 'pipeline_stage');

  if (pipelineStageInfo && pipelineStageInfo.notnull === 1) {
    const tableSqlRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leads'"
    ).get() as { sql: string } | undefined;

    if (tableSqlRow?.sql) {
      // Match "pipeline_stage TEXT NOT NULL" with any surrounding whitespace /
      // quoting variants and strip the NOT NULL.
      const newSql = tableSqlRow.sql.replace(
        /(["']?pipeline_stage["']?\s+TEXT)\s+NOT\s+NULL/i,
        '$1',
      );

      if (newSql !== tableSqlRow.sql) {
        db.unsafeMode(true);
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('PRAGMA writable_schema = ON');
        db.prepare(
          "UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'leads'"
        ).run(newSql);
        db.exec('PRAGMA writable_schema = OFF');
        db.exec('PRAGMA foreign_keys = ON');
        db.unsafeMode(false);

        // Bump schema_version so SQLite reloads its cached schema —
        // without this, subsequent ALTER TABLE ADD COLUMN can fail
        // because the in-memory schema still holds the pre-rewrite DDL.
        const sv = db.pragma('schema_version', { simple: true }) as number;
        db.pragma(`schema_version = ${sv + 1}`);

        const integrity = (
          db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
        ).integrity_check;
        if (integrity !== 'ok') {
          // eslint-disable-next-line no-console
          console.error('[schema] integrity_check failed after relaxing pipeline_stage:', integrity);
        } else {
          // eslint-disable-next-line no-console
          console.log('[schema] Dropped NOT NULL constraint from leads.pipeline_stage');
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Drop NOT NULL from leads.phone (if present) — phone is optional
  // since leads can be created without a phone number.
  // Uses the same writable_schema technique as pipeline_stage above.
  // ─────────────────────────────────────────────────────────────────
  const phoneInfo = (
    db.prepare('PRAGMA table_info(leads)').all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === 'phone');

  if (phoneInfo && phoneInfo.notnull === 1) {
    const tableSqlRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leads'"
    ).get() as { sql: string } | undefined;

    if (tableSqlRow?.sql) {
      const newSql = tableSqlRow.sql.replace(
        /(["']?phone["']?\s+TEXT)\s+NOT\s+NULL/i,
        '$1',
      );

      if (newSql !== tableSqlRow.sql) {
        db.unsafeMode(true);
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('PRAGMA writable_schema = ON');
        db.prepare(
          "UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'leads'"
        ).run(newSql);
        db.exec('PRAGMA writable_schema = OFF');
        db.exec('PRAGMA foreign_keys = ON');
        db.unsafeMode(false);

        const sv = db.pragma('schema_version', { simple: true }) as number;
        db.pragma(`schema_version = ${sv + 1}`);

        // eslint-disable-next-line no-console
        console.log('[schema] Dropped NOT NULL constraint from leads.phone');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Pipeline simplification (May 2026): collapse legacy stages.
  // new_lead is NO LONGER migrated — it was causing CSV imports to
  // be auto-placed into tier_3. Legacy new_lead rows are now set to
  // NULL (no tier) instead.
  // ─────────────────────────────────────────────────────────────────
  db.exec(`
    UPDATE leads SET pipeline_stage = NULL  WHERE pipeline_stage = 'new_lead';
    UPDATE leads SET pipeline_stage = 'tier_2' WHERE pipeline_stage = 'follow_up';
    UPDATE leads SET pipeline_stage = 'tier_1' WHERE pipeline_stage IN ('call_booked', 'negotiation');
    UPDATE leads SET pipeline_stage = 'lost'   WHERE pipeline_stage IN ('not_interested', 'five_strikes');
  `);

  // ─────────────────────────────────────────────────────────────────
  // Migration (June 2026): rewrite the leads table CREATE statement to
  // force pipeline_stage's column DEFAULT to NULL. Older prod DBs were
  // created when DEFAULT 'new_lead' was in the ALTER TABLE call, so
  // every fresh INSERT that didn't explicitly set pipeline_stage picked
  // up 'new_lead' silently — breaking undo-import's protection logic
  // (every newly-imported lead looked like Jordan had placed it in a
  // tier). Same writable_schema technique used to drop NOT NULL above.
  // ─────────────────────────────────────────────────────────────────
  const leadsTableSqlRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leads'"
  ).get() as { sql: string } | undefined;

  if (leadsTableSqlRow?.sql && /pipeline_stage\s+TEXT\s+DEFAULT\s+['"]new_lead['"]/i.test(leadsTableSqlRow.sql)) {
    const fixedSql = leadsTableSqlRow.sql.replace(
      /(pipeline_stage\s+TEXT)\s+DEFAULT\s+['"]new_lead['"]/i,
      '$1 DEFAULT NULL',
    );
    db.unsafeMode(true);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('PRAGMA writable_schema = ON');
    db.prepare(
      "UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'leads'"
    ).run(fixedSql);
    db.exec('PRAGMA writable_schema = OFF');
    db.exec('PRAGMA foreign_keys = ON');
    db.unsafeMode(false);
    const sv = db.pragma('schema_version', { simple: true }) as number;
    db.pragma(`schema_version = ${sv + 1}`);
    // eslint-disable-next-line no-console
    console.log("[schema] Changed pipeline_stage column DEFAULT from 'new_lead' to NULL");
  }

  // ─────────────────────────────────────────────────────────────────
  // One-time cleanup (May 2026): revert CSV-imported leads that were
  // incorrectly auto-tiered to tier_3. A lead is "uncontacted" if it
  // has no notes, emails, or call logs — those are the CSV imports.
  // ─────────────────────────────────────────────────────────────────
  db.exec(`
    UPDATE leads SET pipeline_stage = NULL
    WHERE pipeline_stage = 'tier_3'
      AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = leads.id)
      AND NOT EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = leads.id)
      AND NOT EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = leads.id);
  `);

  // Add temperature column
  if (!columns.some((c) => c.name === 'temperature')) {
    db.exec('ALTER TABLE leads ADD COLUMN temperature TEXT DEFAULT NULL');
  }

  // Add converted_to_project flag
  if (!columns.some((c) => c.name === 'converted_to_project')) {
    db.exec('ALTER TABLE leads ADD COLUMN converted_to_project INTEGER DEFAULT 0');
  }

  // Legacy: twilio_call_sid column on call_logs. Kept so historical rows
  // aren't broken; new rows insert NULL. Safe to ignore.
  const callLogColumns = db.prepare("PRAGMA table_info(call_logs)").all() as { name: string }[];
  if (!callLogColumns.some((c) => c.name === 'twilio_call_sid')) {
    db.exec('ALTER TABLE call_logs ADD COLUMN twilio_call_sid TEXT');
  }

  // Legacy Twilio support tables — retained so historical rows / future
  // schema migrations don't blow up. Not written to by current code.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_transcripts (
      call_sid TEXT PRIMARY KEY,
      transcript TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
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

  // Add deal_value column — annual / lifetime dollar value of this lead.
  // Used by the Reports page to surface pipeline value per tier.
  if (!columns.some((c) => c.name === 'deal_value')) {
    db.exec('ALTER TABLE leads ADD COLUMN deal_value REAL NOT NULL DEFAULT 0');
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

    -- Tasks table: scheduled follow-ups attached to leads. Each task can
    -- optionally mirror to a Google Calendar event (so Jordan / George
    -- see the work in their normal day-view). The calendar event id is
    -- stored so we can update / delete the event when the task changes.
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      due_date TEXT NOT NULL,             -- YYYY-MM-DD (date-only)
      google_calendar_event_id TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_lead       ON tasks(lead_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_due        ON tasks(due_date) WHERE completed = 0;

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

    -- Index for follow-up date queries (stage filter removed in May 2026
    -- pipeline simplification — any active tier can have a follow-up date).
    -- Drop the legacy partial index that filtered on the old 'follow_up' stage.
    DROP INDEX IF EXISTS idx_leads_follow_up_date;
    CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date
      ON leads(follow_up_date)
      WHERE follow_up_date IS NOT NULL;

    -- Settings table: key-value pairs for app configuration
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Categories: managed list of lead categories (dropdown values).
    -- Seeded with "Recruitment" — new categories added via Settings.
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT DEFAULT (datetime('now'))
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

    -- Draft attachments — file content stored as base64 blobs.
    -- Tied to a draft; deleted when the draft is discarded or the lead is removed.
    CREATE TABLE IF NOT EXISTS draft_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_base64 TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (draft_id) REFERENCES email_drafts(id) ON DELETE CASCADE
    );

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

  // ============================================================
  // CTA card configuration (manufacturing campaign onwards)
  //
  // Per-category capabilities CTA: extends category_prompts with the
  // URL, button label, and intro line for the blue "capabilities
  // document" button rendered in post-call follow-up emails. A row
  // with cta_doc_url IS NULL means no CTA available for that category
  // and the toggle stays hidden in the UI.
  //
  // Per-draft toggles on email_drafts: control which optional blocks
  // render at send time. After-call header defaults ON for Email Bank
  // drafts (post-call channel). Book-a-call defaults ON universally.
  // Capabilities defaults OFF at the DB level — flipped to ON in code
  // at draft creation when the lead's category has a CTA configured.
  // ============================================================
  addColumnIfMissing(db, 'category_prompts', 'cta_doc_url', 'TEXT');
  addColumnIfMissing(db, 'category_prompts', 'cta_doc_label', 'TEXT');
  addColumnIfMissing(db, 'category_prompts', 'cta_intro', 'TEXT');

  addColumnIfMissing(db, 'email_drafts', 'include_after_call_header', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'email_drafts', 'include_capabilities', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'email_drafts', 'include_book_a_call', 'INTEGER NOT NULL DEFAULT 1');
  // Second capabilities-style CTA. Jordan uses this to drop the broad
  // "View our capabilities" button (details.oxyscale.ai) while the
  // existing include_capabilities toggle drives the recruitment-specific
  // hook (info.oxyscale.ai). Either, both or neither can be on.
  addColumnIfMissing(db, 'email_drafts', 'include_secondary_doc', 'INTEGER NOT NULL DEFAULT 0');
  // Plain-text mode: when 1, render the email without the branded
  // OxyScale shell (header, editorial card, footer colophon) — just
  // the body text + signature + optionally the capabilities button.
  // Designed for outreach that should read as personal, not marketing.
  addColumnIfMissing(db, 'email_drafts', 'plain_text_mode', 'INTEGER NOT NULL DEFAULT 0');

  // ============================================================
  // Email engagement tracking — populated by Resend webhook events.
  // The gmail_message_id column doubles as the Resend email_id (legacy
  // name; reused when we migrated from Gmail-direct sends to Resend).
  //
  // Events we track:
  //   delivered  → delivered_at
  //   opened     → opened_at (first), last_opened_at, open_count
  //   clicked    → clicked_at (first), last_clicked_at, click_count
  //   bounced    → bounced_at
  // ============================================================
  // When an email is sent via Resend, a copy is inserted into Gmail's
  // Sent folder so it shows up in the user's mailbox. The Gmail message
  // ID of that copy is stored here so gmail-sync can skip it (dedup).
  addColumnIfMissing(db, 'emails_sent', 'gmail_copy_id', 'TEXT');

  addColumnIfMissing(db, 'emails_sent', 'delivered_at', 'TEXT');
  addColumnIfMissing(db, 'emails_sent', 'opened_at', 'TEXT');
  addColumnIfMissing(db, 'emails_sent', 'last_opened_at', 'TEXT');
  addColumnIfMissing(db, 'emails_sent', 'open_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'emails_sent', 'clicked_at', 'TEXT');
  addColumnIfMissing(db, 'emails_sent', 'last_clicked_at', 'TEXT');
  addColumnIfMissing(db, 'emails_sent', 'click_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'emails_sent', 'bounced_at', 'TEXT');

  // Index for "recently engaged" queries on the intelligence + email-bank
  // sent views — opens are by far the highest-volume event.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_emails_sent_last_opened
       ON emails_sent(last_opened_at DESC)
       WHERE last_opened_at IS NOT NULL`,
  );

  // Seed the categories table with "Recruitment" if it's empty.
  // Runs outside the DDL block to avoid mixing DML with CREATE TABLE
  // statements in the same db.exec() call.
  const catCount = (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  if (catCount === 0) {
    db.prepare("INSERT INTO categories (name) VALUES ('Recruitment')").run();
  }

  // NOTE (July 2026): the "Miller Leith Network" category seed was REMOVED.
  // Miller Leith is a lead SOURCE (how the lead arrived), not an industry
  // category (what the business does). The backfill below migrates it to
  // the lead_sources list and clears the category on those leads so Jordan
  // can set their real industry. Do not re-add the seed.

  // ============================================================
  // Lead sources — the channel a lead arrived through.
  //
  // Deliberately separate from `category` (the industry the business is
  // in). A Facebook ad brings in leads across many industries; keeping
  // the two on one field made the data unfilterable. Managed list, same
  // shape as `categories`, curated in Settings > Lead Sources.
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  addColumnIfMissing(db, 'leads', 'lead_source', 'TEXT DEFAULT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(lead_source)');

  // Seed the default source list once (empty table only, so Jordan's
  // edits/deletions in Settings are never resurrected on redeploy).
  const srcCount = (db.prepare('SELECT COUNT(*) AS n FROM lead_sources').get() as { n: number }).n;
  if (srcCount === 0) {
    const insertSrc = db.prepare('INSERT OR IGNORE INTO lead_sources (name) VALUES (?)');
    for (const s of [
      'Cold call',
      'Meta ad',
      'Google ad',
      'LinkedIn ad',
      'Miller-Leith network',
      'Jordan Bell network',
      'Jarrad Dowling network',
      'Referral',
    ]) {
      insertSrc.run(s);
    }
  }

  // Personal referral networks added July 2026, after the initial seed
  // had already run on production. Guarded by its own flag rather than
  // an unconditional INSERT OR IGNORE so that deleting one in Settings
  // doesn't resurrect it on the next deploy.
  const networksAdded = db
    .prepare("SELECT value FROM settings WHERE key = 'lead_sources_personal_networks_v1'")
    .get() as { value: string } | undefined;

  if (!networksAdded) {
    const addNetworks = db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO lead_sources (name) VALUES (?)');
      ins.run('Jordan Bell network');
      ins.run('Jarrad Dowling network');
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('lead_sources_personal_networks_v1', 'done', datetime('now'))",
      ).run();
    });
    addNetworks();
  }

  // One-time backfill, guarded by a settings flag so it runs exactly once
  // and never overwrites a source Jordan has set by hand afterwards.
  //
  //   1. Leads in the legacy "Miller Leith Network" CATEGORY are referrals
  //      from that network -> source = 'Miller-Leith network', and their
  //      category is CLEARED (it was never an industry; Jordan will set
  //      the real one per lead).
  //   2. Everything else predates the source field and came from scraped
  //      CSV lists -> 'Cold call'.
  //   3. The legacy category is then removed from the managed list.
  const backfillDone = db
    .prepare("SELECT value FROM settings WHERE key = 'lead_source_backfill_v1'")
    .get() as { value: string } | undefined;

  if (!backfillDone) {
    const runBackfill = db.transaction(() => {
      const millerLeith = db.prepare(`
        UPDATE leads SET lead_source = 'Miller-Leith network', category = NULL
        WHERE lead_source IS NULL
          AND category IS NOT NULL
          AND REPLACE(LOWER(category), '-', ' ') LIKE '%miller leith%'
      `).run();

      const coldCall = db.prepare(`
        UPDATE leads SET lead_source = 'Cold call' WHERE lead_source IS NULL
      `).run();

      db.prepare(
        "DELETE FROM categories WHERE REPLACE(LOWER(name), '-', ' ') LIKE '%miller leith%'",
      ).run();

      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('lead_source_backfill_v1', 'done', datetime('now'))",
      ).run();

      return { millerLeith: millerLeith.changes, coldCall: coldCall.changes };
    });

    const counts = runBackfill();
    console.log(
      `[schema] lead_source backfill: ${counts.millerLeith} -> Miller-Leith network (category cleared), ${counts.coldCall} -> Cold call`,
    );
  }

  // Tasks — add completed_at timestamp (May 2026). NULL until user manually
  // marks a task complete; used by the Tasks page to track completion history.
  addColumnIfMissing(db, 'tasks', 'completed_at', 'TEXT DEFAULT NULL');

  // Manual contacted override (May 2026). The "contacted" flag is normally
  // computed from notes/emails_sent/call_logs. This column lets Jordan
  // manually mark a lead as contacted (e.g. after saving a draft) without
  // needing a note/email/call row.
  addColumnIfMissing(db, 'leads', 'manually_contacted', 'INTEGER NOT NULL DEFAULT 0');

  // Last viewed timestamp (June 2026). Bumped on every GET /api/leads/:id
  // so the Leads page can default-sort by recent activity. Without this,
  // the page would always show the same leads at the top (whatever was
  // at queue_position = 1) regardless of where Jordan's actually been
  // working in the CRM.
  addColumnIfMissing(db, 'leads', 'last_viewed_at', 'TEXT DEFAULT NULL');

  // One-time (May 2026): set $10k default deal value for Pulse leads that
  // don't have one yet. Safe to re-run — only touches NULL/0 values.
  db.prepare(`
    UPDATE leads SET deal_value = 10000
    WHERE pipeline_stage = 'pulse'
      AND (deal_value IS NULL OR deal_value = 0)
  `).run();

  // ============================================================
  // Duplicate flags — populated by the duplicate scan.
  //
  // Each row is "suspect lead might be a duplicate of target lead, here
  // are the reasons, the user has/hasn't dismissed it yet."
  // - suspect_lead_id  : the row that's most likely the dup (untouched)
  // - target_lead_id   : the existing real contact it might belong to
  // - reasons          : JSON array of strings like ["phone match",
  //                      "name token: smaart"]
  // - confidence       : 'high' (phone/email/domain) or 'medium' (tokens)
  // - dismissed_at     : non-null = Jordan said "not a dup, leave alone"
  //
  // PRIMARY KEY (suspect, target) so re-running the scan upserts cleanly.
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS duplicate_flags (
      suspect_lead_id INTEGER NOT NULL,
      target_lead_id INTEGER NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      reasons TEXT NOT NULL DEFAULT '[]',
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      dismissed_at TEXT,
      PRIMARY KEY (suspect_lead_id, target_lead_id),
      FOREIGN KEY (suspect_lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (target_lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_duplicate_flags_suspect
      ON duplicate_flags(suspect_lead_id) WHERE dismissed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_duplicate_flags_target
      ON duplicate_flags(target_lead_id) WHERE dismissed_at IS NULL;
  `);
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
