# OxyScale Dialler — Operational Runbook

Quick reference for running and recovering the dialler in production. Aimed at Jordan and George.

---

## Where things live

- **Production app:** https://oxycrm-production.up.railway.app
- **Hosting:** Railway. Auto-deploys every push to `main`.
- **Database:** SQLite at `/data/dialler.db` on the Railway persistent volume.
- **Token storage:** `/data/google-tokens.json` (Google OAuth) and `/data/session-secret` (cookie signing key) on the same volume.
- **Logs:** Railway dashboard → Project → Deployments → Logs (live tail).

---

## First-time setup checklist

If a fresh Railway environment is ever spun up from scratch, these env vars must be set on the service before the server boots successfully. The server fails fast on missing values.

**Required (server exits if missing):**

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

**Optional (sensible defaults):**

```
EMAIL_FROM_NAME           default "OxyScale"
CLIENT_URL                default https://<railway-host>
DATA_DIR                  default ../data
PORT                      default 3001
LOG_LEVEL                 default info
TWILIO_CALLER_ID          falls back to TWILIO_PHONE_NUMBER
UNANSWERED_CALL_THRESHOLD default 5
```

After Railway redeploys, the server will:
1. Run schema migrations idempotently (no manual step).
2. Seed Jordan + George user accounts on first boot only.
3. Backfill any pre-auth `call_logs` and `email_drafts` to Jordan's user_id.

---

## Backups

Railway volumes survive deploys but are not snapshotted automatically. Two-line snapshot:

```bash
# From your laptop, with the railway CLI logged in:
railway run --service oxycrm cat /data/dialler.db > dialler-$(date +%F).db
```

Or use Railway's dashboard volume snapshot feature.

**Recommended cadence:** weekly snapshot to local Dropbox / iCloud while user count is just two people. Increase to daily once the dataset matters enough.

**Restore:**
1. Stop the Railway service.
2. Upload the backup file to `/data/dialler.db` via the Railway shell.
3. Restart the service.

---

## Common operations

### Reset a forgotten password

Use the "Forgot password" link on the login page. The reset email goes via Resend to the user's email. Token expires in 60 minutes.

If Resend is broken or you can't receive email:
1. Open Railway shell on the service.
2. `cd server && node -e "..."` — generate a new bcrypt hash.
3. `sqlite3 /data/dialler.db "UPDATE users SET password_hash = '<hash>' WHERE email = 'jordan@oxyscale.ai'"`.

### Reconnect Google Calendar

Tokens get revoked every 7 days while the OAuth app is unverified. Just click "Reconnect calendar" on the home page when the chip appears. The chip auto-disappears once new tokens are honoured.

### Force logout everyone

Delete `/data/session-secret` from the volume. Every active cookie becomes invalid; users see the login page on next request.

---

## What's auto-protected

- Login required for all `/api/*` except Twilio webhooks, Google OAuth callback, and `/api/health`.
- Twilio webhooks signed with `TWILIO_AUTH_TOKEN` — spoofed POSTs return 403.
- Rate limits: 30 auth attempts / 15 min / IP, 30 hits / min / IP on AI / email / transcribe.
- HTTPS enforced in production. HSTS for 180 days.
- Helmet security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP).
- CSV upload capped at 10 MB / 1 file.
- Server exits cleanly on SIGTERM (Railway redeploys won't truncate in-flight calls).

---

## Health checks

- `GET /api/health` returns `{ status: "ok" }`. Use this from Railway's health probe.
- Server log line on boot: `OxyScale Dialler server is running` confirms successful startup.

If `/api/health` returns non-200 in Railway logs but the deploy went green, check the live tail for `[FATAL] Missing required env vars` — that's the most common cause.
