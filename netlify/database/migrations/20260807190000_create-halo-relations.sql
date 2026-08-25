CREATE TABLE IF NOT EXISTS halo_relationship_profiles (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  relationship_stage TEXT NOT NULL DEFAULT 'new',
  contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_channel TEXT NOT NULL DEFAULT 'none',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  relationship_summary TEXT NOT NULL DEFAULT '',
  updated_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (relationship_stage IN ('new', 'welcomed', 'engaged', 'collaborator', 'partner', 'vip', 'paused')),
  CHECK (preferred_channel IN ('none', 'email', 'community')),
  CHECK (char_length(relationship_summary) <= 500),
  CHECK (cardinality(tags) <= 12)
);

CREATE TABLE IF NOT EXISTS halo_relationship_auth_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  session_key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('signup', 'login', 'session', 'recovery')),
  CHECK (char_length(session_key) BETWEEN 8 AND 80),
  UNIQUE (member_id, event_type, session_key)
);

CREATE TABLE IF NOT EXISTS halo_relationship_notes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  author_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(body) BETWEEN 2 AND 1200)
);

CREATE TABLE IF NOT EXISTS halo_relationship_tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  assigned_to_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (char_length(title) BETWEEN 2 AND 180),
  CHECK (status IN ('open', 'done'))
);

CREATE TABLE IF NOT EXISTS halo_relationship_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  assistant_role TEXT NOT NULL,
  intent TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (assistant_role IN ('welcome', 'relationship', 'community', 'creator', 'support')),
  CHECK (char_length(intent) BETWEEN 2 AND 300),
  CHECK (char_length(content) BETWEEN 2 AND 2000),
  CHECK (status IN ('draft', 'approved', 'discarded'))
);

CREATE INDEX IF NOT EXISTS halo_relationship_profiles_stage_idx
  ON halo_relationship_profiles(relationship_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_relationship_auth_member_idx
  ON halo_relationship_auth_events(member_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS halo_relationship_auth_time_idx
  ON halo_relationship_auth_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS halo_relationship_notes_member_idx
  ON halo_relationship_notes(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_relationship_tasks_due_idx
  ON halo_relationship_tasks(status, due_at);
CREATE INDEX IF NOT EXISTS halo_relationship_drafts_member_idx
  ON halo_relationship_drafts(member_id, created_at DESC);

INSERT INTO halo_relationship_profiles (member_id)
SELECT member_id FROM halo_memberships
ON CONFLICT (member_id) DO NOTHING;
