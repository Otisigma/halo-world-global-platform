CREATE TABLE IF NOT EXISTS halo_song_publication_leases (
  song_id TEXT PRIMARY KEY REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
