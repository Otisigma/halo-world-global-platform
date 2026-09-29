-- Each song keeps exactly one active sale master (the canonical master copy).
-- Demote any historical duplicates deterministically before adding the guard.
WITH ranked_masters AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY song_id
    ORDER BY (COALESCE(audio_url, '') <> '') DESC, created_at ASC, id ASC
  ) AS master_rank
  FROM halo_song_versions
  WHERE version_type = 'sale_master' AND status = 'active'
)
UPDATE halo_song_versions
SET version_type = 'alternate',
    label = 'Alternate version',
    destination = 'storefront',
    updated_at = NOW()
WHERE id IN (SELECT id FROM ranked_masters WHERE master_rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS halo_song_versions_single_active_master_idx
  ON halo_song_versions (song_id)
  WHERE version_type = 'sale_master' AND status = 'active';
