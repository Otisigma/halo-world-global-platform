CREATE TABLE IF NOT EXISTS halo_social_snippets (
  id UUID PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL DEFAULT 'topic',
  source_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  hook TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  asset_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_kind IN ('profile', 'release', 'activity', 'video', 'campaign', 'topic')),
  CHECK (char_length(source_id) <= 120),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (char_length(body) BETWEEN 1 AND 2400),
  CHECK (char_length(hook) <= 240),
  CHECK (char_length(topic) <= 100),
  CHECK (char_length(asset_url) <= 1200),
  CHECK (status IN ('draft', 'ready', 'retired')),
  CHECK (use_count >= 0)
);

CREATE TABLE IF NOT EXISTS halo_social_snippet_feedback (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snippet_id UUID NOT NULL REFERENCES halo_social_snippets(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  signal TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (signal IN ('saved', 'reused', 'worked', 'needs_change')),
  CHECK (char_length(note) <= 800)
);

CREATE INDEX IF NOT EXISTS halo_social_snippets_artist_idx
  ON halo_social_snippets(artist_slug, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_social_snippets_owner_idx
  ON halo_social_snippets(owner_member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_social_feedback_snippet_idx
  ON halo_social_snippet_feedback(snippet_id, created_at DESC);
