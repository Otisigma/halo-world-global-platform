-- Public publication is deliberate; no private catalog assets are copied here.
CREATE TABLE IF NOT EXISTS halo_signal_feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  author_name TEXT NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'AUDIO', 'VIDEO', 'BRIEF_LINK')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  release_id TEXT REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  link_url TEXT NOT NULL DEFAULT '' CHECK (char_length(link_url) <= 1200),
  include_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'AUDIO' AND release_id IS NOT NULL AND link_url = '')
    OR (kind IN ('VIDEO', 'BRIEF_LINK') AND link_url <> '' AND release_id IS NULL)
    OR (kind = 'TEXT' AND link_url = '' AND release_id IS NULL)),
  CHECK (NOT include_purchase OR kind = 'AUDIO')
);
CREATE INDEX IF NOT EXISTS halo_signal_feed_posts_chronology_idx
  ON halo_signal_feed_posts (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS halo_signal_feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES halo_signal_feed_posts(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  author_name TEXT NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
  parent_id UUID,
  timestamp_seconds INTEGER CHECK (timestamp_seconds BETWEEN 0 AND 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, id),
  FOREIGN KEY (post_id, parent_id) REFERENCES halo_signal_feed_comments(post_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS halo_signal_feed_comments_chronology_idx
  ON halo_signal_feed_comments (post_id, created_at, id);
-- Enforce one-level replies even for writes outside the API.
CREATE OR REPLACE FUNCTION halo_signal_feed_reply_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM halo_signal_feed_comments
    WHERE id = NEW.parent_id AND post_id = NEW.post_id AND parent_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Signal replies must reference a root comment on this post';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS halo_signal_feed_reply_guard ON halo_signal_feed_comments;
CREATE TRIGGER halo_signal_feed_reply_guard BEFORE INSERT OR UPDATE ON halo_signal_feed_comments
  FOR EACH ROW EXECUTE FUNCTION halo_signal_feed_reply_guard();

CREATE TABLE IF NOT EXISTS halo_signal_feed_reactions (
  post_id UUID NOT NULL REFERENCES halo_signal_feed_posts(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('boost', 'save')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, member_id, kind)
);
CREATE INDEX IF NOT EXISTS halo_signal_feed_reactions_member_idx
  ON halo_signal_feed_reactions (member_id, kind, post_id);

CREATE TABLE IF NOT EXISTS halo_signal_feed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  actor_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  post_id UUID NOT NULL REFERENCES halo_signal_feed_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES halo_signal_feed_comments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'boost')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (recipient_member_id <> actor_member_id)
);
CREATE INDEX IF NOT EXISTS halo_signal_feed_notifications_recipient_idx
  ON halo_signal_feed_notifications (recipient_member_id, created_at DESC, id DESC);

-- One bounded counter row per member/action; upsert serializes concurrent requests.
CREATE TABLE IF NOT EXISTS halo_signal_feed_rate_limits (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (bucket IN ('write', 'publish')),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  PRIMARY KEY (member_id, bucket)
);
