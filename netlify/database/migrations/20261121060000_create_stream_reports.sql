-- Artist-uploaded stream reports: distributor statements (DistroKid, TuneCore, CD Baby…) and
-- Spotify for Artists / Apple Music for Artists exports. Numbers come only from the uploaded file
-- and are kept separate from HALO's own play counts and consented listener reports.
CREATE TABLE IF NOT EXISTS halo_stream_reports (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_sha256 TEXT NOT NULL,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  total_streams BIGINT NOT NULL DEFAULT 0,
  total_downloads BIGINT NOT NULL DEFAULT 0,
  total_earnings NUMERIC(18, 6),
  currency TEXT NOT NULL DEFAULT '',
  period_start DATE,
  period_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source IN ('distrokid', 'tunecore', 'cdbaby', 'amuse', 'ditto', 'other_distributor',
    'spotify_for_artists', 'apple_music_for_artists')),
  CHECK (char_length(file_name) <= 200),
  CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (total_streams >= 0 AND total_downloads >= 0)
);

-- The same file can't be imported twice by the same artist, so totals are never double counted.
CREATE UNIQUE INDEX IF NOT EXISTS halo_stream_reports_member_file_idx
  ON halo_stream_reports(member_id, file_sha256);
CREATE INDEX IF NOT EXISTS halo_stream_reports_member_created_idx
  ON halo_stream_reports(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS halo_stream_report_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES halo_stream_reports(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  store_name TEXT NOT NULL DEFAULT '',
  isrc TEXT NOT NULL DEFAULT '',
  track_title TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  period_month DATE,
  streams BIGINT NOT NULL DEFAULT 0,
  downloads BIGINT NOT NULL DEFAULT 0,
  earnings NUMERIC(18, 6) NOT NULL DEFAULT 0,
  song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL,
  CHECK (platform IN ('spotify', 'apple_music', 'youtube', 'amazon_music', 'tidal', 'deezer', 'tiktok',
    'meta', 'pandora', 'soundcloud', 'other')),
  CHECK (streams >= 0 AND downloads >= 0),
  CHECK (char_length(track_title) <= 200 AND char_length(artist_name) <= 200 AND char_length(store_name) <= 120)
);

CREATE INDEX IF NOT EXISTS halo_stream_report_lines_report_idx ON halo_stream_report_lines(report_id);
CREATE INDEX IF NOT EXISTS halo_stream_report_lines_member_idx
  ON halo_stream_report_lines(member_id, platform, period_month);
CREATE INDEX IF NOT EXISTS halo_stream_report_lines_song_idx
  ON halo_stream_report_lines(song_id) WHERE song_id IS NOT NULL;
