-- The 5am radio operator: a daily AI briefing that reads the station's own numbers
-- (audience, programming, catalogue, cost signals) and proposes owner-approved moves.

CREATE TABLE IF NOT EXISTS halo_radio_operator_briefings (
  id TEXT PRIMARY KEY,
  briefing_date DATE NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL DEFAULT '',
  station_grade TEXT NOT NULL DEFAULT 'unknown',
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_watch JSONB NOT NULL DEFAULT '{}'::jsonb,
  programming_moves JSONB NOT NULL DEFAULT '[]'::jsonb,
  artist_spotlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  blind_spots JSONB NOT NULL DEFAULT '[]'::jsonb,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  error_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trigger_type IN ('scheduled', 'manual')),
  CHECK (status IN ('running', 'complete', 'failed')),
  CHECK (station_grade IN ('unknown', 'healthy', 'watch', 'at-risk')),
  CHECK (char_length(headline) <= 200),
  CHECK (char_length(summary) <= 4000),
  CHECK (char_length(error_summary) <= 1000),
  CHECK (confidence BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS halo_radio_operator_briefings_recent_idx
  ON halo_radio_operator_briefings (briefing_date DESC);

-- Heartbeat telemetry is queried by event name over a rolling window and joined to the play
-- log by room. This index keeps the audience read cheap as the event table grows.
CREATE INDEX IF NOT EXISTS analytics_events_radio_room_idx
  ON analytics_events (event_name, created_at DESC)
  WHERE event_name IN ('radio_tune_in', 'radio_heartbeat', 'radio_tune_out', 'radio_skip');

CREATE INDEX IF NOT EXISTS halo_radio_play_history_room_started_idx
  ON halo_radio_play_history (room, started_at DESC);
