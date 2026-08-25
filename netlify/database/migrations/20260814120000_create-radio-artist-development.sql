ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS development_stage TEXT NOT NULL DEFAULT 'discovery',
  ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;

ALTER TABLE halo_radio_tracks
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_development_stage_check,
  ADD CONSTRAINT halo_radio_tracks_development_stage_check CHECK (
    development_stage IN ('discovery', 'testing', 'emerging', 'rotation', 'featured', 'development', 'closed')
  ),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_review_round_check,
  ADD CONSTRAINT halo_radio_tracks_review_round_check CHECK (review_round >= 0),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_artist_message_check,
  ADD CONSTRAINT halo_radio_tracks_artist_message_check CHECK (char_length(artist_message) <= 1200);

CREATE TABLE IF NOT EXISTS halo_radio_development_reviews (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES halo_radio_tracks(id) ON DELETE CASCADE,
  reviewer_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  development_stage TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  scorecard JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (decision IN ('preview', 'rotation', 'pass', 'reject', 'spotlight')),
  CHECK (development_stage IN ('discovery', 'testing', 'emerging', 'rotation', 'featured', 'development', 'closed')),
  CHECK (char_length(summary) <= 1200),
  CHECK (jsonb_typeof(strengths) = 'array'),
  CHECK (jsonb_typeof(priorities) = 'array'),
  CHECK (jsonb_typeof(next_steps) = 'array'),
  CHECK (jsonb_typeof(scorecard) = 'object')
);

CREATE INDEX IF NOT EXISTS halo_radio_development_reviews_track_idx
  ON halo_radio_development_reviews(track_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_radio_tracks_development_stage_idx
  ON halo_radio_tracks(development_stage, reviewed_at DESC, created_at DESC);
