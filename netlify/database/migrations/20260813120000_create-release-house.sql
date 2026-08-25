CREATE TABLE IF NOT EXISTS halo_release_house_projects (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  artist_name TEXT NOT NULL DEFAULT '',
  track_title TEXT NOT NULL DEFAULT '',
  target_release_date DATE,
  current_room SMALLINT NOT NULL DEFAULT 1,
  completed_rooms SMALLINT[] NOT NULL DEFAULT '{}',
  room_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CHECK (char_length(project_name) BETWEEN 1 AND 120),
  CHECK (char_length(artist_name) <= 120),
  CHECK (char_length(track_title) <= 160),
  CHECK (current_room BETWEEN 1 AND 13),
  CHECK (completed_rooms <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13]::SMALLINT[]),
  CHECK (status IN ('active', 'released', 'archived'))
);

CREATE INDEX IF NOT EXISTS halo_release_house_owner_updated_idx
  ON halo_release_house_projects(owner_member_id, updated_at DESC);

