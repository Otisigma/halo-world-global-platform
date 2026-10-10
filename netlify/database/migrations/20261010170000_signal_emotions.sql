CREATE TABLE IF NOT EXISTS halo_signal_emotions (
  id UUID PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  track_name TEXT NOT NULL,
  emotion_word VARCHAR(20) NOT NULL CHECK (
    char_length(emotion_word) BETWEEN 1 AND 20 AND emotion_word !~ '[[:space:][:cntrl:]]'
  ),
  identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  playback_seconds DOUBLE PRECISION CHECK (playback_seconds BETWEEN 0 AND 86400),
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_signal_emotions_recent_idx
  ON halo_signal_emotions(release_id, created_at DESC, id DESC) WHERE hidden = FALSE;

CREATE TABLE IF NOT EXISTS halo_signal_emotion_limits (
  identity_hash TEXT PRIMARY KEY CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0)
);

-- Conflicting row locks serialize quotas across function instances.
CREATE OR REPLACE FUNCTION halo_signal_emotion_allow(identity_key TEXT, quota_max INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE accepted TEXT;
BEGIN
  INSERT INTO halo_signal_emotion_limits AS limits (identity_hash) VALUES (identity_key)
  ON CONFLICT (identity_hash) DO UPDATE SET
    attempts = CASE WHEN limits.window_start <= NOW() - INTERVAL '1 minute'
      THEN 1 ELSE limits.attempts + 1 END,
    window_start = CASE WHEN limits.window_start <= NOW() - INTERVAL '1 minute'
      THEN NOW() ELSE limits.window_start END
  WHERE limits.attempts < quota_max OR limits.window_start <= NOW() - INTERVAL '1 minute'
  RETURNING identity_hash INTO accepted;
  RETURN accepted IS NOT NULL;
END;
$$;
