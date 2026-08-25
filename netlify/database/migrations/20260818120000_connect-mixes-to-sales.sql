ALTER TABLE halo_mixes
  ADD COLUMN IF NOT EXISTS artwork_url TEXT NOT NULL DEFAULT '/assets/releases/salty.jpg',
  ADD COLUMN IF NOT EXISTS original_artist TEXT NOT NULL DEFAULT 'Owen Anthony',
  ADD COLUMN IF NOT EXISTS remixer_name TEXT NOT NULL DEFAULT 'DJ HALO X',
  ADD COLUMN IF NOT EXISTS sales_status TEXT NOT NULL DEFAULT 'mastering';

ALTER TABLE halo_mixes
  DROP CONSTRAINT IF EXISTS halo_mixes_sales_status_check;

ALTER TABLE halo_mixes
  ADD CONSTRAINT halo_mixes_sales_status_check
  CHECK (sales_status IN ('mastering', 'rights_review', 'ready', 'stream_only'));

CREATE INDEX IF NOT EXISTS halo_mix_release_plans_mix_idx
  ON halo_mix_release_plans(mix_id)
  WHERE mix_id IS NOT NULL;

UPDATE halo_mixes
SET
  artwork_url = COALESCE(NULLIF(artwork_url, ''), '/assets/releases/salty.jpg'),
  original_artist = COALESCE(NULLIF(original_artist, ''), 'Owen Anthony'),
  remixer_name = COALESCE(NULLIF(remixer_name, ''), 'DJ HALO X'),
  sales_status = CASE
    WHEN visibility = 'private' THEN 'stream_only'
    ELSE COALESCE(NULLIF(sales_status, ''), 'mastering')
  END;
