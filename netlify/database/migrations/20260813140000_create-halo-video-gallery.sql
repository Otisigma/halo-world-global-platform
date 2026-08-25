CREATE TABLE IF NOT EXISTS halo_videos (
  id UUID PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  youtube_id TEXT NOT NULL DEFAULT '',
  blob_key TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  gallery_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sofa_visible BOOLEAN NOT NULL DEFAULT TRUE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (char_length(description) <= 1000),
  CHECK (source_type IN ('youtube', 'upload')),
  CHECK (status IN ('draft', 'published', 'archived')),
  CHECK (
    (source_type = 'youtube' AND youtube_id <> '' AND blob_key = '') OR
    (source_type = 'upload' AND blob_key <> '' AND youtube_id = '')
  )
);

CREATE INDEX IF NOT EXISTS halo_videos_gallery_idx
  ON halo_videos(status, gallery_visible, featured DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_videos_sofa_idx
  ON halo_videos(status, sofa_visible, featured DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_videos_artist_idx
  ON halo_videos(artist_slug, status, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_videos_owner_idx
  ON halo_videos(owner_member_id, created_at DESC);

INSERT INTO halo_videos (
  id,
  owner_member_id,
  artist_slug,
  title,
  description,
  source_type,
  source_url,
  youtube_id,
  thumbnail_url,
  gallery_visible,
  sofa_visible,
  featured
)
SELECT
  '2f70d6b5-4f83-4f13-bd58-a9807fce3d92',
  page.owner_member_id,
  NULL,
  'Ghost To Me (DJ Halo X Remix)',
  'A permanent HALO TV selection connected to the video gallery and sofa queue.',
  'youtube',
  'https://www.youtube.com/watch?v=yh7qQGvzmdw',
  'yh7qQGvzmdw',
  'https://i.ytimg.com/vi/yh7qQGvzmdw/hqdefault.jpg',
  TRUE,
  TRUE,
  TRUE
FROM halo_artist_pages page
WHERE page.owner_member_id IS NOT NULL
ORDER BY page.updated_at DESC
LIMIT 1
ON CONFLICT (id) DO NOTHING;
