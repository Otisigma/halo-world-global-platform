ALTER TABLE halo_song_catalog
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE halo_song_versions
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked_songs AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_member_id ORDER BY updated_at DESC, id) - 1 AS position
  FROM halo_song_catalog
)
UPDATE halo_song_catalog song
SET sort_order = ranked_songs.position
FROM ranked_songs
WHERE song.id = ranked_songs.id AND song.sort_order = 0;

WITH ranked_versions AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY created_at, id) - 1 AS position
  FROM halo_song_versions
)
UPDATE halo_song_versions version
SET sort_order = ranked_versions.position
FROM ranked_versions
WHERE version.id = ranked_versions.id AND version.sort_order = 0;

CREATE TABLE IF NOT EXISTS halo_catalog_layouts (
  owner_member_id TEXT PRIMARY KEY,
  section_order JSONB NOT NULL DEFAULT '["summary", "catalog", "producer", "radio"]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(section_order) = 'array')
);

CREATE INDEX IF NOT EXISTS halo_song_catalog_owner_sort_idx
  ON halo_song_catalog (owner_member_id, status, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_song_versions_song_sort_idx
  ON halo_song_versions (song_id, status, sort_order, updated_at DESC);
