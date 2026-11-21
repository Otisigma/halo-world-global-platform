-- Dynamic artist storefronts: each artist page carries its own role (shown on the Artist Shop
-- profile card next to the name and bio).
ALTER TABLE halo_artist_pages
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_pages_role_length') THEN
    ALTER TABLE halo_artist_pages ADD CONSTRAINT halo_artist_pages_role_length CHECK (char_length(role) <= 80);
  END IF;
END $$;

-- AI artist persona conversations (e.g. the Anna Jayne shop-front persona). One conversation per
-- fan per artist page; signed-in fans keep their history across visits so the persona can
-- remember them, anonymous visitors are keyed by a hashed browser id.
CREATE TABLE IF NOT EXISTS halo_artist_persona_conversations (
  id TEXT PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  persona_key TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  member_id TEXT,
  ip_hash TEXT NOT NULL DEFAULT '',
  fan_name TEXT NOT NULL DEFAULT '',
  fan_notes TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(fan_name) <= 80),
  CHECK (char_length(fan_notes) <= 1200)
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_artist_persona_conversations_visitor_idx
  ON halo_artist_persona_conversations(artist_slug, persona_key, visitor_key);

CREATE TABLE IF NOT EXISTS halo_artist_persona_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES halo_artist_persona_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('user', 'assistant')),
  CHECK (char_length(content) <= 4000)
);

CREATE INDEX IF NOT EXISTS halo_artist_persona_messages_conversation_idx
  ON halo_artist_persona_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_artist_persona_conversations_ip_idx
  ON halo_artist_persona_conversations(ip_hash, updated_at DESC);
