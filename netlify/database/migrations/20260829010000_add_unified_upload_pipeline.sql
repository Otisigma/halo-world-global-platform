-- Extend the unified upload pipeline.
-- main already added pipeline_status and source_upload_surface via
-- 20260829000000_unified_upload_pipeline.sql. This migration adds the
-- pipeline_updated_at timestamp (so departments can see when a stage changed)
-- and the master_song_id FK on halo_radio_tracks so radio submissions are
-- provably tied to their master catalog entry.

ALTER TABLE halo_song_catalog
  ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS halo_song_catalog_pipeline_stage_idx
  ON halo_song_catalog(pipeline_status, updated_at DESC);

-- Link radio tracks back to their master song catalog entry so the radio
-- room and song catalog stay in sync from the same source item.
ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS master_song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_radio_tracks_master_song_idx
  ON halo_radio_tracks(master_song_id);
