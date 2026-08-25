CREATE TABLE IF NOT EXISTS marketplace_creators (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_actor_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  city TEXT NOT NULL,
  country_code TEXT NOT NULL,
  disciplines TEXT[] NOT NULL DEFAULT '{}',
  statement TEXT NOT NULL,
  bio TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#dfff42',
  status TEXT NOT NULL DEFAULT 'draft',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (country_code IN ('GB', 'IE')),
  CHECK (status IN ('draft', 'review', 'published', 'suspended')),
  CHECK (char_length(display_name) BETWEEN 2 AND 80),
  CHECK (char_length(statement) BETWEEN 12 AND 180)
);

CREATE TABLE IF NOT EXISTS marketplace_products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creator_id BIGINT NOT NULL REFERENCES marketplace_creators(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  product_type TEXT NOT NULL,
  description TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  format_label TEXT NOT NULL,
  edition_label TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (creator_id, slug),
  CHECK (product_type IN ('dj_tools', 'stems', 'masters', 'education', 'review')),
  CHECK (price_minor >= 0),
  CHECK (currency IN ('GBP', 'EUR')),
  CHECK (status IN ('draft', 'review', 'published', 'archived')),
  CHECK (char_length(title) BETWEEN 2 AND 120)
);

CREATE TABLE IF NOT EXISTS marketplace_interests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  product_id BIGINT REFERENCES marketplace_products(id) ON DELETE CASCADE,
  creator_id BIGINT REFERENCES marketplace_creators(id) ON DELETE CASCADE,
  interest_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (interest_type IN ('saved_drop', 'founding_creator')),
  CHECK (
    (interest_type = 'saved_drop' AND product_id IS NOT NULL)
    OR (interest_type = 'founding_creator' AND creator_id IS NULL AND product_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_saved_drop_unique
  ON marketplace_interests(actor_id, product_id)
  WHERE interest_type = 'saved_drop';

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_founding_creator_unique
  ON marketplace_interests(actor_id)
  WHERE interest_type = 'founding_creator';

CREATE INDEX IF NOT EXISTS marketplace_creators_public_idx
  ON marketplace_creators(status, is_featured DESC, sort_order, display_name);

CREATE INDEX IF NOT EXISTS marketplace_products_public_idx
  ON marketplace_products(status, product_type, is_featured DESC, sort_order);

INSERT INTO marketplace_creators
  (slug, display_name, city, country_code, disciplines, statement, bio, accent, status, is_featured, is_demo, sort_order)
VALUES
  ('mara-vale', 'MARA VALE', 'Manchester', 'GB', ARRAY['DJ', 'Producer'], 'Warehouse pressure translated into precise, emotional club tools.', 'A preview creator representing HALO''s founding electronic music cohort across the UK and Ireland.', '#dfff42', 'published', TRUE, TRUE, 1),
  ('north-relay', 'NORTH RELAY', 'Belfast', 'GB', ARRAY['Live Act', 'Producer'], 'Analog movement, coastal atmosphere, and records built for long rooms.', 'A preview creator representing HALO''s founding electronic music cohort across the UK and Ireland.', '#ff6b35', 'published', TRUE, TRUE, 2),
  ('eimear-vale', 'EIMEAR VALE', 'Dublin', 'IE', ARRAY['Songwriter', 'Producer'], 'Songs with open skies, detailed low end, and nowhere for the feeling to hide.', 'A preview creator representing HALO''s founding electronic music cohort across the UK and Ireland.', '#78a7ff', 'published', TRUE, TRUE, 3),
  ('nia-rook', 'NIA ROOK', 'London', 'GB', ARRAY['DJ', 'Educator'], 'Fast hands, patient storytelling, and practical knowledge for working DJs.', 'A preview creator representing HALO''s founding electronic music cohort across the UK and Ireland.', '#ffdf6b', 'published', FALSE, TRUE, 4)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_products
  (creator_id, slug, title, product_type, description, price_minor, currency, format_label, edition_label, status, is_featured, sort_order)
SELECT creator.id, product.slug, product.title, product.product_type, product.description,
  product.price_minor, product.currency, product.format_label, product.edition_label,
  'published', product.is_featured, product.sort_order
FROM marketplace_creators creator
JOIN (VALUES
  ('mara-vale', 'after-hours-tools-001', 'After Hours Tools 001', 'dj_tools', 'Four extended club edits with clean intros, acappella exits, and lossless masters.', 1999, 'GBP', '24-bit WAV · 8 files', 'Founding drop · 100 copies', TRUE, 1),
  ('mara-vale', 'pressure-system-stems', 'Pressure System Stems', 'stems', 'Five native session buses prepared without master limiting for remixing and study.', 2499, 'GBP', '24-bit WAV · 5 stems', 'Native DAW export', FALSE, 2),
  ('north-relay', 'signal-coast-master', 'Signal Coast — Studio Master', 'masters', 'The full-resolution studio master with alternate club and sunrise versions.', 1299, 'GBP', '24-bit WAV · 3 versions', 'HALO exclusive', TRUE, 1),
  ('north-relay', 'inside-signal-coast', 'Inside Signal Coast', 'education', 'A focused track deconstruction covering arrangement, hardware capture, and final mix decisions.', 2999, 'GBP', '48 min video · project stems', 'Creator classroom', FALSE, 2),
  ('eimear-vale', 'open-sky-vocal-stems', 'Open Sky Vocal Stems', 'stems', 'Lead, harmony, texture, instrumental, and effects buses from the original session.', 2499, 'EUR', '24-bit WAV · 7 stems', 'Licensed remix study', TRUE, 1),
  ('eimear-vale', 'song-architecture-class', 'Song Architecture', 'education', 'A practical session on turning one emotional sentence into melody, lyric, and arrangement.', 3499, 'EUR', '62 min video · workbook', 'Founding class', FALSE, 2),
  ('nia-rook', 'behind-the-decks', 'Behind The Decks', 'education', 'Set building, energy mapping, harmonic movement, and preparing edits for real rooms.', 2999, 'GBP', '54 min video · templates', 'DJ field guide', TRUE, 1),
  ('nia-rook', 'track-review-pass', 'Track Review Pass', 'review', 'One private five-minute video critique covering arrangement, mix translation, and next actions.', 7500, 'GBP', 'Private video response', '6 monthly places', FALSE, 2)
) AS product(creator_slug, slug, title, product_type, description, price_minor, currency, format_label, edition_label, is_featured, sort_order)
  ON creator.slug = product.creator_slug
ON CONFLICT (creator_id, slug) DO NOTHING;
