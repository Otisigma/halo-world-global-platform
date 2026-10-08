-- A single leased run per catalog song prevents parallel retries from racing.
CREATE TABLE IF NOT EXISTS halo_release_conveyor (
  song_id TEXT PRIMARY KEY REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL,
  input_hash TEXT NOT NULL DEFAULT '',
  state JSONB NOT NULL DEFAULT '{}',
  lease_token TEXT,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only snapshots retain decisions and escalations across input revisions.
CREATE TABLE IF NOT EXISTS halo_release_conveyor_events (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  stage TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_release_conveyor_events_song_idx
  ON halo_release_conveyor_events(song_id, created_at);
