-- Publish Blessed after the latest applied migration.
INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  release_date,
  genres,
  artwork_url,
  official_url,
  dj_url,
  radio_url,
  press_url,
  pitch,
  press_description,
  credits,
  available_versions,
  status
)
VALUES (
  'blessed',
  'Blessed',
  'Owen Anthony',
  NULL,
  ARRAY['Hip-Hop', 'Rap'],
  '',
  'https://distrokid.com/hyperfollow/owenanthony/blessed',
  '/release-kit.html?audience=dj&slug=blessed',
  '/release-kit.html?audience=radio&slug=blessed',
  '/release-kit.html?audience=press&slug=blessed',
  'Blessed is Owen Anthony''s official release, available now on all major streaming platforms.',
  'Blessed is an official Owen Anthony release distributed through DistroKid and available on all major streaming platforms.',
  'Owen Anthony — primary artist',
  ARRAY['Official release', 'DJ support request', 'Radio support request', 'Release details'],
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  genres = EXCLUDED.genres,
  official_url = EXCLUDED.official_url,
  dj_url = EXCLUDED.dj_url,
  radio_url = EXCLUDED.radio_url,
  press_url = EXCLUDED.press_url,
  pitch = EXCLUDED.pitch,
  press_description = EXCLUDED.press_description,
  credits = EXCLUDED.credits,
  available_versions = EXCLUDED.available_versions,
  status = EXCLUDED.status,
  updated_at = NOW();
