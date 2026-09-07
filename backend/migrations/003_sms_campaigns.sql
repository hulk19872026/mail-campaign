-- Text blasts. Campaigns gain a channel, customers gain texting consent, and
-- the existing recipient queue carries phone numbers alongside addresses.

-- Texting consent is deliberately opt-in: US marketing texts need prior express
-- written consent, so the default is false and nobody is textable until they are
-- marked. sms_opt_in_at records when consent was captured, which is the part
-- that has to be evidenced if it is ever challenged.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS sms_opt_in     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_opt_in_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_texted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_sms_idx ON customers (sms_opt_in, status);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS channel  TEXT NOT NULL DEFAULT 'email',   -- email | sms
  ADD COLUMN IF NOT EXISTS sms_body TEXT NOT NULL DEFAULT '';

-- Recipients of a text blast have a phone rather than an address. The email
-- column stays NOT NULL and is written as '' for them, so the duplicate guard
-- on (campaign_id, customer_id) keeps working unchanged for both channels.
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

-- Numbers that replied STOP, or that the carrier rejected outright. Kept apart
-- from suppression_list because that one is keyed by email address.
CREATE TABLE IF NOT EXISTS sms_suppression_list (
  id         SERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'stop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Matching is on digits only, so +1 732 555 0142 and 7325550142 are one number.
CREATE UNIQUE INDEX IF NOT EXISTS sms_suppression_phone_key
  ON sms_suppression_list (regexp_replace(phone, '[^0-9]', '', 'g'));
