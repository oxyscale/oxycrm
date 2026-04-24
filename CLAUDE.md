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

- **Frontend:** React + Vite + TypeScript + Tailwind (light editorial theme — see Brand rules below)
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

The canonical brand reference lives at `/Users/georgeharrad/oxyscale/internal/brand/BRAND-GUIDELINES.md`. The rules below are the Dialler-specific application of that system. If the two ever disagree, the brand guidelines file wins — update this section.

### Theme

- **Light editorial theme.** Warm Cream page background, White paper cards, Ink black text, Sky blue accent. No dark mode. No black page backgrounds.
- Previous "dark mode only" rule is SUPERSEDED (April 2026 rebrand).

### Colours (use Tailwind tokens — never hard-code)

| Token | Hex | Usage |
|---|---|---|
| `ink` | `#0b0d0e` | Primary text, headings, primary CTA bg |
| `ink-muted` | `#55606a` | Body text, secondary copy |
| `ink-dim` | `#8a95a0` | Tertiary text, labels, captions |
| `ink-faint` | `#b8bfc6` | Placeholder, disabled |
| `sky` | `#5ec5e6` | Primary accent — icons, highlights, glyphs |
| `sky-ink` | `#0a9cd4` | Accent text on light bg, italic editorial words, links |
| `sky-wash` | `rgba(94,197,230,0.12)` | Accent backgrounds, pill highlights |
| `sky-hair` | `rgba(94,197,230,0.24)` | Accent borders, dividers |
| `cream` | `#faf9f5` | Page background |
| `paper` | `#ffffff` | Card/paper surfaces |
| `tray` | `#f2f0e8` | Bezel trays, recessed containers |
| `hair` | `rgba(11,13,14,0.08)` | Standard dividers |
| `hair-soft` | `rgba(11,13,14,0.05)` | Subtle card borders |
| `hair-strong` | `rgba(11,13,14,0.14)` | Prominent dividers |

### Semantic (use sparingly)

- `ok` `#10b981` — success
- `warn` `#f59e0b` — warnings, medium priority (e.g. "due today" follow-ups)
- `risk` `#ef4444` — errors, high priority (e.g. "overdue" follow-ups)

### Typography

- **Sans (UI):** Geist — weights 400, 500, 600.
- **Mono (labels, tags, data):** Geist Mono — weight 400.
- **Editorial accent (italic words in headings):** Fraunces italic, weight 400, colour `sky-ink`. Use for 1–3 key words in a headline, e.g. *"Intelligence your team will actually use."* Reserve for marketing-style surfaces; use judgement for internal CRM headings.
- Fallback stack: Inter, SF Pro Display, -apple-system, BlinkMacSystemFont, system-ui, sans-serif.

Type hierarchy: Hero 72–80px / 500 / -0.04em · Section 32–40px / 500 / -0.03em · Card 16–22px / 500 / -0.02em · Body 15px · Small 13–14px · Mono label 10–11px / 600 / 0.18–0.22em tracking.

### Surfaces & elevation

Layered card system:

1. **Page** — Cream `#faf9f5`
2. **Tray** — `#f2f0e8`, inset highlight `inset 0 1px 0 rgba(255,255,255,0.9)`
3. **Card** — White, `1px hair-soft` border, subtle shadow
4. **Elevated** — White, `1px sky-hair` border, `0 12px 28px -18px rgba(12,141,191,0.35)`

Prefer the **double-bezel** card pattern for primary surfaces: outer tray with `rounded-2xl` + inset highlight, inner white card with `rounded-[calc(2rem-0.375rem)]` and hair-soft border.

### Buttons

- **Primary (dark):** Ink `#0b0d0e` bg, White text, `rounded-full` pill. Optional trailing icon in `bg-white/15` circle. Hover `#1a1d1f`. Active `scale(0.98)`.
- **Outline:** Hair border, Ink text, transparent bg. Hover: subtle sky-wash.
- **Ghost:** No border, no bg, Ink Muted text. Hover: `bg-[rgba(11,13,14,0.03)]`.

### Logo

- **Wordmark (default, light bg):** "Oxy" in Ink `#0b0d0e`, "Scale" in Sky Ink `#0a9cd4`. Geist 600, tracking `-0.035em`.
- **Inverse (dark bg only, rare):** "Oxy" White, "Scale" Sky `#5ec5e6`.
- SVGs live at `/Users/georgeharrad/oxyscale/internal/brand/logos/`. Copy — never redraw.
- Favicon: Black "O" with blue "S" centred. File at `/Users/georgeharrad/oxyscale/internal/brand/icons/favicon.svg`.

### Icons

Phosphor Icons (regular for UI, bold for small sizes, fill for emphasis). Sky Ink for accent, Ink Dim for secondary. 11–16px. Lucide is already present in the codebase — migrate incrementally, don't mix styles within one screen.

### Never use

- Pure black `#000000` (use Ink `#0b0d0e`).
- Dark page backgrounds (`#09090b`, `#18181b` etc — legacy).
- Emerald `#34d399` (legacy accent — replaced by Sky).
- Inter as primary UI font (Geist now).
- Purple/blue AI gradients, pink/magenta accents, drop shadows on the logo.
- Emojis in UI, code, or commit messages (unless the user explicitly asks).

### Animation

- Springs over easing curves (stiffness 150–180, damping 20–26).
- Opacity 0.4–0.55s. Scale entrance 0.95 → 1.0. Y entrance 16–30px up.
- No bounce, no overshoot. Respect `prefers-reduced-motion`.

### Emails

- Header: White bg, wordmark top-left.
- Accent: Sky Ink `#0a9cd4` for headings, links.
- Body: Ink on white/cream. Dividers: `1px rgba(11,13,14,0.08)`.
- CTA: Ink bg, white text, `rounded-full`.
- Footer: Cream `#faf9f5` bg, Ink Dim text.
- Every send: Resend with both `text` and `html`. Always include the signature.

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
- Using Inter or Arial as primary UI fonts (Geist is the brand sans).
- Using pure black `#000000` (use Ink `#0b0d0e`) or re-introducing dark page backgrounds.
- Re-introducing the old emerald `#34d399` accent — Sky blue has replaced it everywhere.
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
