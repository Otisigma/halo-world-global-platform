-- Licensing tiers live on the existing release campaign record so the public shop
-- can offer version and licence selection without a separate product system.
ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS licensing_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;
