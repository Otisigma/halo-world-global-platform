ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS source_filename TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS album_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS release_year INTEGER,
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS moods TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS energy SMALLINT,
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS explicit_content BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS analysis_model TEXT NOT NULL DEFAULT '';

ALTER TABLE halo_radio_tracks
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_release_year_check,
  ADD CONSTRAINT halo_radio_tracks_release_year_check CHECK (release_year IS NULL OR release_year BETWEEN 1900 AND 2200),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_energy_check,
  ADD CONSTRAINT halo_radio_tracks_energy_check CHECK (energy IS NULL OR energy BETWEEN 1 AND 10),
  DROP CONSTRAINT IF EXISTS halo_radio_tracks_analysis_status_check,
  ADD CONSTRAINT halo_radio_tracks_analysis_status_check CHECK (analysis_status IN ('not_requested', 'complete', 'fallback'));

CREATE INDEX IF NOT EXISTS halo_radio_tracks_intelligence_idx
  ON halo_radio_tracks(status, room, energy, created_at DESC);
