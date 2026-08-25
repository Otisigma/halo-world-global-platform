CREATE TABLE IF NOT EXISTS halo_world_dark_pulses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  listener_key TEXT NOT NULL,
  signal TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (release_id, listener_key),
  CHECK (char_length(listener_key) = 64),
  CHECK (signal IN ('stay', 'rise', 'remember', 'return'))
);

CREATE INDEX IF NOT EXISTS halo_world_dark_pulses_release_created_idx
  ON halo_world_dark_pulses(release_id, created_at DESC);

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
  'when-the-world-goes-dark',
  'When The World Goes Dark',
  'Owen Anthony',
  '2026-08-20',
  ARRAY['Electronic', 'Cinematic'],
  '/assets/releases/when-the-world-goes-dark.jpg',
  'https://distrokid.com/hyperfollow/owenanthony/when-the-world-goes-dark?ref=halo-world',
  '/release-kit.html?audience=dj&slug=when-the-world-goes-dark',
  '/release-kit.html?audience=radio&slug=when-the-world-goes-dark',
  '/release-kit.html?audience=press&slug=when-the-world-goes-dark',
  'A cinematic electronic transmission about protecting the last human signal when certainty, connection, and light disappear.',
  'Released August 20, 2026, When The World Goes Dark expands into The Last Light Network: a participatory digital ritual where every listener leaves one persistent pulse before entering the record.',
  'Owen Anthony — primary artist, songwriter, and producer',
  ARRAY['Official streaming release', 'The Last Light Network fan experience', 'Persistent listener pulse map', 'DJ campaign room', 'Radio campaign room', 'Press campaign room', 'Official cover artwork and release details'],
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  release_date = EXCLUDED.release_date,
  genres = EXCLUDED.genres,
  artwork_url = EXCLUDED.artwork_url,
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

UPDATE halo_artist_pages
SET
  artwork_url = '/assets/releases/when-the-world-goes-dark.jpg',
  release_title = 'When The World Goes Dark',
  release_date = '2026-08-20',
  release_url = '/when-the-world-goes-dark/',
  current_release_id = 'when-the-world-goes-dark',
  updated_at = NOW()
WHERE slug = 'owen-anthony';
