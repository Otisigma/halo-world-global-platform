-- Publish "My Sensitivity Like a Crown" by Owen Anthony.
-- Follows the resolved artwork contract from PR #38:
--   artwork_url          → base song artwork (local asset path)
--   imported_artwork_url → empty; set when artwork is imported from an external source
--   artwork_override_url → empty; set when a manual artwork override is applied
-- resolveReleaseArtworkFields() will resolve artworkSource = "legacy" for the local
-- artwork_url, or fall back to the HALO icon if the asset is not yet uploaded.
--
-- Dream Weaver storage path:
--   Canonical release record lives in halo_release_campaigns (id = 'my-sensitivity-like-a-crown').
--   When imported into the song catalog the halo_song_catalog row must carry
--   source_release_id = 'my-sensitivity-like-a-crown' so catalog, chart, and
--   release surfaces all resolve back to this single authoritative record.
--   Dream Weaver Song Lab stores its AI-generated creative package in
--   halo_dreamweaver_songs keyed by a project UUID; the song catalog row links
--   the two surfaces through source_release_id.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Release campaign record
-- ───────────────────────────────────────────────────────────────────────────
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
  purchase_url,
  pitch,
  press_description,
  credits,
  available_versions,
  is_clean_version,
  is_chart_eligible,
  status
)
VALUES (
  'my-sensitivity-like-a-crown',
  'My Sensitivity Like a Crown',
  'Owen Anthony',
  NULL, -- release_date: set when the streaming release date is confirmed
  ARRAY['Hip-Hop', 'Rap', 'R&B / Soul'],
  '/assets/releases/my-sensitivity-like-a-crown.jpg',
  '',
  '',
  'https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown',
  '/release-kit.html?audience=dj&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=radio&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=press&slug=my-sensitivity-like-a-crown',
  'https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown',
  'My Sensitivity Like a Crown is Owen Anthony''s official release, available now on all major streaming platforms.',
  'My Sensitivity Like a Crown is an official Owen Anthony release distributed through DistroKid and available on all major streaming platforms.',
  'Owen Anthony — primary artist',
  ARRAY['Official streaming release', 'Radio edit', 'Clean version', 'Instrumental'],
  TRUE,
  TRUE,
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title                = EXCLUDED.title,
  artist               = EXCLUDED.artist,
  genres               = EXCLUDED.genres,
  artwork_url          = EXCLUDED.artwork_url,
  imported_artwork_url = EXCLUDED.imported_artwork_url,
  artwork_override_url = EXCLUDED.artwork_override_url,
  official_url         = EXCLUDED.official_url,
  dj_url               = EXCLUDED.dj_url,
  radio_url            = EXCLUDED.radio_url,
  press_url            = EXCLUDED.press_url,
  purchase_url         = EXCLUDED.purchase_url,
  pitch                = EXCLUDED.pitch,
  press_description    = EXCLUDED.press_description,
  credits              = EXCLUDED.credits,
  available_versions   = EXCLUDED.available_versions,
  is_clean_version     = EXCLUDED.is_clean_version,
  is_chart_eligible    = EXCLUDED.is_chart_eligible,
  status               = EXCLUDED.status,
  updated_at           = NOW();

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Artist page — Owen Anthony hero update for this release
--
-- release_url  → the HyperFollow pre-save / streaming landing page for the
--                release itself; displayed as the primary "listen" link.
-- website_url  → the artist's streaming profile URL (e.g. Spotify artist or
--                album page); intentionally separate from release_url so the
--                frontend can surface both independently.
--                Left empty here until the streaming release date is confirmed
--                and a canonical Spotify/Apple URL is available.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO halo_artist_pages (
  slug,
  artist_name,
  tagline,
  bio,
  accent_color,
  artwork_url,
  release_title,
  release_url,
  dj_room_url,
  radio_room_url,
  press_room_url,
  community_url,
  website_url,
  status
)
VALUES (
  'owen-anthony',
  'Owen Anthony',
  'My Sensitivity Like a Crown — available now on all platforms.',
  'Owen Anthony is an independent hip-hop/rap artist in the HALO ecosystem. My Sensitivity Like a Crown is the latest release: a deeply personal record now permanently connected to fan, DJ, and radio support rooms.',
  '#c084fc',
  '/assets/releases/my-sensitivity-like-a-crown.jpg',
  'My Sensitivity Like a Crown',
  'https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown',
  '/release-kit.html?audience=dj&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=radio&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=press&slug=my-sensitivity-like-a-crown',
  '/#clubhouse',
  '', -- populated when the streaming release date is confirmed and a Spotify URL is available
  'published'
)
ON CONFLICT (slug) DO UPDATE SET
  artist_name    = EXCLUDED.artist_name,
  tagline        = EXCLUDED.tagline,
  bio            = EXCLUDED.bio,
  accent_color   = EXCLUDED.accent_color,
  artwork_url    = EXCLUDED.artwork_url,
  release_title  = EXCLUDED.release_title,
  release_url    = EXCLUDED.release_url,
  dj_room_url    = EXCLUDED.dj_room_url,
  radio_room_url = EXCLUDED.radio_room_url,
  press_room_url = EXCLUDED.press_room_url,
  community_url  = EXCLUDED.community_url,
  -- Preserve any manually populated streaming URL (e.g. Spotify); only write the
  -- placeholder empty string when no URL has been set yet.
  website_url    = COALESCE(NULLIF(halo_artist_pages.website_url, ''), EXCLUDED.website_url),
  status         = EXCLUDED.status,
  updated_at     = NOW();
