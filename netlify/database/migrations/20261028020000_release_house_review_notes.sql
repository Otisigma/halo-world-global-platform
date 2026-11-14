-- Internal review notes only: no approval, publication, licensing or release-state changes.
-- Apply after 20261028010000_release_house_submissions.sql.
CREATE TABLE IF NOT EXISTS halo_release_house_review_notes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES halo_release_house_submissions(id),
  reviewer_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  action TEXT NOT NULL CHECK (action IN ('note', 'follow_up_needed')),
  note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_release_house_review_notes_submission_idx
  ON halo_release_house_review_notes(submission_id, created_at DESC);
