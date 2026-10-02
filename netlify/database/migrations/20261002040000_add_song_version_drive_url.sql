-- Owners can paste a shareable Google Drive link to the full WAV master instead of using the
-- credentialed Drive upload. The link lives on the song's canonical sale_master version and is
-- only returned to the owner through /api/song-catalog (as googleDriveUrl); it is never published.
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_url text DEFAULT '' NOT NULL;
