-- Artist Shop hero header images, one row per artist page (so each persona/artist room
-- keeps its own header). With no row the shop shows the active theme backdrop.
CREATE TABLE IF NOT EXISTS halo_shop_headers (
  artist_slug TEXT PRIMARY KEY REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'theme',
  image_url TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  focal TEXT NOT NULL DEFAULT 'center',
  scrim REAL NOT NULL DEFAULT 0.62,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_type IN ('theme', 'upload', 'url', 'album_cover')),
  CHECK (focal IN ('top', 'center', 'bottom', 'left', 'right')),
  CHECK (scrim >= 0.1 AND scrim <= 0.92),
  CHECK (char_length(image_url) <= 1000),
  CHECK (char_length(label) <= 160)
);
