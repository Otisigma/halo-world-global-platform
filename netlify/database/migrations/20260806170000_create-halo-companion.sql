CREATE TABLE IF NOT EXISTS halo_companion_journeys (
  session_id TEXT PRIMARY KEY,
  member_id TEXT,
  display_name TEXT,
  active_agent TEXT NOT NULL DEFAULT 'nova',
  journey_summary TEXT NOT NULL DEFAULT '',
  last_path TEXT NOT NULL DEFAULT '/',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(session_id) BETWEEN 16 AND 64),
  CHECK (active_agent IN ('nova', 'sol', 'echo', 'muse')),
  CHECK (char_length(journey_summary) <= 1200),
  CHECK (message_count >= 0)
);

CREATE TABLE IF NOT EXISTS halo_companion_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES halo_companion_journeys(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  agent TEXT,
  body TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('visitor', 'assistant')),
  CHECK (agent IS NULL OR agent IN ('nova', 'sol', 'echo', 'muse')),
  CHECK (char_length(body) BETWEEN 1 AND 2400)
);

CREATE TABLE IF NOT EXISTS halo_companion_care_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES halo_companion_journeys(session_id) ON DELETE CASCADE,
  member_id TEXT,
  page_path TEXT NOT NULL DEFAULT '/',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(reason) BETWEEN 3 AND 500),
  CHECK (status IN ('open', 'reviewing', 'resolved'))
);

CREATE INDEX IF NOT EXISTS halo_companion_messages_session_idx
  ON halo_companion_messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_companion_journeys_updated_idx
  ON halo_companion_journeys(updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_companion_care_status_idx
  ON halo_companion_care_requests(status, created_at DESC);
