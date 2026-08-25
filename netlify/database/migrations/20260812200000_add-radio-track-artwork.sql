ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS artwork_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS artwork_content_type TEXT NOT NULL DEFAULT '';

ALTER TABLE halo_radio_tracks
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_artwork_content_type_check,
  ADD CONSTRAINT halo_radio_tracks_artwork_content_type_check CHECK (
    artwork_content_type IN ('', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );
