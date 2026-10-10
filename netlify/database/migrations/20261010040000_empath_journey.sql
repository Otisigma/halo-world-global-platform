ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS journey_poll_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Only deliberately public campaigns participate; upcoming campaigns never expose catalog drafts.
CREATE OR REPLACE VIEW halo_journey_catalog AS
SELECT release.id, release.title, release.artist, release.stream_url,
  CASE WHEN release.status = 'published' THEN COALESCE(song.lyrics_text, '') ELSE '' END AS lyrics_text,
  CASE WHEN release.status = 'published' AND radio.id IS NOT NULL THEN '/api/radio/audio?id=' || radio.id
    WHEN release.status = 'published' AND EXISTS (
      SELECT 1 FROM halo_song_versions version JOIN halo_song_catalog catalog ON catalog.id = version.song_id
      WHERE catalog.source_release_id = release.id AND version.version_type = 'sale_master'
        AND version.audio_url <> '' AND version.audio_url = release.stream_url
    ) THEN ''
    ELSE release.stream_url END AS preview_url
FROM halo_release_campaigns release
LEFT JOIN LATERAL (
  SELECT catalog.lyrics_text FROM halo_song_catalog catalog
  WHERE catalog.source_release_id = release.id AND catalog.status = 'active'
  ORDER BY catalog.updated_at DESC LIMIT 1
) song ON release.status = 'published'
LEFT JOIN LATERAL (
  SELECT track.id FROM halo_radio_tracks track
  JOIN halo_release_audio_versions version ON version.id = track.audio_version_id
  WHERE track.release_id = release.id AND track.status IN ('preview', 'rotation')
    AND track.rights_confirmed = TRUE AND track.byte_size > 0 AND track.blob_key <> ''
    AND version.release_id = release.id AND version.status = 'active'
    AND version.rights_confirmed = TRUE AND version.version_type IN ('radio_edit', 'clean')
  ORDER BY track.updated_at DESC, track.id LIMIT 1
) radio ON release.status = 'published'
WHERE release.visibility = 'public'
  AND (release.status = 'published'
    OR (release.status = 'draft' AND release.journey_poll_enabled = TRUE));

CREATE TABLE IF NOT EXISTS halo_journey_rate_limits (
  identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  bucket TEXT NOT NULL CHECK (bucket IN ('write', 'vote', 'ip_vote')),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  PRIMARY KEY (identity_hash, bucket)
);

-- The conflicting row lock serializes quota consumption across function instances.
CREATE OR REPLACE FUNCTION halo_journey_allow(identity_key TEXT, quota_bucket TEXT,
  quota_max INTEGER, window_seconds INTEGER) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE accepted TEXT;
BEGIN
  INSERT INTO halo_journey_rate_limits AS limits (identity_hash, bucket)
  VALUES (identity_key, quota_bucket)
  ON CONFLICT (identity_hash, bucket) DO UPDATE SET
    attempts = CASE WHEN limits.window_start <= NOW() - make_interval(secs => window_seconds)
      THEN 1 ELSE limits.attempts + 1 END,
    window_start = CASE WHEN limits.window_start <= NOW() - make_interval(secs => window_seconds)
      THEN NOW() ELSE limits.window_start END
  WHERE limits.attempts < quota_max
    OR limits.window_start <= NOW() - make_interval(secs => window_seconds)
  RETURNING identity_hash INTO accepted;
  RETURN accepted IS NOT NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS halo_journey_votes (
  identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('track', 'remix', 'priority')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (identity_hash, release_id, kind)
);
CREATE INDEX IF NOT EXISTS halo_journey_votes_release_idx ON halo_journey_votes(release_id, created_at);
CREATE INDEX IF NOT EXISTS halo_journey_votes_recent_idx ON halo_journey_votes(created_at);

CREATE TABLE IF NOT EXISTS halo_journey_album_owners (
  owner_id TEXT PRIMARY KEY,
  album_count INTEGER NOT NULL CHECK (album_count BETWEEN 1 AND 50)
);
CREATE TABLE IF NOT EXISTS halo_journey_albums (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES halo_journey_album_owners(owner_id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  tracks JSONB NOT NULL CHECK (jsonb_typeof(tracks) = 'array' AND jsonb_array_length(tracks) BETWEEN 1 AND 12),
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_journey_albums_owner_idx ON halo_journey_albums(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS halo_journey_lyric_sessions (
  id UUID PRIMARY KEY,
  identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  seconds DOUBLE PRECISION NOT NULL CHECK (seconds BETWEEN 0 AND 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
