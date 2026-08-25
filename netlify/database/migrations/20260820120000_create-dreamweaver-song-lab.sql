CREATE TABLE IF NOT EXISTS halo_dreamweaver_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  blob_prefix TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 64),
  content_type TEXT NOT NULL CHECK (content_type IN ('audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 134217728),
  duration_seconds NUMERIC(12, 3) NOT NULL DEFAULT 0,
  rights_attested BOOLEAN NOT NULL DEFAULT FALSE,
  creative_brief TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL DEFAULT '',
  analysis_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  creative_package JSONB NOT NULL DEFAULT '{}'::jsonb,
  artwork_key TEXT NOT NULL DEFAULT '',
  artwork_content_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'analyzing', 'ready', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_songs_member_created_idx
  ON halo_dreamweaver_songs(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_songs_status_idx
  ON halo_dreamweaver_songs(status, updated_at DESC);
