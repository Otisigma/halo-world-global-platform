CREATE TABLE IF NOT EXISTS halo_merch_products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  featured_release_id TEXT NOT NULL DEFAULT '',
  featured_release_title TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL DEFAULT 'HALO',
  collection_label TEXT NOT NULL,
  title TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT 'HALO Merch',
  description TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  provider_name TEXT NOT NULL DEFAULT 'printful',
  provider_product_id TEXT NOT NULL DEFAULT '',
  affiliate_checkout_url TEXT NOT NULL DEFAULT '',
  affiliate_disclosure_required BOOLEAN NOT NULL DEFAULT TRUE,
  fulfillment_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  fulfillment_notes TEXT NOT NULL DEFAULT '',
  disclosure_copy TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (price_minor >= 0),
  CHECK (currency IN ('GBP', 'EUR', 'USD')),
  CHECK (provider_name IN ('printful')),
  CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS halo_merch_products_status_idx
  ON halo_merch_products(status, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_merch_products_release_idx
  ON halo_merch_products(featured_release_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS halo_merch_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES halo_merch_products(id) ON DELETE CASCADE,
  variant_label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  provider_sku TEXT NOT NULL UNIQUE,
  provider_variant_id TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  availability_label TEXT NOT NULL DEFAULT 'Available',
  fulfillment_days_min INTEGER NOT NULL DEFAULT 2,
  fulfillment_days_max INTEGER NOT NULL DEFAULT 5,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, variant_label),
  CHECK (price_minor >= 0),
  CHECK (currency IN ('GBP', 'EUR', 'USD')),
  CHECK (fulfillment_days_min >= 0),
  CHECK (fulfillment_days_max >= fulfillment_days_min),
  CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS halo_merch_variants_status_idx
  ON halo_merch_variants(product_id, status, updated_at DESC);

INSERT INTO halo_merch_products (
  id, slug, featured_release_id, featured_release_title, artist_name, collection_label, title, badge,
  description, hero_image_url, price_minor, currency, provider_name, provider_product_id,
  affiliate_checkout_url, affiliate_disclosure_required, fulfillment_regions, fulfillment_notes,
  disclosure_copy, status, sort_order
) VALUES
  (
    'merch-world-tee',
    'halo-world-tee',
    'when-the-world-goes-dark',
    'When The World Goes Dark',
    'HALO',
    'World signal capsule',
    'HALO World Tee',
    'HALO merch',
    'Soft everyday tee anchored to the main HALO storefront so listeners can move from a release into a branded merch lane without leaving the platform voice.',
    '/assets/releases/when-the-world-goes-dark.jpg',
    2800,
    'GBP',
    'printful',
    'printful-halo-world-tee',
    'https://www.printful.com/uk/custom/mens/t-shirts/unisex-staple-t-shirt?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch',
    TRUE,
    '["United Kingdom","Europe","United States","International"]'::jsonb,
    'Made to order, routed through HALO, and fulfilled internationally by Printful after checkout.',
    'Merch is presented as HALO merchandise. Checkout and fulfilment run through Printful, and HALO may earn an affiliate commission on eligible orders.',
    'active',
    1
  ),
  (
    'merch-signal-poster',
    'halo-signal-poster',
    'my-sensitivity-like-a-crown',
    'My Sensitivity Like a Crown',
    'HALO',
    'Release wall set',
    'HALO Signal Poster',
    'HALO merch',
    'A release-wall print route that keeps HALO product language public while the provider SKU and affiliate destination remain server-side.',
    '/assets/releases/my-sensitivity-like-a-crown.jpg',
    2200,
    'GBP',
    'printful',
    'printful-halo-signal-poster',
    'https://www.printful.com/uk/custom/posters/posters?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch',
    TRUE,
    '["United Kingdom","Europe","United States","International"]'::jsonb,
    'Poster production starts after order confirmation and ships through Printful''s international network.',
    'Merch is presented as HALO merchandise. Checkout and fulfilment run through Printful, and HALO may earn an affiliate commission on eligible orders.',
    'active',
    2
  ),
  (
    'merch-session-tote',
    'halo-session-tote',
    'blessed',
    'Blessed',
    'HALO',
    'Carry the signal',
    'HALO Session Tote',
    'HALO merch',
    'A lightweight carry item for music, notebooks, and cables, positioned inside the HALO shop as merch rather than a separate partner-branded storefront.',
    '/assets/releases/blessed.jpg',
    2600,
    'GBP',
    'printful',
    'printful-halo-session-tote',
    'https://www.printful.com/uk/custom/bags/tote-bags/eco-tote-bag?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch',
    TRUE,
    '["United Kingdom","Europe","United States","International"]'::jsonb,
    'Print-on-demand tote fulfilled by Printful with international delivery coverage.',
    'Merch is presented as HALO merchandise. Checkout and fulfilment run through Printful, and HALO may earn an affiliate commission on eligible orders.',
    'active',
    3
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO halo_merch_variants (
  id, product_id, variant_label, color, size, provider_sku, provider_variant_id,
  price_minor, currency, availability_label, fulfillment_days_min, fulfillment_days_max, metadata, status
) VALUES
  ('merch-world-tee-black-m', 'merch-world-tee', 'Black / M', 'Black', 'M', 'PF-HALO-WORLD-TEE-BLK-M', '401', 2800, 'GBP', 'UK + international', 2, 5, '{"material":"cotton","provider":"printful"}'::jsonb, 'active'),
  ('merch-world-tee-black-xl', 'merch-world-tee', 'Black / XL', 'Black', 'XL', 'PF-HALO-WORLD-TEE-BLK-XL', '402', 2800, 'GBP', 'UK + international', 2, 5, '{"material":"cotton","provider":"printful"}'::jsonb, 'active'),
  ('merch-world-tee-bone-l', 'merch-world-tee', 'Bone / L', 'Bone', 'L', 'PF-HALO-WORLD-TEE-BNE-L', '403', 2800, 'GBP', 'UK + international', 2, 5, '{"material":"cotton","provider":"printful"}'::jsonb, 'active'),
  ('merch-signal-poster-a3', 'merch-signal-poster', 'A3 print', 'Full colour', 'A3', 'PF-HALO-SIGNAL-POSTER-A3', '501', 2200, 'GBP', 'Rolled poster', 2, 6, '{"paper":"matte","provider":"printful"}'::jsonb, 'active'),
  ('merch-signal-poster-a2', 'merch-signal-poster', 'A2 print', 'Full colour', 'A2', 'PF-HALO-SIGNAL-POSTER-A2', '502', 2600, 'GBP', 'Rolled poster', 2, 6, '{"paper":"matte","provider":"printful"}'::jsonb, 'active'),
  ('merch-session-tote-black', 'merch-session-tote', 'Black', 'Black', 'One size', 'PF-HALO-SESSION-TOTE-BLK', '601', 2600, 'GBP', 'Everyday carry', 2, 5, '{"material":"organic_cotton","provider":"printful"}'::jsonb, 'active'),
  ('merch-session-tote-natural', 'merch-session-tote', 'Natural', 'Natural', 'One size', 'PF-HALO-SESSION-TOTE-NAT', '602', 2600, 'GBP', 'Everyday carry', 2, 5, '{"material":"organic_cotton","provider":"printful"}'::jsonb, 'active')
ON CONFLICT (provider_sku) DO NOTHING;
