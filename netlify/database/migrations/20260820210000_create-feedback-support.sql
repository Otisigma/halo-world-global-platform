CREATE TABLE IF NOT EXISTS halo_support_requests (
  request_key TEXT PRIMARY KEY,
  submitter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'support')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 4 AND 120),
  details TEXT NOT NULL CHECK (char_length(details) BETWEEN 12 AND 4000),
  page_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed')),
  staff_note TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS halo_support_votes (
  request_key TEXT NOT NULL REFERENCES halo_support_requests(request_key) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_key, voter_id)
);

CREATE INDEX IF NOT EXISTS halo_support_requests_submitter_idx
  ON halo_support_requests(submitter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_support_requests_public_idx
  ON halo_support_requests(visibility, status, vote_count DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_support_votes_voter_idx
  ON halo_support_votes(voter_id, created_at DESC);
