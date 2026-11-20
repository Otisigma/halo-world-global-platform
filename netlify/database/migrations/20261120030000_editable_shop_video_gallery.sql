-- Editable Artist Shop video galleries.
-- Each video now records where it came from (manual upload/link vs a Dreamweaver song video),
-- which song and version it belongs to, and whether it may appear in the wider HALO feed
-- or only in the artist's own shop.
ALTER TABLE halo_videos ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE halo_videos ADD COLUMN IF NOT EXISTS song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL;
ALTER TABLE halo_videos ADD COLUMN IF NOT EXISTS song_version_id TEXT REFERENCES halo_song_versions(id) ON DELETE SET NULL;
-- Existing videos keep their current behaviour (eligible for the HALO feed).
ALTER TABLE halo_videos ADD COLUMN IF NOT EXISTS publish_scope TEXT NOT NULL DEFAULT 'halo_feed';
ALTER TABLE halo_videos DROP CONSTRAINT IF EXISTS halo_videos_origin_check;
ALTER TABLE halo_videos ADD CONSTRAINT halo_videos_origin_check CHECK (origin IN ('manual', 'dreamweaver'));
ALTER TABLE halo_videos DROP CONSTRAINT IF EXISTS halo_videos_publish_scope_check;
ALTER TABLE halo_videos ADD CONSTRAINT halo_videos_publish_scope_check CHECK (publish_scope IN ('shop_only', 'halo_feed'));
CREATE INDEX IF NOT EXISTS halo_videos_artist_origin_idx ON halo_videos (artist_slug, origin, status);
CREATE INDEX IF NOT EXISTS halo_videos_song_idx ON halo_videos (song_id);

-- One row per artist shop. With no row the shop behaves as 'dreamweaver_only',
-- which is empty until the artist has Dreamweaver song videos.
CREATE TABLE IF NOT EXISTS halo_shop_video_galleries (
  artist_slug TEXT PRIMARY KEY REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'dreamweaver_only',
  pinned_video_id UUID REFERENCES halo_videos(id) ON DELETE SET NULL,
  empty_title TEXT NOT NULL DEFAULT '',
  empty_note TEXT NOT NULL DEFAULT '',
  empty_cover_url TEXT NOT NULL DEFAULT '',
  empty_release_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mode IN ('empty', 'dreamweaver_only')),
  CHECK (char_length(empty_title) <= 120),
  CHECK (char_length(empty_note) <= 400),
  CHECK (char_length(empty_cover_url) <= 1000)
);

-- Placement of a video in one shop: manual additions, plus order/visibility overrides
-- for Dreamweaver videos that were attached automatically.
CREATE TABLE IF NOT EXISTS halo_shop_video_gallery_items (
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES halo_videos(id) ON DELETE CASCADE,
  added_manually BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artist_slug, video_id),
  CHECK (position BETWEEN 0 AND 10000)
);
CREATE INDEX IF NOT EXISTS halo_shop_video_gallery_items_order_idx ON halo_shop_video_gallery_items (artist_slug, position);
