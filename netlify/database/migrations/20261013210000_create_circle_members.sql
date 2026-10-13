CREATE TABLE IF NOT EXISTS halo_circle_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  circle_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator',
  status TEXT NOT NULL DEFAULT 'pending',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(email) BETWEEN 3 AND 320),
  CHECK (email = lower(email)),
  CHECK (circle_name IN ('artist_core', 'creative_team', 'extended_world')),
  CHECK (role IN ('admin', 'collaborator', 'viewer')),
  CHECK (status IN ('pending', 'active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_circle_members_owner_email_idx
  ON halo_circle_members (owner_member_id, email);

CREATE INDEX IF NOT EXISTS halo_circle_members_owner_circle_idx
  ON halo_circle_members (owner_member_id, circle_name, invited_at);
