# OxyCRM Handover — May 2026 (v3, full session record)

This is the comprehensive handover for any fresh Claude session picking up
work on OxyCRM. Read this together with `CLAUDE.md` and
`docs/PROJECT_CONTEXT.md`. This file is the single source of truth for
"what state is the app in right now" and "what conventions must I follow".

> **Working directory:** the real repo lives in
> `/Users/jordanbell/Projects/Oxyscale/internal-apps/Oxyscale-dialler/code/`.
> Open Claude from there. The git repo, `CLAUDE.md`, `docs/`, `client/`,
> `server/`, `shared/` all live in `code/`.

---

## TABLE OF CONTENTS

1. Who Jordan is + how he works
2. Production stack
3. Folder map
4. Product shape — every page
5. Cold-calling workflow (what Jordan actually does day-to-day)
6. Pipeline model (canonical stages + the 7 places to update)
7. Data model — every table + key columns
8. Concepts that are DEAD — do NOT reintroduce
9. Conventions (dates, brand, code, business rules)
10. API endpoint inventory
11. File map (added + removed in this session)
12. Deploy / git / build quirks
13. The full bug + feature log from this session
14. Known leftovers / tech debt
15. Common gotchas (the things that bit us)
16. Posture for the next session
17. First-message template for a fresh chat

---

## 1. Who Jordan is + how he works

- **Non-technical founder.** Runs business + product. He shouldn't have to
  read code unless he asks. Plain English over jargon. Concise updates
  over walls of text. 3-sentence summaries beat code diffs.
- **George** is his co-founder. Same posture.
- Iterates fast — ship small, push often, no preflight questions for
  trivial calls. DO ask before destructive ops (force-push, drop table,
  bulk delete, anything that can't be undone).
- Uses **Wispr Flow** on Mac for system-wide dictation.
- Calls happen on his **personal mobile**. Not in the browser. Twilio is
  gone for good.
- Git auth is set up via PAT in macOS Keychain. Pushes from his terminal
  just work. If a fresh terminal ever prompts: username `oxyscale`,
  password the keychain'd PAT.
- He gets fooled by browser cache constantly — always remind him to
  hard refresh (Cmd+Shift+R) after a UI push.

---

## 2. Production stack (DO NOT swap)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 6 + TypeScript + Tailwind 3 |
| Backend | Node 18 + Express 4 + TypeScript (run via `tsx`, not compiled) |
| DB | SQLite via `better-sqlite3`. Persistent volume on Railway at `/data` |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) — summaries, email drafts |
| Email | Resend API (branded HTML, always `text` + `html`) |
| Calendar | Google Calendar API (OAuth, tokens in `data/google-tokens.json`) |
| Auth | Cookie session, bcrypt passwords, rate-limited |
| Deploy | Railway → `main` branch auto-deploys (~60s normally, ~2 min on dep changes) |

**Twilio is GONE.** Don't reintroduce browser-based calling.
**Monday.com is GONE.** OxyCRM is the source of truth.

---

## 3. Folder map (relative to `code/`)

```
code/
├── CLAUDE.md                       # Top-level Claude instructions
├── docs/
│   ├── PROJECT_CONTEXT.md          # Deep architectural reference
│   └── HANDOFF.md                  # This file
├── client/                         # React SPA
│   ├── src/
│   │   ├── components/             # Layout, SearchBar, EmailThread, etc.
│   │   ├── pages/                  # One file per route
│   │   ├── hooks/                  # useAuth, useDiallerSession (legacy)
│   │   ├── services/api.ts         # All HTTP calls live here
│   │   ├── types.ts                # Re-exports shared/types
│   │   └── utils/                  # dates, text, emailTemplate, names, recentLeads
│   └── package.json
├── server/                         # Express API
│   ├── .env                        # SECRETS — NEVER commit
│   └── src/
│       ├── routes/                 # One file per resource
│       ├── services/               # ai-summary, emailTemplate, gmail-sync, google-calendar
│       ├── db/schema.ts            # SQLite schema + every migration
│       ├── prompts/                # AI prompt templates
│       ├── util/                   # dataDir, dates (todayInSydney)
│       └── middleware/             # auth, errorHandler
├── shared/types.ts                 # TS types shared client+server. SOURCE OF TRUTH.
├── package.json                    # Root — build + start scripts
└── railway.json
```

---

## 4. Product shape — every page

| Path | Page | Purpose |
|---|---|---|
| `/login`, `/reset-password` | Auth | Cookie session |
| `/` | HomePage | Lead intake (Create / Import CSV), today's queue, KPIs, recent activity |
| `/pipeline` | PipelinePage | Kanban: **Tier 1 / Tier 2 / Tier 3 / Pulse / Won / Lost**. Per-column $ totals. Category filter. "Unplaced" hint when NULL-stage leads exist. |
| `/leads` | LeadsPage | Sortable table of every lead with search + category + status filters. Filter state persists in URL. |
| `/leads/:id` | LeadProfilePage | Profile: contact info, Email/Book Meeting/Add Note/Set Task action bar, tabs (Activity / Transcripts / Notes / Emails), sidebar (Lead Details, Tasks, Activity Stats, Project link) |
| `/tasks` | TasksPage | Global tasks view. Tabs: Overdue / Due Today / Upcoming / Completed. Quick 2w/4w/6w/8w reschedule on each row. |
| `/email-bank` | EmailBankPage | Post-call AI email drafts queue (legacy-ish but still works) |
| `/compose/:leadId` | ComposeEmailPage | Manual email composer with AI assist. Auto-reads transcript from sessionStorage if user came from Transcripts tab. |
| `/book-meeting/:leadId` | BookMeetingPage | Calendar event creation |
| `/projects` | ProjectsPage | Won leads converted to active jobs |
| `/projects/:id` | ProjectDetailPage | Project status, deliverables |
| `/reports` | ReportsPage | **Investor pulse-check view** — date range + category filter + KPI strip + tier $ breakdown + new leads + won/lost + tasks due. |
| `/report` | PrintReportPage | Single-page printable version of the Report. Used by Reports → Download PDF. |
| `/settings` | SettingsPage | Category Prompts, Company Profile, Email Preferences, Email Signature, **Lead Cleanup**, Account |

### Pages REMOVED from the product
- `/dialler` — was a 1031-line Twilio softphone; replaced with a slim browser then fully nuked
- `/intelligence` — DEPRECATED, no longer in the app
- `/dashboard` — DEPRECATED, no longer in the app

---

## 5. Cold-calling workflow (Jordan's actual day-to-day)

This is the loop the whole app is optimised for. Don't break it.

```
1. Open /leads → filter pill set to "Not Contacted"
2. Click into a lead row → opens /leads/:id (profile)
   → Leads URL `/leads?status=not_contacted` is saved to sessionStorage
3. On the profile: click the website link → opens company site in new tab
4. Find a director's mobile on their site → click the phone field on the
   profile → paste director's mobile → Enter (saves inline)
5. Call them on his personal mobile (NOT in browser)
6. While on the call, focus the Transcripts tab textarea
   → trigger Wispr Flow → dictate the conversation
7. Click "Save Transcript" OR "Save and Draft Email"
   - Save Transcript: records a call_log row, no other state change
   - Save and Draft Email: same + navigates to /compose/:leadId with the
     transcript stashed in sessionStorage. Compose page auto-fires Claude
     draft using the transcript as primary context.
8. Click "Set Task" → enter label + due date (or hit the 2w/4w/6w/8w
   quick pills) → saves a task + drops a Google Calendar event at 9am
   Sydney on that day.
9. Click "Back to leads" → returns to /leads with the Not Contacted
   filter STILL applied (sessionStorage restore)
10. Next lead. Repeat.
```

**Fortnightly investor pulse check:**
- Open /reports
- Pick date range (defaults to last 14 days, or use 7/14/30/90/MTD/YTD presets)
- Optional category filter
- Click "Download PDF" → opens /report with same params → print/save as PDF
- Send to investors

---

## 6. Pipeline model (canonical)

### Stage values
```typescript
type PipelineStage = 'tier_1' | 'tier_2' | 'tier_3' | 'pulse' | 'won' | 'lost';
// + pipelineStage can be NULL on a Lead — lead exists in /leads but is
//   NOT placed on the kanban.
```

### Meaning
| Stage | Definition |
|---|---|
| `tier_1` | Hot, probably gonna close them |
| `tier_2` | Working on them |
| `tier_3` | Light intro, not sure where they're at |
| `pulse` | Spoken to but not actively pursued — keep them warm |
| `won` | Closed deal |
| `lost` | Dead |
| `NULL` | Not yet triaged into a tier (default for new leads & CSV imports) |

### Column order on the kanban (left → right)
`Tier 1 → Tier 2 → Tier 3 → Pulse → Won → Lost`

(This is intentional — Jordan reordered Pulse to sit AFTER Tier 3 in the latest pass.)

### When you add or change a stage value, update ALL 7 places:
1. `shared/types.ts` (`PipelineStage` type)
2. `server/src/routes/leads.ts` (createLeadSchema + updateLeadSchema zod enums)
3. `server/src/routes/pipeline.ts` (`PIPELINE_STAGES` array + `stageLabels`)
4. `client/src/pages/LeadProfilePage.tsx` (`PIPELINE_STAGES` array)
5. `client/src/pages/HomePage.tsx` (`STAGE_CONFIG`)
6. `client/src/pages/PipelinePage.tsx` (`STAGES` array — column order lives here)
7. `client/src/pages/SearchBar.tsx` (`stageLabel` function) + `client/src/pages/ReportsPage.tsx` (`TIER_LABELS`) + `server/src/routes/reports.ts` (`TIER_LABELS` + the SQL `IN (...)` filters)

Missing any one = silent 400 / missing-label fallback.

### Triage flow
- New leads (CSV import or manual create) default to **NULL** stage
- Jordan triages by opening the lead profile and picking a tier from the dropdown
- Dropdown has a **"Remove from pipeline"** option at the bottom when the lead is in a tier (sets stage to NULL)
- Bulk reset: **Settings → Lead Cleanup → Clear the pipeline** (sets stage to NULL for all leads, optionally preserving Won/Lost)

---

## 7. Data model

### `leads` (central table — every other table FKs into it)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name`, `phone`, `company`, `email`, `website`, `category` | TEXT | `name` required; `phone` required-ish |
| `lead_type` | TEXT | 'new' / 'callback' (legacy; mostly 'new') |
| `status` | TEXT | 'not_called' / 'called'. Not surfaced in UI anymore. |
| `pipeline_stage` | TEXT NULLABLE | Tier values above, or NULL. **Was NOT NULL until May 2026 — dropped via writable_schema migration.** |
| `temperature` | TEXT NULLABLE | **LEGACY.** Hidden from UI. Old values 'hot'/'warm'/'cold'/NULL. |
| `deal_value` | REAL NOT NULL DEFAULT 0 | AUD. Pipeline column totals + Reports use this. |
| `follow_up_date` | TEXT NULLABLE | YYYY-MM-DD. Auto-set by Set Task panel (mirrors earliest task date). |
| `manually_contacted` | INTEGER NOT NULL DEFAULT 0 | 0/1. Override for the contacted-flag derivation. |
| `consolidated_summary` | TEXT NULLABLE | Rolling AI summary across calls |
| `unanswered_calls`, `voicemail_left`, `voicemail_date`, `last_called_at`, `queue_position`, `converted_to_project`, `monday_item_id` | mixed | Legacy / hidden |
| `created_at`, `updated_at` | TEXT | ISO 8601 |

### `call_logs`
Records of conversations. **Manual transcripts saved here too** with
`disposition='interested'`. `twilio_call_sid` column unused for new rows
(NULL).

### `notes`
Standalone notes on a lead. Different from transcripts.

### `tasks` (added May 2026)
```sql
id INTEGER PRIMARY KEY,
lead_id INTEGER NOT NULL FK ON DELETE CASCADE,
label TEXT NOT NULL,
due_date TEXT NOT NULL,                 -- YYYY-MM-DD
google_calendar_event_id TEXT,          -- best-effort link to GCal event
completed INTEGER NOT NULL DEFAULT 0,
completed_at TEXT,                      -- NULL until ticked off
created_at, updated_at
```

### `activities`
Timeline rows. `type` ∈ {`call`, `note`, `email`, `stage_change`,
`meeting`, `temperature_change`}. Rendered in Lead Profile → Activity tab.
Frontend reformats YYYY-MM-DD substrings to "17th of May 2026" at display
time via `humaniseDates()` helper.

### `emails_sent`, `email_drafts`
Outbound emails (via Resend) + pre-staged drafts from the post-call flow.
Body snippets are stored HTML-encoded (`&amp;` etc) — frontend decodes
via `decodeHtmlEntities()` from `client/src/utils/text.ts`.

### `projects`, `project_tasks`
Active jobs that converted from Won leads.

### Legacy tables (kept for data integrity, NO LONGER written to)
- `pending_transcripts` — was Twilio recording staging
- `call_sessions` — was Twilio CallSid → phone mapping
- `callbacks` — superseded by `leads.follow_up_date` + `tasks`

---

## 8. Concepts that are GONE — do NOT reintroduce

| Removed | Why | What replaced it |
|---|---|---|
| Twilio Voice SDK | Jordan calls on his mobile | Manual transcripts (Wispr Flow dictation) |
| Temperature (Hot/Warm/Cold) | Tiers do this better | Tier 1 / 2 / 3 |
| Status badge (Called / Not Called) on lead profile | Anyone in a tier = spoken to | Implicit |
| In-browser Call button on lead profile | No Twilio | Removed entirely |
| Log Call inline panel | Manual transcripts cover it | Transcripts tab dictation |
| Follow-up date input next to tier dropdown | Confusing UX | Set Task panel |
| "Unsorted" pipeline stage (briefly added then removed) | Jordan rejected adding a 6th tier-like value | `NULL` pipeline_stage |
| Monday.com integration | Removed in CRM pivot | OxyCRM IS the source of truth |
| `new_lead`, `follow_up`, `call_booked`, `negotiation`, `not_interested`, `five_strikes` pipeline stages | Replaced by tier system | One-time migration mapped old → new |
| `#` row-number column on Leads table | Not meaningful (was queue_position) | Removed |
| `Status` (Yes/No) column on print Report | Not useful — everyone shown is by definition contacted | Removed |

If you see ANY leftovers of these, nuke them.

---

## 9. Conventions (don't break these)

### Dates
- **Stored** as `YYYY-MM-DD` (date-only) or ISO 8601 (timestamps).
- **Displayed** as `17th of May 2026` (Aussie ordinal style).
- **"Today" anchored to Sydney time, not UTC.** Helpers:
  - Client: `client/src/utils/dates.ts` — `todayInSydney()`, `daysFromTodaySydney(n)`
  - Server: `server/src/util/dates.ts` — `todayInSydney()`
- **Never** use `new Date().toISOString().split('T')[0]` for "today" — it returns UTC's calendar day, which is yesterday for Sydney during evenings.
- `humaniseDates(text)` in `LeadProfilePage.tsx` reformats any YYYY-MM-DD substring inside an activity description on render.
- `formatDueDateLong()` in `tasks.ts` does the same on write for new task activity rows.

### Brand colours (Tailwind tokens — never hardcode)
| Token | Hex | Usage |
|---|---|---|
| `ink` | `#0b0d0e` | Primary text, headings, primary CTA bg |
| `ink-muted` | `#55606a` | Body text |
| `ink-dim` | `#8a95a0` | Labels, captions |
| `ink-faint` | `#b8bfc6` | Placeholders, disabled |
| `sky` | `#5ec5e6` | Accent — icons, glyphs |
| `sky-ink` | `#0a9cd4` | Accent text, links, italic editorial words |
| `sky-wash` | `rgba(94,197,230,0.12)` | Accent backgrounds |
| `sky-hair` | `rgba(94,197,230,0.24)` | Accent borders |
| `cream` | `#faf9f5` | Page background |
| `paper` | `#ffffff` | Card surfaces |
| `tray` | `#f2f0e8` | Inset trays |
| `hair`, `hair-soft`, `hair-strong` | rgba(11,13,14, varies) | Dividers |
| `ok` `#10b981` / `warn` `#f59e0b` / `risk` `#ef4444` | Semantic |
| Pulse tier accent | `#8b5cf6` (violet-500) | Only used on Pulse column |

**Never:** pure `#000`, pure `#fff`, emerald `#34d399`, Inter font, dark page backgrounds, purple/blue AI gradients, emojis in UI or commit messages.

### Typography
- Geist for UI (weights 400/500/600). Geist Mono for labels/data.
- Fraunces italic for editorial accent words in headings (use sparingly, colour `sky-ink`).
- Never Inter.

### Buttons
- Primary: `bg-ink text-white rounded-full px-5 py-2`
- Outline: `border border-hair-strong text-ink rounded-full`
- Ghost: no border, `text-ink-muted hover:bg-[rgba(11,13,14,0.03)]`

### Code
- TypeScript strict. No `any` unless commented.
- Zod schemas on every API endpoint body.
- Pino logger on the backend, log every external call + state change + error.
- Error handling on every external API call.
- No new files unless necessary. Prefer editing existing.

### Dispositions (legacy enum, still in use by call_logs)
`'no_answer' | 'voicemail' | 'not_interested' | 'interested' | 'wrong_number'`

Manual transcripts get `disposition='interested'` and bypass the state-machine side-effects.

### Critical business rules
1. **Call notes are APPENDED, never replaced.** When summarising a new call for a lead with prior notes, feed ALL existing notes + new transcript to Claude and produce a consolidated summary.
2. **Wrong Number deletes the lead entirely** (including call_logs). Intentional.
3. **Overdue = `due_date < todayInSydney()`.** Computed at query time.
4. **Emails are sent via Resend with BOTH `text` and `html` fields.** Always include the signature.
5. **`pipeline_stage = NULL`** = lead not on kanban. Don't treat this as an error.
6. **CSV import sets `pipeline_stage = NULL`** (omits the column — column default is now NULL). New leads via manual create form do the same.
7. **Lead profile Back button** restores the previous /leads URL from sessionStorage (`leads:return-url` key). Saved on row click. Falls back to `/leads` if absent.

---

## 10. API endpoint inventory (added or modified in this session)

### Leads
- `POST /api/leads/dedupe { dryRun?: boolean }` — group leads by normalised phone (last 9 digits) or name+company fallback. Returns groups + plan.
- `POST /api/leads/categories/rename { from: string, to: string }` — bulk rename a category. Used by Merge category.
- `POST /api/leads/reset-pipeline { preserveWonLost?: boolean }` — set pipeline_stage = NULL for all leads (preserves Won/Lost by default).
- `POST /api/leads/:id/transcripts { transcript: string, durationMinutes?: number }` — record a manually-dictated transcript as a call_log. Bypasses disposition state machine.
- `GET /api/leads?status=not_called&contacted=true|false&category=X&leadType=Y` — list with filters. `contacted` is NULL-safe: uses `(pipeline_stage IS NULL OR pipeline_stage != 'pulse')`.
- `PATCH /api/leads/:id` — partial update, accepts `dealValue`, `pipelineStage` (nullable), `manuallyContacted`, etc.

### Tasks
- `GET /api/leads/:leadId/tasks` — tasks for a lead
- `POST /api/leads/:leadId/tasks { label, dueDate }` — create + mirror to Google Calendar (best-effort) + set follow_up_date on lead
- `PATCH /api/tasks/:id { label?, dueDate?, completed? }` — partial update
- `DELETE /api/tasks/:id`
- `PATCH /api/tasks/:id/complete` — toggle completion (also sets completed_at)
- `GET /api/tasks` — global list with lead info
- `GET /api/tasks/stats` — overdue / dueToday / upcoming / completedTotal counts

### Reports
- `GET /api/reports?from=&to=&category=` — single endpoint returning everything for the Reports page (window, byTier, newLeads, won, lost, tasksDue, summary KPIs, pipelineLeads with details, contactedCount, conversion %, tasksCreated, tasksCompleted)

### Pipeline
- `PATCH /api/pipeline/:leadId/stage { stage: PipelineStage | null }` — nullable; activity log uses 'No tier' label when null
- `GET /api/pipeline/stats` — now returns `unplaced: number` (count of NULL-stage leads)

---

## 11. File map — added + removed in this session

### Added
- `client/src/utils/dates.ts` — `todayInSydney()`, `daysFromTodaySydney()`
- `client/src/utils/text.ts` — `decodeHtmlEntities()` (uses detached textarea, browser parser)
- `client/src/pages/ReportsPage.tsx`
- `client/src/pages/TasksPage.tsx`
- `client/src/pages/PrintReportPage.tsx`
- `server/src/util/dates.ts` — `todayInSydney()` (Intl-based)
- `server/src/routes/tasks.ts`
- `server/src/routes/reports.ts`
- `docs/HANDOFF.md` (this file)

### Deleted
- `server/src/routes/twilio.ts`
- `server/src/middleware/twilioSignature.ts`
- `client/src/pages/DiallerPage.tsx` (was 1031-line softphone; rewrite is `client/src/pages/DiallerPage.tsx` — slim browser, then later removed entirely from navigation)

### Heavily modified
- `client/src/pages/LeadProfilePage.tsx` — biggest file in the codebase, target of many edits
- `server/src/routes/leads.ts` — disposition handler stripped of Twilio plumbing
- `server/src/db/schema.ts` — added `tasks` table, `deal_value` column, `manually_contacted` column, `completed_at` on tasks, dropped NOT NULL on pipeline_stage via writable_schema migration
- `shared/types.ts` — PipelineStage type
- `client/src/pages/PipelinePage.tsx` — column order, per-tier $ totals, unplaced hint
- `client/src/pages/HomePage.tsx` — STAGE_CONFIG, today-in-Sydney

---

## 12. Deploy / git / build quirks

### Build script (root `package.json`)
```
"build": "npm run build:client && cd server && npm install --include=dev"
"build:client": "cd client && npm install --include=dev && npm run build"
"start": "cd server && NODE_ENV=production npx tsx src/index.ts"
```

**`--include=dev` is critical.** Railway sets `NODE_ENV=production` which would otherwise skip devDependencies like vite and tsx, breaking build + runtime. If you ever see "vite: not found" or "tsx: not found" in Railway logs, this is why.

**`tsx` must be in server `dependencies`** (not devDependencies) so it survives `npm prune --production`.

### Git auth
Set up via macOS Keychain. Pushes from Jordan's terminal just work.
- Helper: `git config --global credential.helper osxkeychain`
- Token: PAT generated at https://github.com/settings/tokens/new (tick `repo`)
- If asked for username: `oxyscale`. Password: the PAT.

### Workflow
1. Make changes
2. `git add -A && git commit -m "..."`
3. `git push origin main`
4. Railway auto-deploys in ~60s (longer if deps changed)
5. Tell Jordan to **hard refresh** (Cmd+Shift+R)

### Pre-commit verification
```bash
cd client && npx tsc --noEmit && NODE_ENV=production npx vite build
cd server && npx tsc --noEmit 2>&1 | grep -v rootDir
```

Server tsc has one pre-existing harmless "rootDir" warning about importing from `../../../shared` — filter it with `| grep -v rootDir`.

There are also 3 pre-existing harmless TS errors in client (HomePage line 253 string|undefined, LeadProfilePage line ~645 Note type, line ~731 unused var) — these existed before this session and vite build still passes. Don't get stuck on them.

### Verifying a deploy is live
```bash
# Hash changes every deploy
curl -s https://oxycrm-production.up.railway.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1

# Health
curl -s https://oxycrm-production.up.railway.app/api/health

# Confirm specific code shipped
curl -s "https://oxycrm-production.up.railway.app/assets/<BUNDLE>.js" | grep -c "Active Pipeline Value"
```

---

## 13. Full bug + feature log from this session

Listed in roughly chronological order. Commit hashes are the actual SHAs Jordan can `git show <hash>` to read the change.

### Pipeline + tier system
- **Category filter on Dialler/Leads page wasn't being passed to backend** — the param was silently dropped; fixed by adding `category` to `getLeads()` API signature.
- **Pipeline collapsed from 7+ legacy stages to 3 tiers + Won/Lost** (later expanded to add Pulse as a 4th non-outcome stage). One-time migration mapped old → new on deploy.
- **Pulse tier added** as a 6th stage (between Tier 3 and Won) for leads that've been spoken to but aren't actively being pursued. Default `deal_value` of $10k for Pulse leads.
- **Per-tier $ totals** shown under each kanban column header.
- **Pulse column reordered** to appear AFTER Tier 3 (not before Tier 1).
- **Unsorted concept added then removed** — Jordan rejected a 6th visible tier. Replaced with `pipeline_stage = NULL`.
- **`pipeline_stage` NOT NULL constraint dropped** via `PRAGMA writable_schema` migration in `schema.ts`. Was blocking NULL writes. Idempotent — only runs if it detects the old constraint.
- **"Remove from pipeline" option** added to lead profile tier dropdown when lead has a stage. Sets stage to NULL via existing PATCH endpoint (now nullable).
- **"Clear the pipeline" button** in Settings → Lead Cleanup. Bulk-sets stage to NULL for all active leads. Preserves Won/Lost by default.
- **"X leads not yet placed in a tier" banner** on Pipeline page when there are NULL-stage leads. Links to /leads.
- **NULL-safe Not Contacted filter** — was `pipeline_stage != 'pulse'` which evaluated to NULL for NULL-stage rows. Fixed with `(IS NULL OR != 'pulse')`.

### Dialler simplification
- **DiallerPage rewritten** from 1031-line Twilio softphone with cycler/audio/in-browser-calling to ~250-line slim lead browser. Then later removed entirely from navigation.
- **Twilio fully ripped out**: `routes/twilio.ts`, `middleware/twilioSignature.ts` deleted. `twilio` (server) + `@twilio/voice-sdk` (client) npm packages removed. Helmet CSP exceptions removed. `/twilio/*` webhook bypass paths removed from auth. Disposition handler simplified (no CallSid lookup, no pending_transcripts merge).

### Lead profile cleanup
- **Removed from top of profile:** Call button, Log Call button + inline panel, follow-up date input next to tier.
- **Removed from sidebar:** Status badge (Called/Not Called), Temperature display + toggle, Unanswered Calls counter, Voicemail Left entry.
- **Added to top:** Set Task button + inline panel.
- **Added to sidebar:** Tasks list (checkbox + delete on hover + inline edit on click/pencil), Deal Value inline editor.
- **Tabs renamed:** "Calls" tab → "Transcripts" tab.
- **Back button** now goes to `/leads` (not browser back). Restores filter state from sessionStorage if available.
- **Status display** uses derived `contacted` flag (computed from notes/emails/calls/tasks OR manually_contacted OR pulse).

### Transcripts + email handoff
- **Transcripts tab** has a dictate-friendly textarea at top. Two buttons: Save Transcript / Save and Draft Email.
- **Save and Draft Email** stashes transcript in sessionStorage as `transcript-context-{leadId}`, navigates to /compose/:leadId.
- **ComposeEmailPage auto-reads** the stashed transcript on mount, passes it to Claude as primary context, fires the draft immediately. Shows a sky banner saying "Drafting email from your transcript..." with a Show transcript toggle.
- **Each existing transcript** has a "Send email based on this" button that does the same handoff.
- **HTML entities decoded** in email body snippets (was showing `&amp;` etc raw). Helper at `utils/text.ts`.
- **Decoded entities also fed to Claude** in compose context — otherwise Claude learns to write `&amp;` in new drafts.

### Tasks system
- **Tasks table added** with label, due_date, completed_at, google_calendar_event_id.
- **Set Task panel** on lead profile with label + date inputs, quick "Touch Base / Send Proposal / Send Summary" label pills, 2w/4w/6w/8w quick date pills, Save / Cancel.
- **Google Calendar mirror** — best-effort drops a 9am Sydney event on create. Updates the event when label or date changes (PATCH handler in tasks.ts).
- **Tasks list panel** in lead profile sidebar. Checkbox to complete, hover-X to delete, click body or pencil to edit inline.
- **Inline edit** flips the row into a small form with label + date + 2/4/6/8w push-back buttons.
- **Tasks page** (`/tasks`) with Overdue / Due Today / Upcoming / Completed tabs. URL-driven tab state.
- **Quick-schedule pills** on each Tasks page row (2w/4w/6w/8w) — hover-revealed. Creates a NEW task with same label + same lead + due date today + Nw. Original task untouched. Green "+Nw scheduled" chip for 4s.
- **Add button on sidebar Tasks card** now scrolls to + focuses the Set Task panel (was opening it off-screen).

### Reports + deal value
- **Deal value column** added to leads (`deal_value` REAL NOT NULL DEFAULT 0).
- **Inline AUD editor** on lead profile sidebar.
- **Per-column $ totals** on Pipeline kanban headers.
- **Reports page** (`/reports`) — date range + category filter + KPI strip (pipeline value / new leads / won / lost) + per-tier breakdown + new leads in window + won + lost + tasks due/overdue + Print button → /report.
- **Print report** at `/report` is the printable version. URL params restore filters.
- **Conversion rate, contacted count, tasksCreated, tasksCompleted** all surfaced in Reports.

### Settings → Lead Cleanup tab
- **Clear the pipeline** (bulk NULL stage)
- **Merge a category** (rename one to another)
- **Find & merge duplicate leads** (dedupe by phone last-9-digits or name+company)

### Date handling
- **Today's "today" was UTC** server- and client-side. Caused tasks dated yesterday (Sydney) to show as "Due Today" and today's tasks to show as "Upcoming". Fixed via `todayInSydney()` helpers on both sides. All 10 affected files updated.
- **Display format** standardised on "17th of May 2026" via `humaniseDates()` (client) and `formatDueDateLong()` (server).

### Other fixes
- **Build failures** on Railway — vite-not-found / tsx-not-found because Railway sets NODE_ENV=production which skips devDependencies. Fixed by adding `--include=dev` to the build script. tsx also moved to dependencies.
- **`#` row-number column removed** from Leads page table.
- **`Status` (Yes/No) column removed** from print Report (showed "YES" for every row, not meaningful).
- **Back to leads preserves filter** — saves /leads URL in sessionStorage on row click, restores it on Back button.
- **Add Task button "didn't work"** — it did, but the Set Task panel opened ~700px above the sidebar so it appeared dead. Now scrolls into view + focuses input.
- **HomePage Add Lead form 500 error** — caused by the now-nullable pipeline_stage; fixed by the writable_schema migration.

---

## 14. Known leftovers / tech debt (not urgent)

- **Legacy tables not dropped:** `pending_transcripts`, `call_sessions`, `callbacks`. Kept for data integrity. Could drop in a future migration.
- **`twilio_call_sid` column** on `call_logs` — unused, new rows write NULL.
- **`temperature` column** on `leads` — unused, hidden from UI. Old rows still have values.
- **`useDiallerSession` hook** — still used by HomePage / LeadsPage / DispositionPage / EmailComposePage. Twilio bits already stripped from inside it, but the hook itself could be slimmed further.
- **DispositionPage and EmailComposePage** — remnants of old call flow. Wired up but Jordan doesn't hit them.
- **EmailBankPage** — still references some post-Twilio email draft pipeline. Works fine but framing is dated.
- **"Calls this week" KPI** on Home page — reflects manual transcripts (which are also `call_logs`). Numbers valid, framing dated.
- **`shared/types.d.ts`** — exists somewhere, mirrors `shared/types.ts`. Update both if you change `DispositionPayload`.
- **3 pre-existing TS errors** in client (HomePage:253, LeadProfilePage:645 + 731) — harmless, vite build still passes, but worth cleaning up one day.

---

## 15. Common gotchas (the things that bit us)

1. **NOT NULL constraints on schema migrations.** SQLite has no ALTER COLUMN. Use `PRAGMA writable_schema` (see `schema.ts` `pipeline_stage` example). Wrap in `PRAGMA foreign_keys = OFF`, run `integrity_check` after.
2. **`pipelineStage` enum mismatch.** Add a stage → update all 7 places (section 6). Miss one → silent 400 or "stage: stage" label fallback.
3. **Browser cache.** Jordan ALWAYS sees stale UI after a deploy. Tell him Cmd+Shift+R every push.
4. **`NODE_ENV=production` skipping devDependencies.** Build script uses `--include=dev`. If you see "vite: not found", this is why.
5. **`tsx` must be in `dependencies`**, not devDependencies, because `npm start` runs `tsx src/index.ts` after Railway prunes devDeps.
6. **Today must be Sydney, never UTC.** Use `todayInSydney()` everywhere. Server runs in UTC; `new Date().toISOString().split('T')[0]` returns yesterday's date if it's evening Sydney time.
7. **Activity rows are append-only.** Don't UPDATE them. Frontend reformats display via `humaniseDates()`.
8. **Stage change activity expects both old and new labels.** If `oldStage` or `newStage` is NULL, use 'No tier' as the label (see pipeline.ts PATCH).
9. **NULL pipeline_stage in WHERE clauses** evaluates to NULL (not TRUE/FALSE). Always wrap with `(... IS NULL OR ...)` when filtering.
10. **CSV import** doesn't include pipelineStage in its INSERT — relies on column default which is NULL.
11. **`PipelinePage.stats.unplaced`** is the source of truth for the "X leads not yet placed" banner. Comes from `/api/pipeline/stats` `WHERE pipeline_stage IS NULL` query.
12. **Compose page reads `transcript-context-{leadId}` from sessionStorage** on mount. Removes the key after reading.
13. **Back-to-leads URL stored at `leads:return-url` in sessionStorage**, saved on row click in LeadsPage.
14. **Email body snippets are HTML-encoded** at storage. Always pipe through `decodeHtmlEntities()` before display or feeding to Claude.

---

## 16. Posture for the next session

- **Ship small, push often.** Don't batch 5 features into one push.
- **3-sentence summary** + "what to test" note. Not a code diff.
- **No preflight questions for trivial calls.** Just do it.
- **ASK before destructive ops** (force-push, drop table, mass DELETE, rewriting git history).
- **If a deploy crashes**, check Railway build logs first. "vite: not found" / "tsx: not found" = build script lost `--include=dev` (see gotcha #4/#5).
- **Remind Jordan to hard refresh** every UI push.
- **Update HANDOFF.md** when you ship something big. This doc is the source of truth for the NEXT Claude session.
- **Trust but verify**: if Jordan says "X doesn't work", look at the code AND open the screenshot — sometimes the bug is real, sometimes it's a UX issue (e.g. panel opens off-screen, button is fine but appears dead).

---

## 17. First-message template for a fresh chat

Open Claude from `code/` (not the parent folder). Paste this as your first message:

```
Before we do anything, please read these in order:
1. CLAUDE.md
2. docs/PROJECT_CONTEXT.md
3. docs/HANDOFF.md

If those paths don't exist, you opened from the wrong folder — the repo
is in code/.

Once you've read all three, give me a one-line confirmation that you
understand:
- Twilio is gone, calls happen on my mobile + Wispr Flow dictation
- Pipeline is Tier 1 / 2 / 3 / Pulse / Won / Lost (in that order)
- pipeline_stage can be NULL = not on the kanban (default for new leads)
- "Today" is anchored to Sydney via todayInSydney(), never UTC
- Deploy is git push -> Railway auto-deploys
- Hard refresh after every UI change
- Back-to-leads restores the previous filter via sessionStorage

Then I'll brief you on what I want to change.
```

The new Claude will read the three docs (~600 lines total) and be on the exact same page where we ended.

---

## Latest deployed commit reference

Recent deploy chain (chronological, newest first):
- `0441d38` Back to leads restores filter
- `307b178` Add Task button scrolls + focuses
- `5d8015f` Back button always goes to /leads
- `8ca9fde` Edit existing tasks inline
- `2df463a` Remove Status column from print report
- `bf28d4a` Anchor today to Sydney everywhere
- `109bad4` Decode HTML entities in emails
- `0ce713e` NULL-safe Not Contacted filter
- `6f4a6b5` Remove # column from Leads
- `6ada9ae` 2/4/6/8 week quick-schedule
- `d46b9b1` Pulse column moved after Tier 3
- `4b66320` Drop NOT NULL on pipeline_stage
- `d41885d` Use NULL stage instead of Unsorted
- `3b8718c` Tasks list + deal value + reports + Twilio rip

End of handover. Good luck — ship quality.
