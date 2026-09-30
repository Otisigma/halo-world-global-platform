-- Large WAV masters can be archived in Google Drive via resumable uploads streamed from the browser.
-- The verified Drive file reference is stored on the song's canonical sale_master version;
-- no Drive URL is ever published, and audio_url playback is unaffected.
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_file_id text DEFAULT '' NOT NULL;
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_file_name text DEFAULT '' NOT NULL;
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_byte_size integer DEFAULT 0 NOT NULL;
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_uploaded_at timestamp with time zone;
