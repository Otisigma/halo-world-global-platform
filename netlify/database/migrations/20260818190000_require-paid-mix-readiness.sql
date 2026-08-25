ALTER TABLE halo_mixes
  ADD COLUMN IF NOT EXISTS edition_format TEXT NOT NULL DEFAULT 'mp3',
  ADD COLUMN IF NOT EXISTS price_minor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS product_info_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS master_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rights_clearance_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE halo_mixes
  DROP CONSTRAINT IF EXISTS halo_mixes_edition_format_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_price_minor_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_currency_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_rights_clearance_status_check;

ALTER TABLE halo_mixes
  ADD CONSTRAINT halo_mixes_edition_format_check
    CHECK (edition_format IN ('mp3', 'wav_bundle')),
  ADD CONSTRAINT halo_mixes_price_minor_check
    CHECK (price_minor BETWEEN 0 AND 50000),
  ADD CONSTRAINT halo_mixes_currency_check
    CHECK (currency = 'USD'),
  ADD CONSTRAINT halo_mixes_rights_clearance_status_check
    CHECK (rights_clearance_status IN ('pending', 'confirmed', 'blocked'));

UPDATE halo_mixes
SET sales_status = 'rights_review'
WHERE sales_status = 'ready'
  AND client_sale_enabled = TRUE;

CREATE INDEX IF NOT EXISTS halo_mixes_paid_readiness_idx
  ON halo_mixes(client_sale_enabled, master_approved, product_info_complete, rights_clearance_status)
  WHERE visibility = 'room';
