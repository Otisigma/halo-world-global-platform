-- Release House submissions are review requests. A row records the artist's chosen
-- pathway, a rights-control attestation version, and an optional user-supplied smart
-- link reference. It never grants HALO rights, never publishes, and never bypasses the
-- existing upload, rights-clearance, mastering or approval gates.
-- terms_version stays NULL until counsel-approved submission terms exist.
CREATE TABLE IF NOT EXISTS halo_release_house_submissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES halo_release_house_projects(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  pathway TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  track_title TEXT NOT NULL,
  smart_link_url TEXT NOT NULL DEFAULT '',
  rights_attestation_version TEXT NOT NULL,
  rights_attested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terms_version TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CHECK (pathway IN ('halo_catalog_review', 'independent_discovery')),
  CHECK (char_length(artist_name) BETWEEN 1 AND 120),
  CHECK (char_length(track_title) BETWEEN 1 AND 160),
  CHECK (char_length(smart_link_url) <= 500 AND (smart_link_url = '' OR smart_link_url LIKE 'https://%')),
  CHECK (char_length(rights_attestation_version) BETWEEN 1 AND 64),
  CHECK (status IN ('pending_review', 'withdrawn'))
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_release_house_submissions_pending_idx
  ON halo_release_house_submissions(project_id)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS halo_release_house_submissions_owner_idx
  ON halo_release_house_submissions(owner_member_id, created_at DESC);
