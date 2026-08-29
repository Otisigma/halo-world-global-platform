-- Unified upload pipeline: adds pipeline_status and source_upload_surface to
-- halo_song_catalog so one upload becomes the single source of truth that every
-- department (artist room, radio, Dream Weaver, sales/publishing) works from.
-- All new columns default to safe/empty values for full backwards compatibility.

ALTER TABLE halo_song_catalog
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (pipeline_status IN (
      'uploaded', 'processing', 'needs_assets', 'dreamweaver_in_progress',
      'ready_for_radio', 'ready_for_sale', 'approved', 'published'
    )),
  ADD COLUMN IF NOT EXISTS source_upload_surface TEXT NOT NULL DEFAULT ''
    CHECK (source_upload_surface IN (
      '', 'artist_room', 'radio_room', 'song_catalog', 'dreamweaver_lab'
    ));

-- Backfill: songs that already have audio on at least one version and a dream
-- weaver review attached are promoted to 'dreamweaver_in_progress' so existing
-- catalogue items start at the correct stage.
UPDATE halo_song_catalog sc
SET pipeline_status = 'dreamweaver_in_progress'
WHERE pipeline_status = 'uploaded'
  AND EXISTS (
    SELECT 1 FROM halo_song_versions sv
    WHERE sv.song_id = sc.id AND sv.audio_url <> '' AND sv.status = 'active'
  )
  AND EXISTS (
    SELECT 1 FROM halo_dreamweaver_song_reviews dr
    WHERE dr.song_id = sc.id
  );

-- Backfill: songs linked to a published release campaign are already live.
-- Guard: only promote forward; never overwrite a song that was already past 'published'
-- (impossible by the CHECK constraint) or has been explicitly held at an earlier stage.
UPDATE halo_song_catalog sc
SET pipeline_status = 'published'
WHERE pipeline_status <> 'published'
  AND EXISTS (
    SELECT 1 FROM halo_release_campaigns rc
    WHERE rc.id = sc.source_release_id AND rc.status = 'published'
  );
