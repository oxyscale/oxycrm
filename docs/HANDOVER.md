# OxyScale Dialler / Hub — Handover Brief

Living document. Last updated: **2026-04-27**.

You are picking up an internal CRM + cold-calling tool that is **live in production** at `https://oxycrm-production.up.railway.app` and being used daily by Jordan Bell (sales, the operator) and George Harrad (co-founder, the user you'll work with). Read this end-to-end before touching anything.

---

## 1. Read these in order before responding

1. **`CLAUDE.md`** at the repo root — project rules, brand tokens, business rules. Mandatory. Pay attention to the "pipeline stages must update in 5 places" rule and the email business rules.
2. **`docs/PROJECT_CONTEXT.md`** — architecture + feature inventory.
3. **`docs/RUNBOOK.md`** — operational runbook (env vars, backup, password reset, calendar reconnect).
4. This file.
5. `~/.claude/projects/-Users-georgeharrad-oxyscale-internal-CRMdialler/memory/MEMORY.md` — auto-memory with George's preferences.

Brand source of truth: `/Users/georgeharrad/oxyscale/internal/brand/BRAND-GUIDELINES.md`. CLAUDE.md mirrors the relevant bits but the brand guide wins on any conflict.

---

## 2. People

- **George Harrad** — co-founder, the user in chat. Email `george@oxyscale.ai`. Title "Co-founder". Phone in his email signature is `+61 478 197 600` — **intentionally Jordan's number**, because Jordan handles sales calls and George doesn't want prospects calling him. Style: blunt, direct, no fluff. Will catch over-engineering. Wants honest "this won't work" answers, not optimistic ones. Often dictates messages — phrasing can be messy, infer charitably. He may say "ignore me, mate" mid-thought when he realises he's wrong; don't pursue retracted points. Prefers short status updates between actions, full reports at end of work, explicit confirmation before destructive ops.
- **Jordan Bell** — co-founder, the actual operator on the dialler. Email `jordan@oxyscale.ai`. Title "Co-founder". Phone `+61 478 197 600`. Has Calendly link `https://calendly.com/jordan-oxyscale/30min`. **Has Railway access; George does not.** This matters for env-var changes.

---

## 3. Stack (do not swap)

- **Frontend**: React + Vite + TypeScript + Tailwind. Light editorial brand.
  - Cream `#faf9f5` page bg, White paper cards, Ink `#0b0d0e` text.
  - Sky `#5ec5e6` / Sky-Ink `#0a9cd4` accent. Tailwind tokens defined in `client/tailwind.config.ts`.
  - Geist sans, Geist Mono, Fraunces italic for accent words in headings.
  - **No dark mode. No emerald (`#34d399`). No pure black `#000`. No Inter as primary.** All legacy.
- **Backend**: Node + Express + TypeScript. Run via `tsx` in dev (`npm run dev:server` from repo root).
- **Database**: SQLite via `better-sqlite3`. WAL mode, FK enforcement on. Dev DB at `server/data/dialler.db`; prod at `/data/dialler.db` (Railway persistent volume).
- **Telephony**: Twilio Voice SDK (browser-based outbound calling).
- **AI**: Anthropic Claude `claude-sonnet-4-20250514` for summaries / drafts. OpenAI `whisper-1` for transcription.
- **Email**: Resend.
- **Calendar**: Google Calendar API. **Single shared connection across both users** (per-user OAuth was deferred — see §10).
- **Deploy**: Railway. Auto-deploys `main` (~1 min). Persistent volume mounted at `/data`.

**Monday.com is gone — do not re-add it.**

---

## 4. Auth & per-user identity

The whole app sits behind a session-cookie login. Two seed accounts (Jordan + George) created on first boot from bcrypt hashes committed in `server/src/db/seed-users.ts` (bcrypt is one-way, hashes are safe to commit).

- Sessions: HMAC-signed cookies, secret persisted to `/data/session-secret` on first boot. **Deleting that file force-logs-out everyone** — handy for emergency revocation.
- Cookie config: `httpOnly`, `Secure` (prod), `SameSite=Lax`, 30-day sliding TTL (refreshed on every authenticated request).
- Auth middleware at `server/src/middleware/auth.ts`. Applied to every `/api/*` except the **public-by-design** list in `server/src/index.ts`:
  - `/api/health`
  - `/api/auth/*` (login, logout, forgot, reset all unauthenticated; me + change-password apply requireAuth themselves)
  - `/api/twilio/voice`, `/api/twilio/incoming`, `/api/twilio/recording-status` (Twilio's servers, not browsers — protected by signature verification instead)
  - `/api/google/callback` (Google's redirect target — OAuth `code` itself is the credential)
- Routes: `/api/auth/login`, `/logout`, `/me`, `/forgot`, `/reset`, `/change-password`. Forgot-password sends a Resend-branded email with a 60-min token. Login response time is constant whether the user exists or not (bcrypt always runs against a dummy hash on miss) — prevents user enumeration.
- Frontend: `AuthProvider` context wraps the app, `RequireAuth` gate redirects to `/login?next=...` on 401. Login + Reset pages are branded (Cream / Ink / Sky). Sidebar shows the user's initials at bottom; hover reveals logout.
- Settings page has an **Account** tab with a Change Password form.

### Per-user identity threading

When Jordan calls and the AI drafts a follow-up, it writes "You are Jordan Bell from OxyScale...". When George calls, "You are George Harrad...". Identity is determined by joining `call_logs.user_id → users.name` inside `draftAndStoreEmailForCall` in `services/ai-summary.ts`. From-address and signature also swap to the per-user identity at send time.

**Settings table holds company-wide stuff** (company name, website, AI prompt config). **Users table holds personal identity** (name, title, phone, sender_email, sign_off, calendly_link).

### Activity attribution

`activities` table has a `created_by` column (free-text user name, not a FK so deletion doesn't lose history). Every activity insert (lead create, note, email send via either route, pipeline stage change, temperature change, project conversion) records `req.user.name`. The Recent feed on the home page shows the actor in sky-ink before the timestamp.

Backfill is **idempotent and runs every boot** — fills any NULL rows to "Jordan Bell" since he was the only operator pre-auth. Lives in `seedUsersIfEmpty()` in `server/src/db/seed-users.ts`. Same backfill covers `call_logs.user_id` and `email_drafts.user_id`.

### Bootstrap passwords

Issued to George + Jordan once and they were instructed to rotate via forgot-password / Settings → Account. **Treat them as rotated.** Don't ask George for the plaintext. If you ever need to add a new user, generate a bcrypt hash (cost 12), append to the `SEED_USERS` array in `seed-users.ts`. The seed only inserts when the users table is **empty** — for adding users to an existing install, do it via SQL on the Railway shell or build a proper admin endpoint.

---

## 5. Production environment

**Required env vars on Railway** (server exits 1 with a clear list if any missing):

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
EMAIL_FROM_ADDRESS
```

All present, all validated on boot. **Only Jordan can edit them on Railway.**

**Optional** (sensible defaults): `EMAIL_FROM_NAME`, `CLIENT_URL`, `DATA_DIR`, `PORT`, `LOG_LEVEL`, `TWILIO_CALLER_ID`, `UNANSWERED_CALL_THRESHOLD`.

**Google OAuth app is in Testing state, not verified.** Refresh tokens auto-revoke every 7 days. The home page Reconnect Calendar chip handles this — polls `/api/google/status` (which makes a real `calendarList.list({maxResults:1})` call to validate the token; cached 5 min server-side). Submitting the OAuth app for Google verification would kill the chip permanently — multi-week external process, not done.

**UptimeRobot** is set up by George. Pings `/api/health` every 5 min, emails him + Jordan on outage.

**Backup**: Documented in `docs/RUNBOOK.md`. The pattern is `railway run --service oxycrm cat /data/dialler.db > dialler-YYYY-MM-DD.db`. **George cannot run this — Jordan has to.** No automated backup yet.

---

## 6. Security posture (verified live, 2026-04-27)

All these were curl-tested against production at the end of the audit cleanup:

- ✅ Auth gate: every `/api/*` except the public list returns 401 without a cookie
- ✅ Helmet headers in production: CSP, HSTS (180-day, includeSubDomains), X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- ✅ HTTPS enforce: 301 from `http://` → `https://` (uses `x-forwarded-proto` since Railway terminates TLS at edge)
- ✅ Twilio webhook signature verification: unsigned POSTs to `/voice`, `/incoming`, `/recording-status` return 403. Uses `twilio.validateRequest()` against `TWILIO_AUTH_TOKEN`. `app.set('trust proxy', 1)` so x-forwarded-* reconstruct the URL Twilio signed.
- ✅ Rate limiting via `express-rate-limit`: 30 / 15 min per IP on `/api/auth`, 30 / min per IP on `/api/intelligence`, `/api/email`, `/api/email-drafts`, `/api/transcribe`. Rate-limit response headers visible.
- ✅ Constant-time auth response (~900ms whether user exists or not — bcrypt runs against a dummy on miss)
- ✅ Open-redirect protection on Google OAuth `returnTo` (rejects anything that doesn't start with single `/`)
- ✅ SQL `LIKE` wildcard escape on phone search
- ✅ Email `to`/`cc`/`bcc`/`subject` reject `\r\n` (header-injection guard)
- ✅ CSV upload capped at 10 MB / 1 file
- ✅ CSP whitelist correctly allows Twilio + Anthropic only
- ✅ No `.env` in git, no hardcoded API keys in code
- ✅ Client `npm audit --omit=dev`: 0 vulns
- ✅ Server `npm audit --omit=dev`: 1 residual transitive (`uuid<14` via `resend → svix`) — not exploitable in our code path; needs breaking Resend major bump to clear

---

## 7. Other notable hardening shipped in the last sweep

- Graceful SIGTERM/SIGINT — closes server, waits up to 25s for in-flight requests, then exits. Stops Railway redeploys from killing mid-call AI summarisation or email sends.
- Fetch timeouts: Claude 60s (`AbortSignal.timeout`), Whisper 90s (SDK option), Twilio recording download 45s.
- Disposition transaction upgraded to `BEGIN IMMEDIATE` — kills the lost-update race if two dispositions hit the same lead at once.
- Post-Whisper async chain failures now logged with `leadId` + `callLogId` (was previously `.catch(()=>{})` swallowing errors silently).
- Resend hard-fails in production if `RESEND_API_KEY` is missing instead of returning a fake `local-${Date.now()}` messageId. Dev still returns a stub for local testing.
- `wrong_number` disposition rejects a `followUpDate` (was previously silently dropped).
- `consolidated_summary` capped at 16 KB (previously unbounded — would slow lead profiles for chatty long-term leads).
- Voicemail flag (`voicemail_left`, `voicemail_date`) cleared on `interested`/`not_interested` re-disposition so the UI doesn't show stale "voicemail previously left" indefinitely.
- Stale email-draft sweep throttled to once per 5 min (previously ran on every list request).
- Gmail sync uses exponential backoff (60s base, doubles per consecutive failure to 30 min cap, ±20% jitter). No-op when not authenticated.
- Foreign-key `ON DELETE CASCADE` retrofitted on `notes`, `activities`, `projects`, `project_tasks`, `emails_sent` via a SQLite-safe table-rebuild migration. Wrong-number deletion no longer leaves orphans.
- gzip compression middleware (lead lists, activity timelines benefit most).
- Request logger logs `req.path` not `req.url` so query strings (reset tokens, search terms, returnTo) don't leak.
- Claude error responses log only HTTP status, not the response body (which can include rate-limit metadata).

---

## 8. Frontend polish shipped

- DiallerPage disconnects active Twilio call on unmount (no more zombie ringing if user navigates away mid-call).
- "Phone Offline" status now has a Retry button (`handleRetryTwilio`) — manual re-init without page refresh.
- LeadProfilePage inline-edit failures (name/company/phone/email/website) show a red banner at the top for 4s instead of silently reverting.
- Date / time pickers across BookMeetingPage, DispositionPage, LeadProfilePage flipped from `[color-scheme:dark]` to `[color-scheme:light]` so native pickers match the cream brand.
- PipelinePage "Not Interested" column dot was `bg-zinc-400` (off-palette gray) → `bg-ink-dim`.
- EmailBankPage save-on-blur is debounced (250ms) AND serialised — fast Tab burst no longer races concurrent PATCHes that lost edits out of order. Pending timeouts are cleared on unmount.
- Create Lead form inputs have `maxLength` caps.
- Create Lead button added to LeadsPage header (top-right) — navigates to `/?create=lead` which auto-opens the existing panel on the home page.
- Disposition + BookMeeting form preservation: sessionStorage-backed, lead-scoped. If a popup-blocker forces same-tab OAuth navigation, the user lands back on the same page with all form fields restored. `returnTo` param round-trips through OAuth `state`.
- Notes on the lead profile show the author name in sky-ink before the timestamp.
- Recent activity feed on home page shows the actor in sky-ink before the timestamp.
- Login page reads "Sign in to the OxyScale **hub**" (per George's preferred wording — was previously "dashboard").

---

## 9. Major features (in order of when shipped this engagement)

- **Email Bank** at `/email-bank` — AI-drafted follow-up emails queued asynchronously after each disposition. Lifecycle: `pending → ready → sent | discarded | failed`. Created on disposition (interested/voicemail), filled in by Claude after Whisper transcript arrives. Stale-pending sweep marks anything stuck > 15 min as `failed`. Sidebar inbox icon shows live ready-count badge.
- **Branded HTML email template + signature** in `server/src/services/emailTemplate.ts` and `emailSignature.ts`. Cream/Ink/Sky editorial design. Table-based, inline CSS, Outlook-safe favicon mark (Ink circle with Sky "S"). No CTA pills in the wrapper — body content only. Date stamp top-right. Three-column footer.
- **Call Summary card** pinned to the lead profile (above tabs) AND the dialler (between call button and Email Prep). Always visible. Empty state for never-called leads. Stays visible across all call states so Jordan reads the rolling AI summary mid-call. Internal scroll capped at 260px so a long summary doesn't shove other widgets off-screen.
- **Reconnect Calendar chip** on home page (top-right of action button row, in line with "Create lead" / "Import CSV", above the Avg Call stat). Polls `/api/google/status` on mount, on window focus, and every 5 min. Only renders when `authenticated === false`.
- **Auth + per-user identity** (the big piece — see §4).
- **Activity attribution** (also §4).

---

## 10. Open / deferred work (none are launch-blocking)

- **`server/src/prompts/emailDraft.ts`** — `buildEmailDraftPrompt` and `buildEmailSubjectPrompt` are exported but not imported anywhere. **Dead code.** Either delete or wire up. The active prompt path is in `services/ai-summary.ts`.
- **Per-user Google calendar OAuth** — currently shared. Big refactor (per-user token storage + per-user reconnect UX). Skip unless it actively annoys them.
- **Sentry** — would need Jordan to add `SENTRY_DSN` env var.
- **Resend major upgrade** — clears the residual `uuid<14` transitive vuln. Breaking change.
- **`activities` and `emails_sent` table archival** — both grow unbounded. Not urgent at 2-user scale.
- **CSV import column-name validation feedback** — silently drops unknown columns.
- **Submit OAuth app for Google verification** — kills the 7-day re-auth chip permanently. Multi-week external process.
- **Automated DB backup** — currently manual, documented in RUNBOOK.

---

## 11. Conventions / things to watch for

- **Pipeline stages must agree in 5 places** — `shared/types.ts`, `server/src/routes/leads.ts` (createLeadSchema + updateLeadSchema), `server/src/routes/pipeline.ts` (PIPELINE_STAGES + stageLabels), `client/src/pages/LeadProfilePage.tsx` (PIPELINE_STAGES), `client/src/pages/HomePage.tsx` (STAGE_CONFIG). Missing one causes silent 400 errors.
- **Call notes are append, never replace** — when summarising a new call for an existing lead, feed Claude the prior `consolidated_summary` plus the new transcript. `summariseAndPersistCall` does this.
- **Wrong Number deletes the lead entirely** including call logs. Intentional. Cascade FKs now ensure cleanup.
- **Follow-up date auto-moves the lead to `follow_up` stage**. Server handles this.
- **Emails always include both `text` and `html`**. Always include the signature.
- **No emojis in code, commits, or UI** unless George explicitly asks.
- **Server-side HTML (e.g. email templates) can't be previewed in the dev server**. Render to `/tmp/oxyscale-email-preview/preview.html` and `open` it.
- **Don't delete the `.claude/` or untracked `package-lock.json` at the repo root** — both are George's local files, not yours.
- **Use sub-agents for the heavy explore work**. Three Explore agents in parallel produced the production audit. Very effective for "find me everything wrong with X" queries that would otherwise blow context.
- **Memory rules**: never save secrets. Auto-memory at `~/.claude/projects/.../memory/MEMORY.md`. Update via Write tool when you learn lasting facts about George, their workflow, or the project.
- **Railway auto-deploys `main`** within ~1 min of a push. After every push, wait then verify with `curl https://oxycrm-production.up.railway.app/api/health`.
- **Both users push to main**. Coordinate when working in parallel — no formal branch protection.
- **The Plan / Explore / Code-Review subagents are appropriate** for non-trivial changes. Use them.

---

## 12. Most recent state (snapshot at handover time)

- Working tree clean — no uncommitted changes besides untracked `.claude/` and `package-lock.json` at the root (George's local).
- `HEAD` matches `origin/main` at `ddab5a2` (`deps: npm audit fix (follow-redirects 1.15.11 -> 1.16.0)`).
- Production responding `200` on `/api/health`.
- UptimeRobot watching.
- Previous in-flight work: George was about to **configure email behaviour for a manufacturing-niche cold-call campaign**. He has a "full capabilities document for the manufacturing niche" he wants to wire into the system. Best guess at where this fits:
  - **Category prompts** are in the `category_prompts` table, edited via Settings → Category Prompts. The `getCategoryPrompt(category)` helper in `services/ai-summary.ts` injects them into the email-draft prompts as a "playbook" section. Most likely the manufacturing capabilities doc becomes the prompt body for `category = 'Manufacturing'` (verify exact string with George).
  - Alternatively, if he wants it global (across all categories), it goes in the `settings` table key like `company_description` — read via `getSettingsContext()` in `ai-summary.ts`.
  - **Ask him which level he wants before editing.**

---

## 13. How George briefs you

He'll often paste a long voice-note transcription. **Read it whole before responding** — important context tends to be at the end. He sometimes says "ignore me, mate" mid-thought when he realises he's wrong; don't pursue points he's retracted. He prefers short status updates between actions, full reports at end of work, and explicit confirmation of risks before destructive ops. Don't drown him in micro-issues — synthesise.

When in doubt: ask, then build.
