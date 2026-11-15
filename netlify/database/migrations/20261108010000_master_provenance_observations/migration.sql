-- These records are observations, not certificates of immutable storage.
CREATE TABLE IF NOT EXISTS halo_master_provenance_observations (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  record JSONB NOT NULL,
  mac TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_master_provenance_observations_owner_version_idx
  ON halo_master_provenance_observations (owner_member_id, version_id, created_at DESC);
CREATE TABLE IF NOT EXISTS halo_master_provenance_read_limits (
  owner_member_id TEXT PRIMARY KEY,
  last_started TIMESTAMPTZ NOT NULL
);
