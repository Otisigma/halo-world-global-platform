ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS reviewed_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS spotlight_month DATE;

ALTER TABLE halo_radio_tracks
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_review_note_check,
  ADD CONSTRAINT halo_radio_tracks_review_note_check CHECK (char_length(review_note) <= 500),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_spotlight_month_check,
  ADD CONSTRAINT halo_radio_tracks_spotlight_month_check CHECK (
    spotlight_month IS NULL OR EXTRACT(DAY FROM spotlight_month) = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS halo_radio_tracks_spotlight_month_idx
  ON halo_radio_tracks(spotlight_month)
  WHERE spotlight_month IS NOT NULL;

CREATE INDEX IF NOT EXISTS halo_radio_tracks_review_queue_idx
  ON halo_radio_tracks(status, spotlight_month DESC, created_at DESC);
