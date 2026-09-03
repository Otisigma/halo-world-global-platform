CREATE TABLE IF NOT EXISTS halo_album_concierge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 64),
  emotion TEXT NOT NULL DEFAULT '' CHECK (char_length(emotion) <= 256),
  sound_direction TEXT NOT NULL DEFAULT '' CHECK (char_length(sound_direction) <= 128),
  story_input TEXT NOT NULL DEFAULT '' CHECK (char_length(story_input) <= 4000),
  generated_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_theme TEXT NOT NULL DEFAULT '',
  generated_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_cover_prompt TEXT NOT NULL DEFAULT '',
  generated_dedication TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'private' CHECK (mode IN ('private', 'gift', 'public')),
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_album_concierge_member_created_idx
  ON halo_album_concierge_sessions(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_album_concierge_status_idx
  ON halo_album_concierge_sessions(status, updated_at DESC);
