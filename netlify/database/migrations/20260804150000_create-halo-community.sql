CREATE TABLE IF NOT EXISTS community_profiles (
  actor_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🌙',
  region TEXT NOT NULL DEFAULT 'Global',
  favorite_genres TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  vibe_status TEXT NOT NULL DEFAULT 'Finding the frequency',
  badge TEXT NOT NULL DEFAULT 'New Light',
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_follows (
  follower_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  followed_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS community_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  reply_to BIGINT REFERENCES community_messages(id) ON DELETE SET NULL,
  is_spotlighted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(body) BETWEEN 1 AND 320)
);

CREATE TABLE IF NOT EXISTS community_reactions (
  message_id BIGINT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, actor_id, emoji),
  CHECK (emoji IN ('✨', '💜', '🔥', '🌊'))
);

CREATE TABLE IF NOT EXISTS community_support (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  gift TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (actor_id <> recipient_id),
  CHECK (kind IN ('boost', 'gift', 'light')),
  CHECK (gift IS NULL OR gift IN ('comet', 'butterfly', 'vinyl', 'rose', 'sunrise', 'crowd-wave'))
);

CREATE TABLE IF NOT EXISTS community_relationship_controls (
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, target_id, kind),
  CHECK (actor_id <> target_id),
  CHECK (kind IN ('block', 'mute'))
);

CREATE TABLE IF NOT EXISTS community_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  target_id TEXT REFERENCES community_profiles(actor_id) ON DELETE SET NULL,
  message_id BIGINT REFERENCES community_messages(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(reason) BETWEEN 3 AND 240),
  CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS community_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES community_profiles(actor_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind IN ('follow', 'boost', 'gift', 'light', 'mention', 'party'))
);

CREATE INDEX IF NOT EXISTS community_profiles_last_seen_idx ON community_profiles(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS community_messages_created_idx ON community_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS community_support_created_idx ON community_support(created_at DESC);
CREATE INDEX IF NOT EXISTS community_support_recipient_idx ON community_support(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_reports_status_idx ON community_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS community_notifications_recipient_idx ON community_notifications(recipient_id, is_read, created_at DESC);

INSERT INTO community_profiles (actor_id, display_name, avatar, region, favorite_genres, vibe_status, badge, is_host)
VALUES
  ('halo-host', 'DJ HALO', '☀️', 'Ibiza · Global', ARRAY['Progressive', 'Melodic'], 'Building the sunrise', 'Room Host', TRUE),
  ('sasha-london', 'Sasha London', '🪩', 'London', ARRAY['House', 'Disco'], 'Terrace energy only', 'First Wave', FALSE),
  ('kaelen-ibiza', 'Kaelen Ibiza', '🌅', 'Ibiza', ARRAY['Progressive', 'Balearic'], 'Chasing the next sunrise', 'Vibe Guide', FALSE),
  ('berlin-mindset', 'Berlin Mindset', '🦋', 'Berlin', ARRAY['Melodic Techno', 'Ambient'], 'Deep in the low end', 'Signal Keeper', FALSE)
ON CONFLICT (actor_id) DO NOTHING;

INSERT INTO community_messages (actor_id, body)
SELECT seed.actor_id, seed.body
FROM (VALUES
  ('halo-host', 'Welcome to the clubhouse. Pass your light to someone who makes this room better.'),
  ('sasha-london', 'That opening synth feels like the whole city exhaling ✨'),
  ('kaelen-ibiza', 'New here? Say your city — we are building tonight’s constellation together.')
) AS seed(actor_id, body)
WHERE NOT EXISTS (SELECT 1 FROM community_messages LIMIT 1);
