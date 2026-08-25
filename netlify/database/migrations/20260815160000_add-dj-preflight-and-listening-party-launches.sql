CREATE TABLE IF NOT EXISTS halo_dj_set_preflights (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  persona_id TEXT REFERENCES halo_radio_personas(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled set',
  mode TEXT NOT NULL DEFAULT 'listening',
  seed BIGINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  quality_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  track_count SMALLINT NOT NULL DEFAULT 0,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 1 AND 140),
  CHECK (mode IN ('listening', 'club', 'chill')),
  CHECK (status IN ('draft', 'ready', 'blocked')),
  CHECK (quality_score BETWEEN 0 AND 100),
  CHECK (track_count BETWEEN 2 AND 40)
);

CREATE INDEX IF NOT EXISTS halo_dj_set_preflights_member_idx
  ON halo_dj_set_preflights(member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS halo_dj_transition_observations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  persona_id TEXT REFERENCES halo_radio_personas(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  preflight_id TEXT REFERENCES halo_dj_set_preflights(id) ON DELETE SET NULL,
  outgoing_track_id TEXT NOT NULL,
  incoming_track_id TEXT NOT NULL,
  transition_style TEXT NOT NULL,
  transition_bars SMALLINT NOT NULL DEFAULT 16,
  predicted_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  outcome_score NUMERIC(5, 2),
  recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  CHECK (char_length(session_id) BETWEEN 8 AND 100),
  CHECK (char_length(outgoing_track_id) BETWEEN 1 AND 120),
  CHECK (char_length(incoming_track_id) BETWEEN 1 AND 120),
  CHECK (char_length(transition_style) BETWEEN 1 AND 60),
  CHECK (transition_bars IN (4, 8, 16, 32, 64)),
  CHECK (predicted_score BETWEEN 0 AND 100),
  CHECK (outcome_score IS NULL OR outcome_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS halo_dj_transition_observations_persona_idx
  ON halo_dj_transition_observations(persona_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS halo_dj_transition_observations_session_idx
  ON halo_dj_transition_observations(member_id, session_id, performed_at DESC);

CREATE TABLE IF NOT EXISTS halo_dj_external_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES halo_radio_personas(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  content_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(16, 2) NOT NULL DEFAULT 0,
  audience_size NUMERIC(16, 2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'authorized_api',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (platform IN ('halo', 'youtube', 'tiktok', 'spotify', 'apple_music', 'instagram', 'import')),
  CHECK (metric_name IN ('likes', 'saves', 'shares', 'views', 'streams', 'completions', 'watch_seconds', 'comments')),
  CHECK (metric_value >= 0),
  CHECK (audience_size >= 0),
  CHECK (source IN ('authorized_api', 'owner_export', 'halo')),
  CHECK (char_length(content_id) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS halo_dj_external_signals_persona_idx
  ON halo_dj_external_signals(persona_id, observed_at DESC);

ALTER TABLE halo_fan_vote_campaigns
  ADD COLUMN IF NOT EXISTS preflight_id TEXT REFERENCES halo_dj_set_preflights(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS host_persona_id TEXT REFERENCES halo_radio_personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS party_theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS halo_fan_vote_campaigns_host_idx
  ON halo_fan_vote_campaigns(host_persona_id, launched_at DESC)
  WHERE host_persona_id IS NOT NULL;
