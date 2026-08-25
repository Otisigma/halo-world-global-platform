CREATE TABLE IF NOT EXISTS halo_mixes (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  blob_key TEXT NOT NULL UNIQUE,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'room',
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 2 AND 100),
  CHECK (char_length(description) <= 320),
  CHECK (chunk_count BETWEEN 1 AND 64),
  CHECK (byte_size > 0 AND byte_size <= 134217728),
  CHECK (duration_seconds BETWEEN 0 AND 43200),
  CHECK (track_count BETWEEN 0 AND 500),
  CHECK (visibility IN ('room', 'private')),
  CHECK (play_count >= 0)
);

CREATE TABLE IF NOT EXISTS halo_mix_playlist_items (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, mix_id)
);

CREATE INDEX IF NOT EXISTS halo_mixes_room_created_idx
  ON halo_mixes(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_mixes_member_created_idx
  ON halo_mixes(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_mix_playlist_member_idx
  ON halo_mix_playlist_items(member_id, added_at DESC);
