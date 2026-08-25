CREATE TABLE IF NOT EXISTS halo_agent_runs (
  id TEXT PRIMARY KEY,
  report_date DATE NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  executive_summary TEXT NOT NULL DEFAULT '',
  health_score INTEGER NOT NULL DEFAULT 50,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  wins JSONB NOT NULL DEFAULT '[]'::jsonb,
  concerns JSONB NOT NULL DEFAULT '[]'::jsonb,
  reflection JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (trigger_type IN ('scheduled', 'manual')),
  CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  CHECK (health_score BETWEEN 0 AND 100),
  CHECK (confidence BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS halo_agent_findings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES halo_agent_runs(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, agent_key),
  CHECK (agent_key IN ('atlas', 'pulse', 'bridge', 'hearth', 'sentinel')),
  CHECK (confidence BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS halo_agent_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES halo_agent_runs(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  needs_approval BOOLEAN NOT NULL DEFAULT TRUE,
  expected_metric TEXT NOT NULL DEFAULT '',
  owner_note TEXT NOT NULL DEFAULT '',
  actual_outcome TEXT NOT NULL DEFAULT '',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (agent_key IN ('atlas', 'pulse', 'bridge', 'hearth', 'sentinel', 'mirror')),
  CHECK (category IN ('strategy', 'growth', 'creator', 'community', 'product', 'operations', 'risk')),
  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  CHECK (status IN ('proposed', 'approved', 'in_progress', 'completed', 'dismissed')),
  CHECK (char_length(title) BETWEEN 2 AND 180),
  CHECK (char_length(rationale) BETWEEN 2 AND 1200),
  CHECK (char_length(owner_note) <= 1200),
  CHECK (char_length(actual_outcome) <= 1200)
);

CREATE TABLE IF NOT EXISTS halo_agent_memory (
  agent_key TEXT PRIMARY KEY,
  working_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  lessons JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_reflection TEXT NOT NULL DEFAULT '',
  run_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (agent_key IN ('atlas', 'pulse', 'bridge', 'hearth', 'sentinel', 'mirror')),
  CHECK (run_count >= 0)
);

CREATE INDEX IF NOT EXISTS halo_agent_runs_date_idx
  ON halo_agent_runs(report_date DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS halo_agent_actions_status_idx
  ON halo_agent_actions(status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_agent_actions_run_idx
  ON halo_agent_actions(run_id, created_at);

INSERT INTO halo_agent_memory (agent_key)
VALUES ('atlas'), ('pulse'), ('bridge'), ('hearth'), ('sentinel'), ('mirror')
ON CONFLICT (agent_key) DO NOTHING;
