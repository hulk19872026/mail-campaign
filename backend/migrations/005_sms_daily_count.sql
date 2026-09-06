-- Texts get their own daily allowance. Sharing the email counter would mean a
-- busy mailing morning silently eats the texting budget, and the two cost
-- different money and answer to different limits.
ALTER TABLE daily_send_counts
  ADD COLUMN IF NOT EXISTS sms_count INTEGER NOT NULL DEFAULT 0;
