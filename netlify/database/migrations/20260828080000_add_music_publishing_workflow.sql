-- Music publishing workflow: chart eligibility, buy/stream links, featured spotlight.
-- Preserves backwards compatibility — all new columns default to safe/empty values.

ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS is_clean_version   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_chart_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchase_url       TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stream_url         TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS featured_type      TEXT    NOT NULL DEFAULT ''
    CHECK (featured_type IN ('', 'week', 'month')),
  ADD COLUMN IF NOT EXISTS featured_until     DATE;

-- Add a dedicated buy/stream URL to artist pages so the hero CTA can link to a
-- distinct destination from the "Play" action (e.g. a sales page or streaming service).
ALTER TABLE halo_artist_pages
  ADD COLUMN IF NOT EXISTS purchase_url TEXT NOT NULL DEFAULT '';

-- Every existing published release is promoted to chart-eligible clean status
-- so nothing disappears from the live chart.
UPDATE halo_release_campaigns
SET
  is_clean_version  = TRUE,
  is_chart_eligible = TRUE
WHERE status = 'published';

-- Carry the existing official_url into purchase_url wherever it is a verified
-- streaming / HyperFollow destination so the buy button works immediately.
UPDATE halo_release_campaigns
SET purchase_url = official_url
WHERE purchase_url = ''
  AND official_url <> ''
  AND (
    official_url ILIKE '%distrokid%'
    OR official_url ILIKE '%hyperfollow%'
    OR official_url ILIKE '%spotify%'
    OR official_url ILIKE '%apple%'
    OR official_url ILIKE '%bandcamp%'
  );

-- Backfill artist page purchase_url from release_url where the release_url is a
-- known streaming / HyperFollow destination.
UPDATE halo_artist_pages
SET purchase_url = release_url
WHERE purchase_url = ''
  AND release_url <> ''
  AND (
    release_url ILIKE '%distrokid%'
    OR release_url ILIKE '%hyperfollow%'
    OR release_url ILIKE '%spotify%'
    OR release_url ILIKE '%apple%'
    OR release_url ILIKE '%bandcamp%'
  );

-- -----------------------------------------------------------------------
-- Requested HyperFollow releases (https://direct.distrokid.com/halomusic/)
-- -----------------------------------------------------------------------

INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  artwork_url,
  official_url,
  purchase_url,
  pitch,
  available_versions,
  is_clean_version,
  is_chart_eligible,
  status
)
VALUES
  (
    'cognitive-erasure',
    'Cognitive Erasure',
    'Owen Anthony',
    '',
    'https://distrokid.com/hyperfollow/owenanthony/cognitive-erasure',
    'https://distrokid.com/hyperfollow/owenanthony/cognitive-erasure',
    'Cognitive Erasure — Owen Anthony. Stream and save now via HALO.',
    ARRAY['Official streaming release'],
    TRUE,
    TRUE,
    'published'
  ),
  (
    'ill-do-it-all-again',
    'I''ll Do It All Again',
    'Owen Anthony',
    '',
    'https://distrokid.com/hyperfollow/owenanthony/ill-do-it-all-again',
    'https://distrokid.com/hyperfollow/owenanthony/ill-do-it-all-again',
    'I''ll Do It All Again — Owen Anthony. Stream and save now via HALO.',
    ARRAY['Official streaming release'],
    TRUE,
    TRUE,
    'published'
  ),
  (
    'blessed',
    'Blessed',
    'Owen Anthony',
    '',
    'https://distrokid.com/hyperfollow/owenanthony/blessed',
    'https://distrokid.com/hyperfollow/owenanthony/blessed',
    'Blessed — Owen Anthony. Stream and save now via HALO.',
    ARRAY['Official streaming release'],
    TRUE,
    TRUE,
    'published'
  )
ON CONFLICT (id) DO UPDATE SET
  title             = EXCLUDED.title,
  artist            = EXCLUDED.artist,
  official_url      = EXCLUDED.official_url,
  purchase_url      = EXCLUDED.purchase_url,
  is_clean_version  = EXCLUDED.is_clean_version,
  is_chart_eligible = EXCLUDED.is_chart_eligible,
  status            = EXCLUDED.status,
  updated_at        = NOW();
