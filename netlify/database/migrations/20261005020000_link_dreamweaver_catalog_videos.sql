ALTER TABLE halo_videos
  ADD COLUMN IF NOT EXISTS linked_song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_mix_id TEXT REFERENCES halo_mixes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_videos_linked_song_idx
  ON halo_videos(linked_song_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_videos_linked_mix_idx
  ON halo_videos(linked_mix_id, status, created_at DESC);
