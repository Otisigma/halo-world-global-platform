ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS imported_artwork_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS artwork_override_url TEXT NOT NULL DEFAULT '';

UPDATE halo_release_campaigns
SET imported_artwork_url = COALESCE(NULLIF(imported_artwork_url, ''), artwork_url, '')
WHERE imported_artwork_url = '';
