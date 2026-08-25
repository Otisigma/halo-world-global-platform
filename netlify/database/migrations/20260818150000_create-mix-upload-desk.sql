ALTER TABLE halo_mixes
  ADD COLUMN IF NOT EXISTS upload_source TEXT NOT NULL DEFAULT 'halo_deck',
  ADD COLUMN IF NOT EXISTS production_route TEXT NOT NULL DEFAULT 'halo_mixed',
  ADD COLUMN IF NOT EXISTS seller_mode TEXT NOT NULL DEFAULT 'creator',
  ADD COLUMN IF NOT EXISTS client_sale_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mixing_fee_included BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS rights_attested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE halo_mixes
  DROP CONSTRAINT IF EXISTS halo_mixes_upload_source_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_production_route_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_seller_mode_check;

ALTER TABLE halo_mixes
  ADD CONSTRAINT halo_mixes_upload_source_check
    CHECK (upload_source IN ('halo_deck', 'creator_desk')),
  ADD CONSTRAINT halo_mixes_production_route_check
    CHECK (production_route IN ('self_mixed', 'halo_mixed')),
  ADD CONSTRAINT halo_mixes_seller_mode_check
    CHECK (seller_mode IN ('creator', 'halo_managed'));

UPDATE halo_mixes
SET
  upload_source = COALESCE(NULLIF(upload_source, ''), 'halo_deck'),
  production_route = COALESCE(NULLIF(production_route, ''), 'halo_mixed'),
  seller_mode = COALESCE(NULLIF(seller_mode, ''), 'creator'),
  client_sale_enabled = visibility = 'room',
  mixing_fee_included = TRUE;

CREATE INDEX IF NOT EXISTS halo_mixes_creator_sales_idx
  ON halo_mixes(member_id, client_sale_enabled, created_at DESC);
