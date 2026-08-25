CREATE TABLE IF NOT EXISTS halo_radio_shows (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  host_name TEXT NOT NULL DEFAULT '',
  producer_name TEXT NOT NULL DEFAULT '',
  show_type TEXT NOT NULL DEFAULT 'music',
  day_of_week SMALLINT NOT NULL,
  start_time_utc TIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL,
  artwork_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (char_length(id) BETWEEN 2 AND 96),
  CHECK (room IN ('club', 'chill', 'lounge')),
  CHECK (char_length(title) BETWEEN 1 AND 140),
  CHECK (char_length(description) <= 1200),
  CHECK (char_length(host_name) <= 120),
  CHECK (char_length(producer_name) <= 120),
  CHECK (show_type IN ('music', 'discovery', 'interview', 'dj', 'magazine', 'community', 'special')),
  CHECK (day_of_week BETWEEN 0 AND 6),
  CHECK (duration_minutes BETWEEN 15 AND 480),
  CHECK (status IN ('draft', 'published', 'paused'))
);

CREATE TABLE IF NOT EXISTS halo_radio_show_subscriptions (
  show_id TEXT NOT NULL REFERENCES halo_radio_shows(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (show_id, member_id)
);

CREATE TABLE IF NOT EXISTS halo_artist_follows (
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  notify_radio BOOLEAN NOT NULL DEFAULT TRUE,
  notify_releases BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artist_slug, member_id)
);

CREATE TABLE IF NOT EXISTS halo_radio_play_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room TEXT NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL,
  release_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'station-desk',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (room IN ('club', 'chill', 'lounge')),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (char_length(artist_name) BETWEEN 1 AND 140),
  CHECK (source IN ('station-desk', 'live', 'autodj', 'replay')),
  CHECK (duration_seconds BETWEEN 0 AND 14400)
);

CREATE TABLE IF NOT EXISTS halo_artist_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published',
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind IN ('radio', 'magazine', 'release', 'event', 'replay', 'community')),
  CHECK (char_length(title) BETWEEN 1 AND 180),
  CHECK (char_length(description) <= 1200),
  CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS halo_radio_shows_public_schedule_idx
  ON halo_radio_shows(status, day_of_week, start_time_utc);
CREATE INDEX IF NOT EXISTS halo_radio_shows_artist_idx
  ON halo_radio_shows(artist_slug, status);
CREATE INDEX IF NOT EXISTS halo_artist_follows_artist_idx
  ON halo_artist_follows(artist_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_play_history_artist_idx
  ON halo_radio_play_history(artist_slug, started_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_play_history_room_idx
  ON halo_radio_play_history(room, started_at DESC);
CREATE INDEX IF NOT EXISTS halo_artist_activity_public_idx
  ON halo_artist_activity(artist_slug, status, starts_at DESC, created_at DESC);

INSERT INTO halo_radio_shows (
  id, room, title, description, host_name, producer_name, show_type,
  day_of_week, start_time_utc, duration_minutes, status
)
VALUES
  ('new-music-meeting', 'club', 'New Music Meeting', 'The HALO radio team reviews creator submissions and introduces the records entering the weekly conversation.', 'HALO Radio Team', 'Music Desk', 'discovery', 1, '18:00', 60, 'published'),
  ('halo-discovery', 'club', 'HALO Discovery', 'Emerging artists, community signals, and the stories behind the tracks moving toward rotation.', 'HALO Radio Team', 'Discovery Desk', 'discovery', 2, '20:00', 90, 'published'),
  ('artist-room-live', 'lounge', 'Artist Room Live', 'A focused artist conversation combining music, fan questions, release context, and the next place to connect.', 'HALO Radio Team', 'Artist Desk', 'interview', 3, '20:00', 60, 'published'),
  ('selector-session', 'club', 'Selector Session', 'Guest DJs and selectors connect approved releases to the dancefloor and explain the choices inside the set.', 'Guest Selector', 'DJ Desk', 'dj', 4, '21:00', 120, 'published'),
  ('halo-club-live', 'club', 'HALO Club Live', 'The flagship live frequency for premieres, hosts, community moments, and the strongest records of the week.', 'HALO Radio Team', 'Live Desk', 'music', 5, '21:00', 180, 'published'),
  ('magazine-sessions', 'lounge', 'Magazine Sessions', 'Long-form conversations, performances, and cultural stories prepared for radio, replay, and editorial coverage.', 'HALO Magazine', 'Editorial Desk', 'magazine', 6, '19:00', 90, 'published'),
  ('lounge-and-review', 'lounge', 'Lounge and Review', 'A slower close to the week with listener messages, recent highlights, and a preview of the next schedule.', 'HALO Radio Team', 'Community Desk', 'community', 0, '18:00', 90, 'published')
ON CONFLICT (id) DO NOTHING;
