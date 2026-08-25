CREATE TABLE IF NOT EXISTS sovereign_ambassador_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL UNIQUE REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  contributions TEXT NOT NULL,
  focus_area TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',
  review_notes TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(statement) BETWEEN 80 AND 1200),
  CHECK (char_length(contributions) BETWEEN 80 AND 1200),
  CHECK (focus_area IN ('creator-support', 'community-care', 'events', 'technology', 'education', 'global-outreach')),
  CHECK (status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn'))
);

CREATE TABLE IF NOT EXISTS sovereign_ambassador_nominations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nominee_actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  nominator_actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nominee_actor_id, nominator_actor_id),
  CHECK (nominee_actor_id <> nominator_actor_id),
  CHECK (char_length(reason) BETWEEN 40 AND 600),
  CHECK (status IN ('submitted', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS sovereign_ambassador_grants (
  actor_id TEXT PRIMARY KEY REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  application_id BIGINT REFERENCES sovereign_ambassador_applications(id) ON DELETE SET NULL,
  granted_by TEXT NOT NULL,
  grant_notes TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revocation_notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sovereign_ambassador_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  performed_by TEXT NOT NULL,
  event_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('applied', 'resubmitted', 'withdrawn', 'nominated', 'nomination_dismissed', 'review_started', 'approved', 'declined', 'revoked', 'restored'))
);

CREATE INDEX IF NOT EXISTS sovereign_ambassador_applications_status_idx
  ON sovereign_ambassador_applications(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS sovereign_ambassador_nominations_nominee_idx
  ON sovereign_ambassador_nominations(nominee_actor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sovereign_ambassador_grants_active_idx
  ON sovereign_ambassador_grants(is_active, granted_at DESC);
CREATE INDEX IF NOT EXISTS sovereign_ambassador_events_actor_idx
  ON sovereign_ambassador_events(actor_id, created_at DESC);

ALTER TABLE community_notifications DROP CONSTRAINT IF EXISTS community_notifications_kind_check;
ALTER TABLE community_notifications
  ADD CONSTRAINT community_notifications_kind_check
  CHECK (kind IN ('follow', 'boost', 'gift', 'light', 'mention', 'party', 'ambassador'));
