CREATE TABLE IF NOT EXISTS halo_radio_tracks (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  musical_key TEXT NOT NULL DEFAULT '',
  blob_key TEXT NOT NULL UNIQUE,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'preview',
  rights_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ai_score NUMERIC(5,2),
  votes_up INTEGER NOT NULL DEFAULT 0,
  votes_down INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (room IN ('club', 'chill', 'lounge')),
  CHECK (char_length(title) BETWEEN 1 AND 140),
  CHECK (char_length(artist_name) BETWEEN 1 AND 140),
  CHECK (char_length(description) <= 500),
  CHECK (char_length(genre) <= 80),
  CHECK (char_length(musical_key) <= 16),
  CHECK (bpm IS NULL OR bpm BETWEEN 40 AND 240),
  CHECK (chunk_count BETWEEN 1 AND 64),
  CHECK (byte_size > 0 AND byte_size <= 134217728),
  CHECK (duration_seconds BETWEEN 0 AND 7200),
  CHECK (status IN ('preview', 'rotation', 'held', 'rejected')),
  CHECK (rights_confirmed = TRUE),
  CHECK (ai_score IS NULL OR ai_score BETWEEN 0 AND 100),
  CHECK (votes_up >= 0 AND votes_down >= 0),
  CHECK (play_count >= 0)
);

CREATE TABLE IF NOT EXISTS halo_radio_votes (
  track_id TEXT NOT NULL REFERENCES halo_radio_tracks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (track_id, member_id),
  CHECK (vote IN (-1, 1))
);

CREATE INDEX IF NOT EXISTS halo_radio_tracks_room_status_idx
  ON halo_radio_tracks(room, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_tracks_score_idx
  ON halo_radio_tracks(status, votes_up DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_tracks_member_idx
  ON halo_radio_tracks(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_votes_member_idx
  ON halo_radio_votes(member_id, updated_at DESC);
