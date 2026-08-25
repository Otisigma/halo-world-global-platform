CREATE TABLE IF NOT EXISTS halo_mix_release_plans (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mix_id TEXT REFERENCES halo_mixes(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled DJ mix',
  current_step SMALLINT NOT NULL DEFAULT 1,
  release_format TEXT NOT NULL DEFAULT 'paid_mix',
  mastering_status TEXT NOT NULL DEFAULT 'not_started',
  target_lufs NUMERIC(4, 1) NOT NULL DEFAULT -14.0,
  true_peak_dbtp NUMERIC(3, 1) NOT NULL DEFAULT -1.0,
  rights_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  sale_ready BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  demand_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 1 AND 140),
  CHECK (current_step BETWEEN 1 AND 5),
  CHECK (release_format IN ('free_stream', 'paid_mix', 'mix_album')),
  CHECK (mastering_status IN ('not_started', 'mix_review', 'mastering_booked', 'mastered', 'approved')),
  CHECK (target_lufs BETWEEN -24 AND -5),
  CHECK (true_peak_dbtp BETWEEN -6 AND 0)
);

CREATE INDEX IF NOT EXISTS halo_mix_release_plans_member_idx
  ON halo_mix_release_plans(member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS halo_mix_market_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'listener_request',
  demand_score SMALLINT NOT NULL DEFAULT 50,
  evidence TEXT NOT NULL DEFAULT '',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(query) BETWEEN 2 AND 180),
  CHECK (source IN ('listener_request', 'search', 'club', 'chart', 'social', 'radio', 'operator')),
  CHECK (demand_score BETWEEN 1 AND 100),
  CHECK (char_length(evidence) <= 500)
);

CREATE INDEX IF NOT EXISTS halo_mix_market_signals_member_idx
  ON halo_mix_market_signals(member_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS halo_mix_market_signals_query_idx
  ON halo_mix_market_signals(query, observed_at DESC);
