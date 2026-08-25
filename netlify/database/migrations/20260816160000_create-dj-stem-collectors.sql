CREATE TABLE IF NOT EXISTS halo_dj_stem_collector_kits (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  transition_goal TEXT NOT NULL,
  room_texture TEXT NOT NULL DEFAULT 'none',
  outgoing_track JSONB NOT NULL DEFAULT '{}'::jsonb,
  incoming_track JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_pack_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 2 AND 160),
  CHECK (transition_goal IN ('vocal-handoff', 'beat-carry', 'room-bridge', 'bass-swap', 'breakdown-rescue')),
  CHECK (room_texture IN ('none', 'crowd-air', 'hallway', 'vinyl-dust', 'rain-glass', 'warehouse-tail')),
  CHECK (quality_score BETWEEN 0 AND 100),
  CHECK (status IN ('ready', 'archived'))
);

CREATE INDEX IF NOT EXISTS halo_dj_stem_collector_member_idx
  ON halo_dj_stem_collector_kits(member_id, status, updated_at DESC);
