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
  'what-ive-learned',
  'What I''ve Learned',
  'Owen Anthony',
  '2026-07-10',
  'https://distrokid.imgix.net/http%3A%2F%2Fgather.fandalism.com%2F13116989--E2E1D346-84B4-47CE-B39682A80A3F4097--0--1865782--GeminiGeneratedImagel7btuvl7btuvl7bt.png?fm=jpg&mark-y=568&mark-x=620&mark-w=180&q=75&w=800&mark=http%3A%2F%2Fgather.fandalism.com%2Fdistrokid-sticker-sm.png&s=08acd00460bd034d9648bb39e90b42a7',
  'https://distrokid.com/hyperfollow/owenanthony/what-ive-learned',
  '/release-kit.html?audience=dj&slug=what-ive-learned',
  '/release-kit.html?audience=radio&slug=what-ive-learned',
  '/release-kit.html?audience=press&slug=what-ive-learned',
  'What I''ve Learned is an Owen Anthony release connecting the official stream, visual, and professional support paths.',
  'What I''ve Learned is an Owen Anthony release available through its official HyperFollow page, with connected paths for listeners, DJs, radio teams, and press.',
  ARRAY['Official streaming release', 'Official video', 'Artwork and verified release details', 'DJ, radio, and press enquiries'],
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
  artwork_url = 'https://distrokid.imgix.net/http%3A%2F%2Fgather.fandalism.com%2F13116989--E2E1D346-84B4-47CE-B39682A80A3F4097--0--1865782--GeminiGeneratedImagel7btuvl7btuvl7bt.png?fm=jpg&mark-y=568&mark-x=620&mark-w=180&q=75&w=800&mark=http%3A%2F%2Fgather.fandalism.com%2Fdistrokid-sticker-sm.png&s=08acd00460bd034d9648bb39e90b42a7',
  release_title = 'What I''ve Learned',
  release_date = '2026-07-10',
  release_url = 'https://distrokid.com/hyperfollow/owenanthony/what-ive-learned',
  video_title = 'What I''ve Learned. Out Now. Stream From All Platforms',
  video_url = 'https://www.youtube.com/watch?v=QVbAzi8Lw9g',
  dj_room_url = '/release-kit.html?audience=dj&slug=what-ive-learned',
  radio_room_url = '/release-kit.html?audience=radio&slug=what-ive-learned',
  press_room_url = '/release-kit.html?audience=press&slug=what-ive-learned',
  website_url = 'https://open.spotify.com/album/2kjMQORqPJVNZrIJX6VUpw',
  status = 'published',
  updated_at = NOW()
WHERE slug = 'owen-anthony';
