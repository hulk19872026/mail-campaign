# HULK Automation — Marketing Center

A web application that pulls your customers from Wave Accounting, sends maintenance-contract
marketing emails through Resend, and never sends more than 99 in a day. It runs entirely on
Railway. You use it in a browser — there is nothing to install and no commands to run daily.

---

## What you get

| Page | What it does |
|---|---|
| Dashboard | Customer count, emails sent, today's 99-limit, open/click rate, active campaign progress |
| Customers | Search, filter, edit, disable, delete, bulk actions, CSV import and export, full profile with email history |
| Campaigns | Eight-step wizard, live queue, pause/resume/cancel, per-recipient status |
| Email templates | Block-based visual editor with live preview and the three HULK plans built in |
| Schedule | Daily limit, next send time, system status, manual "send next batch" button |
| Analytics | Sent/delivered/opened/clicked/bounced/failed, charts over time, per-campaign performance |
| Maintenance leads | Everyone who clicked a maintenance button, with new → contacted → quoted → won/lost |
| Integrations | Wave sync and Resend status, connection tests, test email |
| Settings | Company details, daily limit, batch size, delay, send time, addresses, password, activity log |
| Help | Plain-language answers to the eight questions that come up most |

---

## Deploy to Railway

### 1. Create the project

1. Push this folder to a GitHub repository.
2. In Railway: **New Project → Deploy from GitHub repo** → pick that repository.
3. Railway reads `railway.json` and builds from the `Dockerfile`. No other build config needed.

### 2. Add PostgreSQL

In the same project: **New → Database → PostgreSQL**. Railway creates a `DATABASE_URL`
variable. In your app service, add a variable reference to it (Railway offers
`${{Postgres.DATABASE_URL}}` in the variable editor).

Database tables are created automatically the first time the app boots. There is no separate
migration step to run.

### 3. Add a volume for flyers

**Service → Settings → Volumes → Add volume**, mount path `/data`. Without this, uploaded
flyers disappear on each deploy.

### 4. Set the environment variables

| Variable | Where it goes | What it expects | How to test it |
|---|---|---|---|
| `DATABASE_URL` | Railway service variables | `${{Postgres.DATABASE_URL}}` | Dashboard → System status shows Database connected |
| `SESSION_SECRET` | Railway service variables | A long random string (40+ chars) | You stay signed in after a refresh |
| `APP_URL` | Railway service variables | Your public URL, e.g. `https://marketing.hulkautomation.com` | Unsubscribe links in a test email open your app |
| `ADMIN_EMAIL` | Railway service variables | `david@hulkautomation.com` | Creates your login on boot; change it later and the new address gets an account too |
| `ADMIN_PASSWORD` | Railway service variables | A strong password | You can sign in; change it in Settings afterwards |
| `ADMIN_PASSWORD_RESET` | Railway service variables | Leave unset; `true` only to recover a lost password | Next deploy resets the `ADMIN_EMAIL` password — unset it again afterwards |
| `WAVE_API_TOKEN` | Railway service variables | Wave full-access token (below) | Integrations → Test connection |
| `WAVE_BUSINESS_ID` | Railway service variables | Your Wave business ID (below) | Integrations → Sync customers imports people |
| `RESEND_API_KEY` | Railway service variables | Resend key starting `re_` | Integrations → Test connection |
| `RESEND_FROM_EMAIL` | Railway service variables | `marketing@hulkautomation.com` | Integrations → Send test |
| `RESEND_FROM_NAME` | Railway service variables | `HULK Automation` | Appears as the sender name in the test |
| `RESEND_REPLY_TO` | Railway service variables | `service@hulkautomation.com` | Replies to a test land in that inbox |
| `RESEND_WEBHOOK_SECRET` | Railway service variables | `whsec_…` from Resend (optional) | Open/bounce numbers appear in Analytics |
| `UPLOAD_DIR` | Already set in the Dockerfile | `/data/uploads` | A flyer survives a redeploy |

Generate a session secret with: `openssl rand -base64 48`

### 5. Generate a domain

**Service → Settings → Networking → Generate Domain**, or attach your own subdomain.
Put that address in `APP_URL` and redeploy.

### 6. Sign in

Open the URL, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then change your password under
Settings.

Every boot checks that `ADMIN_EMAIL` has an account and creates one if it does not, so
changing `ADMIN_EMAIL` later and redeploying gives the new address a working login. The old
address keeps its own account until you delete it.

**If sign-in says "That email and password don't match an account":**

1. Confirm `ADMIN_EMAIL` is exactly the address you are typing, and redeploy — the check runs
   at boot, not while the app is running. The deploy log says `Sign-in account ready for ...`
   or `Created an account for ...`, and names the accounts that already exist.
2. If the address is right and the *password* is what does not match, set
   `ADMIN_PASSWORD_RESET=true` alongside `ADMIN_PASSWORD` and redeploy. That resets the
   password for `ADMIN_EMAIL` to `ADMIN_PASSWORD`. **Remove `ADMIN_PASSWORD_RESET` afterwards**
   — while it is set, every deploy overwrites whatever password you chose under Settings.

---

## Wave Accounting setup

1. Sign in to Wave and open the developer portal: https://developer.waveapps.com
2. **Manage Applications → Create an application**. Name it "HULK Marketing Center".
3. On the application page, create a **Full Access Token**. Copy it into `WAVE_API_TOKEN`.
4. Find your business ID: open the API playground and run

   ```graphql
   query { businesses(page: 1, pageSize: 10) { edges { node { id name } } } }
   ```

   Copy the `id` of HULK Automation into `WAVE_BUSINESS_ID`.
5. In the app, open **Integrations → Test connection**, then **Sync customers**.

Only customers with a valid email address are imported. Records are matched on their Wave ID,
so syncing repeatedly never creates duplicates. Run a sync whenever you add customers in Wave.

---

## Resend setup

1. Create an account at https://resend.com
2. **Domains → Add domain** → `hulkautomation.com`. Add the DKIM, SPF and DMARC records Resend
   gives you to your DNS. Wait for the status to turn verified — sending from an unverified
   domain fails.
3. **API Keys → Create API Key** with sending permission. Copy it into `RESEND_API_KEY`.
4. Optional but recommended — **Webhooks → Add endpoint**:
   `https://your-app-url/webhooks/resend`, subscribed to `email.delivered`, `email.opened`,
   `email.clicked`, `email.bounced`, `email.complained`. Copy the signing secret into
   `RESEND_WEBHOOK_SECRET`. Without this, opens and clicks are still tracked through the app's
   own pixel and link redirects; the webhook adds delivery and bounce data.
5. In the app, **Integrations → Send test** to your own address.

Hard bounces and spam complaints automatically add the address to your suppression list.

---

## How the 99-a-day system works

1. A scheduler inside the app wakes up every five minutes.
2. It checks the clock against your send time (default 9:00 AM in your timezone). Before that
   time, it does nothing.
3. It reads today's counter from the database — not from memory — and works out the remaining
   allowance: `daily limit − already sent today`.
4. It finds active campaigns with queued recipients, in the order they were created.
5. It claims a batch (default 10) of recipients and marks them as sending, in a single
   transaction using `FOR UPDATE SKIP LOCKED`. Two copies of the app can never claim the same
   person.
6. It sends the batch through Resend, one email at a time, then waits (default 30 seconds)
   before the next batch. Nothing is fired all at once.
7. Every successful send increments the daily counter and writes a `sent` event.
8. When the counter reaches the limit, the pass stops. The next day it starts again from
   exactly where it left off.
9. When a campaign has no queued recipients left, it is marked completed and you get a
   notification.

**Why it cannot double-send:** `campaign_recipients` has a unique index on
`(campaign_id, customer_id)`. One row per person per campaign — enforced by PostgreSQL, not by
application code. If Railway restarts mid-batch, anything left in the `sending` state is
requeued on boot, and rows already marked `sent` are never touched again.

**Failures:** a rejected address (invalid, unverified domain, bad key) is marked failed
immediately and does not count as delivered. A network blip or rate limit is requeued and
retried up to three times, then marked failed. Nothing retries forever.

---

## Running it locally

```bash
# PostgreSQL must be running locally
cd backend  && npm install
cd ../frontend && npm install

# backend/.env
DATABASE_URL=postgresql://user:pass@localhost:5432/hulk
SESSION_SECRET=anything-long-for-development
APP_URL=http://localhost:8080
ADMIN_EMAIL=david@hulkautomation.com
ADMIN_PASSWORD=pick-something
# ADMIN_PASSWORD_RESET=true   # only to reset a forgotten password, then remove it
UPLOAD_DIR=/tmp/hulk-uploads

# two terminals
cd backend  && npm run dev     # API on :8080
cd frontend && npm run dev     # UI on :5173, proxies to the API
```

---

## Test procedure before your first real campaign

1. **Sign in.** Change your password under Settings.
2. **Settings.** Fill in the mailing address — commercial email in the US and Canada legally
   requires a physical postal address in the footer. Set your timezone and send time.
3. **Integrations → Test connection** for both Wave and Resend. Both should say connected.
4. **Integrations → Sync customers.** Check the count against Wave.
5. **Integrations → Send test** to your own address. Confirm it arrives, is not in spam, and
   the unsubscribe link at the bottom opens your app.
6. **Create a campaign in test mode.** On step 7, turn on test mode and enter your address.
   The banner should read "no customers will receive this campaign". Start it and confirm only
   you receive it.
7. **Click the unsubscribe link** in that test email. Confirm the customer record shows
   Unsubscribed. (Use a spare address, not your own customer record.)
8. **Click the maintenance button** in the test email. Confirm it appears under Maintenance
   leads.
9. **Create the real campaign.** Review the confirmation screen: recipient count, daily limit,
   estimated days, from address, subject. Send one more test from that screen, then start.
10. **Check the dashboard the next morning.** The counter should show yesterday's total and
    today's progress.

---

## Production launch checklist

- [ ] PostgreSQL added and `DATABASE_URL` referenced
- [ ] Volume mounted at `/data`
- [ ] All environment variables set, `SESSION_SECRET` random and long
- [ ] `APP_URL` matches the real public domain
- [ ] Admin password changed from the bootstrap value
- [ ] Resend domain shows verified; SPF, DKIM and DMARC records live
- [ ] Test email received and not in spam
- [ ] Mailing address filled in under Settings
- [ ] Wave sync run; customer count checked
- [ ] A test-mode campaign completed end to end
- [ ] Unsubscribe link tested from a real inbox
- [ ] Daily limit confirmed at 99, batch size 10, delay 30s
- [ ] Health check green at `/healthz`

---

## Project layout

```
backend/
  migrations/001_init.sql        every table, index and constraint
  src/lib/                       env, database, auth, tokens, errors, migrations
  src/services/wave.ts           Wave GraphQL client and customer sync
  src/services/resend.ts         sending, error classification, webhook signatures
  src/services/campaigns.ts      audience rules, batching, daily limit, retries
  src/services/scheduler.ts      cron loop with a cross-instance advisory lock
  src/services/settings.ts       configurable limits with safety clamps
  src/email/render.ts            blocks to email HTML, personalization, tracking
  src/email/defaults.ts          the three starter templates
  src/routes/                    auth, customers, campaigns, manage, insights, public
frontend/
  src/components/                UI kit, app shell, email block editor
  src/pages/                     one file per screen
Dockerfile                       three-stage build, frontend + backend + runtime
railway.json                     builder, start command, health check
.env.example                     every variable, ready to copy
```

## Database tables

`users`, `customers`, `campaigns`, `campaign_recipients`, `email_events`, `email_templates`,
`unsubscribe_records`, `suppression_list`, `maintenance_leads`, `settings`, `audit_logs`,
`notifications`, `daily_send_counts`, `sync_runs`, `schema_migrations`.

PostgreSQL is the only source of truth. Campaign progress, the daily counter and recipient
status are never held in memory alone.

---

## Compliance notes

Every marketing email carries your company name, your mailing address from Settings, your
website, a one-click unsubscribe link and `List-Unsubscribe` headers. Unsubscribed customers
are excluded at three separate points: when the audience is built, when a recipient is claimed
for sending, and again immediately before the send call. Bounces and complaints are suppressed
automatically. The daily limit is a hard stop, not a target.
