CREATE TABLE IF NOT EXISTS halo_route_health_entries (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES halo_ledger(id) ON DELETE CASCADE,
  page_path TEXT NOT NULL,
  chart_status TEXT NOT NULL CHECK (chart_status IN ('working', 'attention', 'broken', 'disconnected')),
  state_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_states JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_route_health_entries_created_idx
  ON halo_route_health_entries (created_at DESC);

CREATE INDEX IF NOT EXISTS halo_route_health_entries_chart_status_idx
  ON halo_route_health_entries (chart_status, created_at DESC);
