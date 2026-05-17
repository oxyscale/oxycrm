# OxyCRM Handoff — May 2026

This doc orients a fresh Claude session on the state of the codebase after
the dialler-to-CRM pivot. Read it together with `CLAUDE.md` and
`docs/PROJECT_CONTEXT.md`.

---

## How Jordan uses this app (read first)

- **Calls happen on his personal mobile.** Not in the browser. Twilio is
  gone. He has Wispr Flow installed for dictation.
- **His daily loop:**
  1. Browse leads (Pipeline kanban OR Dialler list — both work)
  2. Open a lead profile, find the right director on the company website
  3. Edit the phone number on the profile (replace the company 1800 with
     the director's mobile)
  4. Call them on his mobile
  5. Come back, focus the Transcripts tab textarea, dictate the call with
     Wispr Flow
  6. Hit **Save and draft email** OR just **Save transcript**
  7. Move them between tiers as the relationship matures
  8. **Set Task** for the next touch — it lands on Google Calendar
- **Fortnightly investor pulse check:** he opens Reports, picks a date
  range, hits Print, sends the PDF.
- He is non-technical. Explain decisions in plain English, prefer
  the simplest maintainable approach, no walls of code.

---

## Mental model of the current product

```
Home (/)               Lead intake + quick stats + Today's queue
Pipeline (/pipeline)   Kanban: Tier 1 / Tier 2 / Tier 3 / Won / Lost
                       Per-column $ totals. Category filter only.
Leads (/leads)         Sortable table of every lead
Dialler (/dialler)     Lightweight lead browser (was the softphone)
Lead Profile (/leads/:id)
  - Top: Email / Book Meeting / Add Note / Set Task + Tier dropdown
  - Tabs: Activity | Transcripts | Notes | Emails
  - Sidebar: Lead Details, Tasks list, Activity Stats, Project link
Email Bank (/email-bank)    Post-call AI email drafts queue (legacy-ish)
Projects (/projects)        Won leads as active jobs
Call Intelligence (/intelligence)   AI analysis over call history
Stats (/dashboard)          KPIs
Reports (/reports)          Investor pulse-check (date range, KPI strip,
                            tier $ breakdown, new leads, won, lost, tasks)
Settings (/settings)
  - Category Prompts
  - Company Profile
  - Email Preferences
  - Email Signature
  - Lead Cleanup (merge categories, dedupe by phone)
  - Account
```

---

## Pipeline stages (canonical)

```
'tier_1' | 'tier_2' | 'tier_3' | 'won' | 'lost'
```

The legacy stages (`new_lead`, `follow_up`, `call_booked`, `negotiation`,
`not_interested`, `five_strikes`) were auto-migrated to the tier model.

**To add or change a stage, update all 5 places:**
1. `shared/types.ts` (`PipelineStage` type)
2. `server/src/routes/leads.ts` (createLeadSchema + updateLeadSchema)
3. `server/src/routes/pipeline.ts` (PIPELINE_STAGES + stageLabels)
4. `client/src/pages/LeadProfilePage.tsx` (PIPELINE_STAGES array)
5. `client/src/pages/HomePage.tsx` (STAGE_CONFIG)

---

## Concepts that are GONE — don't reintroduce

| Removed | Why | What replaced it |
|---|---|---|
| Twilio Voice SDK | Jordan calls on his mobile | Manual transcripts + Log Call flow |
| Temperature (hot/warm/cold) | Tiers do this better | Tier 1 / 2 / 3 |
| Status badge (Called / Not Called) | Anyone in a tier has been spoken to | (nothing — implicit) |
| In-browser Call button | No Twilio | "Open" or navigate to profile |
| Follow-up date input next to tier | Confusing UX | Set Task panel |
| Log Call button + disposition flow | Manual transcripts cover it | Transcripts tab dictation |
| Monday.com | Removed in the CRM pivot | This app IS the source of truth |

If you find any leftovers (temperature pill on a card, "Call" button
that routes to `/dialler` with `loadLeadId`, etc.), nuke them.

---

## Key features shipped in the recent chat

### Set Task (lead profile)
- Inline panel: label + date
- Creates a row in `tasks` table
- Best-effort drops a 9am Sydney Google Calendar event
- Mirrors to `leads.follow_up_date` so Pipeline > Follow-ups still works
- Tasks list panel in the sidebar — checkbox to complete, hover X to delete
- Endpoints: `GET/POST /api/leads/:id/tasks`, `PATCH/DELETE /api/tasks/:id`

### Transcripts (lead profile)
- "Calls" tab renamed
- Top textarea + Save transcript / Save and draft email
- Wispr Flow dictation lands here system-wide (no integration needed)
- Backend endpoint: `POST /api/leads/:id/transcripts`
- Saves to `call_logs` with `disposition='interested'` — no state-machine
  side effects
- Each transcript card has "Send email based on this" — stashes transcript
  in `sessionStorage` under `transcript-context-{leadId}` then navigates
  to `/compose/:leadId`
- Compose page auto-reads the stash, passes it to Claude as context,
  auto-fires the draft on mount, shows a sky banner

### Deal Value
- New `deal_value` REAL column on `leads` (default 0)
- Inline editor in Lead Profile sidebar (`DealValueEditor` component)
- Shown as a badge on Pipeline cards
- Summed per-column in Pipeline header
- Aggregated in Reports

### Reports page (`/reports`)
- Date range + category filter + quick presets (7/14/30/90 days)
- KPI strip: pipeline value / new leads / won / lost
- Per-tier breakdown (count + $)
- New leads in window
- Won + Lost in window
- Tasks due/overdue
- Print button

### Lead Cleanup (Settings tab)
- Merge category from -> into (e.g. Styling -> Property Styling)
- Dedupe by phone (last 9 digits — collapses +61 / 0 prefixes)
- Dry-run preview then bulk merge

---

## Files added recently

- `server/src/routes/tasks.ts`
- `server/src/routes/reports.ts`
- `client/src/pages/ReportsPage.tsx`
- `docs/HANDOFF.md` (this file)

## Files deleted recently

- `server/src/routes/twilio.ts`
- `server/src/middleware/twilioSignature.ts`

---

## Dates

- **Stored** as `YYYY-MM-DD` (date-only) or ISO 8601 (timestamps).
- **Displayed** in Aussie format with ordinal suffix: `17th of May 2026`.
- Activity timeline has a `humaniseDates()` helper that reformats any
  YYYY-MM-DD substring at render time, so old rows also look right.

---

## Deploy + git

- `main` auto-deploys to Railway, ~60s normally, ~2 min on dependency
  changes.
- Build script: `npm run build:client && cd server && npm install --include=dev`
  (the `--include=dev` is critical — Railway sets `NODE_ENV=production`
  which would otherwise skip devDeps like vite, tsx).
- `tsx` is in server `dependencies` (not devDependencies) so `npm start`
  works after `npm prune --production`.
- Git auth lives in macOS Keychain via PAT. Jordan generated a token
  earlier in the chat and ran:
  ```
  git config --global credential.helper osxkeychain
  ```
  Future pushes from his terminal "just work". If a fresh terminal
  ever prompts, paste `oxyscale` as username and the keychain'd PAT
  as password.

---

## Verifying after a push

```bash
# Bundle hash changes on every deploy
curl -s https://oxycrm-production.up.railway.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1

# Health
curl -s https://oxycrm-production.up.railway.app/api/health

# Grep the deployed JS for a known new string to confirm
curl -s "https://oxycrm-production.up.railway.app/assets/<BUNDLE>.js" | grep -c "Active Pipeline Value"
```

Always remind Jordan to **hard refresh (Cmd+Shift+R)** — he gets fooled
by browser cache regularly.

---

## Known leftovers (not urgent, candidates for future tidy-ups)

- `pending_transcripts` and `call_sessions` SQLite tables are dead.
  Kept for data integrity; safe to drop in a future migration.
- `twilio_call_sid` column on `call_logs` is unused; new rows write NULL.
- `useDiallerSession` hook is still used by HomePage / LeadsPage /
  DispositionPage / EmailComposePage — could be slimmed further but the
  Twilio bits are already gone.
- DispositionPage and EmailComposePage are remnants of the old call flow.
  Still wired up but Jordan doesn't really hit them anymore.
- "Calls this week" / "Connect rate" KPI cards on Home page reflect the
  call_logs that come from manual transcripts now — numbers are valid
  but the framing is dated.
- `callbacks` table is legacy — `leads.follow_up_date` is canonical.
- Email Bank page still references the post-Twilio email draft pipeline
  in places.

---

## Posture for the next session

- Jordan is iterating fast. Ship small, push often.
- He doesn't want pre-flight questions for trivial things — just do it.
- He DOES want a sanity-check before destructive ops (force push, drop
  table, bulk delete).
- He prefers a 2-3 sentence summary + a "what to test" note, not a
  paragraph dump of the diff.
- If a deploy crashes, check the Railway build logs first — vite-not-found
  or tsx-not-found are the usual suspects (see the build script note above).
