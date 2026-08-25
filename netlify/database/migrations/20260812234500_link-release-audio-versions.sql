ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_stage TEXT NOT NULL DEFAULT 'released',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

ALTER TABLE halo_release_campaigns
  DROP CONSTRAINT IF EXISTS halo_release_campaigns_release_stage_check,
  ADD CONSTRAINT halo_release_campaigns_release_stage_check
    CHECK (release_stage IN ('demo', 'unreleased', 'scheduled', 'released', 'archived')),
  DROP CONSTRAINT IF EXISTS halo_release_campaigns_visibility_check,
  ADD CONSTRAINT halo_release_campaigns_visibility_check
    CHECK (visibility IN ('private', 'team', 'public'));

ALTER TABLE halo_artist_pages
  ADD COLUMN IF NOT EXISTS current_release_id TEXT REFERENCES halo_release_campaigns(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS halo_release_audio_versions (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  version_type TEXT NOT NULL DEFAULT 'radio_edit',
  version_label TEXT NOT NULL DEFAULT 'Radio edit',
  blob_key TEXT NOT NULL UNIQUE,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT NOT NULL DEFAULT '',
  artwork_key TEXT NOT NULL DEFAULT '',
  artwork_content_type TEXT NOT NULL DEFAULT '',
  rights_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (version_type IN ('master', 'radio_edit', 'clean', 'instrumental', 'extended', 'demo', 'other')),
  CHECK (char_length(version_label) BETWEEN 1 AND 80),
  CHECK (chunk_count BETWEEN 1 AND 64),
  CHECK (byte_size > 0 AND byte_size <= 134217728),
  CHECK (duration_seconds BETWEEN 0 AND 7200),
  CHECK (rights_confirmed = TRUE),
  CHECK (status IN ('active', 'archived'))
);

ALTER TABLE halo_radio_tracks
  ADD COLUMN IF NOT EXISTS release_id TEXT REFERENCES halo_release_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_version_id TEXT REFERENCES halo_release_audio_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_release_campaigns_artist_stage_idx
  ON halo_release_campaigns(artist_slug, release_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_release_audio_versions_release_idx
  ON halo_release_audio_versions(release_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_release_audio_versions_owner_idx
  ON halo_release_audio_versions(owner_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_tracks_release_status_idx
  ON halo_radio_tracks(release_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_radio_tracks_audio_version_idx
  ON halo_radio_tracks(audio_version_id, created_at DESC);

UPDATE halo_release_campaigns release
SET artist_slug = page.slug
FROM halo_artist_pages page
WHERE release.artist_slug IS NULL
  AND release.title = page.release_title
  AND release.artist = page.artist_name;

UPDATE halo_release_campaigns release
SET owner_member_id = page.owner_member_id
FROM halo_artist_pages page
WHERE release.owner_member_id IS NULL
  AND page.owner_member_id IS NOT NULL
  AND release.artist_slug = page.slug;

UPDATE halo_artist_pages page
SET current_release_id = release.id
FROM halo_release_campaigns release
WHERE page.current_release_id IS NULL
  AND release.title = page.release_title
  AND release.artist = page.artist_name;

UPDATE halo_radio_tracks track
SET release_id = page.current_release_id
FROM halo_artist_pages page
WHERE track.release_id IS NULL
  AND track.artist_slug = page.slug
  AND page.current_release_id IS NOT NULL;
