-- Large master copies are uploaded straight from the browser to S3-compatible object storage.
-- The private object key is recorded here; audio_url keeps pointing at the owner-only
-- /api/song-catalog/audio playback route so no storage URL is ever persisted or published.
ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS audio_storage_key text DEFAULT '' NOT NULL;
