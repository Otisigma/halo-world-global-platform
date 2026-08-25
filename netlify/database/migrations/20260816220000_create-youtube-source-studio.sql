CREATE TABLE IF NOT EXISTS halo_youtube_sources (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'video',
  channel_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(label) BETWEEN 1 AND 160),
  CHECK (char_length(source_url) BETWEEN 12 AND 500),
  CHECK (source_type IN ('channel', 'playlist', 'short', 'video')),
  CHECK (char_length(channel_url) <= 500),
  CHECK (char_length(notes) <= 1200),
  UNIQUE (member_id, source_url)
);

CREATE TABLE IF NOT EXISTS halo_youtube_campaign_briefs (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  campaign_goal TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  channel_url TEXT NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NOT NULL DEFAULT 'fallback',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 2 AND 160),
  CHECK (char_length(campaign_goal) BETWEEN 2 AND 600),
  CHECK (char_length(audience) <= 300),
  CHECK (char_length(channel_url) BETWEEN 12 AND 500)
);

CREATE INDEX IF NOT EXISTS halo_youtube_sources_member_idx
  ON halo_youtube_sources(member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_youtube_campaign_briefs_member_idx
  ON halo_youtube_campaign_briefs(member_id, created_at DESC);
