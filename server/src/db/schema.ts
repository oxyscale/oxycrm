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
  //
  // The line that reset new_lead to NULL is GONE (Aug 2026). new_lead is
  // a real board column again — the first one — and CSV imports land
  // there. This statement was unguarded, so leaving it would have
  // emptied that column on every deploy.
  // ─────────────────────────────────────────────────────────────────
  db.exec(`
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
  // Guarded on the tables existing: notes and emails_sent are created
  // further down this function, so on a brand-new database (empty
  // volume, fresh deploy) this ran before they existed and threw,
  // stopping the server from booting at all.
  const cleanupTables = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('notes','emails_sent','call_logs')"
    )
    .get() as { n: number };

  if (cleanupTables.n === 3) {
    db.exec(`
      UPDATE leads SET pipeline_stage = NULL
      WHERE pipeline_stage = 'tier_3'
        AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.lead_id = leads.id)
        AND NOT EXISTS (SELECT 1 FROM emails_sent WHERE emails_sent.lead_id = leads.id)
        AND NOT EXISTS (SELECT 1 FROM call_logs WHERE call_logs.lead_id = leads.id);
    `);
  }

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
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
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
  // projects.lead_id is SET NULL, deliberately NOT cascade. The column is
  // nullable, and a project is a real delivery record with its own tasks
  // and retainer history. Cascading meant the Wrong Number disposition
  // (which hard-deletes a lead) silently destroyed live client records.
  // Losing the link back to the lead is recoverable; losing the client
  // is not.
  retrofitCascadeIfMissing(db, 'projects', 'lead_id', 'leads', 'SET NULL');
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

  // Campaign attribution — one level below lead_source. Source says
  // "Meta ad"; campaign says WHICH offer, and campaign_content says
  // which creative/angle within it. Populated from utm_campaign /
  // utm_content on import.
  //
  // Deliberately NOT a managed list like lead_sources: campaign names
  // come from the ad platform, so requiring Jordan to pre-create each
  // one in Settings would just block imports. The filter dropdown is
  // built from distinct values instead.
  addColumnIfMissing(db, 'leads', 'campaign', 'TEXT DEFAULT NULL');
  addColumnIfMissing(db, 'leads', 'campaign_content', 'TEXT DEFAULT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign)');

  // Stable id from the upstream system (Meta's submission_id, a form
  // entry id, etc). This is what makes re-importing a continuously-
  // growing export safe: rows already carrying a known external_id are
  // skipped instead of creating a second copy of the same person.
  // Partial index because the vast majority of rows (CSV scrapes,
  // manual creates) have none.
  addColumnIfMissing(db, 'leads', 'external_id', 'TEXT DEFAULT NULL');
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_leads_external_id
       ON leads(external_id) WHERE external_id IS NOT NULL`,
  );

  // Display ordering for the source dropdowns. Lower sorts first, ties
  // broken alphabetically. The main channels carry an explicit order
  // (Jordan's preference, not alphabetical); networks sit in a trailing
  // group at 100 where they stay alphabetical among themselves, so a
  // newly-added network slots in sensibly without a manual reorder.
  addColumnIfMissing(db, 'lead_sources', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');

  // Canonical ordering. Referenced by both the fresh-install seed and
  // the migration below so the two can never disagree.
  const SOURCE_ORDER: [string, number][] = [
    ['Meta ad', 10],
    ['LinkedIn ad', 20],
    ['Cold call', 30],
    ['Client referral', 40],
    ['Organic', 50],
    // 90 is the landing spot for any new non-network source: end of the
    // main group, still above the networks.
    ['Miller-Leith network', 100],
    ['Jordan Bell network', 100],
    ['Jarrad Dowling network', 100],
  ];

  // Seed the default source list once (empty table only, so Jordan's
  // edits/deletions in Settings are never resurrected on redeploy).
  const srcCount = (db.prepare('SELECT COUNT(*) AS n FROM lead_sources').get() as { n: number }).n;
  if (srcCount === 0) {
    const insertSrc = db.prepare(
      'INSERT OR IGNORE INTO lead_sources (name, sort_order) VALUES (?, ?)',
    );
    for (const [name, order] of SOURCE_ORDER) {
      insertSrc.run(name, order);
    }
  }

  // August 2026: the three working tiers collapse into a single "Hot"
  // stage, and "Meeting booked" joins the board.
  //   Tier 1 / Tier 2 -> Hot   (both were actively-worked stages)
  //   Tier 3          -> Pulse (the coldest tier; Pulse is the warm-but-
  //                             not-active bucket, which is what it was)
  // Guarded so a lead Jordan moves afterwards isn't dragged back.
  const stagesV3 = db
    .prepare("SELECT value FROM settings WHERE key = 'pipeline_stages_v3'")
    .get() as { value: string } | undefined;

  if (!stagesV3) {
    const migrateStages = db.transaction(() => {
      const hot = db.prepare(
        "UPDATE leads SET pipeline_stage = 'hot' WHERE pipeline_stage IN ('tier_1', 'tier_2')",
      ).run();
      const pulse = db.prepare(
        "UPDATE leads SET pipeline_stage = 'pulse' WHERE pipeline_stage = 'tier_3'",
      ).run();
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('pipeline_stages_v3', 'done', datetime('now'))",
      ).run();
      return { hot: hot.changes, pulse: pulse.changes };
    });
    const c = migrateStages();
    if (c.hot || c.pulse) {
      console.log(`[schema] pipeline stages: ${c.hot} tier_1/2 -> hot, ${c.pulse} tier_3 -> pulse`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Stage rework (Aug 2026): 'hot' retired, 'new_lead' reinstated as the
  // first board column. Board order is now New lead, Meeting booked,
  // Proposal sent, Pulse, Won, Lost.
  //
  // Anything sitting in 'hot' moves to 'new_lead' — it would otherwise be
  // stranded in a column that no longer renders, invisible on the board
  // but still counted by reports.
  //
  // Leads with NO stage are deliberately left alone. NULL still means
  // "kept out of the pipeline on purpose", which is a state Jordan uses.
  // ─────────────────────────────────────────────────────────────────
  const stagesV4 = db
    .prepare("SELECT value FROM settings WHERE key = 'pipeline_stages_v4'")
    .get() as { value: string } | undefined;

  if (!stagesV4) {
    try {
      const moved = db
        .prepare("UPDATE leads SET pipeline_stage = 'new_lead' WHERE pipeline_stage = 'hot'")
        .run();
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('pipeline_stages_v4', 'done', datetime('now'))",
      ).run();
      if (moved.changes) {
        // eslint-disable-next-line no-console
        console.log(`[schema] pipeline stages: ${moved.changes} hot -> new_lead`);
      }
    } catch (err) {
      // A failed migration must never stop the server booting.
      // eslint-disable-next-line no-console
      console.error('[schema] hot -> new_lead migration failed:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Aug 2026: call_logs.disposition becomes nullable.
  //
  // A manually pasted transcript is not a call outcome, but the column
  // was NOT NULL so that path wrote 'interested' to satisfy it. Every
  // pasted transcript therefore counted as an interested call and the
  // disposition breakdown was meaningless. Those rows now store NULL and
  // are excluded from outcome stats.
  //
  // Same writable_schema rewrite used elsewhere in this file — no child
  // tables reference call_logs, so nothing needs rebuilding.
  // ─────────────────────────────────────────────────────────────────
  const dispositionInfo = (
    db.prepare('PRAGMA table_info(call_logs)').all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === 'disposition');

  if (dispositionInfo && dispositionInfo.notnull === 1) {
    try {
      const row = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'call_logs'"
      ).get() as { sql: string } | undefined;
      const newSql = row?.sql?.replace(
        /(["']?disposition["']?\s+TEXT)\s+NOT\s+NULL/i,
        '$1',
      );
      if (row?.sql && newSql && newSql !== row.sql) {
        db.unsafeMode(true);
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('PRAGMA writable_schema = ON');
        db.prepare(
          "UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'call_logs'"
        ).run(newSql);
        db.exec('PRAGMA writable_schema = OFF');
        db.exec('PRAGMA foreign_keys = ON');
        db.unsafeMode(false);
        const sv = db.pragma('schema_version', { simple: true }) as number;
        db.pragma(`schema_version = ${sv + 1}`);
        // eslint-disable-next-line no-console
        console.log('[schema] call_logs.disposition is now nullable');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[schema] disposition nullable migration failed:', err);
    }
  }

  // ============================================================
  // Suppression list — contacts deliberately removed.
  //
  // Jordan re-uploads a master spreadsheet that keeps growing, so a lead
  // he deletes would simply reappear on the next import. Deleting one
  // now records its identifiers here, and the importer skips any row
  // matching them. Clearing a row re-admits that contact.
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppressed_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT,
      email TEXT,
      phone_key TEXT,             -- digits only, last 9 (see phoneKey)
      name TEXT,
      company TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_suppressed_external ON suppressed_contacts(external_id);
    CREATE INDEX IF NOT EXISTS idx_suppressed_email    ON suppressed_contacts(email);
    CREATE INDEX IF NOT EXISTS idx_suppressed_phone    ON suppressed_contacts(phone_key);
  `);

  // One-time: relabel notes the CSV importer created before it started
  // attributing them to 'Import'. They were stamped with the importing
  // user's name, which made every imported lead register as "contacted"
  // — a note is normally evidence Jordan spoke to someone, but a note
  // transcribed from a lead form isn't.
  //
  // Identified as: the lead's ONLY note, written within 10 seconds of
  // the lead itself. Nobody hand-types a note that fast.
  const importNotesRelabelled = db
    .prepare("SELECT value FROM settings WHERE key = 'import_notes_relabelled_v1'")
    .get() as { value: string } | undefined;

  if (!importNotesRelabelled) {
    const relabel = db.transaction(() => {
      const r = db.prepare(`
        UPDATE notes SET created_by = 'Import'
        WHERE created_by != 'Import'
          AND (SELECT COUNT(*) FROM notes n2 WHERE n2.lead_id = notes.lead_id) = 1
          AND ABS(julianday(created_at) - julianday(
                (SELECT l.created_at FROM leads l WHERE l.id = notes.lead_id)
              )) * 86400 < 10
      `).run();
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('import_notes_relabelled_v1', 'done', datetime('now'))",
      ).run();
      return r.changes;
    });
    const n = relabel();
    if (n > 0) console.log(`[schema] relabelled ${n} importer-created note(s) to 'Import'`);
  }

  // ============================================================
  // Client lifecycle + retainers (July 2026)
  //
  // OxyScale charges a monthly retainer, no build fees. A single
  // one-off `value` on a project can't express that, so money now
  // lives in a dated retainer history:
  //
  //   current retainer = latest row with effective_from <= today
  //   MRR              = sum of current retainers over live clients
  //   ARR              = MRR * 12
  //
  // Storing every change as its own row (rather than overwriting one
  // number) is what makes "what were we billing in March" answerable,
  // and separates growth from existing clients expanding.
  // ============================================================
  // Keyed to the LEAD (the client company), not to a project. A client
  // has one monthly retainer that moves up or down as they add or drop
  // services; the projects are the work log, not the billing unit. An
  // active client commissioning extra work gets another project and a
  // bumped retainer, not a second invoice line.
  //
  // The first cut of this table keyed rows to project_id. Rebuild it
  // if that older shape is present, carrying rows over via the owning
  // project's lead. SQLite can't drop a NOT NULL column in place, so
  // this is the rename/copy/drop dance.
  const retainerTableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='client_retainers'",
  ).get();
  const retainerCols = retainerTableExists
    ? (db.prepare('PRAGMA table_info(client_retainers)').all() as { name: string }[])
    : [];
  const needsRetainerRebuild =
    retainerTableExists
    && retainerCols.some((c) => c.name === 'project_id')
    && !retainerCols.some((c) => c.name === 'lead_id');

  if (needsRetainerRebuild) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec('ALTER TABLE client_retainers RENAME TO client_retainers_by_project');
        db.exec(`
          CREATE TABLE client_retainers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            monthly_amount REAL NOT NULL,
            effective_from TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_by TEXT,
            FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
          );
        `);
        db.exec(`
          INSERT INTO client_retainers (lead_id, monthly_amount, effective_from, note, created_at, created_by)
          SELECT p.lead_id, r.monthly_amount, r.effective_from, r.note, r.created_at, r.created_by
          FROM client_retainers_by_project r
          JOIN projects p ON p.id = r.project_id
          WHERE p.lead_id IS NOT NULL
        `);
        db.exec('DROP TABLE client_retainers_by_project');
      })();
      console.log('[schema] client_retainers re-keyed from project to lead');
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS client_retainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      monthly_amount REAL NOT NULL,
      effective_from TEXT NOT NULL,          -- YYYY-MM-DD (date-only)
      note TEXT,                             -- why it changed
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_client_retainers_lead
      ON client_retainers(lead_id, effective_from DESC);
  `);

  // ─────────────────────────────────────────────────────────────────
  // A single definition of "what is this client paying today".
  //
  // The rule (latest row effective on or before today, ties broken by id)
  // had been copy-pasted into the leads list route and nowhere else, so
  // the Pipeline, Reports and Home pages had no access to retainers at
  // all and silently fell back to leads.deal_value — which is 0 for
  // anyone who became a client, since the conversion flow never writes
  // it. A client on $3,100/mo showed no money anywhere but the Active
  // and Leads pages.
  //
  // As a view, every query joins the same rule and they cannot drift.
  // ─────────────────────────────────────────────────────────────────
  db.exec(`
    DROP VIEW IF EXISTS current_retainers;
    CREATE VIEW current_retainers AS
      SELECT cr.lead_id, cr.monthly_amount, cr.effective_from
        FROM client_retainers cr
       WHERE cr.effective_from <= DATE('now')
         AND cr.id = (
              SELECT x.id FROM client_retainers x
               WHERE x.lead_id = cr.lead_id
                 AND x.effective_from <= DATE('now')
               ORDER BY x.effective_from DESC, x.id DESC
               LIMIT 1
         );
  `);

  // When the build went live. `end_date` was being (mis)used for this,
  // which meant an active client displayed an "End" date. Separate column
  // so the two can't be confused, and so the free-period countdown has
  // something honest to count from.
  addColumnIfMissing(db, 'projects', 'live_from', 'TEXT');
  // Length of any complimentary period after go-live. Retained for a
  // later revision — nothing reads it today.
  addColumnIfMissing(db, 'projects', 'free_days', 'INTEGER NOT NULL DEFAULT 30');
  // Upfront fee charged to build the thing, separate from the monthly
  // retainer. One-off, per project, so a client commissioning two builds
  // records two fees. Deliberately NOT the legacy `value` column — an
  // earlier migration seeded retainers from that, so reusing it would
  // double-count anyone caught by it.
  addColumnIfMissing(db, 'projects', 'build_fee', 'REAL NOT NULL DEFAULT 0');

  // Backfill go-live dates for clients who were already live before the
  // column existed. Until Aug 2026 the go-live handler stamped end_date,
  // so that value IS the go-live date for anything currently live —
  // move it across and clear it, since a live client has not ended.
  // Anything with no date at all falls back to the project start.
  const liveFromBackfill = db
    .prepare("SELECT value FROM settings WHERE key = 'project_live_from_v1'")
    .get() as { value: string } | undefined;

  if (!liveFromBackfill) {
    try {
      db.exec(`
        UPDATE projects
           SET live_from = COALESCE(end_date, start_date, DATE(created_at)),
               end_date = NULL
         WHERE status = 'live' AND live_from IS NULL;
      `);
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('project_live_from_v1', ?)"
      ).run(new Date().toISOString());
      // eslint-disable-next-line no-console
      console.log('[schema] Backfilled projects.live_from for live clients');
    } catch (err) {
      // A failed backfill must never stop the server booting.
      // eslint-disable-next-line no-console
      console.error('[schema] live_from backfill failed:', err);
    }
  }

  // Project notes. The detail page has always POSTed a `notes` field
  // with nowhere to store it — the update schema stripped it, the
  // server 400'd on "no valid fields", and the client swallowed the
  // error. The textarea looked like it saved and never did.
  addColumnIfMissing(db, 'projects', 'notes', 'TEXT');

  // Project status simplifies to two states: it's being built, or it's
  // live and the client is on a retainer. Jordan explicitly didn't want
  // a build-stage kanban yet (George will shape that later), and the
  // column stays free-text so finer stages can be added with no
  // migration. Legacy values are folded in.
  const projectStatusDone = db
    .prepare("SELECT value FROM settings WHERE key = 'project_status_v2'")
    .get() as { value: string } | undefined;

  if (!projectStatusDone) {
    const migrateStatus = db.transaction(() => {
      db.prepare(
        "UPDATE projects SET status = 'building' WHERE status IN ('onboarding', 'in_progress', 'review')",
      ).run();
      db.prepare("UPDATE projects SET status = 'live' WHERE status = 'complete'").run();
      // Seed a retainer for any linked client carrying a legacy value,
      // so MRR isn't zero the moment the feature ships.
      db.prepare(`
        INSERT INTO client_retainers (lead_id, monthly_amount, effective_from, note, created_by)
        SELECT p.lead_id, p.value, COALESCE(p.start_date, DATE(p.created_at)), 'Migrated from project value', 'System'
        FROM projects p
        WHERE p.value > 0 AND p.lead_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM client_retainers r WHERE r.lead_id = p.lead_id)
      `).run();
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('project_status_v2', 'done', datetime('now'))",
      ).run();
    });
    migrateStatus();
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

  // July 2026: push the network sources into the trailing display group
  // and rename the generic "Referral" to "Client referral". Guarded so a
  // later manual reorder or rename in Settings isn't undone on redeploy.
  const sourceOrderingDone = db
    .prepare("SELECT value FROM settings WHERE key = 'lead_sources_ordering_v1'")
    .get() as { value: string } | undefined;

  if (!sourceOrderingDone) {
    const applyOrdering = db.transaction(() => {
      db.prepare(
        "UPDATE lead_sources SET sort_order = 100 WHERE LOWER(name) LIKE '%network%'",
      ).run();

      // Rename in the managed list AND re-stamp any leads already
      // carrying the old string, so the two never drift apart.
      const renamed = db.prepare(
        "UPDATE lead_sources SET name = 'Client referral' WHERE LOWER(name) = 'referral'",
      ).run();
      if (renamed.changes > 0) {
        db.prepare(
          "UPDATE leads SET lead_source = 'Client referral' WHERE LOWER(lead_source) = 'referral'",
        ).run();
      }

      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('lead_sources_ordering_v1', 'done', datetime('now'))",
      ).run();
    });
    applyOrdering();
  }

  // July 2026 (v2): Jordan's explicit channel order, replacing the
  // alphabetical main group. Adds "Organic" and retires "Google ad"
  // (not running Google at the moment). Guarded separately from v1 so
  // a later manual reorder in Settings survives redeploys.
  const sourceOrderingV2 = db
    .prepare("SELECT value FROM settings WHERE key = 'lead_sources_ordering_v2'")
    .get() as { value: string } | undefined;

  if (!sourceOrderingV2) {
    const applyOrderingV2 = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO lead_sources (name, sort_order) VALUES (?, ?)')
        .run('Organic', 50);

      const setOrder = db.prepare(
        'UPDATE lead_sources SET sort_order = ? WHERE LOWER(name) = LOWER(?)',
      );
      for (const [name, order] of SOURCE_ORDER) {
        setOrder.run(order, name);
      }
      // Anything not named above (e.g. a source Jordan added himself)
      // lands at the end of the main group rather than jumping to front.
      db.prepare(`
        UPDATE lead_sources SET sort_order = 90
        WHERE sort_order = 0 AND LOWER(name) NOT LIKE '%network%'
      `).run();

      // Retire Google ad — but only when nothing is tagged with it.
      // Deleting a source never deletes leads, though leaving a lead
      // pointing at a string with no dropdown entry is a papercut worth
      // avoiding. If it IS in use we keep it and say so in the log.
      const googleInUse = db.prepare(
        "SELECT COUNT(*) AS n FROM leads WHERE LOWER(lead_source) = 'google ad'",
      ).get() as { n: number };
      if (googleInUse.n === 0) {
        db.prepare("DELETE FROM lead_sources WHERE LOWER(name) = 'google ad'").run();
      } else {
        console.log(
          `[schema] kept "Google ad" source — ${googleInUse.n} lead(s) still tagged with it`,
        );
      }

      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('lead_sources_ordering_v2', 'done', datetime('now'))",
      ).run();
    });
    applyOrderingV2();
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

  // REMOVED (July 2026): a backfill that stamped deal_value = 10000 on
  // every Pulse lead with no value. It was labelled "one-time" but was
  // never guarded, so it re-ran on every boot — clearing a value to 0
  // silently restored the $10k on the next deploy, and the Pipeline and
  // Home pages were reporting a pipeline figure largely made of it.
  //
  // Invented numbers are worse than blank ones: a lead with no estimate
  // should read as unset, not as $10k of forecast. Money for clients now
  // comes from the dated retainer history instead.
  //
  // Existing $10k values are left alone on purpose — some may since have
  // been set deliberately, and overwriting real data to undo fake data
  // is Jordan's call, not a migration's.

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

  // ============================================================
  // Investor Report
  //
  // Self-contained: nothing here touches leads, projects or the stage
  // model. The report READS the CRM and stores only its own manual
  // inputs and locked monthly snapshots.
  // ============================================================
  db.exec(`
    -- Report-level settings. Kept apart from the app 'settings' table so
    -- the report's knobs are obvious and can't collide.
    CREATE TABLE IF NOT EXISTS investor_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- One row per month. 'draft' is editable; 'final' freezes a JSON
    -- snapshot so a report already sent to shareholders can never change
    -- underneath them when CRM data moves.
    CREATE TABLE IF NOT EXISTS investor_months (
      month              TEXT PRIMARY KEY,      -- YYYY-MM
      bank_balance       REAL,
      live_mrr_override  REAL,                  -- NULL = trust the CRM
      pot_wages_drawn    REAL NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'draft',
      snapshot           TEXT,                  -- JSON, written on finalise
      finalised_at       TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Itemised payments out of the $30k ring fence.
    CREATE TABLE IF NOT EXISTS investor_ringfence_payments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      paid_on    TEXT NOT NULL,                 -- YYYY-MM-DD
      item       TEXT NOT NULL,
      amount     REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Carries forward month to month until the status changes.
    CREATE TABLE IF NOT EXISTS investor_planned_spend (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      item           TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      timing         TEXT,
      purpose        TEXT,
      status         TEXT NOT NULL DEFAULT 'proposed',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Carries forward until closed.
    CREATE TABLE IF NOT EXISTS investor_risks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      risk       TEXT NOT NULL,
      mitigation TEXT,
      status     TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ringfence_paid_on
      ON investor_ringfence_payments(paid_on);
  `);

  // Defaults, written once. Changing them later is a settings edit, not
  // a code change — the 60-day lead time in particular lives in exactly
  // one place so it can be corrected without hunting through queries.
  const investorDefaults: Array<[string, string]> = [
    ['revenue_lead_days', '60'],
    ['monthly_cost_base', '0'],
    ['pot_ringfence_total', '30000'],
    ['pot_wages_total', '90000'],
    ['forecast_mrr_6', '0'],
    ['forecast_mrr_12', '0'],
    ['forecast_note', ''],
    ['distribution_list', JSON.stringify([
      'stephen.borg@example.com',
      'joe.sette@example.com',
      'jarrad.dowling@example.com',
      'george@oxyscale.ai',
    ])],
  ];
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO investor_settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of investorDefaults) insertSetting.run(k, v);

  // Seed the risks the spec calls out, once. Status changes from here on
  // are the user's, so this must never re-run and resurrect a closed row.
  const risksSeeded = db
    .prepare("SELECT value FROM settings WHERE key = 'investor_risks_seeded_v1'")
    .get() as { value: string } | undefined;

  if (!risksSeeded) {
    try {
      const insertRisk = db.prepare(
        'INSERT INTO investor_risks (risk, mitigation, status) VALUES (?, ?, ?)'
      );
      insertRisk.run(
        'Delivery capacity concentrated in one person',
        'Document build process; identify an offshore data resource to take overflow.',
        'open',
      );
      insertRisk.run(
        'Founder working hours',
        'Prioritise automation of repeat build steps to reduce hours per client.',
        'open',
      );
      insertRisk.run(
        'Client concentration',
        'Broaden the pipeline across industries so no single client dominates revenue.',
        'open',
      );
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('investor_risks_seeded_v1', ?)"
      ).run(new Date().toISOString());
      console.log('[schema] Seeded investor report starting risks');
    } catch (err) {
      console.error('[schema] investor risk seed failed:', err);
    }
  }
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
  onDelete: 'CASCADE' | 'SET NULL' = 'CASCADE',
): void {
  const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
  const existing = fks.find((f) => f.from === fkColumn && f.table === parentTable);
  if (!existing) return;
  if (existing.on_delete === onDelete) return; // already correct

  // Look up the original CREATE TABLE so we can rebuild it byte-for-byte
  // with the FK clause swapped. Falling back to the parsed PRAGMA info
  // would risk losing column defaults / collation hints.
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(table) as { sql: string } | undefined;
  if (!row?.sql) return;

  // Matches the FK clause whether or not it already carries an ON DELETE
  // action, so this can swap CASCADE -> SET NULL as well as add a missing
  // clause. (The original only matched the no-clause case.)
  const fkPattern = new RegExp(
    `FOREIGN KEY\\s*\\(\\s*${fkColumn}\\s*\\)\\s*REFERENCES\\s+${parentTable}\\s*\\(\\s*id\\s*\\)` +
      `(\\s*ON DELETE\\s+(?:CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))?`,
    'i',
  );
  const newSql = row.sql.replace(
    fkPattern,
    `FOREIGN KEY (${fkColumn}) REFERENCES ${parentTable}(id) ON DELETE ${onDelete}`,
  );
  if (newSql === row.sql) return; // pattern didn't match — bail safely

  // SQLite's officially supported pattern for changing constraints:
  // turn FK enforcement off, swap the table inside one transaction.
  // Rewrite the CREATE to target a temp table name. The stored DDL may
  // quote the table name ("projects") — SQLite writes it that way after
  // an ALTER TABLE RENAME — so plain string replacement of
  // `CREATE TABLE ${table}` silently misses and we'd then execute a
  // CREATE using the LIVE name, which collides and takes the process
  // down on boot. Match optional IF NOT EXISTS and any quoting style.
  const tmpTable = `${table}_new_cascade_migration`;
  const createPattern = new RegExp(
    `^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"${table}"|'${table}'|\`${table}\`|\\[${table}\\]|${table})`,
    'i',
  );
  const tmpSql = newSql.replace(createPattern, `CREATE TABLE ${tmpTable}`);
  if (tmpSql === newSql || !tmpSql.includes(tmpTable)) {
    // Couldn't safely retarget the statement — leave the table alone
    // rather than risk executing a CREATE against the live name.
    console.warn(
      `[schema] skipped ON DELETE ${onDelete} retrofit for ${table}: could not rewrite CREATE statement`,
    );
    return;
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(tmpSql);
      db.exec(`INSERT INTO ${tmpTable} SELECT * FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${tmpTable} RENAME TO ${table}`);
    })();
    console.log(`[schema] ${table}.${fkColumn} FK set to ON DELETE ${onDelete}`);
  } catch (err) {
    // A failed retrofit must never stop the server booting. The old
    // constraint stays in place and we carry on.
    console.error(`[schema] ON DELETE ${onDelete} retrofit failed for ${table}:`, (err as Error).message);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
