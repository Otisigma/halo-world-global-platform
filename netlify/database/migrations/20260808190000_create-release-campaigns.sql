CREATE TABLE IF NOT EXISTS halo_release_campaigns (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  release_date DATE,
  duration TEXT NOT NULL DEFAULT '',
  genres TEXT[] NOT NULL DEFAULT '{}',
  artwork_url TEXT NOT NULL DEFAULT '',
  official_url TEXT NOT NULL DEFAULT '',
  dj_url TEXT NOT NULL DEFAULT '',
  radio_url TEXT NOT NULL DEFAULT '',
  press_url TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  preview_expires_at TIMESTAMPTZ,
  preview_access_code_hash TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  musical_key TEXT NOT NULL DEFAULT '',
  isrc TEXT NOT NULL DEFAULT '',
  content_rating TEXT NOT NULL DEFAULT 'unspecified',
  pitch TEXT NOT NULL DEFAULT '',
  press_description TEXT NOT NULL DEFAULT '',
  credits TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  available_versions TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (char_length(id) BETWEEN 2 AND 96),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (char_length(artist) BETWEEN 1 AND 120),
  CHECK (bpm IS NULL OR bpm BETWEEN 20 AND 300),
  CHECK (content_rating IN ('unspecified', 'clean', 'explicit')),
  CHECK (char_length(preview_access_code_hash) <= 64),
  CHECK (status IN ('draft', 'published'))
);

CREATE TABLE IF NOT EXISTS halo_release_campaign_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (audience IN ('fan', 'dj', 'radio', 'press', 'preview')),
  CHECK (event_type IN ('kit_open', 'outbound_click')),
  CHECK (char_length(target) <= 32)
);

CREATE INDEX IF NOT EXISTS halo_release_campaigns_status_date_idx
  ON halo_release_campaigns(status, release_date DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_release_campaign_events_release_idx
  ON halo_release_campaign_events(release_id, created_at DESC);

INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  release_date,
  duration,
  genres,
  artwork_url,
  official_url,
  pitch,
  press_description,
  available_versions,
  status
)
VALUES (
  'the-cold-is-lasting-longer',
  'The Cold Is Lasting Longer',
  'Owen Anthony',
  '2026-08-10',
  '5:10',
  ARRAY['Electronic', 'Afrobeat'],
  '/assets/releases/the-cold-is-lasting-longer.jpg',
  'https://distrokid.com/hyperfollow/owenanthony/the-cold-is-lasting-longer?ref=release-pack',
  'A slow-building electronic and Afrobeat signal designed for late-night radio, warm-up rooms, and emotionally paced DJ sets.',
  'A patient, late-night release built for selectors who value atmosphere, emotional pacing, and a gradual rise in energy.',
  ARRAY['Broadcast-ready master', 'Radio or clean edit request', 'DJ intro or extended edit request', 'Cover artwork and release details'],
  'published'
)
ON CONFLICT (id) DO NOTHING;
