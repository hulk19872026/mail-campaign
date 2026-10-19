# Master prompt — build a Marketing Center for another business

Copy everything below the line into a new Claude Code session that's pointed at an **empty**
GitHub repository. First fill in every `[[ … ]]` in the **Business profile** section. Leave the
rest as it is. It describes the system this repository already runs for HULK Automation.

If the new business doesn't use Wave, texting, or maintenance plans, say so in the profile. The
prompt explains how to leave each part out.

---

## Business profile (fill this in)

- **Business name:** [[ e.g. Acme Plumbing ]]
- **Short brand name for plan titles:** [[ e.g. ACME ]]
- **Website:** [[ https://acmeplumbing.com ]]
- **What they do, in one sentence:** [[ e.g. Residential and commercial plumbing, water heaters and drain service ]]
- **Service list (4–8 bullets shown in emails):** [[ Drain cleaning; Water heaters; Leak detection; Repiping; Backflow testing; Emergency service ]]
- **Plans / packages to promote (name + 5–6 bullets each, or "none"):**
  - [[ BASIC: … ]]
  - [[ PRO: Everything in BASIC, … ]]
  - [[ ELITE: Everything in PRO, … ]]
- **Main offer that emails push toward:** [[ e.g. Annual maintenance plan / seasonal inspection ]]
- **Admin login email:** [[ owner@acmeplumbing.com ]]
- **Sending address / sender name / reply-to:** [[ marketing@… ]] / [[ Acme Plumbing ]] / [[ service@… ]]
- **Sending domain to verify in Resend:** [[ acmeplumbing.com ]]
- **Timezone:** [[ America/New_York ]]
- **Brand accent colour (hex):** [[ #22C55E ]]
- **Customer source:** [[ Wave Accounting / CSV import only / other (name it) ]]
- **Text blasts via Twilio:** [[ yes / no ]]. "Text us" number shown in emails: [[ +1… ]]
- **Daily send limit:** [[ 99 ]] emails, [[ 99 ]] texts
- **Hosting:** [[ Railway ]]. Public URL: [[ https://marketing.acmeplumbing.com ]]

---

## The prompt

You are building a production-ready **Marketing Center** web app for the business described in
the Business profile above. It pulls the business's customers in, sends them branded marketing
emails (and, if enabled, SMS text blasts) on a schedule with a hard daily limit, tracks results,
and captures the people who click as sales leads. The owner isn't technical. They use it only in
a browser, so there should be nothing to install and no commands to run day to day.

Work in this repository. Commit in small, clearly described steps and push when each major piece
works. Write all UI copy, errors and the README in plain, friendly language that a business owner
understands.

### Stack (keep it exactly like this)

- **Backend:** Node + TypeScript + Express, `pg` (PostgreSQL, the only source of truth), `luxon`
  for timezones, `bcryptjs` + `jsonwebtoken` + `cookie-parser` for auth, `multer` for uploads,
  and a cron loop for scheduling.
- **Frontend:** React 18 + Vite + TypeScript + Tailwind, `react-router-dom`, `recharts`,
  `lucide-react`.
- **Layout:** `backend/` (`src/lib`, `src/services`, `src/routes`, `src/email`, `src/scripts`,
  `migrations/NNN_name.sql`) and `frontend/` (`src/components`, `src/lib`, `src/pages`, one page
  per screen). A root `package.json` with `build`/`start` scripts, a three-stage `Dockerfile`
  (frontend build → backend build → slim runtime that serves both), and a `railway.json` with a
  `/healthz` health check. Add `.env.example` and `.gitignore`.
- The backend serves the built frontend, so it all deploys as one service.

### Data model (numbered SQL migrations, run automatically on boot)

`users`, `customers`, `customer_groups`, `customer_group_members`, `campaigns`,
`campaign_recipients`, `email_events`, `email_templates`, `unsubscribe_records`,
`suppression_list`, `sms_suppression_list`, `maintenance_leads` (or call it `leads`), `settings`,
`audit_logs`, `notifications`, `daily_send_counts`, `sync_runs`, `schema_migrations`.

- `campaign_recipients` has a **unique index on `(campaign_id, customer_id, occurrence)`** so the
  database itself, not app code, makes double-sending impossible.
- Store emails trimmed and lower-cased. Store phone numbers so they match on the last 10 digits.

### Features, page by page

1. **Login.** Cookie session (JWT signed with `SESSION_SECRET`). On every boot, make sure
   `ADMIN_EMAIL` has an account and create it from `ADMIN_PASSWORD` if it doesn't.
   `ADMIN_PASSWORD_RESET=true` resets that password on the next boot. Add a CLI
   (`npm run admin -- list | set-password <email> <pw>`) for recovery. Write the reason for each
   failed login to the server log, but keep the message in the browser vague.
2. **Dashboard.** Customer count, emails sent, today's progress against the daily limit,
   open/click rate, progress of active campaigns, and system status (database, scheduler, email
   provider).
3. **Customers.** Search, filter, sort, edit, disable, delete, bulk actions, CSV import and
   export. A profile page shows each customer's full email history. There are flags for
   unsubscribed, suppressed and "agreed to texts", and a filter for "has a phone, no texting
   consent".
4. **Customer groups.** Saved lists with member counts, plus how many members can actually be
   emailed or texted. Add people from the group itself or with "Add to group" on Customers.
   Deleting a group is refused while a live campaign still uses it.
5. **Campaigns.** An eight-step wizard: channel (email/SMS) → template → content → customers
   (all, filters, or specific groups) → schedule (with a sending calendar) → sender → test mode →
   review. The review screen shows recipient count, daily limit, estimated days, from address and
   subject, and has a "send test" button. A campaign page shows the live queue, pause / resume /
   cancel, and each recipient's status. Test mode sends only to the address entered and shows a
   banner saying no customers will receive it.
6. **Repeating campaigns.** Once, every N days, chosen weekdays every N weeks, or day-of-month
   every N months. A repeat runs until stopped, for X sends, or until a date. Each pass is an
   *occurrence*, and the audience is rebuilt fresh on every sending day. Measure the rule from a
   fixed first-send date, so the 31st keeps coming back to the 31st and uses the last day of
   shorter months. Share the same recurrence logic between backend and frontend so the calendar
   matches what really sends.
7. **Email templates.** A block-based visual editor with live preview. Blocks: logo, headline,
   paragraph, image, flyer (shown first), button (tracked; records an "interest" lead on click),
   "Text us" button (an `sms:` link with a pre-filled message, shown beside the main button),
   divider, spacer, **services** (the service list from the profile) and **plans** (the plans from
   the profile, chosen per block). Personalisation: `{{first_name}}`, `{{company_name}}`, etc.
   Seed three starter templates written for this business: a plan/offer email, a seasonal
   check-up with a flyer, and a "still here when you need us" reminder.
8. **Schedule.** Daily limit, next send time, system status, and a manual "send next batch"
   button.
9. **Analytics.** Sent, delivered, opened, clicked, bounced and failed. Charts over time and
   per-campaign performance.
10. **Leads.** Everyone who clicked an offer button, with a pipeline of new → contacted → quoted →
    won/lost.
11. **Integrations.** Status of the customer source and email/SMS providers, connection tests, a
    "sync customers now" button, the last and next nightly sync, and a "send test email" button.
12. **Settings.** Company details, mailing address (required by CAN-SPAM; warn if it's empty),
    timezone, send time, daily limit, batch size, batch delay, logo, accent colour, from / reply-to
    addresses, SMS settings, nightly sync switch and hour, password change, and the activity log.
    Clamp unsafe values on the server.
13. **Help.** Plain-language answers to the eight most likely questions.
14. **Public routes.** Unsubscribe page `/u/:token`, open pixel `/t/open/:token.gif`, click
    redirect `/t/click/:token?u=`, `POST /webhooks/resend` (verify the signature; hard bounces and
    complaints go on the suppression list) and `POST /webhooks/twilio/inbound` (STOP / UNSUBSCRIBE
    / CANCEL / QUIT / END opt out and clear consent; START opts back in). `/healthz` reports the
    database state, the deployed commit and the account count.

### The sending engine (implement exactly this)

1. The scheduler wakes every 5 minutes. Before the send time in the business's timezone, it does
   nothing.
2. It reads today's counter **from the database** and works out the remaining allowance as
   `daily_limit − sent_today`.
3. It takes active campaigns with queued recipients, oldest first.
4. It claims a batch (default 10) in one transaction with `FOR UPDATE SKIP LOCKED`, marked as
   sending, so two app instances can never claim the same person. It also holds a PostgreSQL
   advisory lock.
5. It sends the batch one email at a time, then waits (default 30 s) before the next batch.
6. Each success increments the daily counter and writes a `sent` event.
7. It stops at the limit and carries on tomorrow from exactly where it left off.
8. When nothing is left queued, it completes the campaign and creates a notification, or for a
   repeating campaign moves it to its next sending day.
9. On boot, anything stuck in `sending` is put back in the queue. Rows already `sent` are never
   touched.
10. Rejected addresses fail immediately. Network errors and rate limits are retried up to 3 times,
    then fail. Nothing retries forever.
11. Unsubscribed, suppressed and disabled customers are excluded everywhere. A customer is only
    texted with consent, checked both when the audience is built and again just before the send.
    Every SMS carries an opt-out line. SMS has its own daily counter.

### Nightly customer sync

A separate job checks every 15 minutes whether it's past the sync time today in the business's
timezone and no sync has succeeded today. If both are true, it pulls customers. It uses its own
advisory lock. A manual sync counts for that day, and after 3 failures in a day it waits until
tomorrow.
**With Wave:** use the GraphQL API (`WAVE_API_TOKEN`, business id chosen in Settings and shown in
full), match on Wave ID so there are never duplicates, import only customers with a valid email,
and if Email is blank, look for an address typed into the Contact first/last name fields (and
keep it out of the name).
**Without Wave:** skip this job and rely on CSV import, or build the same thing for the source
named in the profile.

### Environment variables

`DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`ADMIN_PASSWORD_RESET`, `WAVE_API_TOKEN`, `WAVE_BUSINESS_ID`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `RESEND_REPLY_TO`, `RESEND_WEBHOOK_SECRET`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_NUMBER`, `UPLOAD_DIR`
(`/data/uploads` on a Railway volume mounted at `/data`). When the database is down, the app
should keep running and say so instead of crashing. Report a Resend key with limited permissions
as limited, not as rejected.

### README (write it for the owner)

Include: a table of what each page does; step-by-step Railway deploy (project, PostgreSQL, volume,
a variables table with "where it goes / what it expects / how to test it", domain, first sign-in,
lost-password recovery); Wave setup (token and business id query); Resend setup (domain, DKIM /
SPF / DMARC, key, webhook); how the daily-limit system works and why it can't double-send; the
nightly sync; running it locally; a 10-step test procedure before the first real campaign; a
production launch checklist; the project layout; and sections on repeating campaigns, groups and
text blasts.

### If a feature isn't wanted

- **No texting:** leave out Twilio, the SMS channel, the "Text us" block and the SMS tables and
  settings.
- **No plans:** leave out the plans block and write the starter templates around the main offer
  instead.
- **No Wave:** CSV import and manual entry only. Hide the Wave card on Integrations.

### Done means

`npm run build` passes for both apps, a fresh database migrates on boot, the admin can sign in,
a test-mode campaign sends only to the test address, unsubscribe and lead clicks are recorded,
and `/healthz` is green. Finish with a short summary of what was built and what the owner still
needs to set up (DNS records, API keys, mailing address).
