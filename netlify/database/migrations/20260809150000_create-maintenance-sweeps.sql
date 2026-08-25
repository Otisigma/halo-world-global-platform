CREATE TABLE IF NOT EXISTS halo_maintenance_sweeps (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  base_url TEXT NOT NULL,
  pages_checked INTEGER NOT NULL DEFAULT 0,
  connections_checked INTEGER NOT NULL DEFAULT 0,
  outputs_checked INTEGER NOT NULL DEFAULT 0,
  passed_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('running', 'passed', 'degraded', 'failed')),
  CHECK (trigger_type IN ('scheduled', 'manual')),
  CHECK (pages_checked >= 0),
  CHECK (connections_checked >= 0),
  CHECK (outputs_checked >= 0),
  CHECK (passed_checks >= 0),
  CHECK (failed_checks >= 0)
);

CREATE TABLE IF NOT EXISTS halo_maintenance_checks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sweep_id TEXT NOT NULL REFERENCES halo_maintenance_sweeps(id) ON DELETE CASCADE,
  check_kind TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_kind IN ('page', 'connection', 'output')),
  CHECK (status IN ('passed', 'failed')),
  CHECK (duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS halo_maintenance_sweeps_started_idx
  ON halo_maintenance_sweeps(started_at DESC);

CREATE INDEX IF NOT EXISTS halo_maintenance_checks_sweep_idx
  ON halo_maintenance_checks(sweep_id, status, check_kind);
