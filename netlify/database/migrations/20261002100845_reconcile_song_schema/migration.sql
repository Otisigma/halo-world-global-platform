CREATE INDEX IF NOT EXISTS "halo_song_publication_sync_owner_idx"
  ON "halo_song_publication_sync" ("owner_member_id", "updated_at");
