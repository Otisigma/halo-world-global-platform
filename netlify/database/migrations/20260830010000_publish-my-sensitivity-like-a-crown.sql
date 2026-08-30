-- Add "My Sensitivity Like a Crown" by Owen Anthony to the HALO platform.
-- Includes: release campaign record, chart eligibility, artwork contract fields,
-- artist page entry, and Dream Weaver canonical source note.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Release campaign record
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  genres,
  artwork_url,
  imported_artwork_url,
  official_url,
  dj_url,
  radio_url,
  press_url,
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
  ARRAY['Hip-Hop', 'Rap'],
  '/assets/releases/my-sensitivity-like-a-crown.jpg',
  '/assets/releases/my-sensitivity-like-a-crown.jpg',
  'https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown',
  '/release-kit.html?audience=dj&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=radio&slug=my-sensitivity-like-a-crown',
  '/release-kit.html?audience=press&slug=my-sensitivity-like-a-crown',
  'My Sensitivity Like a Crown is Owen Anthony''s official release — a deeply personal record connecting raw feeling with the HALO ecosystem of fan, DJ, and radio support.',
  'Released by Owen Anthony, My Sensitivity Like a Crown is distributed through DistroKid and available on all major streaming platforms, permanently connected to its HALO campaign room.',
  'Owen Anthony — primary artist',
  ARRAY['Official release', 'Clean version', 'Radio edit', 'Instrumental', 'DJ support request', 'Radio support request', 'Release details'],
  TRUE,
  TRUE,
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title             = EXCLUDED.title,
  artist            = EXCLUDED.artist,
  genres            = EXCLUDED.genres,
  artwork_url       = EXCLUDED.artwork_url,
  imported_artwork_url = EXCLUDED.imported_artwork_url,
  official_url      = EXCLUDED.official_url,
  dj_url            = EXCLUDED.dj_url,
  radio_url         = EXCLUDED.radio_url,
  press_url         = EXCLUDED.press_url,
  pitch             = EXCLUDED.pitch,
  press_description = EXCLUDED.press_description,
  credits           = EXCLUDED.credits,
  available_versions = EXCLUDED.available_versions,
  is_clean_version  = EXCLUDED.is_clean_version,
  is_chart_eligible = EXCLUDED.is_chart_eligible,
  status            = EXCLUDED.status,
  updated_at        = NOW();

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Artist page — Owen Anthony hero update for this release
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
  'https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown',
  'published'
)
ON CONFLICT (slug) DO UPDATE SET
  artist_name   = EXCLUDED.artist_name,
  tagline       = EXCLUDED.tagline,
  bio           = EXCLUDED.bio,
  accent_color  = EXCLUDED.accent_color,
  artwork_url   = EXCLUDED.artwork_url,
  release_title = EXCLUDED.release_title,
  release_url   = EXCLUDED.release_url,
  dj_room_url   = EXCLUDED.dj_room_url,
  radio_room_url = EXCLUDED.radio_room_url,
  press_room_url = EXCLUDED.press_room_url,
  community_url = EXCLUDED.community_url,
  website_url   = EXCLUDED.website_url,
  status        = EXCLUDED.status,
  updated_at    = NOW();
