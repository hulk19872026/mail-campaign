-- Automatic cold outreach. Prospects are emailed from a separate Google
-- Workspace mailbox on a separate domain (never through Resend), a few new
-- ones each weekday, with two follow-ups that stop as soon as someone replies.

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sequence_step   INTEGER NOT NULL DEFAULT 0; -- emails sent so far (0-3)
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS first_subject   TEXT NOT NULL DEFAULT '';
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_message_id TEXT NOT NULL DEFAULT '';
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS opened_at       TIMESTAMPTZ;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS open_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS replied_at      TIMESTAMPTZ;

-- One row per email in a list's sequence: step 1 is the first email, 2 and 3
-- are follow-ups sent as replies in the same thread.
CREATE TABLE IF NOT EXISTS outreach_steps (
  list       TEXT NOT NULL,
  step       INTEGER NOT NULL CHECK (step BETWEEN 1 AND 3),
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list, step)
);

-- Every attempt, sent or failed. The token is what the open-tracking image uses.
CREATE TABLE IF NOT EXISTS outreach_messages (
  id          SERIAL PRIMARY KEY,
  prospect_id INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
  step        INTEGER NOT NULL,
  to_email    TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  message_id  TEXT NOT NULL DEFAULT '',
  token       TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at   TIMESTAMPTZ,
  open_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outreach_messages_sent_idx ON outreach_messages (sent_at);
CREATE INDEX IF NOT EXISTS outreach_messages_token_idx ON outreach_messages (token) WHERE token <> '';
CREATE INDEX IF NOT EXISTS outreach_messages_msgid_idx ON outreach_messages (message_id) WHERE message_id <> '';

INSERT INTO outreach_steps (list, step, subject, body) VALUES
('violations', 1, 'Intercom at {{address}}',
'Hi {{first_name}},

NYC''s public housing (HPD) records show an open intercom violation at {{address}}. We''re a local low-voltage company - we repair and replace building intercoms and door-entry systems, and can usually get a violation cleared quickly.

Would a free look at the system this week be helpful?'),
('violations', 2, '',
'Hi {{first_name}}, just following up on the intercom at {{address}}. Open violations can lead to fines if they stay open, and the fix is often simpler than people expect - sometimes a repair, not a whole new system.

Happy to take a look and give you a straight quote. Does that work?'),
('violations', 3, '',
'Hi {{first_name}}, I won''t keep filling your inbox. If the intercom at {{address}} is already handled, great. If not, just reply here and we''ll get someone out. We also handle access control and cameras if those ever come up.'),

('voip', 1, 'Phones at {{business_name}}',
'Hi {{first_name}},

We set up business phone systems for local offices like {{business_name}} - calls ring on desk phones, cell phones or a computer, with a proper menu and voicemail to email. Most offices end up paying less than they do now for their old lines.

Would it be worth a quick look at what you have today?'),
('voip', 2, '',
'Hi {{first_name}}, just following up. If your phones ever drop calls, miss after-hours callers or cost more than they should, we can usually fix all three. Happy to send a quick price comparison - no obligation.'),
('voip', 3, '',
'Hi {{first_name}}, last note from me. If a phone upgrade isn''t on the list right now, no problem. If it ever is, just reply here and we''ll take a look.'),

('construction', 1, 'Low-voltage for {{address}}',
'Hi {{first_name}},

I saw the new project at {{address}}. We''re a local low-voltage contractor - intercoms, access control, cameras, networking and phone systems - and we work with builders from rough-in through final.

Would it help to get a number from us for this job?'),
('construction', 2, '',
'Hi {{first_name}}, following up on {{address}}. If low-voltage isn''t assigned yet, we''re happy to walk the plans and send a quote quickly.'),
('construction', 3, '',
'Hi {{first_name}}, last note from me on {{address}}. If you''re covered, no problem - and if anything comes up on this job or the next one, just reply here.')
ON CONFLICT DO NOTHING;
