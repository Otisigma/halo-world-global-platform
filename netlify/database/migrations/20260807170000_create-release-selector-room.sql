CREATE TABLE IF NOT EXISTS halo_release_selector_responses (
  release_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  selector_type TEXT NOT NULL,
  outlet_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'interested',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (release_id, member_id),
  CHECK (char_length(release_id) BETWEEN 2 AND 100),
  CHECK (selector_type IN ('dj', 'radio')),
  CHECK (char_length(outlet_name) <= 100),
  CHECK (status IN ('interested', 'downloaded', 'played', 'declined')),
  CHECK (char_length(notes) <= 320)
);

CREATE INDEX IF NOT EXISTS halo_release_selector_status_idx
  ON halo_release_selector_responses(release_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_release_selector_type_idx
  ON halo_release_selector_responses(release_id, selector_type, updated_at DESC);
