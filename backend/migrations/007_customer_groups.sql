-- Groups: a named, hand-picked list of customers, so a campaign can go to
-- "Service contract holders" or "Brooklyn commercial" rather than to everyone.
--
-- Membership is explicit rather than a saved filter. The owner decides who is
-- in a group on the Customers page, and a group keeps meaning the same people
-- until it is changed by hand — which is what makes it safe to point a campaign
-- at one without re-checking who it would reach.

CREATE TABLE IF NOT EXISTS customer_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Two groups with the same name would be impossible to tell apart in the
-- campaign wizard, where all you see is the name.
CREATE UNIQUE INDEX IF NOT EXISTS customer_groups_name_key ON customer_groups (lower(name));

CREATE TABLE IF NOT EXISTS customer_group_members (
  group_id    INTEGER NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);
CREATE INDEX IF NOT EXISTS customer_group_members_customer_idx
  ON customer_group_members (customer_id);

-- A campaign aimed at a group records which one. ON DELETE SET NULL rather than
-- a block: a running campaign already has its recipient rows written, so
-- deleting the group cannot change who it reaches, and the wizard treats a
-- missing group as an empty audience.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS audience_group_id INTEGER REFERENCES customer_groups(id) ON DELETE SET NULL;
