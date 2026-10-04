CREATE OR REPLACE FUNCTION halo_valid_music_home_layout(modules JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(modules) = 'array' AND jsonb_array_length(modules) = 4 THEN (
    SELECT COUNT(DISTINCT item->>'type') = 4 AND COUNT(DISTINCT item->>'order') = 4
      AND BOOL_AND(COALESCE(
        item ?& ARRAY['id', 'type', 'order', 'isVisible']
        AND (item - ARRAY['id', 'type', 'order', 'isVisible']) = '{}'::jsonb
        AND item->>'type' IN ('PEARL_HALL', 'SOVEREIGN_VAULT', 'SIGNAL_FEED', 'COLLAB_BRIEFS')
        AND item->>'id' = item->>'type'
        AND item->'order' IN ('0'::jsonb, '1'::jsonb, '2'::jsonb, '3'::jsonb)
        AND jsonb_typeof(item->'isVisible') = 'boolean', FALSE
      )) IS TRUE
    FROM jsonb_array_elements(modules) AS item
  ) ELSE FALSE END
$$;

CREATE TABLE IF NOT EXISTS halo_music_homes (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  custom_background_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (member_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  CHECK (jsonb_typeof(config) = 'object'),
  CHECK (octet_length(config::text) <= 16384),
  CHECK (config ?& ARRAY['schemaVersion', 'creatorId', 'theme', 'backgroundMode',
    'selectedBackgroundUrl', 'unlockedBadges', 'layoutModules', 'isSovereignModeActive']),
  CHECK ((config - ARRAY['schemaVersion', 'creatorId', 'theme', 'backgroundMode',
    'selectedBackgroundUrl', 'unlockedBadges', 'layoutModules', 'isSovereignModeActive']) = '{}'::jsonb),
  CHECK (config->'schemaVersion' = '1'::jsonb),
  CHECK (jsonb_typeof(config->'creatorId') = 'string'),
  CHECK (config->>'creatorId' = member_id),
  CHECK (jsonb_typeof(config->'theme') = 'string'),
  CHECK (config->>'theme' IN ('GOLD', 'BRONZE', 'COPPER', 'PLATINUM')),
  CHECK (jsonb_typeof(config->'backgroundMode') = 'string'),
  CHECK (config->>'backgroundMode' IN ('SOLID_OBSIDIAN', 'CURATED_LOOP', 'CUSTOM_UPLOAD')),
  CHECK (jsonb_typeof(config->'selectedBackgroundUrl') = 'string'),
  CHECK (halo_valid_music_home_layout(config->'layoutModules') IS TRUE),
  CHECK (jsonb_typeof(config->'unlockedBadges') = 'array' AND jsonb_array_length(config->'unlockedBadges') <= 3),
  CHECK (config->'unlockedBadges' <@ '["FIRST_STEM", "STEM_COLLECTOR", "SPLITS_COMPLETED"]'::jsonb),
  CHECK (jsonb_typeof(config->'isSovereignModeActive') = 'boolean'),
  CHECK (custom_background_url = '' OR custom_background_url = '/api/music-home?creator=' || member_id || '&asset=background'),
  CHECK (config->>'backgroundMode' <> 'CUSTOM_UPLOAD' OR (
    custom_background_url <> '' AND config->>'selectedBackgroundUrl' = custom_background_url
  )),
  CHECK (config->>'backgroundMode' <> 'SOLID_OBSIDIAN' OR config->>'selectedBackgroundUrl' = ''),
  CHECK (config->>'backgroundMode' <> 'CURATED_LOOP' OR config->>'selectedBackgroundUrl' IN (
    '/music-home/loops/obsidian-gold-dust.mp4', '/music-home/loops/deep-house-smoke.mp4',
    '/music-home/loops/vinyl-caustics.mp4'
  ))
);

REVOKE ALL ON TABLE halo_music_homes FROM PUBLIC;
