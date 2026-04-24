# OxyScale Dialler — Rebrand Notes

Working notes for the April 2026 aesthetic refresh (Cream / Ink / Sky brand system).
Scope: **frontend-only, cosmetic-only**. No backend/API/logic changes.

Canonical brand reference: `/Users/georgeharrad/oxyscale/internal/brand/BRAND-GUIDELINES.md`.

---

## Design tokens (Tailwind — `client/tailwind.config.ts`)

| Token | Value | Usage |
|---|---|---|
| `ink` | `#0b0d0e` | Primary text, headings, dark CTA bg |
| `ink-muted` | `#55606a` | Body text, secondary copy |
| `ink-dim` | `#8a95a0` | Tertiary text, labels, captions |
| `ink-faint` | `#b8bfc6` | Placeholder, disabled |
| `sky` | `#5ec5e6` | Accent — icons, glyphs, highlights |
| `sky-ink` | `#0a9cd4` | Accent text on light bg (links, headings, mono eyebrows). Brighter than the original brand spec `#0c8dbf` because `#0c8dbf` reads as near-black at UI sizes on cream. |
| `sky-wash` | `rgba(94,197,230,0.14)` | Accent backgrounds, pill highlights |
| `sky-hair` | `rgba(94,197,230,0.28)` | Accent borders (card outlines) |
| `cream` | `#faf9f5` | Page background |
| `paper` | `#ffffff` | Card surfaces |
| `tray` | `#f2f0e8` | Recessed containers, inputs |
| `hair` | `rgba(11,13,14,0.08)` | Standard dividers |
| `hair-soft` | `rgba(11,13,14,0.05)` | Subtle card borders |
| `hair-strong` | `rgba(11,13,14,0.14)` | Prominent dividers |
| `ok` | `#10b981` | Success |
| `warn` | `#f59e0b` | Due-today, medium priority |
| `risk` | `#ef4444` | Overdue, errors |

### Fonts

| Family | Weights | Purpose |
|---|---|---|
| Geist | 400 / 500 / 600 | All UI text |
| Geist Mono | 400 / 600 / 700 | Mono eyebrow labels, tags, metrics |
| Fraunces italic | 400 | **Removed** from UI — didn't look good at Dialler sizes. Kept in Tailwind config (`font-editorial`) for potential marketing surfaces only. |

### Shadows

- `shadow-sky-elevated` — `0 12px 28px -18px rgba(12,141,191,0.35)` — elevated paper cards
- `shadow-sky-strong` — `0 24px 48px -18px rgba(12,141,191,0.5)` — hero surfaces
- `shadow-btn-hover` — `0 4px 12px -6px rgba(12,141,191,0.3)` — pill button hover
- `shadow-card` — `0 30px 80px -40px rgba(11,13,14,0.35)` — generic card lift

### Tracking

- `tracking-hero` `-0.04em`
- `tracking-section` `-0.03em`
- `tracking-card` `-0.02em`
- `tracking-wordmark` `-0.035em`

---

## Shared UI primitives (`client/src/components/ui/`)

Reusable components built to express the brand consistently across pages:

| File | Purpose |
|---|---|
| `Glyph.tsx` | Breathing ring — sky-wash ring + 1.5px sky stroke + solid sky dot. Sidebar logo, status pills, hero accents. |
| `EyebrowLabel.tsx` | Mono uppercase eyebrow (`SALES · COMMAND CENTRE`, `TOTAL LEADS`, etc.). Two variants: `pill` (white rounded-full w/ hair border) or `bare`. Defaults to `tone="sky"` so labels read blue. |
| `PillButton.tsx` | Signature CTA — Ink rounded-full pill with white text + optional trailing arrow in a `bg-white/15` circle. Variants: `primary`, `outline`, `ghost`, `sky`. |
| `SectionHeading.tsx` | Large editorial heading in Sky Ink. Supports an optional `accent` word (formerly italicised — now plain Geist, same colour). `size` `hero` / `section` / `card`. |
| `StatCard.tsx` | Dashboard stat cell — mono eyebrow + 34px Ink number + mono sub-line + sky-wash icon tile. `elevated` prop adds sky-hair border + sky-elevated shadow. |
| `PanelCard.tsx` | Major surface wrapper. Paper bg, hair-soft border (or sky-hair if `elevated`), optional eyebrow + title + right-slot header. |
| `PriorityRow.tsx` | Left-border accent rows for follow-up queues / priority lists. Tones: `risk` / `warn` / `sky` / `neutral`. |

---

## Layout conventions

- **Page bg** — `bg-cream`
- **Panel bg** — `bg-paper`
- **Recessed / tray bg** — `bg-tray`
- **Main content padding** — `px-10 py-10` with `max-w-[1280px] mx-auto`
- **Hero block** — eyebrow pill → big heading → body subcopy → action row of `PillButton`s
- **Stat row** — 4 × `StatCard`, first one `elevated={true}` to anchor
- **Major panels** — `PanelCard` with `eyebrow` + `title` + optional `right` action link
- **Follow-ups** — `PriorityRow` per item, tone by urgency, mono tag + Ink pill "Call" button on right

## Typography conventions

- Hero: 56/72px, Geist 600, tracking-hero, colour `sky-ink`
- Section: 34/40px, Geist 500, tracking-section
- Card: 17-22px, Geist 500, tracking-card
- Body: 15px, Geist 400, colour `ink` or `ink-muted`
- Small body: 13-14px
- Mono eyebrow: 10.5-11px, Geist Mono 700, uppercase, tracking `0.22em`, colour `sky-ink`

## Logo / favicon

- SVGs live at `client/public/`:
  - `oxyscale-wordmark.svg` (default)
  - `oxyscale-wordmark-inverse.svg` (dark bg only)
  - `oxyscale-wordmark-with-glyph.svg` (with ring)
  - `favicon.svg` + `apple-touch-icon.svg`
- Sidebar uses `<Glyph size={28} />` instead of the wordmark (too narrow for text).

## Sidebar (`client/src/components/Layout.tsx`)

- Width unchanged (`w-16`)
- Paper bg, hair-soft border right
- Icons: **Inactive `text-sky-ink/55`** (needs bumping per George — go to full opacity), **active `bg-sky-wash text-sky-ink`** with `bg-sky-ink` 3px left indicator bar
- Help icon uses same active/inactive rules

## Emails (REVERTED — do later)

Email HTML template (`server/src/services/emailTemplate.ts`) and signature (`server/src/services/emailSignature.ts`) were previously rebranded but **reverted** per George's "zero backend changes" rule. Standalone `gmail-signature.html` (root-level, frontend-only file) IS rebranded.

When we're ready to redo the emails, apply the same palette:
- Cream page bg `#faf9f5` → White paper card `#ffffff` with `border: 1px solid rgba(11,13,14,0.05)` and `border-radius: 16px`
- Accent bar: 35% `#0a9cd4` + 65% `rgba(11,13,14,0.08)` (2px)
- Header: white bg, wordmark Ink+Sky Ink, mono `AI & AUTOMATION` label right-aligned
- Sign-off + signature inside the paper card
- CTA pill: `background: #0b0d0e; color: #ffffff; border-radius: 999px; padding: 16px 32px`
- Footer: cream bg, ink-muted wordmark, sky-ink website link
- Signature divider: 60px × 2px `#0a9cd4`
- Signature "Book a call" CTA: Ink pill with white text, `border-radius: 999px`, `padding: 8px 18px`
- Font stack: `Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`

## Global CSS (`client/src/index.css`)

- `body` bg `#faf9f5`, colour `#0b0d0e`, font Geist
- Scrollbar: 8px, track transparent, thumb `rgba(11,13,14,0.12)` → `0.22` on hover
- `::selection` bg `rgba(94,197,230,0.35)`, colour `#0b0d0e`
- `*:focus-visible` outline `2px solid rgba(12,141,191,0.55)` offset 2px

## Pages already rebranded (cosmetic)

- `HomePage.tsx` — fully redesigned using all primitives
- Bulk sed pass already ran across all 17 frontend files converting old dark-mode classes/hex to new tokens. Most pages render in the new palette, they just haven't had the editorial layout treatment yet.

## Pages still to do (editorial layout, cosmetic-only)

1. `PipelinePage.tsx`
2. `LeadProfilePage.tsx`
3. `DiallerPage.tsx`
4. `LeadsPage.tsx`
5. `SettingsPage.tsx`
6. `DispositionPage.tsx`
7. `EmailComposePage.tsx`, `ComposeEmailPage.tsx`
8. `BookMeetingPage.tsx`
9. `DashboardPage.tsx`
10. `IntelligencePage.tsx`
11. `ProjectsPage.tsx`, `ProjectDetailPage.tsx`

## Rules for the rest of the sweep

- **Zero backend edits.** No file under `server/` is touched — including email templates.
- **Zero logic changes.** Same state, effects, API calls, handlers, conditionals, routing, keyboard shortcuts. Only JSX chrome and classes change.
- **Zero removed features.** Every button, field, menu item, empty state, error state that existed continues to exist.
- Before finishing a page, diff it and confirm all `onClick` / `onChange` / `useState` / `useEffect` / `api.` / `navigate()` from the pre-change version still exist in the new version (even if they've moved inside new wrappers).
