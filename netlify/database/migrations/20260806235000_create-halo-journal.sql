CREATE TABLE IF NOT EXISTS halo_journal_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  member_id TEXT,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'activity',
  page_path TEXT NOT NULL DEFAULT '/',
  target_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(event_key) BETWEEN 16 AND 96),
  CHECK (char_length(session_id) BETWEEN 16 AND 64),
  CHECK (char_length(event_type) BETWEEN 2 AND 64),
  CHECK (char_length(category) BETWEEN 2 AND 32),
  CHECK (char_length(page_path) BETWEEN 1 AND 180),
  CHECK (target_name IS NULL OR char_length(target_name) <= 120)
);

CREATE TABLE IF NOT EXISTS halo_journal_profiles (
  owner_key TEXT PRIMARY KEY,
  member_id TEXT,
  latest_session_id TEXT NOT NULL,
  memory_summary TEXT NOT NULL DEFAULT '',
  current_advice TEXT NOT NULL DEFAULT '',
  observed_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_count INTEGER NOT NULL DEFAULT 0,
  last_reflected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(owner_key) BETWEEN 16 AND 80),
  CHECK (char_length(latest_session_id) BETWEEN 16 AND 64),
  CHECK (char_length(memory_summary) <= 2400),
  CHECK (char_length(current_advice) <= 1200),
  CHECK (event_count >= 0)
);

CREATE TABLE IF NOT EXISTS halo_journal_notes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_key TEXT NOT NULL REFERENCES halo_journal_profiles(owner_key) ON DELETE CASCADE,
  member_id TEXT,
  session_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(session_id) BETWEEN 16 AND 64),
  CHECK (char_length(body) BETWEEN 1 AND 1200)
);

CREATE TABLE IF NOT EXISTS halo_journal_insights (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_key TEXT NOT NULL REFERENCES halo_journal_profiles(owner_key) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  headline TEXT NOT NULL,
  insight TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trigger_type IN ('manual', 'problem', 'milestone')),
  CHECK (char_length(headline) BETWEEN 1 AND 120),
  CHECK (char_length(insight) BETWEEN 1 AND 1200),
  CHECK (char_length(recommendation) BETWEEN 1 AND 800)
);

CREATE INDEX IF NOT EXISTS halo_journal_events_session_idx
  ON halo_journal_events(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS halo_journal_events_member_idx
  ON halo_journal_events(member_id, occurred_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS halo_journal_events_category_idx
  ON halo_journal_events(category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS halo_journal_notes_owner_idx
  ON halo_journal_notes(owner_key, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_journal_insights_owner_idx
  ON halo_journal_insights(owner_key, created_at DESC);
