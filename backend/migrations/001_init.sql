-- HULK Automation Marketing Center — initial schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'admin',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS customers (
  id                SERIAL PRIMARY KEY,
  wave_customer_id  TEXT UNIQUE,
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  company_name      TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  city              TEXT NOT NULL DEFAULT '',
  province          TEXT NOT NULL DEFAULT '',
  postal_code       TEXT NOT NULL DEFAULT '',
  country           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active',      -- active | disabled
  marketing_opt_out BOOLEAN NOT NULL DEFAULT false,
  unsubscribed_at   TIMESTAMPTZ,
  source            TEXT NOT NULL DEFAULT 'manual',      -- wave | csv | manual
  last_emailed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key ON customers (lower(email));
CREATE INDEX IF NOT EXISTS customers_status_idx ON customers (status, marketing_opt_out);

CREATE TABLE IF NOT EXISTS email_templates (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  template_id      INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  blocks           JSONB NOT NULL DEFAULT '[]'::jsonb,
  flyer_path       TEXT,
  flyer_name       TEXT,
  flyer_kind       TEXT,                                  -- image | pdf
  audience         TEXT NOT NULL DEFAULT 'active',        -- all | active | never_emailed | not_in_days | custom
  audience_days    INTEGER NOT NULL DEFAULT 90,
  audience_ids     INTEGER[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'draft',         -- draft | scheduled | active | paused | completed | cancelled
  test_mode        BOOLEAN NOT NULL DEFAULT false,
  test_email       TEXT,
  start_date       DATE,
  send_time        TEXT NOT NULL DEFAULT '09:00',
  daily_limit      INTEGER,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                  SERIAL PRIMARY KEY,
  campaign_id         INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued',     -- queued | sending | sent | failed | unsubscribed | skipped
  attempts            INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  error_message       TEXT,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  opened_at           TIMESTAMPTZ,
  clicked_at          TIMESTAMPTZ,
  bounced_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The duplicate guard: one row per campaign per customer, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_unique
  ON campaign_recipients (campaign_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_recipients_queue_idx
  ON campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_recipients_msg_idx
  ON campaign_recipients (provider_message_id);

CREATE TABLE IF NOT EXISTS email_events (
  id           SERIAL PRIMARY KEY,
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                              -- sent | delivered | opened | clicked | bounced | complained | failed | unsubscribed
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_events_type_idx ON email_events (type, created_at);
CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON email_events (campaign_id);

CREATE TABLE IF NOT EXISTS unsubscribe_records (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppression_list (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppression_email_key ON suppression_list (lower(email));

CREATE TABLE IF NOT EXISTS maintenance_leads (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  interest    TEXT NOT NULL DEFAULT 'Maintenance plan',
  status      TEXT NOT NULL DEFAULT 'new',                -- new | contacted | quoted | won | lost
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  level      TEXT NOT NULL DEFAULT 'info',                -- info | success | warning | error
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authoritative daily counter. Survives restarts; the scheduler never sends past it.
CREATE TABLE IF NOT EXISTS daily_send_counts (
  day        DATE PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'wave',
  status      TEXT NOT NULL DEFAULT 'running',
  imported    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
