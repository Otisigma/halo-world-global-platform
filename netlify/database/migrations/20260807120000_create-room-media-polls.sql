CREATE TABLE IF NOT EXISTS community_room_posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 2 AND 100),
  CHECK (char_length(description) <= 500),
  CHECK (char_length(video_url) <= 500)
);

CREATE TABLE IF NOT EXISTS community_room_poll_options (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_room_posts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position SMALLINT NOT NULL,
  UNIQUE (post_id, position),
  UNIQUE (post_id, id),
  CHECK (char_length(label) BETWEEN 1 AND 80),
  CHECK (position BETWEEN 1 AND 6)
);

CREATE TABLE IF NOT EXISTS community_room_votes (
  post_id BIGINT NOT NULL REFERENCES community_room_posts(id) ON DELETE CASCADE,
  option_id BIGINT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, actor_id),
  FOREIGN KEY (post_id, option_id) REFERENCES community_room_poll_options(post_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS community_room_posts_created_idx ON community_room_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS community_room_votes_option_idx ON community_room_votes(option_id);
