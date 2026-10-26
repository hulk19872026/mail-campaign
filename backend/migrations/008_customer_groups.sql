-- Customer groups. A campaign could only be aimed at everyone, at everyone
-- active, or at a recency window. Groups let the same list be cut the way the
-- business actually thinks about it — service contract holders, commercial
-- accounts, one town, last year's installs — and reused campaign after
-- campaign.

CREATE TABLE IF NOT EXISTS customer_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'green',   -- green | blue | amber | red | grey
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_groups_name_key ON customer_groups (lower(name));

CREATE TABLE IF NOT EXISTS customer_group_members (
  group_id    INTEGER NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);
CREATE INDEX IF NOT EXISTS customer_group_members_customer_idx
  ON customer_group_members (customer_id);

-- Which groups a campaign is aimed at, used when audience = 'group'.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS group_ids INTEGER[] NOT NULL DEFAULT '{}';
