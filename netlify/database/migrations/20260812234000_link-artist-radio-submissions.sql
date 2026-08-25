ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_radio_tracks_artist_status_idx
  ON halo_radio_tracks(artist_slug, status, created_at DESC);
