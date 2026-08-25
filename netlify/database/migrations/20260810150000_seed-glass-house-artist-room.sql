INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  release_date,
  artwork_url,
  official_url,
  dj_url,
  radio_url,
  press_url,
  pitch,
  press_description,
  available_versions,
  status
)
VALUES (
  'glass-house',
  'Glass House',
  'Owen Anthony mixed by DJ Halo X',
  '2026-07-17',
  '/assets/artists/owen-anthony-glass-house.webp',
  'https://distrokid.com/hyperfollow/djhalo1/glass-house',
  '/release-kit.html?audience=dj&slug=glass-house',
  '/release-kit.html?audience=radio&slug=glass-house',
  '/release-kit.html?audience=press&slug=glass-house',
  'Glass House brings Owen Anthony and DJ Halo X together in an official release built for direct listening, visual discovery, and professional support.',
  'Glass House is an Owen Anthony release mixed by DJ Halo X. The campaign connects the official stream and visual with dedicated paths for listeners, DJs, radio teams, and press.',
  ARRAY['Official streaming release', 'Official video', 'Artwork and verified release credits', 'DJ, radio, and press enquiries'],
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  release_date = EXCLUDED.release_date,
  artwork_url = EXCLUDED.artwork_url,
  official_url = EXCLUDED.official_url,
  dj_url = EXCLUDED.dj_url,
  radio_url = EXCLUDED.radio_url,
  press_url = EXCLUDED.press_url,
  pitch = EXCLUDED.pitch,
  press_description = EXCLUDED.press_description,
  available_versions = EXCLUDED.available_versions,
  status = EXCLUDED.status,
  updated_at = NOW();

UPDATE halo_artist_pages
SET
  tagline = 'Glass House, mixed by DJ Halo X.',
  bio = 'Owen Anthony is the primary artist credited on Glass House, with DJ Halo X credited for the mix. This room starts with the verified release and grows as more official music, visuals, press, and performance information becomes available.',
  accent_color = '#d5ff52',
  artwork_url = '/assets/artists/owen-anthony-glass-house.webp',
  release_title = 'Glass House',
  release_date = '2026-07-17',
  release_url = 'https://distrokid.com/hyperfollow/djhalo1/glass-house',
  video_title = 'Glass House (Official Video)',
  video_url = 'https://www.youtube.com/watch?v=IEPXrHY77fc',
  community_url = '/#community',
  dj_room_url = '/release-kit.html?audience=dj&slug=glass-house',
  radio_room_url = '/release-kit.html?audience=radio&slug=glass-house',
  press_room_url = '/release-kit.html?audience=press&slug=glass-house',
  booking_url = '/creators/',
  website_url = 'https://open.spotify.com/album/2FzURabdPzW111S2QGkZ5O',
  status = 'published',
  updated_at = NOW()
WHERE slug = 'owen-anthony';
