# OxyScale Dialler / Hub — Claude Code Onboarding

**You are picking up an internal CRM + cold-calling tool that is live in production.** This document gets you from zero context to making safe changes. Read it end-to-end before responding to your first message. Last updated: **2026-04-28**.

Production: `https://oxycrm-production.up.railway.app`
Repo: `https://github.com/oxyscale/oxycrm` (on the user's machine at `/Users/<user>/oxyscale/internal/CRMdialler`)

---

## 0. Reading order — do all of these before responding

In this order:

1. **This file** (`docs/ONBOARDING.md`) — the entry point.
2. **`CLAUDE.md`** at the repo root — project rules, brand tokens, business rules. **Mandatory.** Pay special attention to "Pipeline stages (canonical values)" — the 5-place rule causes silent 400s if missed.
3. **`docs/RUNBOOK.md`** — operational runbook (env vars, backup, password reset, calendar reconnect, Resend webhook).
4. **`docs/PROJECT_CONTEXT.md`** — deep architecture + feature inventory (some sections may be stale; this file is the authoritative summary).
5. **`docs/HANDOVER.md`** — narrative session-to-session handover from the engineer who shipped auth + the major hardening pass.
6. **`docs/REBRAND-NOTES.md`** — light-editorial rebrand decisions if you're touching visual surfaces.
7. **`~/.claude/projects/-Users-<user>-oxyscale-internal-CRMdialler/memory/MEMORY.md`** — auto-memory with the user's preferences. Read it; don't print it.

Brand source of truth lives outside this repo at `/Users/<user>/oxyscale/internal/brand/BRAND-GUIDELINES.md`. CLAUDE.md mirrors the relevant bits but the brand guide wins on conflict.

---

## 1. Who you're working with

**Jordan Bell** — co-founder, the actual operator on the dialler. Email `jordan@oxyscale.ai`. Title "Co-founder". Phone `+61 478 197 600`. Calendly `https://calendly.com/jordan-oxyscale/30min`. **Has Railway access.**

**George Harrad** — co-founder, often the user in chat. Email `george@oxyscale.ai`. Title "Co-founder". Phone in his email signature is **intentionally Jordan's number** — sales calls go to Jordan. **Does not have Railway access** — for env-var changes he needs Jordan.

Both push to `main` directly. Coordinate on shared code via Signal / WhatsApp.

**Style notes:**
- Blunt, direct, no fluff. Will catch over-engineering.
- Often dictates messages — phrasing can be messy, infer charitably.
- May say "ignore me, mate" mid-thought when realising they're wrong — don't pursue retracted points.
- Prefers short status updates between actions, full reports at the end of work, explicit confirmation before destructive ops.
- No emojis unless explicitly requested.

---

## 2. Stack (do not swap)

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS. Light editorial brand: Cream `#faf9f5` page bg, White paper cards, Ink `#0b0d0e` text, Sky `#5ec5e6` / Sky-Ink `#0a9cd4` accent. Geist sans, Geist Mono, Fraunces italic for accent words.
- **Backend**: Node + Express + TypeScript. Run via `tsx` in dev.
- **Database**: SQLite via `better-sqlite3`. WAL mode, FK enforcement on. Dev DB at `server/data/dialler.db`; prod at `/data/dialler.db` (Railway persistent volume).
- **Telephony**: Twilio Voice SDK (browser-based outbound calling). Webhook signatures verified.
- **AI**: Anthropic Claude `claude-sonnet-4-20250514` for summaries / drafts. OpenAI `whisper-1` for transcription.
- **Email**: Resend. Branded HTML templates. Engagement events tracked via Svix-signed webhook.
- **Calendar**: Google Calendar API. **Single shared connection across both users** (per-user OAuth deferred — see §13).
- **Deploy**: Railway. Auto-deploys `main` (~1 min). Persistent volume mounted at `/data`.

**Never re-add Monday.com.** It was removed early. The dialler is a standalone CRM.

---

## 3. Folder layout

```
oxycrm/
├── CLAUDE.md                     # Project rules — read first
├── docs/
│   ├── ONBOARDING.md             # This file
│   ├── PROJECT_CONTEXT.md        # Deep reference
│   ├── HANDOVER.md               # Narrative session handover
│   ├── RUNBOOK.md                # Operations
│   └── REBRAND-NOTES.md          # Visual decisions
├── client/                       # React frontend
│   └── src/
│       ├── pages/                # One per route
│       ├── components/           # Reusable + ui/
│       ├── hooks/                # useAuth, useDiallerSession, etc.
│       ├── services/api.ts       # All fetch wrappers
│       ├── utils/
│       └── types.ts              # Re-exports shared
├── server/
│   ├── .env                      # Secrets (gitignored)
│   ├── data/                     # Local SQLite + tokens (gitignored)
│   └── src/
│       ├── routes/               # One file per resource
│       ├── services/             # Business logic
│       ├── db/                   # schema.ts + index.ts + seed-users.ts
│       ├── prompts/              # AI prompt templates
│       ├── middleware/           # auth, error, twilioSignature
│       └── utils/                # dataDir, etc.
├── shared/types.ts               # Source-of-truth TypeScript types
├── package.json                  # Workspace root scripts
└── railway.json                  # Deploy config
```

---

## 4. Local dev — getting set up

### Clone + install

```bash
git clone https://github.com/oxyscale/oxycrm.git
cd oxycrm
npm install   # postinstall runs install:all (client + server)
```

### Env file

`server/.env` is gitignored. Get the production env values from Railway dashboard (Jordan has access) or from another team member out-of-band. Required vars listed in §6 of [docs/RUNBOOK.md](RUNBOOK.md). The server **fails fast on boot in production** if any are missing — same check runs locally with NODE_ENV=production but is skipped in dev.

### Run

Two terminals:

```bash
# terminal 1 — backend
npm run dev:server          # tsx, hot reloads on file change, http://localhost:3001

# terminal 2 — frontend
npm run dev:client          # vite, http://localhost:5173
```

Vite proxies `/api/*` to `localhost:3001`. Cookie auth works in dev because both run on localhost.

### Quick verify

```bash
curl http://localhost:3001/api/health           # → {"status":"ok",...}
open http://localhost:5173                       # → Login page
```

In dev, the **users table is seeded on first server boot** with two accounts (Jordan + George) using bcrypt hashes committed in `server/src/db/seed-users.ts`. The bootstrap passwords were issued out-of-band and should already be rotated. If you need fresh credentials for local testing, ask the user to issue you one via the Forgot Password flow against the local server, or update the hash directly via SQL.

### Type-check + build

```bash
# server
cd server && npx tsc --noEmit

# client
cd client && npx tsc --noEmit && npx vite build
```

The server tsconfig has a known `rootDir` warning about `shared/` files — **filter those lines out** when checking errors (they're not real). Real errors will show as `src/...` paths.

---

## 5. Git + deploy workflow

**Default branch is `main`.** Both Jordan and George push directly.

### Standard change flow

```bash
git pull origin main           # always start with this
# ... make changes ...
git add <specific files>       # avoid `git add .`
git commit -m "..."            # see commit-message style below
git push origin main           # triggers Railway deploy (~1 min)
```

### Verify deploy succeeded

```bash
git rev-parse HEAD origin/main      # should match
curl https://oxycrm-production.up.railway.app/api/health   # should return 200
```

Railway picks up the new commit, builds, and serves within ~60 seconds. Watch the dashboard logs (Jordan has access) if a deploy looks stuck.

### Commit message style

Look at `git log --oneline -20` for examples. Pattern:

```
<scope>: <short imperative summary>

<paragraph explaining what + why, not how>

<additional paragraphs for non-trivial changes>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Scopes seen in the log: `feat`, `fix`, `ux`, `infra`, `security`, `hardening`, `deps`, `docs`, `validation`, `prod-ready`. Don't invent new ones unless you have to.

### Hard rules

- **Never commit `.env`** (it's gitignored — keep it that way).
- **Never push to `main` without typecheck passing both halves.**
- **Never `git add .` or `git add -A`** — pick files explicitly.
- **Never skip git hooks** (`--no-verify`, `--no-gpg-sign`).
- **Never amend commits** unless explicitly asked. Always create a new one.
- **Never force-push to `main`.**
- **No emojis in commit messages, code, or UI.** Unless the user asks.

### Working with the user

- When asked to commit, follow the standard flow: status / diff / log first to draft the message, then add specific files, then commit, then push.
- When asked to "push" only — that means push existing commits, don't create new ones.
- If you make changes and the user hasn't asked you to commit, **don't commit**. State what's pending and let them decide.

---

## 6. Production environment

Required env vars on Railway (all set; server validates on boot):

```
ANTHROPIC_API_KEY
OPENAI_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_TWIML_APP_SID
TWILIO_PHONE_NUMBER
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
RESEND_API_KEY
RESEND_WEBHOOK_SECRET           # for engagement event tracking
EMAIL_FROM_ADDRESS
```

Optional (sensible defaults): `EMAIL_FROM_NAME`, `CLIENT_URL`, `DATA_DIR`, `PORT`, `LOG_LEVEL`, `TWILIO_CALLER_ID`, `UNANSWERED_CALL_THRESHOLD`.

**Only Jordan can edit Railway env vars.** If a change is needed, ask Jordan to do it.

---

## 7. The system at a glance

### Major user-facing features

- **Login + per-user identity** (email/password, session cookie, 30-day sliding TTL). Login page at `/login`. Forgot-password flow with Resend-emailed reset link (60-min token). Settings → Account tab for in-app password change.
- **Home page (`/`)** — Pipeline stage overview, total leads / calls this week / connect rate / avg call stats, recent activity feed (with actor attribution), follow-up queue, lead-heat by temperature, today's callbacks. Top-right action bar: Start Dialler, Create Lead, Import CSV. Reconnect-Calendar chip appears when Google tokens are revoked.
- **Lead list (`/leads`)** — Sortable, filterable directory of all leads. Status / temperature / last-called columns. Per-row Call action.
- **Lead profile (`/leads/:id`)** — Inline-editable header (name/company/phone/email/website). Pinned Call Summary card (rolling AI summary). Tabs: Activity, Calls, Notes, Emails. Sidebar with Lead Details + Activity Stats.
- **Dialler (`/dialler`)** — Twilio browser-based calling. Lead queue on the left, current lead + call controls on the right. Call Summary card pinned across all states (idle, ringing, connected, ended). Email Prep widget. Live transcript panel.
- **Disposition (`/disposition`)** — Post-call: choose disposition (no_answer / voicemail / not_interested / interested / wrong_number), set follow-up date, optional inline meeting booking, quick note. Form preserved across Google OAuth round-trip via sessionStorage.
- **Email Bank (`/email-bank`)** — AI-drafted follow-up emails queued asynchronously after each disposition. Lifecycle: `pending → ready → sent | discarded | failed`. Stats cards (Ready / Pending / Failed / Sent in last 24h). Filter chips. Two-column list+editor. Three independent toggleable render blocks per draft (after-call header, capabilities CTA, book-a-call CTA). Live preview panel. Save button + on-blur autosave (debounced + serialised).
- **Pipeline (`/pipeline`)** — Kanban view of leads by pipeline stage. Drag-and-drop where supported.
- **Projects (`/projects`)** — Leads converted to active projects. Task checklists per project.
- **Intelligence (`/intelligence`)** — AI-driven insights across calls.
- **Stats / Dashboard (`/dashboard`)** — Call period stats.
- **Settings (`/settings`)** — Tabs: Category Prompts (per-niche AI playbooks + CTA config), Company Profile, Email Preferences, Email Signature preview, Account (change password).
- **Compose Email (`/compose/:leadId`, `/email-bank/:id`)** — Manual + AI-assisted email composition.
- **Book Meeting (`/book-meeting/:leadId`)** — Standalone booking flow. Same form-preservation logic as Disposition.

### How a typical call flows

1. Operator opens `/dialler`, picks a lead.
2. Clicks Call → Twilio Voice SDK opens browser audio session, server hits `/api/twilio/voice` (signed webhook) for TwiML. CallSid captured server-side.
3. Operator talks. Live transcript may stream.
4. On hang-up, Operator dispositions: `no_answer` / `voicemail` / `not_interested` / `interested` / `wrong_number`.
5. Server creates a `call_log` row tagged with `user_id`. For `interested` / `voicemail` dispositions, a pending `email_drafts` row is also inserted.
6. In parallel, Twilio finalises recording (~30–90 sec), POSTs to `/api/twilio/recording-status` (signed). Server downloads the MP3, sends to Whisper, persists transcript onto the call_log.
7. Once transcript lands, `summariseAndPersistCall` runs: feeds prior `consolidated_summary` + new transcript to Claude, writes consolidated summary back to the lead.
8. Then `draftAndStoreEmailForCall` runs: looks up the call's user_id → user's name, drafts a follow-up email **in that user's voice**, writes subject + body onto the email_draft row, flips status `pending → ready`.
9. Operator goes back to the dialler and keeps calling. Email Bank ready-count badge in sidebar increments.
10. Later the operator opens Email Bank, reviews each draft, edits if needed, hits Send. Server sends via Resend with operator's identity (from address, signature). Sends are also logged to `emails_sent` and create an `activity` row.
11. **Engagement events** (delivered/opened/clicked/bounced) flow back from Resend's Svix-signed webhook to `/api/webhooks/resend` and update counters on the matching `emails_sent` row. Visible per-lead on the lead profile email tab as Delivered / Opened Nx / Clicked Nx / Bounced chips.

### Disposition → email mapping

| Disposition | Creates draft? | Email type |
|---|---|---|
| `no_answer` | No | — |
| `voicemail` (with email on lead) | Yes | Voicemail follow-up |
| `not_interested` | No | — |
| `interested` | Yes | Post-call follow-up |
| `wrong_number` | No (lead deleted) | — |

`call_booked` is **not a separate disposition** — it's a pipeline-stage toggle on the Email Bank review screen. Default is `follow_up`; flip to `call_booked` before sending if the call resulted in a booked meeting.

---

## 8. Backend — service layer

Located in `server/src/services/`:

- **`auth.ts`** — bcrypt hashing (cost 12), HMAC-signed session cookies (30-day sliding TTL), reset-token generation (60-min). Session secret persisted to `${DATA_DIR}/session-secret` on first boot.
- **`ai-summary.ts`** — Claude wrapper (`callClaude` with 60s timeout). Functions: `summariseCall`, `draftFollowUpEmail`, `draftVoicemailEmail`, `summariseAndPersistCall`, `draftAndStoreEmailForCall`. All threaded with per-user identity via `senderName` parameter.
- **`emailTemplate.ts`** — Branded HTML wrapper. Two render modes: `'standard'` (Hi {name} greeting) and `'post-call'` (mono recipient label + Fraunces italic display headline). Optional cream CTA card with two independently-rendered rows (capabilities + book-a-call). Body renderer handles blank-line paragraphs and `*asterisk-wrapped*` italic phrases. **`escapeHtml` escapes `& < > " '`. `safeHref` rejects non-http(s) schemes** — defence against XSS via admin-supplied URLs.
- **`emailSignature.ts`** — Per-user signature block (calling-card style). Sky hairline → name → title → "Phone · website".
- **`email.ts`** — Resend client wrapper. **Hard-fails in production if `RESEND_API_KEY` missing** (returns dev stub otherwise). Sends both text and HTML.
- **`google-calendar.ts`** — OAuth client. `isAuthenticatedAndValid()` makes a real `calendar.calendarList.list({maxResults:1})` call to validate the refresh token. Cached 5 min server-side. The cache check uses calendarList because we don't have the `userinfo.profile` scope.
- **`gmail-sync.ts`** — Inbound email matcher (received emails matched to leads). Exponential backoff (60s base, 30 min cap, ±20% jitter).
- **`transcription.ts`** — OpenAI Whisper wrapper (90s timeout).

---

## 9. Backend — routes

In `server/src/routes/`:

| File | Mounted at | Purpose |
|---|---|---|
| `auth.ts` | `/api/auth` | login, logout, me, forgot, reset, change-password |
| `leads.ts` | `/api/leads` | CRUD, search, CSV import, disposition, queue cycling |
| `callbacks.ts` | `/api/callbacks` | Today's callbacks (legacy; follow-up date is canonical now) |
| `twilio.ts` | `/api/twilio` | token, voice (TwiML), incoming, recording-status, call-sid, debug |
| `calls.ts` | `/api/calls` | Call log CRUD, AI-summary updates, period stats |
| `intelligence.ts` | `/api/intelligence` | AI insights |
| `email.ts` | `/api/email` | Manual email send |
| `emailDrafts.ts` | `/api/email-drafts` | Email Bank list / get / patch / send / retry / discard |
| `google.ts` | `/api/google` | OAuth start, callback, status, calendar events / event create |
| `transcribe.ts` | `/api` | Direct audio transcription (browser-side recording, less used now) |
| `notes.ts` | `/api/notes` | Note CRUD |
| `projects.ts` | `/api/projects` | Project CRUD + tasks |
| `activities.ts` | `/api/activities` | Lead timeline + recent feed |
| `pipeline.ts` | `/api/pipeline` | Stage / temperature changes, follow-up queue, stats |
| `settings.ts` | `/api/settings` | App settings (key/value), category prompts |
| `webhooks.ts` | `/api/webhooks` | `/resend` engagement events (Svix-signed) |

### Auth gating

Auth middleware lives at `server/src/middleware/auth.ts`. Mounted globally on `/api/*` in `server/src/index.ts`, with a small **public-by-design** allowlist:

- `/api/health`
- `/api/auth/login`, `/forgot`, `/reset`, `/logout` (login forms can't already be logged in)
- `/api/twilio/voice`, `/api/twilio/incoming`, `/api/twilio/recording-status` (Twilio's servers, not browsers — protected by signature verification)
- `/api/google/callback` (Google's redirect target — OAuth `code` is the credential)
- `/api/webhooks/resend` (Svix-signed)

`/api/auth/me` and `/api/auth/change-password` apply `requireAuth` themselves inside the router.

### Rate limiting

`express-rate-limit`, keyed by IP via trust-proxy:

- `/api/auth` — 30 attempts / 15 min
- `/api/intelligence`, `/api/email`, `/api/transcribe` — 30 / min
- `/api/email-drafts` — **dedicated 120 / min** (auto-refresh polls hit this)

---

## 10. Backend — database

Schema is built lazily on every server boot via `initializeDatabase` in `server/src/db/schema.ts`. **All schema migrations are idempotent** — `CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`, `retrofitCascadeIfMissing`. Safe to re-run.

### Main tables

- **`users`** — `id, email, password_hash, name, title, phone, sender_email, sign_off, calendly_link, reset_token, reset_token_expires_at, created_at, updated_at`. Seeded on first boot from `server/src/db/seed-users.ts`.
- **`leads`** — name, company, phone, email, website, lead_type, category, status, unanswered_calls, voicemail_left, voicemail_date, consolidated_summary (capped 16 KB), pipeline_stage, temperature, follow_up_date, queue_position, last_called_at.
- **`call_logs`** — `lead_id, user_id, duration, transcript, summary, disposition, twilio_call_sid, ...`. `user_id` was added during the auth pass; backfilled to Jordan.
- **`pending_transcripts`, `call_sessions`** — async transcription bookkeeping.
- **`notes`** — `lead_id, content, created_by, created_at`. CASCADE on lead delete.
- **`activities`** — `lead_id, type, title, description, metadata, created_at, created_by`. `created_by` is free-text (not a FK) so deleting users doesn't lose history. Recent activity feed shows it. CASCADE on lead delete.
- **`emails_sent`** — `lead_id, to_address, from_address, subject, body_snippet, gmail_message_id (also used as Resend email_id), source, direction, created_at, delivered_at, opened_at, last_opened_at, open_count, clicked_at, last_clicked_at, click_count, bounced_at`. The engagement columns are populated by the Resend webhook.
- **`projects` + `project_tasks`** — converted leads.
- **`settings`** — key/value app config.
- **`category_prompts`** — `category, prompt, cta_doc_label, cta_intro, cta_doc_url`. Per-niche AI playbook + per-niche capabilities CTA config.
- **`email_drafts`** — `lead_id, call_log_id (UNIQUE), user_id, disposition, to_email, cc_email, subject, body, suggested_stage, status, generated_at, sent_at, error_message, include_after_call_header, include_capabilities, include_book_a_call`. The three `include_*` columns drive the toggleable render blocks in the email template.

### Foreign keys

All lead-scoped child tables use `ON DELETE CASCADE` (notes, projects, project_tasks, activities, emails_sent, call_logs, email_drafts). The `wrong_number` disposition deletes the lead and the cascade cleans everything up.

### Critical business rules (re-read CLAUDE.md for the canonical list)

1. **Call notes are appended, never replaced.** When summarising a new call, feed prior `consolidated_summary` + new transcript to Claude.
2. **Wrong Number deletes the lead entirely.** Intentional. Cascade FKs ensure orphan-free cleanup.
3. **Follow-up date auto-moves the lead to `follow_up` stage.**
4. **Overdue = `follow_up_date < today`** computed at query time in `/api/pipeline/follow-ups`.
5. **Emails are sent via Resend with both `text` and `html`.** Signature always included.
6. **Dates**: follow-up dates stored as `YYYY-MM-DD` (date-only). Call timestamps ISO 8601. Don't mix.
7. **Pipeline stages must be in 5 places** (CLAUDE.md). Missing one causes silent 400s.

---

## 11. Frontend — page structure

Every page in `client/src/pages/`. Auth gate (`RequireAuth` in `App.tsx`) redirects to `/login?next=...` if no session. Login + Reset pages live outside the gate.

`Layout.tsx` is the shell — sidebar with nav icons (Home / Pipeline / Leads / Dialler / Email Bank / Projects / Intelligence / Stats / Settings), keyboard shortcuts modal trigger, user-initials button at the bottom (hover for logout), Email Bank ready-count badge.

The brand-correct CSS tokens live in `client/tailwind.config.ts`. Every visual surface uses tokens (`bg-paper`, `text-ink-muted`, `border-hair-soft`, `text-sky-ink`, etc.) — **never hardcode hex colours unless absolutely necessary**, and never reach for legacy emerald (`#34d399`) or pure black (`#000`).

The API client at `client/src/services/api.ts` wraps fetch with `credentials: 'include'` and intercepts 401s to redirect to `/login`. Add new endpoints there.

---

## 12. Security posture (verified against production)

- Auth gate: every `/api/*` except the public list returns 401 without a cookie.
- Helmet headers in production: CSP (allows `'self'`, Twilio + Anthropic only), HSTS (180-day, includeSubDomains), X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
- HTTPS enforce: 301 from `http://` → `https://` (uses `x-forwarded-proto` since Railway terminates TLS at edge).
- Twilio webhook signature verification: unsigned POSTs return 403. Uses `twilio.validateRequest()` against `TWILIO_AUTH_TOKEN`.
- Resend webhook signature verification: Svix HMAC-SHA256 + timestamp replay-protection. In production, missing secret returns 503; signature mismatch returns 400.
- Rate limiting: see §9.
- Constant-time auth response (~900 ms whether user exists or not — bcrypt runs against a dummy on miss). Prevents user enumeration.
- Open-redirect protection on Google OAuth `returnTo` (rejects anything not starting with single `/`).
- SQL `LIKE` wildcard escape on phone search.
- Email `to`/`cc`/`bcc`/`subject` reject `\r\n` (header-injection guard).
- CSV upload capped at 10 MB / 1 file.
- `escapeHtml` escapes `& < > " '` in the email template renderer; `safeHref` enforces `http(s)://` on URL fields.
- `category_prompts.cta_doc_url` validated as http(s) URL.
- Graceful SIGTERM/SIGINT — closes server, waits up to 25 s for in-flight requests, then exits. Stops Railway redeploys from killing mid-call AI summarisation or email sends.
- Fetch timeouts: Claude 60 s, Whisper 90 s, Twilio recording download 45 s.
- Disposition transaction uses `BEGIN IMMEDIATE` to kill lost-update races.
- Post-Whisper async chain failures logged with `leadId` + `callLogId` (no silent `.catch(()=>{})`).
- Request log redacted: logs `req.path` not `req.url` (no query strings in logs — keeps reset tokens, search terms, returnTo paths out).
- Claude error responses log only HTTP status, not the response body.
- `npm audit`: 0 client vulns; 1 residual transitive on server (`uuid<14` via `resend → svix`) — not exploitable in our code path.

---

## 13. Open / deferred work (none launch-blocking)

- **`server/src/prompts/emailDraft.ts`** — `buildEmailDraftPrompt` and `buildEmailSubjectPrompt` are exported but **never imported anywhere**. Dead code. Either delete or wire up. Active prompt path is in `services/ai-summary.ts`.
- **Per-user Google calendar OAuth** — currently shared. Big refactor.
- **Sentry** — would need Jordan to add `SENTRY_DSN` env var.
- **Resend major upgrade** — clears the residual `uuid<14` transitive vuln. Breaking change.
- **`activities` and `emails_sent` table archival** — both grow unbounded.
- **CSV import column-name validation feedback** — silently drops unknown columns.
- **Submit OAuth app for Google verification** — kills the 7-day re-auth chip permanently. Multi-week external process.
- **Automated DB backup** — currently manual (`railway run --service oxycrm cat /data/dialler.db > dialler-YYYY-MM-DD.db`).

---

## 14. Conventions / things to watch for

- **Pipeline stages must agree in 5 places** (see CLAUDE.md). Missing one = silent 400.
- **Use the existing UI components** (`PillButton`, `PanelCard`, `EyebrowLabel`, `SectionHeading`, `Glyph`) before rolling your own.
- **`shared/types.ts` is the source of truth** for every data shape that crosses the wire.
- **Server-side HTML can't be previewed in the dev server.** Render to `/tmp/oxyscale-email-preview/preview.html` and `open` it.
- **Don't delete `.claude/`** at the repo root — that's local Claude config.
- **Memory rules**: never save secrets. Update auto-memory via Write tool when you learn lasting facts about the user, their workflow, or the project.
- **Use sub-agents for the heavy explore work** — Explore / Plan / Code-Review agents are appropriate for non-trivial changes. Three Explore agents in parallel produced the original production audit.
- **Schema changes**: `addColumnIfMissing` for new columns. `retrofitCascadeIfMissing` for FK changes (SQLite needs a table rebuild). Both are idempotent.
- **Twilio webhook URL** must be HTTPS in production (it is). Local testing requires ngrok or similar — or just rely on `NODE_ENV !== 'production'` skipping the signature check.
- **Adding a new `/api/*` route** — by default it's auth-gated. To make it public, add to `PUBLIC_API_PATHS` in `server/src/index.ts`. Only do this if it's an external-services-only endpoint (signed webhook, OAuth callback) and it has its own auth.
- **Adding a new env var** — add to `REQUIRED_VARS` in `server/src/index.ts` if production must have it; otherwise add to `OPTIONAL_VARS` with a sensible default in code. Document in `docs/RUNBOOK.md`.

---

## 15. Most recent state at handover (2026-04-28)

- Production responding `200` on `/api/health`.
- Most recent commits:
  - `d49ab19` `fix(calendar): use a scope we actually have to validate Google tokens`
  - `b7423b5` `security: pre-launch hardening on the new email + webhook surfaces`
  - `8cce996` `feat(email): Resend webhook engagement tracking`
  - `b973fd1` `infra: dedicated 120/min rate limit for /api/email-drafts`
  - `a9f8286` `feat(email): manufacturing campaign — CTA card, live preview, outcome italic`
- UptimeRobot pinging `/api/health` every 5 min, alerts to both founders.
- The manufacturing-niche cold-call campaign is **live and being run** as of today. Email drafts use the post-call render mode with three toggleable blocks (after-call header, capabilities CTA, book-a-call CTA). The capabilities doc URL is per-category — set in Settings → Category Prompts.

---

## 16. How the user typically briefs you

They'll often paste a long voice-note transcription. **Read the whole thing before responding** — important context tends to be at the end. They sometimes say "ignore me, mate" mid-thought when they realise they're wrong; don't pursue retracted points. They prefer short status updates between actions, full reports at end of work, and explicit confirmation of risks before destructive ops. Don't drown them in micro-issues — synthesise.

When in doubt: ask, then build.

---

You're up to speed. Welcome aboard.
