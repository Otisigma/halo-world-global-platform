CREATE TABLE IF NOT EXISTS halo_master_orchestrator_state (
  scope_id TEXT PRIMARY KEY,
  owner_member_id TEXT,
  intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS halo_master_orchestrator_events (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  owner_member_id TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_master_orchestrator_events_scope_created_idx
  ON halo_master_orchestrator_events (scope_id, created_at DESC);
