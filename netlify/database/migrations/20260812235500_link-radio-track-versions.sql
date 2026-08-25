ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS linked_track_id TEXT REFERENCES halo_radio_tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_relationship TEXT NOT NULL DEFAULT '';

ALTER TABLE halo_radio_tracks
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_version_relationship_check,
  ADD CONSTRAINT halo_radio_tracks_version_relationship_check
    CHECK (version_relationship IN ('', 'full_version', 'remix', 'chilled_version', 'club_version', 'alternate_version')),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_linked_track_not_self_check,
  ADD CONSTRAINT halo_radio_tracks_linked_track_not_self_check
    CHECK (linked_track_id IS NULL OR linked_track_id <> id);

CREATE INDEX IF NOT EXISTS halo_radio_tracks_linked_track_idx
  ON halo_radio_tracks(linked_track_id, created_at DESC);
