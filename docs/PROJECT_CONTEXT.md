# OxyScale Dialler — Project Context

Full reference document for the OxyScale Dialler CRM. Read this before making non-trivial changes. `CLAUDE.md` in the repo root is the short-form rulebook; this file is the deep reference.

**Last major update:** Follow-up date system + two-queue home page (April 2026).

---

## 1. What this is

The OxyScale Dialler is a full-stack internal CRM and outbound cold-calling platform, built and used by OxyScale (an AI/automation consultancy). Its primary user is Jordan Bell (founder) — George recently joined as a second user.

**Core workflow:**
1. Import a batch of leads (CSV or manually created)
2. Hit "Start Dialler" — app calls leads one at a time through the browser via Twilio
3. After each call, the user dispositions the outcome (Didn't Answer, Voicemail, Not Interested, Interested, Wrong Number)
4. For interested leads, AI drafts a personalised follow-up email pulling from the call transcript
5. User reviews/edits the email and sends it via Resend (branded HTML)
6. Optional: book a calendar meeting via Google Calendar from the disposition page
7. Leads flow through a pipeline: New Lead → Follow Up → Call Booked → Negotiation → Won / Lost / Not Interested

Production URL: https://oxycrm-production.up.railway.app
GitHub: https://github.com/oxyscale/oxycrm

---

## 2. Architecture

### High level

```
┌──────────────┐      HTTPS      ┌──────────────────┐
│   Browser    │ ───────────────▶│  Express Server  │
│  (React)     │                 │  (Railway)       │
│   Twilio     │──WebRTC──▶      │                  │
│   Voice SDK  │                 │  SQLite @ /data  │
└──────────────┘                 └────────┬─────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │   External APIs:                        │
                     │   - Twilio (voice + recordings)         │
                     │   - Anthropic Claude (AI)               │
                     │   - Resend (email)                      │
                     │   - Google Calendar                     │
                     │   - Google OAuth                        │
                     └────────────────────────────────────────┘
```

### Why SQLite

- Single-user (really 2 users) internal tool. No concurrency needs beyond WAL mode.
- Railway persistent volume at `/data` survives deploys.
- Zero ops overhead. Backups handled by Railway volume snapshots.
- If we ever outgrow it, migration to Postgres is straightforward (betterer-sqlite3 → pg with Prisma).

### Deployment

- GitHub `main` branch → Railway auto-deploy
- Railway runs `npm start` which runs both the built server and serves the built client static files
- `.env` values are set as Railway environment variables (NOT committed)
- SQLite DB lives at `/data/dialler.db` on the Railway persistent volume

---

## 3. Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend framework | React 18 | |
| Build tool | Vite | |
| Styling | Tailwind CSS | Light editorial theme (Cream/Ink/Sky) — see `CLAUDE.md` Brand rules |
| Language | TypeScript (strict) | |
| Backend | Node.js + Express | |
| Database | SQLite via `better-sqlite3` | WAL mode |
| Schema validation | `zod` | On every API endpoint |
| Logging | `pino` | Structured JSON logs |
| Telephony | Twilio Voice SDK (browser) | Outbound calls through browser |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) | Summaries, email drafts, call intelligence |
| Email | Resend API | Both `text` and `html` fields |
| Calendar | Google Calendar API | OAuth 2.0 |
| Router | React Router v6 | |
| Icons | Lucide React | |

Monday.com integration was removed in April 2026 — do not re-add.

---

## 4. Folder structure

```
oxycrm/
├── CLAUDE.md                        # Claude Code rulebook (short)
├── docs/
│   └── PROJECT_CONTEXT.md           # This file
├── .env.example                     # Template for secrets
├── .gitignore
├── package.json                     # Root — runs both client and server
├── railway.json                     # Railway deploy config
├── gmail-signature.html             # Standalone Gmail signature template
├── test-leads.csv                   # Sample data
│
├── client/                          # React frontend (Vite)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # Routes
│       ├── types.ts                 # Re-exports from ../../shared/types
│       ├── pages/
│       │   ├── HomePage.tsx         # Dashboard + follow-up queue
│       │   ├── DiallerPage.tsx      # Active call screen
│       │   ├── DispositionPage.tsx  # Post-call actions
│       │   ├── EmailComposePage.tsx # Send follow-up email
│       │   ├── PipelinePage.tsx     # Kanban view
│       │   ├── LeadProfilePage.tsx  # Full lead detail
│       │   ├── IntelligencePage.tsx # AI call analysis
│       │   ├── ProjectsPage.tsx     # Won leads → active projects
│       │   ├── SettingsPage.tsx     # Category prompts, profile, signature
│       │   └── BookMeetingPage.tsx  # Google Calendar booking
│       ├── components/
│       │   ├── Layout.tsx           # Sidebar + outlet
│       │   ├── Logo.tsx
│       │   ├── BrandedEmailPreview.tsx
│       │   └── ...
│       ├── hooks/
│       │   ├── useDiallerSession.tsx  # Core dialler state (context provider)
│       │   └── useTwilio.tsx          # Twilio Device wrapper
│       ├── services/
│       │   └── api.ts               # All API calls from the frontend
│       ├── utils/
│       │   ├── names.ts             # First name extraction
│       │   └── emailTemplate.ts     # Email text construction
│       └── assets/
│
├── server/                          # Express backend
│   ├── .env                         # SECRETS — never commit
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # App entry — wires up routes
│       ├── db/
│       │   ├── index.ts             # DB singleton
│       │   └── schema.ts            # Table definitions + migrations
│       ├── routes/                  # One router per resource
│       │   ├── leads.ts             # CRUD, CSV import, disposition, search
│       │   ├── pipeline.ts          # Stage changes, pipeline view, follow-ups
│       │   ├── calls.ts             # Call stats
│       │   ├── emails.ts            # Draft + send
│       │   ├── callbacks.ts         # Legacy callback reminders
│       │   ├── notes.ts             # Standalone notes on leads
│       │   ├── activities.ts        # Timeline events
│       │   ├── projects.ts          # Won leads → projects
│       │   ├── intelligence.ts      # AI call analysis
│       │   ├── settings.ts          # Key-value config + category prompts
│       │   ├── google.ts            # OAuth + Calendar API
│       │   ├── twilio.ts            # Token, voice webhook, recording webhook
│       │   ├── transcribe.ts        # Whisper transcription
│       │   └── search.ts            # Global lead search
│       ├── services/
│       │   ├── ai-summary.ts        # Claude prompts for summaries + email drafts
│       │   ├── email.ts             # Resend wrapper
│       │   ├── emailTemplate.ts     # Branded HTML wrapper
│       │   ├── emailSignature.ts    # Table-based HTML signature block
│       │   ├── monday.ts            # REMOVED — do not re-add
│       │   └── twilio.ts            # Twilio helper functions
│       ├── prompts/
│       │   ├── callSummary.ts       # System prompt for post-call summary
│       │   └── emailDraft.ts        # System prompt for follow-up email
│       └── middleware/
│           ├── errorHandler.ts      # ApiError class + global handler
│           └── logger.ts
│
├── shared/                          # Types shared between client and server
│   ├── types.ts                     # Canonical source
│   └── types.d.ts                   # Auto-generated — keep in sync
│
└── data/                            # Sample CSVs, test leads
```

---

## 5. Database schema (SQLite)

Managed in `server/src/db/schema.ts`. Migrations are additive — check for column existence before `ALTER TABLE`. Never drop columns (SQLite makes that painful).

### Main tables

#### `leads`
Core entity. Every person we might call is a lead.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `company` | TEXT | nullable |
| `phone` | TEXT | |
| `email` | TEXT | nullable |
| `website` | TEXT | nullable |
| `lead_type` | TEXT | `'new'` \| `'callback'` |
| `category` | TEXT | Industry tag (e.g. "Property Styling") |
| `status` | TEXT | `'not_called'` \| `'called'` |
| `unanswered_calls` | INTEGER | Count of unanswered attempts |
| `voicemail_left` | INTEGER | Bool (0/1) |
| `voicemail_date` | TEXT | ISO timestamp |
| `consolidated_summary` | TEXT | Running AI-summarised history |
| `company_info` | TEXT | Optional web-enriched background |
| `pipeline_stage` | TEXT | See pipeline stages below |
| `temperature` | TEXT | `'hot'` \| `'warm'` \| `'cold'` \| NULL |
| `converted_to_project` | INTEGER | Bool |
| `follow_up_date` | TEXT | YYYY-MM-DD, nullable |
| `queue_position` | INTEGER | For cycler ordering |
| `last_called_at` | TEXT | ISO timestamp |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

#### `call_logs`
One row per call attempt.

| Column | Notes |
|---|---|
| `id`, `lead_id` | |
| `duration`, `disposition` | seconds, and enum |
| `transcript`, `summary` | Full text + AI summary |
| `key_topics`, `action_items`, `sentiment` | JSON arrays / string |
| `twilio_call_sid` | For matching recordings |
| `created_at` | |

#### `callbacks` (legacy — being phased out)
Older mechanism for scheduled callbacks. Replaced by `leads.follow_up_date`. Still populated on Interested disposition with `callbackDate`, but the follow-up queue reads from `leads` directly.

#### `notes`
Standalone notes on a lead (addable any time, not just after calls).

#### `activities`
Timeline events shown on the lead profile. One row per event (call, note, email, stage_change, meeting, temperature_change).

#### `emails_sent`
Log of every email sent (and received, once Gmail auto-logging is built).

#### `projects` + `project_tasks`
Won leads become projects. Has its own kanban-style status (`onboarding` \| `in_progress` \| `review` \| `complete`).

#### `settings`
Key-value pairs. Used for: sender name, title, phone, website URL, Calendly link, Calendly duration, company description, email sign-off, etc.

#### `category_prompts`
One free-text prompt per industry category. Injected into Claude's email drafting prompt to tailor language per industry.

#### `pending_transcripts`, `call_sessions`
Internal tables for matching Twilio recordings to calls.

### Key indices

- `idx_leads_queue` — for "next lead to call"
- `idx_leads_pipeline_stage` — for pipeline view
- `idx_leads_follow_up_date` — for follow-up queue
- `idx_activities_lead` — for profile timeline

---

## 6. Pipeline stages

The canonical list (defined in `shared/types.ts`):

```ts
'new_lead' | 'follow_up' | 'call_booked' | 'negotiation' | 'won' | 'lost' | 'not_interested'
```

**How leads move between stages:**

- **New Lead** — default on creation/import. Enters the cold-call cycler.
- **Follow Up** — set by: (a) disposition with follow-up date, (b) manual change on lead profile, (c) email sent with `pipelineStage: 'follow_up'`. Appears in the follow-up queue on the home page.
- **Call Booked** — manual, or email sent with `pipelineStage: 'call_booked'`. Used when a meeting is scheduled.
- **Negotiation** — manual. Hot leads in active conversation.
- **Won** — manual. Can optionally spawn a Project record.
- **Lost** — manual. Terminal.
- **Not Interested** — disposition or manual. Terminal (but we keep the transcript for training).

**Adding a new stage requires updating 5 files** — see CLAUDE.md for the list.

---

## 7. Feature inventory (what's already built)

### ✅ Lead management
- CSV import with duplicate detection (moves duplicates to target pipeline stage)
- Manual lead creation
- Lead profile page with tabbed interface (Activity / Calls / Notes / Emails)
- Inline edit of name, company, phone, email, website, category
- Global search (name, company, phone, email)

### ✅ Dialler
- Twilio Voice SDK browser-based calling (no softphone needed)
- Call cycler: queue with `queue_position`, cycles unanswered leads to the back
- Previous call intel shown during active calls (prior summaries for context)
- Real-time call status (ringing, connected, ended)
- Call duration tracking

### ✅ Dispositions (5 options)
- **Didn't Answer** → increment unanswered_calls, cycle to back
- **Left Voicemail** → same as above + set voicemail flag + offer to send voicemail follow-up email
- **Not Interested** → move to `not_interested` stage (keep transcript)
- **Interested** → route to email composition page
- **Wrong Number** → DELETE lead entirely (intentional)

Each disposition supports optional follow-up date (auto-moves to `follow_up` stage).

### ✅ AI features
- Post-call summary (3-5 bullets, key topics, action items, sentiment)
- Consolidated summary across ALL calls for a lead (not just the latest)
- AI-drafted follow-up emails pulling from transcript
- Voicemail follow-up email drafting (shorter, softer tone)
- Call intelligence: aggregate analysis across all calls (objections, winning patterns, recommendations)
- Category-specific prompts (industry context injected per lead)

### ✅ Email system
- Resend API integration
- Branded HTML template (dark header, emerald accent, signature block)
- Per-user email signature (name, title, phone, website link, Calendly CTA)
- Standalone `gmail-signature.html` for Jordan's Gmail
- Email composition page with live branded preview

### ✅ Google Calendar
- OAuth flow for connection
- Read events for a day (shows your schedule on the booking screen)
- Create events with optional Google Meet link
- Australian timezone support
- Meeting booking directly from disposition page or lead profile

### ✅ Follow-up system (new)
- `follow_up_date` on every lead
- Dedicated follow-up queue on the home page with 3 tiers:
  - **Overdue** (red) — date has passed
  - **Due today** (amber)
  - **Upcoming / no date** (grey)
- One-click Call button next to each follow-up
- Inline date picker on disposition screen and lead profile
- Auto-moves lead to `follow_up` stage when date is set

### ✅ Pipeline & home page
- Pipeline Kanban board with all 7 stages
- Home page dashboard: pipeline overview, temperature breakdown, recent activity, follow-up queue, call stats
- Navigation sidebar to all sections

### ✅ Settings
- **Category Prompts** — one free-text prompt per industry, injected into Claude
- **Company Profile** — sender name, title, company description, sign-off
- **Email Preferences** — from address, Calendly link, Calendly duration
- **Email Signature** — live preview, editable fields
- Settings stored as key-value in `settings` table

### ✅ Projects
- Won leads can be converted to a Project
- Project status pipeline: `onboarding` → `in_progress` → `review` → `complete`
- Tasks (checklist) per project

### ✅ Activity timeline
- Every action (call, note, email, stage change, meeting, temperature change) creates an activity row
- Shown on lead profile and home page recent activity

### 🚧 Known unfinished / planned
- **Gmail auto-logging** — monitor sent folder, match recipient emails to leads, auto-log to activity. Planned. Jordan will need to re-authenticate Google for this.
- **Multi-user support** — currently single-user. Future: add user accounts so George + future hires can have separate email signatures and activity attribution.
- **Mobile responsive polish** — works on desktop, not optimised for mobile.

---

## 8. Key business rules (get these right)

### Call notes are APPENDED, never replaced
When a new call happens for a lead with existing notes/summary:
1. Fetch the existing `consolidated_summary`
2. Pass BOTH the old summary AND the new transcript to Claude
3. Produce a new consolidated summary that weaves together the full history
4. Store BOTH the raw transcript (in `call_logs`) AND the consolidated summary (in `leads.consolidated_summary`)

### Cycler queue rules
- Unanswered leads go to the BACK of the queue — not the next slot
- Implemented by setting `queue_position = MAX(queue_position) + 1`
- Voicemail flag persists so "Voicemail previously left on [date]" is shown on redial

### Disposition side effects

| Disposition | Side effect |
|---|---|
| `no_answer` | `unanswered_calls++`, queue to back, status stays `not_called` |
| `voicemail` | Same as above + `voicemail_left = 1`, `voicemail_date = now`, offer email |
| `not_interested` | `pipeline_stage = 'not_interested'`, `status = 'called'`, keep transcript |
| `interested` | `status = 'called'`, route to email composition |
| `wrong_number` | DELETE lead + all call logs |

If `followUpDate` is provided on any disposition (except wrong_number), also:
- Set `leads.follow_up_date`
- Set `leads.pipeline_stage = 'follow_up'`

### Email sending
- Every email goes through Resend with BOTH `text` and `html` fields
- The branded HTML wraps the plain text body
- Always includes the email signature (from `settings` table)
- Log every send to `emails_sent` table
- Create an `activities` row of type `email`

---

## 9. AI prompts

Stored in `server/src/prompts/`:

- `callSummary.ts` — System prompt for generating the 5-bullet call summary
- `emailDraft.ts` — System prompt for follow-up email, with branches for voicemail / real conversation / short call

Email drafts are tone-controlled:
- Short, direct, no jargon
- No em dashes
- Sound human, not AI
- Australian vernacular OK
- Weaves in category-specific context if a `category_prompts` entry exists for this lead's category
- Pulls Calendly link, sender name, sign-off from `settings`

**Do not change the prompt tone without asking Jordan.** He has strong preferences:
- Short and punchy
- "Sound like you're texting a mate"
- No "I hope this email finds you well"
- No bullet-point lists of features

---

## 10. External integrations

### Twilio
- Account SID + Auth Token in env
- Voice SDK token generated by backend `/api/twilio/token` (short-lived JWT)
- Outbound calls via TwiML App SID
- Recording webhook: Twilio calls back with recording URL → backend downloads → Whisper transcribes → stored in `call_logs.transcript`
- Australian phone number (+61) for outbound — Jordan working on regulatory bundle for the AU number

### Resend
- API key in env
- From address configurable in settings
- Sends both `text` and `html` in every request
- Uses signed sending domain

### Anthropic Claude
- API key in env
- Model: `claude-sonnet-4-20250514`
- Called via official SDK
- Structured outputs via JSON mode where applicable

### Google Calendar
- OAuth 2.0 flow
- Tokens stored in `settings` table
- Redirect URI must match Railway URL exactly
- Scopes: `calendar.events`, `calendar.readonly`, `userinfo.email`
- (Future: will also need Gmail read scope for auto-logging)

---

## 11. Environment variables

All in `server/.env` (local) or Railway env vars (production):

```
# Anthropic
ANTHROPIC_API_KEY=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_TWIML_APP_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=

# Resend
RESEND_API_KEY=
EMAIL_FROM_ADDRESS=
EMAIL_FROM_NAME=OxyScale

# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://oxycrm-production.up.railway.app/api/google/callback

# OpenAI (Whisper for transcription)
OPENAI_API_KEY=

# App
PORT=3001
CLIENT_URL=https://oxycrm-production.up.railway.app
NODE_ENV=production
DATABASE_PATH=/data/dialler.db    # Railway persistent volume
```

`.env.example` in the repo root has the template (no values).

---

## 12. Common gotchas

### Pipeline stage mismatches
If a PATCH to `/api/leads/:id` with `pipelineStage: 'some_stage'` returns 400, check that the stage is included in:
- `shared/types.ts` `PipelineStage` type
- `server/src/routes/leads.ts` both zod schemas (`createLeadSchema` and `updateLeadSchema`)
- `server/src/routes/pipeline.ts` `PIPELINE_STAGES` array

This is a repeat mistake — `not_interested` was missing from the zod schemas for a while, causing silent import failures.

### Shared types drift
`shared/types.ts` is the source of truth. `shared/types.d.ts` is a compiled companion. If you change one, check the other.

### Follow-up date timezones
Follow-up dates are stored as `YYYY-MM-DD` (date-only), not timestamps. When comparing to "today", use `new Date().toISOString().split('T')[0]`, not a timestamp diff. Jordan is in Australia (AEST/AEDT) — if Railway's server is in UTC, "today" can be off by hours during late-evening calls. Currently acceptable.

### Local vs production DB
Your local `npm run dev` uses a LOCAL SQLite file (default: `./dialler.db`). Railway has its own at `/data/dialler.db`. **They are NOT synced.** Imports, leads, test calls in dev stay local. Don't expect your local data to show up in production.

### Email signature rendering in Gmail
Some Gmail clients strip non-inline styles. The `emailSignature.ts` uses inline CSS + table-based layout for compatibility. If George or Jordan want to change the signature design, test it by sending a test to Gmail, Outlook, and Apple Mail.

### Twilio recording latency
After a call ends, the Twilio recording can take 30-120 seconds to be available. The backend polls Twilio's API rather than relying on webhooks (webhooks were unreliable). Expect a delay before transcripts show up on the lead profile.

---

## 13. Working on this repo

### First-time setup
```
git clone https://github.com/oxyscale/oxycrm.git
cd oxycrm
npm install
# Drop .env into server/.env
npm run dev
```

Open http://localhost:5173.

### Daily workflow
```
git pull                         # before starting
# ...make changes...
git add -A
git commit -m "what changed"
git push                         # auto-deploys to Railway in ~1 min
```

### Before committing non-trivial changes
```
cd client && npx vite build                              # verify frontend builds
npx tsc --noEmit --project server/tsconfig.json          # verify server typechecks
```

### Coordination
- Jordan and George both push directly to `main` (no PR review process yet — 2 people only)
- Coordinate via WhatsApp before editing the same file to avoid merge conflicts
- Never force-push or rewrite history on `main`
- Never commit `.env`

### Production URL
https://oxycrm-production.up.railway.app

Railway will auto-deploy within ~1 minute of every push to `main`. Check the Railway dashboard if a deploy seems stuck.

---

## 14. Who to ask

- **Product questions** ("should we do X?") → Jordan
- **Design/brand questions** → Jordan (he has strong opinions)
- **Technical tradeoffs** → discuss between George and Jordan before big changes
- **Credentials / API keys** → Jordan has them
- **Railway access** → Jordan (George should ask Jordan to add him if needed)

---

That's the full picture. Read CLAUDE.md for the rulebook, come back to this doc when you need the why or the how.
