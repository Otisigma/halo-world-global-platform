-- Add pipeline stage tracking to the song catalog master record.
-- Each song has a single pipeline_stage that all departments share.
ALTER TABLE halo_song_catalog
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE halo_song_catalog
  ADD CONSTRAINT halo_song_catalog_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'uploaded',
    'processing',
    'needs_assets',
    'dreamweaver_in_progress',
    'ready_for_radio',
    'ready_for_sale',
    'approved',
    'published'
  ));

CREATE INDEX IF NOT EXISTS halo_song_catalog_pipeline_stage_idx
  ON halo_song_catalog(pipeline_stage, updated_at DESC);

-- Link radio tracks back to their master song catalog entry so the radio
-- room and song catalog stay in sync from the same source item.
ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS master_song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_radio_tracks_master_song_idx
  ON halo_radio_tracks(master_song_id);
