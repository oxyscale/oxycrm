# OxyCRM Handover — May 2026 (v2, comprehensive)

This doc orients a fresh Claude session on the full state of the codebase.
Read it together with `CLAUDE.md` and `docs/PROJECT_CONTEXT.md`. This file
supersedes the earlier shorter handoff.

> **Working directory:** the real repo lives in
> `/Users/jordanbell/Projects/Oxyscale/internal-apps/Oxyscale-dialler/code/`.
> Open Claude from there (not the parent folder, which is leftover
> scaffolding). The git repo, `CLAUDE.md`, `docs/`, `client/`, `server/`,
> `shared/` all live in `code/`.

---

## 1. Who Jordan is and how he works

- **Non-technical founder.** Runs business + product. He shouldn't have to
  read code unless he asks. Plain English over jargon. Concise updates over
  walls of text.
- **George** is his co-founder, joining the project. Same posture.
- Jordan iterates fast — ship small, push often, no preflight questions
  for trivial calls. DO ask before destructive ops (force-push,
  drop table, bulk delete of real data, anything that can't be undone).
- He uses Wispr Flow on his Mac for dictation system-wide. He prefers
  Claude Code over manual editing.
- He's already set up git auth via PAT in macOS Keychain — pushes "just
  work" from his terminal. If a fresh terminal ever prompts for username:
  `oxyscale`, password: the keychain'd PAT.

---

## 2. Production stack (do not swap)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 6 + TypeScript + Tailwind 3 |
| Backend | Node 18 + Express 4 + TypeScript (run via `tsx`, not compiled) |
| DB | SQLite via `better-sqlite3`. Persistent volume on Railway at `/data`. |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) — summaries, email drafts |
| Email | Resend API (branded HTML, always `text` + `html`) |
| Calendar | Google Calendar API (OAuth, tokens in `data/google-tokens.json`) |
| Auth | Cookie session, bcrypt passwords, rate-limited |
| Deploy | Railway → `main` branch auto-deploys (~60s normally, ~2 min on dep changes) |

**Twilio is gone.** Don't reintroduce browser-based calling. Jordan calls
on his personal mobile.

**Monday.com is gone.** OxyCRM is the source of truth.

---

## 3. Folder map (relative to `code/`)

```
code/
├── CLAUDE.md                  # Top-level Claude instructions
├── docs/
│   ├── PROJECT_CONTEXT.md     # Deep architectural reference
│   └── HANDOFF.md             # This file
├── client/                    # React SPA
│   ├── src/
│   │   ├── components/        # Shared components (Layout, SearchBar, etc.)
│   │   ├── pages/             # One file per route
│   │   ├── hooks/             # useAuth, useDiallerSession
│   │   ├── services/api.ts    # All API calls live here
│   │   ├── types.ts           # Re-exports shared/types
│   │   └── utils/             # emailTemplate, names, etc.
│   └── package.json
├── server/                    # Express API
│   ├── .env                   # SECRETS — NEVER commit
│   └── src/
│       ├── routes/            # One file per resource
│       ├── services/          # ai-summary, emailTemplate, gmail-sync, google-calendar
│       ├── db/schema.ts       # SQLite schema + migrations
│       ├── prompts/           # AI prompt templates
│       └── middleware/        # auth, errorHandler
├── shared/types.ts            # TS types shared client+server. SOURCE OF TRUTH.
├── package.json               # Root — build + start scripts
└── railway.json
```

---

## 4. Product shape (what every page does)

| Path | Page | Purpose |
|---|---|---|
| `/` | HomePage | Lead intake (Create / Import CSV), today's queue, KPIs |
| `/pipeline` | PipelinePage | Kanban: **Tier 1 / Tier 2 / Tier 3 / Won / Lost**. Per-column $ totals. Category filter. |
| `/leads` | LeadsPage | Sortable table of every lead with search |
| `/dialler` | DiallerPage | Lightweight lead browser (was the in-browser softphone, stripped down) |
| `/leads/:id` | LeadProfilePage | Profile: contact info, tabs (Activity / Transcripts / Notes / Emails), sidebar (Lead Details, Tasks, Activity Stats) |
| `/email-bank` | EmailBankPage | Post-call AI email drafts queue (legacy, still works) |
| `/compose/:leadId` | ComposeEmailPage | Manual email composer with AI assist. Auto-reads transcript from sessionStorage if user came from Transcripts tab. |
| `/book-meeting/:leadId` | BookMeetingPage | Calendar event creation |
| `/projects` | ProjectsPage | Won leads converted to active jobs |
| `/projects/:id` | ProjectDetailPage | Project status, deliverables |
| `/intelligence` | IntelligencePage | AI analysis over call history |
| `/dashboard` | DashboardPage | Stats / KPIs |
| `/reports` | ReportsPage | **Investor pulse-check view** — date range + category filter + KPI strip + tier $ breakdown + new leads + won/lost + tasks due. Print to PDF. |
| `/settings` | SettingsPage | Category Prompts, Company Profile, Email Preferences, Email Signature, **Lead Cleanup**, Account |

---

## 5. Canonical pipeline stages

```typescript
type PipelineStage = 'tier_1' | 'tier_2' | 'tier_3' | 'won' | 'lost';

// pipelineStage is NULLABLE on Lead. NULL = lead exists in /leads but is
// NOT placed on the kanban. This is how the "clear pipeline" feature works.
```

**Stage meaning:**
- `tier_1` — hot, probably gonna close them
- `tier_2` — working on them
- `tier_3` — light intro, not really sure where they're at
- `won` — closed
- `lost` — dead
- `NULL` — not yet triaged into a tier

**Triage flow:** new leads (CSV import or manual create) default to `NULL`.
Jordan triages them by opening the lead profile and picking a tier from
the dropdown. The dropdown includes a **"Remove from pipeline"** option
at the bottom (sets stage to NULL) when the lead is currently in a tier.

**Bulk clear:** Settings → Lead Cleanup → Clear the pipeline. Sets stage
to NULL for every lead (optionally preserves Won/Lost).

### When you add or change a stage value, update ALL of these:
1. `shared/types.ts` (`PipelineStage` type)
2. `server/src/routes/leads.ts` (createLeadSchema + updateLeadSchema zod enums)
3. `server/src/routes/pipeline.ts` (`PIPELINE_STAGES` array + `stageLabels`)
4. `client/src/pages/LeadProfilePage.tsx` (`PIPELINE_STAGES` array)
5. `client/src/pages/HomePage.tsx` (`STAGE_CONFIG`)
6. `client/src/components/SearchBar.tsx` (`stageLabel` function)
7. `server/src/routes/reports.ts` (`TIER_LABELS` + the SQL `IN (...)` filters)

Missing any one of these = silent 400 / missing-label fallback.

---

## 6. Data model — key tables

### `leads`
The central table. Every other table FKs into it.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name`, `phone`, `company`, `email`, `website`, `category` | TEXT | `name`/`phone` required |
| `lead_type` | TEXT | 'new' / 'callback' (legacy; mostly 'new') |
| `status` | TEXT | 'not_called' / 'called'. Not surfaced in UI anymore. |
| `pipeline_stage` | TEXT NULLABLE | Tier values above, or NULL. **Was NOT NULL until May 2026, now nullable via writable_schema migration.** |
| `temperature` | TEXT NULLABLE | LEGACY. Values 'hot' / 'warm' / 'cold' / NULL. Hidden from UI. |
| `deal_value` | REAL NOT NULL DEFAULT 0 | AUD. Used by Pipeline column totals + Reports. |
| `follow_up_date` | TEXT NULLABLE | YYYY-MM-DD. Set by Set Task panel. |
| `consolidated_summary` | TEXT NULLABLE | Rolling AI summary across calls |
| `unanswered_calls`, `voicemail_left`, `voicemail_date`, `last_called_at`, `queue_position`, `converted_to_project`, `monday_item_id` | mixed | Legacy / hidden |
| `created_at`, `updated_at` | TEXT | ISO 8601 |

### `call_logs`
Records of conversations. Manual transcripts saved here too with
`disposition='interested'`. `twilio_call_sid` is unused.

### `notes`
Standalone notes on a lead. Different from transcripts.

### `tasks` (added May 2026)
```sql
id INTEGER PRIMARY KEY,
lead_id INTEGER NOT NULL FK,
label TEXT NOT NULL,
due_date TEXT NOT NULL,          -- YYYY-MM-DD
google_calendar_event_id TEXT,   -- best-effort link to GCal event
completed INTEGER NOT NULL DEFAULT 0,
created_at, updated_at
```

### `activities`
Timeline rows. `type` ∈ {`call`, `note`, `email`, `stage_change`,
`meeting`, `temperature_change`}. Rendered in Lead Profile → Activity tab.
Frontend reformats any YYYY-MM-DD substring as "17th of May 2026" at
display time.

### `emails_sent`, `email_drafts`
Outbound emails (via Resend) + pre-staged drafts from the post-call flow.

### `projects`, `project_tasks`
Active jobs that converted from Won leads.

### Legacy tables (kept for data integrity, no longer written to)
- `pending_transcripts` — was Twilio recording staging
- `call_sessions` — was Twilio CallSid → phone mapping
- `callbacks` — superseded by `leads.follow_up_date` + `tasks`

---

## 7. Concepts that are GONE — do NOT reintroduce

| Removed | Why | What replaced it |
|---|---|---|
| Twilio Voice SDK | Jordan calls on his mobile | Manual transcripts (Wispr Flow dictation) |
| Temperature (Hot/Warm/Cold) | Tiers do this better | Tier 1 / 2 / 3 |
| Status badge (Called / Not Called) | Anyone in a tier has been spoken to | Implicit |
| In-browser Call button | No Twilio | Remove. Don't navigate to `/dialler?loadLeadId=X` |
| Log Call inline panel | Manual transcripts cover it | Transcripts tab dictation |
| Follow-up date input next to tier | Confusing UX | Set Task panel |
| "Unsorted" pipeline stage | Jordan rejected adding a 6th tier | Use `NULL` pipeline_stage instead |
| Monday.com integration | Removed in CRM pivot | This app IS the source of truth |
| `new_lead`, `follow_up`, `call_booked`, `negotiation`, `not_interested`, `five_strikes` pipeline stages | Replaced by tier system | One-time migration mapped them all |

If you see ANY leftover of these, nuke it. Especially:
- Temperature pills on lead cards
- "Hot/Warm/Cold" filter dropdowns
- `<Phone>` buttons that navigate to `/dialler`
- References to `'unsorted'` in code (the brief existence of this stage was reverted)

---

## 8. Features shipped recently (chronological, newest first)

### `4b66320` — DB migration: drop NOT NULL on `pipeline_stage`
The original column had `NOT NULL DEFAULT 'tier_3'`. After making the code
write NULL, inserts started returning 500. SQLite can't ALTER COLUMN, so
a `PRAGMA writable_schema` migration in `schema.ts` rewrites the table's
CREATE statement in-place. Idempotent. FKs from child tables stay intact.
Verified with `PRAGMA integrity_check` afterwards.

### `d41885d` — Use NULL stage instead of Unsorted tier
Reverted the brief "Unsorted" tier concept (which Jordan rejected).
`PipelineStage` enum back to 5 values. `pipelineStage` is now nullable
end-to-end (type, mappers, zod). New leads default to NULL. Pipeline GET
endpoint skips NULL rows from the kanban. `/api/pipeline/stats` now
returns `unplaced` count. Lead profile tier dropdown shows a "Remove
from pipeline" option at the bottom when the lead is in a tier.

### `7207072` — (REVERTED) Unsorted tier + Clear Pipeline button
Initial attempt added 'unsorted' as a 6th pipeline stage. Jordan didn't
want a new tier — reverted in `d41885d` but kept the Clear Pipeline
button.

### `78247e1` — Per-tier $ totals on Pipeline column headers
Each kanban column sums `dealValue` for its leads and shows the total
under the column name. Lets Jordan see Tier 1 / Tier 2 / Tier 3 worth at
a glance.

### `3b8718c` — Big feature bundle:
- **Tasks list** on Lead Profile sidebar (between Lead Details and
  Activity Stats). Checkbox to complete, hover X to delete. Overdue rows
  in red, due-today in amber.
- **Deal value field** on leads. New `deal_value` REAL column. Inline
  editor in sidebar (`DealValueEditor` component).
- **Reports page** (`/reports`). Date range + category filter, KPI strip,
  per-tier breakdown, new leads in window, won/lost in window with $
  totals, tasks due/overdue, Print button.
- **Twilio rip** — deleted `routes/twilio.ts` + `middleware/twilioSignature.ts`,
  removed `twilio` (server) + `@twilio/voice-sdk` (client) packages,
  cleaned helmet CSP, removed `/twilio/*` webhook bypass paths, simplified
  disposition handler.

### `da7c7da` — Transcript → Email handoff actually works
Compose page auto-reads transcript from sessionStorage on mount, passes
it to Claude as primary context, fires the draft, shows a sky banner
saying "Drafting email from your transcript…". Show transcript toggle
for sanity-check. Instructions panel becomes "Refine the draft".
Activity timeline reformats YYYY-MM-DD as "17th of May 2026".

### `e261332` — Lead profile cleanup + tasks + transcripts
- Removed: Call button (top), Log Call button, Status badge, Temperature
  toggle, Unanswered Calls / Voicemail sidebar entries, inline follow-up
  date input
- Added: Set Task button + panel (creates task + Google Calendar event)
- Renamed Calls tab → Transcripts. Top textarea for Wispr Flow dictation.
  Save Transcript / Save and Draft Email. Each transcript card has
  "Send email based on this".

### `e23a79b` — Dialler page rebuilt as slim lead browser
Old: 1031-line Twilio softphone with queue cycler, audio gear, in-browser
calling. New: 250 lines. Search box, category tabs with per-tab counts,
clean list, click → lead profile. No calling, no queue, no Twilio Device.

### `dd462ac` — Pipeline collapsed to 3 tiers + Won/Lost
Replaced the 7+ legacy stages with the tier system. One-time auto-migration
on deploy mapped old → new (new_lead→tier_3, follow_up→tier_2, etc.).

### Earlier in the same chat
- Settings → Lead Cleanup tab (merge categories, dedupe by phone)
- Manual transcript save endpoint
- Build script fixes for Railway (`--include=dev` to keep vite + tsx
  during npm install when NODE_ENV=production)
- `tsx` moved to dependencies (not devDependencies) so `npm start` works
  after npm prune --production
- Category filter on Dialler actually filters (was silently dropping the
  param before)

---

## 9. Conventions (don't break these)

### Dates
- **Stored** as `YYYY-MM-DD` (date-only) or ISO 8601 (timestamps).
- **Displayed** as `17th of May 2026` (Aussie ordinal style).
- Helper `humaniseDates(text)` in `LeadProfilePage.tsx` reformats any
  YYYY-MM-DD substring inside an activity description on render — so old
  rows look right too.
- Server-side helper `formatDueDateLong()` in `tasks.ts` does the same on
  write for new task activity rows.

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

**Never:** pure `#000`, pure `#fff`, emerald `#34d399`, Inter font,
dark page backgrounds, purple/blue AI gradients, emojis in UI or
commit messages.

### Typography
- Geist for UI (weights 400/500/600). Geist Mono for labels/data.
- Fraunces italic for editorial accent words in headings (use sparingly,
  colour `sky-ink`).
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

Manual transcripts get `disposition='interested'` and bypass the
state-machine side-effects.

---

## 10. Critical business rules

1. **Call notes are APPENDED, never replaced.** When summarising a new
   call for a lead with prior notes, feed ALL existing notes + new
   transcript to Claude and produce a consolidated summary.
2. **Wrong Number deletes the lead entirely** (including call_logs).
   Intentional.
3. **Overdue = `follow_up_date < today`.** Computed at query time.
4. **Emails are sent via Resend with BOTH `text` and `html` fields.**
   Always include the signature.
5. **`pipeline_stage = NULL`** = lead not on kanban. Don't treat this as
   an error.
6. **CSV import sets `pipeline_stage = NULL`** (omits the column —
   default applies). New leads via manual create form do the same.

---

## 11. Deploy + git workflow

### Build script (root `package.json`)
```
"build": "npm run build:client && cd server && npm install --include=dev"
"build:client": "cd client && npm install --include=dev && npm run build"
"start": "cd server && NODE_ENV=production npx tsx src/index.ts"
```

The `--include=dev` flag is **critical** — Railway sets `NODE_ENV=production`
which would otherwise skip devDependencies like vite and tsx, breaking
the build and runtime.

### Git auth
Already set up via macOS Keychain. Future pushes work without prompting.
If a fresh terminal asks: username `oxyscale`, password the keychain'd PAT.
Generate new PATs at https://github.com/settings/tokens/new (tick `repo`).

### Workflow
1. Make changes
2. `git add -A && git commit -m "..."`
3. `git push origin main`
4. Railway picks it up automatically, redeploys in ~60s (longer if deps changed)
5. Always tell Jordan to **hard refresh** (Cmd+Shift+R) — he gets fooled
   by browser cache constantly

### Pre-commit verification
```bash
cd client && npx tsc --noEmit && NODE_ENV=production npx vite build
cd server && npx tsc --noEmit
```

Server tsc has one pre-existing harmless "rootDir" warning about importing
from `../../../shared` — filter it out with `| grep -v rootDir`.

### Verifying a deploy is live
```bash
# Hash changes every deploy
curl -s https://oxycrm-production.up.railway.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1

# Health
curl -s https://oxycrm-production.up.railway.app/api/health

# Confirm specific code shipped by grepping the deployed bundle
curl -s "https://oxycrm-production.up.railway.app/assets/<BUNDLE>.js" | grep -c "Active Pipeline Value"
```

---

## 12. Lead profile UI inventory (current state)

**Top section (after Back button):**
- Eyebrow "LEAD · PROFILE"
- Big sky-ink heading: lead name (editable inline)
- Subtitle: company (editable inline)
- Contact row: phone / email / website (each editable inline by click)

**Action bar:**
- Email button → `/compose/:leadId`
- Book Meeting button → `/book-meeting/:leadId`
- Add Note button → switches to Notes tab + focuses textarea
- **Set Task button** → opens inline panel below for label + due date
- Spacer
- Tier dropdown (right-aligned): Tier 1 / Tier 2 / Tier 3 / Won / Lost
  + "Remove from pipeline" if already in a tier

**Inline panels (conditional):**
- Set Task panel: label input, date input, Save / Cancel. Creates task
  + Google Calendar event (best-effort) + sets `follow_up_date` on lead.

**Call Summary card** (rolling AI summary if exists)

**Tabs:** Activity | **Transcripts** | Notes | Emails

- **Activity tab:** timeline of all activities, paginated. Dates
  reformatted to "17th of May 2026" via `humaniseDates()`.
- **Transcripts tab:**
  - Top: dictation panel with textarea (Wispr Flow dictates into it).
    Two buttons: Save Transcript / Save and Draft Email.
  - Below: list of all transcripts (call_logs ordered desc). Click to
    expand. Each expanded transcript has a "Send email based on this"
    button that stashes transcript in sessionStorage and navigates to
    `/compose/:leadId`.
- **Notes tab:** standalone notes (textarea + save).
- **Emails tab:** all emails sent/received for this lead.

**Right sidebar (4 cards):**
1. **Lead Details:** Category, Lead Type, Tier (or "No tier"), Deal
   Value (inline editable AUD), Last Called (if set), Created.
2. **Tasks:** list of tasks with checkboxes + overdue/today colour + delete
   on hover. "+ Add" link opens Set Task panel.
3. **Activity Stats:** Total Calls, Notes, Emails Sent (counts).
4. **Converted to Project** (only if `convertedToProject` is true).

---

## 13. Pipeline page UI inventory

- Eyebrow "OPERATIONS · PIPELINE"
- Big sky-ink heading "Active pipeline."
- 3 stat cards: Total Leads / Active Pipeline Value / Won
- Filter row: category dropdown + total count
- **Banner** (conditional): "X leads not yet placed in a tier. → Go to Leads"
  when `stats.unplaced > 0`
- Kanban: 5 columns horizontal scroll. Each column has:
  - Header: tier name + count badge + total $ value
  - Cards: lead name (click → profile), company, deal-value badge,
    category badge, "Move" dropdown on hover
- Column color strips: ink / amber / blue / purple / red

---

## 14. Settings page → Lead Cleanup tab

3 cards:
1. **Clear the pipeline** — checkbox "Keep Won and Lost where they are"
   (default ticked) + Clear pipeline button. Confirms via dialog.
   Bulk-sets `pipeline_stage = NULL`.
2. **Merge a category** — from / into text inputs + Merge button.
3. **Find & merge duplicate leads** — Preview duplicates button (dry-run)
   then Merge button. Dedupes by phone last-9-digits.

---

## 15. Known leftovers / technical debt (not urgent)

- **Legacy tables not dropped:** `pending_transcripts`, `call_sessions`,
  `callbacks`. Kept for data integrity. Could drop in a future migration.
- **`twilio_call_sid` column** on `call_logs` — unused, new rows write NULL.
- **`temperature` column** on `leads` — unused, hidden from UI. Old rows
  still have values.
- **`useDiallerSession` hook** — still used by HomePage / LeadsPage /
  DispositionPage / EmailComposePage. Twilio bits already stripped from
  inside it, but the hook itself could be slimmed further.
- **DispositionPage and EmailComposePage** — remnants of old call flow.
  Still wired up. Jordan doesn't hit them.
- **EmailBankPage** — still references some post-Twilio email draft
  pipeline. Works fine but framing is dated.
- **"Calls this week" KPI** on Home page — reflects manual transcripts
  (which are also `call_logs`). Numbers valid, framing dated.
- **`pipelineStage: 'follow_up'` set anywhere old** — should be gone but
  worth grepping for if a 400 ever appears.
- **`shared/types.d.ts`** — exists somewhere, mirrors `shared/types.ts`.
  Update both if you change `DispositionPayload`.

---

## 16. Common gotchas / things that have bitten us

1. **NOT NULL constraints on schema migrations.** SQLite has no ALTER
   COLUMN. If you need to change a column constraint, use the
   `PRAGMA writable_schema` pattern (see `schema.ts` for
   `pipeline_stage` example). Always wrap in `PRAGMA foreign_keys = OFF`
   and run `integrity_check` afterwards.
2. **`pipelineStage` enum mismatch.** If you add a new stage value and
   forget any of the 7 places in section 5, you get silent 400 errors
   or "stage: stage" label fallbacks.
3. **Browser cache.** Jordan ALWAYS sees stale UI after a deploy. Tell
   him Cmd+Shift+R every time you push UI changes.
4. **`NODE_ENV=production` skipping devDependencies.** The build script
   uses `--include=dev` to force vite, tsc, tailwind, postcss to install
   on Railway. If you ever see "vite: not found" in build logs, this is
   why.
5. **`tsx` must be in `dependencies`**, not devDependencies, because
   `npm start` runs `tsx src/index.ts` after Railway prunes devDeps.
6. **Activity rows are append-only.** Don't UPDATE them, only INSERT.
   The frontend reformats display, doesn't mutate.
7. **Stage change activity expects both old and new labels.** If
   `oldStage` or `newStage` is NULL, use 'No tier' as the label
   (see pipeline.ts).
8. **The new lead `POST /api/leads` endpoint defaults `pipelineStage`
   to NULL.** If a UI form sends `undefined`, lead is created with no
   tier. To force a specific tier, send `pipelineStage: 'tier_1'` etc.
9. **CSV import** doesn't include pipelineStage at all in its INSERT
   — relies on column default which is now NULL.
10. **`PipelinePage.stats.unplaced`** is the source of truth for the
    "X leads not yet placed" banner — comes from
    `GET /api/pipeline/stats` which queries `WHERE pipeline_stage IS NULL`.

---

## 17. Posture for the next session

- **Ship small, push often.** Don't batch 5 features into one push.
- **Plain English summaries.** A 3-sentence "what changed and what to
  test" is better than a code diff.
- **Don't ask preflight questions for trivial calls.** Just do it.
- **DO ask before destructive ops.** Force-push, drop table, mass DELETE,
  rewriting git history.
- **If a deploy crashes**, check the Railway build logs first.
  "vite: not found" or "tsx: not found" = the build script lost
  --include=dev (see #4 in gotchas).
- **Remind Jordan to hard refresh** every time you push UI changes.
- **Update `HANDOFF.md`** when you ship something big — this doc is the
  source of truth for the NEXT Claude session.

---

## 18. First-message template for a fresh chat

Paste this in the new chat:

```
Before we do anything, please read these in order:
1. CLAUDE.md
2. docs/PROJECT_CONTEXT.md
3. docs/HANDOFF.md

Make sure you're in the code/ directory — if the docs aren't at those
paths, you opened from the wrong folder.

Once you've read all three, give me a one-line confirmation that you
understand:
- Twilio is gone, calls happen on my mobile + Wispr Flow
- Pipeline is Tier 1/2/3/Won/Lost (no temperature, no Unsorted)
- pipeline_stage can be NULL = not on the kanban
- New leads default to NULL stage
- Deploy is git push -> Railway auto-deploys

Then I'll brief you on what I want to change.
```

---

End of handover.
