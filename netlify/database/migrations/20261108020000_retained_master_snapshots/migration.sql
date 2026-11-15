CREATE TABLE IF NOT EXISTS halo_retained_master_snapshots (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  attempt_id TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  storage_key TEXT NOT NULL DEFAULT '',
  storage_version_id TEXT NOT NULL DEFAULT '',
  record JSONB,
  signature TEXT,
  parent_record_id TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT 'original',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_member_id, song_id, version_id, source_id)
);
CREATE INDEX IF NOT EXISTS halo_retained_master_owner_song_idx
  ON halo_retained_master_snapshots (owner_member_id, song_id, created_at DESC);
