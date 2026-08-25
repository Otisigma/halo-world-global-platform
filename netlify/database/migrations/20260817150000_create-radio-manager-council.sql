CREATE TABLE IF NOT EXISTS halo_radio_manager_councils (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'complete',
  model TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  horizon_days INTEGER NOT NULL DEFAULT 30,
  verdict TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  managers JSONB NOT NULL DEFAULT '[]'::jsonb,
  experiments JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('complete', 'failed')),
  CHECK (horizon_days BETWEEN 7 AND 90),
  CHECK (char_length(objective) <= 500),
  CHECK (char_length(verdict) <= 240),
  CHECK (char_length(summary) <= 4000)
);

CREATE TABLE IF NOT EXISTS halo_radio_manager_actions (
  id TEXT PRIMARY KEY,
  council_id TEXT NOT NULL REFERENCES halo_radio_manager_councils(id) ON DELETE CASCADE,
  manager_key TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  expected_metric TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  effort TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (manager_key IN ('programme', 'audience', 'artist', 'systems', 'growth')),
  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  CHECK (effort IN ('small', 'medium', 'large')),
  CHECK (status IN ('proposed', 'approved', 'rejected', 'completed')),
  CHECK (char_length(title) <= 240),
  CHECK (char_length(rationale) <= 1200),
  CHECK (char_length(expected_metric) <= 300),
  CHECK (char_length(decision_note) <= 800)
);

CREATE INDEX IF NOT EXISTS halo_radio_manager_councils_recent_idx
  ON halo_radio_manager_councils (created_at DESC);

CREATE INDEX IF NOT EXISTS halo_radio_manager_actions_queue_idx
  ON halo_radio_manager_actions (status, priority, created_at DESC);
