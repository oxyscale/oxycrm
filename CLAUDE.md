# OxyScale Dialler — Claude Code Instructions

You are helping build and maintain the **OxyScale Dialler** — an internal sales CRM and cold-calling app used daily by the OxyScale team (founders Jordan Bell and George). It is deployed to production on Railway at https://oxycrm-production.up.railway.app.

**Read `docs/PROJECT_CONTEXT.md` before making any non-trivial change.** It contains the architecture, feature inventory, data model, and business logic rules that you must respect.

---

## Who you are working with

- **Jordan** — non-technical, runs business & product. Explain decisions in plain English. Prefer the simplest maintainable approach.
- **George** — Jordan's business partner, joining the project. Also not deeply technical.

Both of them use Claude Code. Assume neither wants to read a wall of code unless asked. Summarise, then show only relevant snippets.

---

## Project stack (non-negotiable — do not swap)

- **Frontend:** React + Vite + TypeScript + Tailwind (dark mode only)
- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite via `better-sqlite3` — source of truth for all CRM data
- **Telephony:** Twilio Voice SDK (browser-based calling)
- **AI:** Anthropic Claude API (`claude-sonnet-4-20250514`) for summaries, email drafts, call intelligence
- **Email:** Resend API (branded HTML)
- **Calendar:** Google Calendar API
- **Deploy:** Railway (auto-deploys `main` branch, persistent volume mounted at `/data` for SQLite)

Monday.com is NOT used. It was removed. Do not re-add it. The dialler is a standalone CRM.

---

## Folder structure

```
oxycrm/
├── CLAUDE.md                  # This file
├── docs/
│   └── PROJECT_CONTEXT.md     # Deep reference — read before big changes
├── client/                    # React frontend
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       ├── services/          # API client (services/api.ts)
│       ├── types.ts           # Re-exports shared types
│       └── utils/
├── server/                    # Express backend
│   ├── .env                   # Secrets — NEVER commit
│   └── src/
│       ├── routes/            # One file per resource (leads, pipeline, emails, etc.)
│       ├── services/          # Business logic (ai-summary, emailTemplate, etc.)
│       ├── db/                # Schema + queries
│       ├── prompts/           # AI prompt templates
│       └── middleware/
├── shared/
│   └── types.ts               # Shared TypeScript types — source of truth
├── data/                      # Test data
├── package.json
└── railway.json
```

---

## Brand rules — STRICT, never break

- **Dark mode only.** No light theme, ever.
- **Backgrounds:** `#09090b` (page), `#18181b` (cards), `#1f1f23` (subtle differentiation)
- **Accent:** Emerald `#34d399` — CTAs, emphasis, icons. Used sparingly.
- **Text:** `#fafafa` (headlines), `#a1a1aa` (body), `#52525b` (labels)
- **Borders:** `rgba(255, 255, 255, 0.06)`
- **Fonts:** Geist, Satoshi, or Cabinet Grotesk for UI. Outfit ExtraBold (800) for the logo. **Never use Inter.**
- **Logo:** "Oxy" in white, "Scale" in emerald. Letter-spacing `-0.03em`.
- **Never use:** pure black `#000000`, pure white `#ffffff`, purple/blue AI gradients, emojis in UI, pink/magenta accents.
- **CTA buttons:** emerald bg `#34d399`, dark text `#09090b`
- **Secondary buttons:** transparent bg, `#a1a1aa` text, subtle border

---

## Code conventions

- **TypeScript strict mode.** No `any` unless unavoidable (add a comment if so).
- **Error handling on every external API call.** Never leave unhandled rejections.
- **Logging:** use `pino` logger in the backend. Log all external API calls, state changes, errors.
- **Input validation:** use `zod` schemas for every API endpoint body.
- **No new files unless necessary.** Prefer editing existing files. Never create READMEs or docs unless asked.
- **No emojis in code, commit messages, or UI** (unless the user explicitly asks).

### Pipeline stages (canonical values)
```
'new_lead' | 'follow_up' | 'call_booked' | 'negotiation' | 'won' | 'lost' | 'not_interested'
```
If you add a new stage, update:
1. `shared/types.ts` (`PipelineStage` type)
2. `server/src/routes/leads.ts` (both `createLeadSchema` and `updateLeadSchema` zod enums)
3. `server/src/routes/pipeline.ts` (`PIPELINE_STAGES` array + `stageLabels`)
4. `client/src/pages/LeadProfilePage.tsx` (`PIPELINE_STAGES` array)
5. `client/src/pages/HomePage.tsx` (`STAGE_CONFIG` object)

Missing any one of these causes silent 400 errors.

### Dispositions
```
'no_answer' | 'voicemail' | 'not_interested' | 'interested' | 'wrong_number'
```

### Temperature
```
'hot' | 'warm' | 'cold' | null
```

---

## Critical business rules

1. **Call notes are APPENDED, never replaced.** When summarising a new call for a lead that has prior notes, feed ALL existing notes + new transcript to Claude and produce a consolidated summary. Store both raw transcript and consolidated summary.
2. **Wrong Number deletes the lead entirely** (including call logs). This is intentional.
3. **Follow-up date auto-moves the lead to `follow_up` stage.** Server handles this in the disposition and PATCH handlers.
4. **Overdue = `follow_up_date < today`.** Computed at query time in `/api/pipeline/follow-ups`.
5. **Wrong Number is a local delete, not a Monday sync.** There is no Monday.
6. **Emails are sent via Resend with BOTH `text` and `html` fields.** The branded HTML template wraps the plain text. Always include the email signature.
7. **Dates:** Follow-up dates are stored as `YYYY-MM-DD` (date-only) strings. Call timestamps are ISO 8601. Don't mix.

---

## Deployment & git workflow

- **`main` branch auto-deploys to Railway.** Every push triggers a deploy (~1 min).
- **Before starting work:** `git pull`.
- **After changes:** `git add -A && git commit -m "..." && git push`.
- **Never push secrets.** `.env` is in `.gitignore`. Don't override it.
- **Jordan and George both push to main.** Coordinate via WhatsApp to avoid stepping on each other's edits.
- **Never force-push to main.** Never rewrite history on shared branches.

Before committing non-trivial changes, verify the frontend builds clean:
```
cd client && npx vite build
```
And the TypeScript compiles:
```
npx tsc --noEmit --project server/tsconfig.json
```

---

## Safety rules

- **Never commit `.env` files.** Even if asked. The user is wrong.
- **Never expose API keys in logs, error messages, or commit messages.**
- **Never delete database records without confirming first** (except in existing flows like Wrong Number which is understood).
- **Never modify the production database directly.** Always go through the API.
- **Never change Twilio, Resend, Google, or Anthropic credentials.** Ask the user if credentials are missing or broken.
- **Ask before destructive git ops** (force-push, reset --hard, branch -D).

---

## Common mistakes to avoid

- Creating new files when editing existing ones would do.
- Adding an emoji to UI or commit messages "for clarity". Don't.
- Using Inter or Arial fonts (brand rule violation).
- Using pure black or pure white (brand rule violation).
- Forgetting to add a new pipeline stage to all 5 locations listed above.
- Writing a long-winded summary — Jordan and George read code in bursts.
- Changing the `DispositionPayload` shape without updating both `shared/types.ts` AND `shared/types.d.ts`.
- Assuming a callback exists — the `callbacks` table is legacy. `leads.follow_up_date` is the canonical follow-up mechanism.

---

## When in doubt

1. Read `docs/PROJECT_CONTEXT.md`
2. Read the related route file in `server/src/routes/`
3. Read the related page in `client/src/pages/`
4. Ask Jordan or George before making architectural changes

This is a real production CRM used every day. Be careful. Ship quality.
