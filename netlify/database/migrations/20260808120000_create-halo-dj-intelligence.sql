CREATE TABLE IF NOT EXISTS halo_dj_track_profiles (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  source TEXT NOT NULL DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, track_id),
  CHECK (char_length(track_id) BETWEEN 1 AND 100),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (char_length(artist) BETWEEN 1 AND 160),
  CHECK (confidence BETWEEN 0 AND 1),
  CHECK (source IN ('operator', 'analysis', 'import', 'audience'))
);

CREATE TABLE IF NOT EXISTS halo_dj_intelligence_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  energy_curve TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'opening',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(id) BETWEEN 8 AND 100),
  CHECK (mode IN ('listening', 'club', 'chill')),
  CHECK (energy_curve IN ('journey', 'build', 'steady', 'wave', 'double-peak', 'emotional', 'sunset', 'afterhours')),
  CHECK (current_phase IN ('opening', 'build', 'peak', 'release', 'close')),
  CHECK (status IN ('active', 'complete', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS halo_dj_decisions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES halo_dj_intelligence_sessions(id) ON DELETE SET NULL,
  from_track_id TEXT NOT NULL,
  to_track_id TEXT,
  mode TEXT NOT NULL,
  intent TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  fit INTEGER NOT NULL,
  transition_style TEXT NOT NULL,
  transition_bars INTEGER NOT NULL,
  energy_before NUMERIC(4, 2) NOT NULL,
  energy_after NUMERIC(4, 2) NOT NULL,
  why_track TEXT NOT NULL,
  why_now TEXT NOT NULL,
  transition_reason TEXT NOT NULL,
  feeling_next TEXT NOT NULL,
  sonic_weather JSONB NOT NULL DEFAULT '{}'::jsonb,
  set_arc JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(id) BETWEEN 8 AND 100),
  CHECK (mode IN ('listening', 'club', 'chill')),
  CHECK (intent IN ('lift', 'hold', 'reset', 'peak')),
  CHECK (decision_type IN ('mix', 'hold', 'silence')),
  CHECK (fit BETWEEN 1 AND 99),
  CHECK (transition_bars IN (0, 8, 16, 32, 64)),
  CHECK (energy_before BETWEEN 0 AND 10),
  CHECK (energy_after BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS halo_dj_audience_signals (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES halo_dj_decisions(id) ON DELETE SET NULL,
  track_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  signal TEXT NOT NULL,
  intensity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(track_id) BETWEEN 1 AND 100),
  CHECK (mode IN ('listening', 'club', 'chill')),
  CHECK (signal IN ('love', 'lift', 'hold', 'skip', 'vote')),
  CHECK (intensity BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS halo_dj_profiles_updated_idx
  ON halo_dj_track_profiles(member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_dj_intelligence_sessions_member_idx
  ON halo_dj_intelligence_sessions(member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_dj_decisions_member_idx
  ON halo_dj_decisions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_dj_signals_member_idx
  ON halo_dj_audience_signals(member_id, mode, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_dj_signals_track_idx
  ON halo_dj_audience_signals(track_id, signal, created_at DESC);
