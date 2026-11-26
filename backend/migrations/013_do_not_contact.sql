-- Addresses and whole domains that must never get cold email. Kept apart from
-- the prospects table on purpose: deleting a prospect, or the lead finder
-- adding the same business again later, must not bring them back.
CREATE TABLE IF NOT EXISTS do_not_contact (
  id         SERIAL PRIMARY KEY,
  value      TEXT NOT NULL,            -- an email address, or a bare domain like "acme.com"
  reason     TEXT NOT NULL DEFAULT '',
  added_by   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS do_not_contact_value_key ON do_not_contact (lower(value));

-- Everyone already marked Do not contact goes on the list.
INSERT INTO do_not_contact (value, reason, added_by)
SELECT lower(email), 'Marked Do not contact', 'system'
  FROM prospects WHERE status = 'do_not_contact' AND email <> ''
ON CONFLICT DO NOTHING;
