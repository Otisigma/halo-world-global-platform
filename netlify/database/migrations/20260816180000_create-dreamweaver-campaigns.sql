CREATE TABLE IF NOT EXISTS halo_dreamweaver_campaigns (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  clip_start_seconds INTEGER NOT NULL DEFAULT 0,
  clip_duration_seconds INTEGER NOT NULL DEFAULT 30,
  template TEXT NOT NULL DEFAULT 'hook',
  goal TEXT NOT NULL DEFAULT 'full_mix_starts',
  destination_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  package JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '{}'::jsonb,
  performance_score INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'fallback',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reviewed_at TIMESTAMPTZ,
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 2 AND 160),
  CHECK (char_length(artist_name) BETWEEN 2 AND 160),
  CHECK (clip_start_seconds BETWEEN 0 AND 43200),
  CHECK (clip_duration_seconds IN (15, 30, 45)),
  CHECK (template IN ('hook', 'story', 'invitation')),
  CHECK (goal IN ('awareness', 'full_mix_starts', 'release_visits', 'community_growth')),
  CHECK (status IN ('ready', 'active', 'archived')),
  CHECK (char_length(destination_url) BETWEEN 2 AND 500),
  CHECK (performance_score BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS halo_dreamweaver_campaign_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES halo_dreamweaver_campaigns(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'halo',
  variant TEXT NOT NULL DEFAULT 'primary',
  session_key TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_kind IN ('generated', 'copied', 'downloaded', 'rendered', 'publish_ready', 'landing', 'show_play', 'mix_25', 'mix_50', 'mix_75', 'mix_complete')),
  CHECK (platform IN ('halo', 'tiktok', 'instagram', 'youtube')),
  CHECK (char_length(variant) BETWEEN 1 AND 40),
  CHECK (char_length(session_key) <= 128)
);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_campaign_member_idx
  ON halo_dreamweaver_campaigns(member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_campaign_mix_idx
  ON halo_dreamweaver_campaigns(mix_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_campaign_event_idx
  ON halo_dreamweaver_campaign_events(campaign_id, event_kind, created_at DESC);
