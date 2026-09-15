-- Recurring campaigns. A campaign used to send once and finish; it can now
-- repeat on a calendar — every day, every week on chosen weekdays, or every
-- month on a chosen day — until an end date or after a number of sends.
--
-- Each pass through the audience is an "occurrence". Recipients carry the
-- occurrence they belong to so the duplicate guard still stops a customer
-- being emailed twice within one send, while allowing next month's send to
-- reach the same person again.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS repeat_interval     TEXT NOT NULL DEFAULT 'none',  -- none | daily | weekly | monthly
  ADD COLUMN IF NOT EXISTS repeat_every        INTEGER NOT NULL DEFAULT 1,    -- every N days/weeks/months
  ADD COLUMN IF NOT EXISTS repeat_days         INTEGER[] NOT NULL DEFAULT '{}', -- ISO weekdays, 1=Mon..7=Sun
  ADD COLUMN IF NOT EXISTS repeat_day_of_month INTEGER,                       -- 1..31, clamped to short months
  ADD COLUMN IF NOT EXISTS repeat_until        DATE,
  ADD COLUMN IF NOT EXISTS repeat_count        INTEGER,                       -- stop after this many sends
  ADD COLUMN IF NOT EXISTS occurrence          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_run_date       DATE,
  ADD COLUMN IF NOT EXISTS last_run_date       DATE,
  -- The first sending day, fixed for the life of the campaign. start_date moves
  -- forward to whichever occurrence is due next, so it cannot also be what the
  -- rule is measured from: "every 2 weeks" and "the 31st of the month" both
  -- drift if the thing they count from keeps moving.
  ADD COLUMN IF NOT EXISTS repeat_anchor_date  DATE;

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS occurrence INTEGER NOT NULL DEFAULT 1;

-- The duplicate guard becomes per occurrence: one row per customer per send.
DROP INDEX IF EXISTS campaign_recipients_unique;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_unique
  ON campaign_recipients (campaign_id, customer_id, occurrence) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_recipients_occurrence_idx
  ON campaign_recipients (campaign_id, occurrence, status);
