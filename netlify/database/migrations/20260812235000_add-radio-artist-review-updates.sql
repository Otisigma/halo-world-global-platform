ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS artist_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS artist_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS artist_viewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS halo_radio_tracks_artist_updates_idx
  ON halo_radio_tracks(member_id, artist_viewed_at, reviewed_at DESC)
  WHERE reviewed_at IS NOT NULL;
