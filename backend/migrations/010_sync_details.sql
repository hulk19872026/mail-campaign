-- A sync reported three numbers and nothing about which customers they were.
-- "358 skipped" is not actionable; the names behind it are, because the fix is
-- to add the address in Wave. Keeps the per-run breakdown and those lists.
ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
