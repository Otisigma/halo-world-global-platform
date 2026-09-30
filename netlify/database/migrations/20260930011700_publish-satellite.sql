-- Publish "Satellite" by Owen Anthony to the HALO Shop catalog.
--
-- halo_release_campaigns is the authoritative source behind /api/release-catalog.
-- Its CHECK constraint only allows 'draft' or 'published', and every public
-- surface (shop, release links, release kits, publication sync, catalog audit)
-- gates on 'published', so 'published' is the approved ("passed") state here.
--
-- Catalog mapping:
--   audioUrl    → stream_url (Google Drive direct-download pattern used by the shop player)
--   coverArtUrl → artwork_url
--   price       → licensing_tiers (priceCents 2999, GBP = £29.99)
--   isrc        → isrc
--   genre       → genres
-- masterDriveId belongs on the song's canonical sale_master version
-- (halo_song_versions.drive_file_id) once the song catalog record is created,
-- so it is not duplicated on the release campaign.
INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  release_date,
  genres,
  artwork_url,
  imported_artwork_url,
  artwork_override_url,
  official_url,
  dj_url,
  radio_url,
  press_url,
  stream_url,
  isrc,
  pitch,
  press_description,
  credits,
  available_versions,
  licensing_tiers,
  is_chart_eligible,
  status
)
VALUES (
  'satellite-01',
  'Satellite',
  'Owen Anthony',
  NULL,
  ARRAY['Dance', 'House'],
  '/assets/releases/satellite.jpg',
  '',
  '',
  '',
  '/release-kit.html?audience=dj&slug=satellite-01',
  '/release-kit.html?audience=radio&slug=satellite-01',
  '/release-kit.html?audience=press&slug=satellite-01',
  'https://drive.google.com/uc?export=download&id=STREAMING_FILE_ID_FOR_SATELLITE',
  'UK-AAA-26-00010',
  'Satellite is an Owen Anthony house and dance release, verified and available in the HALO Shop.',
  'Satellite is a verified Owen Anthony dance release available for preview and licensing in the HALO Shop.',
  'Owen Anthony — primary artist',
  ARRAY['Official release'],
  '[{"id": "sync_standard", "priceCents": 2999, "currency": "GBP"}]'::jsonb,
  TRUE,
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title                = EXCLUDED.title,
  artist               = EXCLUDED.artist,
  genres               = EXCLUDED.genres,
  artwork_url          = EXCLUDED.artwork_url,
  imported_artwork_url = COALESCE(NULLIF(EXCLUDED.imported_artwork_url, ''), halo_release_campaigns.imported_artwork_url),
  artwork_override_url = COALESCE(NULLIF(EXCLUDED.artwork_override_url, ''), halo_release_campaigns.artwork_override_url),
  dj_url               = EXCLUDED.dj_url,
  radio_url            = EXCLUDED.radio_url,
  press_url            = EXCLUDED.press_url,
  stream_url           = EXCLUDED.stream_url,
  isrc                 = EXCLUDED.isrc,
  pitch                = EXCLUDED.pitch,
  press_description    = EXCLUDED.press_description,
  credits              = EXCLUDED.credits,
  available_versions   = EXCLUDED.available_versions,
  licensing_tiers      = EXCLUDED.licensing_tiers,
  is_chart_eligible    = EXCLUDED.is_chart_eligible,
  status               = EXCLUDED.status,
  updated_at           = NOW();
