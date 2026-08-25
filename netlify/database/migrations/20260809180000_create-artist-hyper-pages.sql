CREATE TABLE IF NOT EXISTS halo_artist_pages (
  slug TEXT PRIMARY KEY,
  owner_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  artist_name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#d5ff52',
  artwork_url TEXT NOT NULL DEFAULT '',
  release_title TEXT NOT NULL DEFAULT '',
  release_date DATE,
  release_url TEXT NOT NULL DEFAULT '',
  video_title TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  community_url TEXT NOT NULL DEFAULT '',
  dj_room_url TEXT NOT NULL DEFAULT '',
  radio_room_url TEXT NOT NULL DEFAULT '',
  press_room_url TEXT NOT NULL DEFAULT '',
  booking_url TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (char_length(slug) BETWEEN 2 AND 80),
  CHECK (char_length(artist_name) BETWEEN 1 AND 120),
  CHECK (char_length(tagline) <= 180),
  CHECK (char_length(bio) <= 1600),
  CHECK (char_length(location) <= 100),
  CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS halo_artist_pages_owner_idx
  ON halo_artist_pages(owner_member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_artist_pages_status_idx
  ON halo_artist_pages(status, updated_at DESC);

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
  'quicksand',
  'Quicksand',
  'Owen Anthony',
  '2026-07-03',
  '/assets/artists/owen-anthony-quicksand.jpg',
  'https://distrokid.com/hyperfollow/halomusic1/quicksand',
  'https://distrokid.com/hyperfollow/halomusic1/quicksand',
  'https://distrokid.com/hyperfollow/halomusic1/quicksand',
  'https://distrokid.com/hyperfollow/halomusic1/quicksand',
  'A rhythm-led release built around tension, movement, and the feeling of finding solid ground inside an unstable moment.',
  'Quicksand is an Owen Anthony release from the HALO production desk, connecting a direct streaming path with dedicated rooms for listeners, selectors, broadcasters, and storytellers.',
  ARRAY['Official streaming release', 'Artwork and release details', 'DJ, radio, and press enquiries'],
  'published'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO halo_artist_pages (
  slug,
  artist_name,
  tagline,
  bio,
  location,
  accent_color,
  artwork_url,
  release_title,
  release_date,
  release_url,
  community_url,
  dj_room_url,
  radio_room_url,
  press_room_url,
  booking_url,
  website_url,
  status
)
VALUES (
  'owen-anthony',
  'Owen Anthony',
  'Rhythm, tension, and release from the HALO production desk.',
  'Owen Anthony builds records for late rooms, open roads, and the exact second a crowd decides to move together. This page keeps the music, visuals, professional rooms, and next invitation under one permanent address.',
  'United Kingdom',
  '#d7ff5f',
  '/assets/artists/owen-anthony-quicksand.jpg',
  'Quicksand',
  '2026-07-03',
  'https://distrokid.com/hyperfollow/halomusic1/quicksand',
  '/#community',
  '/release-kit.html?audience=dj&slug=quicksand',
  '/release-kit.html?audience=radio&slug=quicksand',
  '/release-kit.html?audience=press&slug=quicksand',
  '/creators/',
  '/music/',
  'published'
)
ON CONFLICT (slug) DO NOTHING;
