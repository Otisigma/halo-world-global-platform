CREATE TABLE IF NOT EXISTS halo_creator_charter_acknowledgments (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  charter_version TEXT NOT NULL,
  creator_role TEXT NOT NULL DEFAULT 'creator',
  accepts_tool_freedom BOOLEAN NOT NULL DEFAULT FALSE,
  accepts_rights_responsibility BOOLEAN NOT NULL DEFAULT FALSE,
  accepts_fair_review BOOLEAN NOT NULL DEFAULT FALSE,
  affirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(charter_version) BETWEEN 4 AND 24),
  CHECK (creator_role IN ('artist', 'producer', 'dj', 'writer', 'fan', 'industry', 'creator'))
);

CREATE TABLE IF NOT EXISTS halo_creator_charter_responses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (category IN ('question', 'experience', 'proposal', 'challenge')),
  CHECK (char_length(body) BETWEEN 12 AND 1000),
  CHECK (status IN ('published', 'reviewing', 'hidden'))
);

CREATE TABLE IF NOT EXISTS halo_creator_charter_votes (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  principle SMALLINT NOT NULL,
  position TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, principle),
  CHECK (principle BETWEEN 1 AND 7),
  CHECK (position IN ('support', 'needs_work', 'concern'))
);

CREATE INDEX IF NOT EXISTS halo_creator_charter_responses_created_idx
  ON halo_creator_charter_responses(created_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS halo_creator_charter_votes_principle_idx
  ON halo_creator_charter_votes(principle, position);
