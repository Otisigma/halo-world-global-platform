CREATE TABLE IF NOT EXISTS halo_radio_long_plays (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_id TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL UNIQUE,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  rotation_position INTEGER NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 2 AND 180),
  CHECK (char_length(artist_name) BETWEEN 2 AND 100),
  CHECK (char_length(description) <= 320),
  CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  CHECK (video_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'),
  CHECK (rotation_position > 0)
);

CREATE INDEX IF NOT EXISTS halo_radio_long_plays_active_rotation_idx
  ON halo_radio_long_plays(active, rotation_position);

INSERT INTO halo_radio_long_plays (
  id,
  title,
  artist_name,
  description,
  video_id,
  video_url,
  thumbnail_url,
  rotation_position
) VALUES
  (
    'midnight-frequency-60-minute-mix',
    'Midnight Frequency (60-Min Continuous Mix)',
    'Halo Music',
    'A continuous deep house, melodic techno, and progressive Long Play session.',
    'IbwPoo-b1bs',
    'https://www.youtube.com/watch?v=IbwPoo-b1bs',
    'https://i.ytimg.com/vi/IbwPoo-b1bs/hqdefault.jpg',
    10
  ),
  (
    'dj-butterfly-halo-music-mix',
    'DJ Butterfly Halo Music Mix',
    'DJ Butterfly',
    'A full DJ Butterfly session selected for the Halo Radio Long Play rotation.',
    'Bn1V4lvhFTA',
    'https://www.youtube.com/watch?v=Bn1V4lvhFTA',
    'https://i.ytimg.com/vi/Bn1V4lvhFTA/hqdefault.jpg',
    20
  ),
  (
    'dj-sister-butterfly-non-stop-beats',
    'Non-Stop Beats: Pure Energy',
    'DJ Sister Butterfly',
    'Twenty minutes of uninterrupted house energy from Halo Music World.',
    'd8Nd2jb7BDs',
    'https://www.youtube.com/watch?v=d8Nd2jb7BDs',
    'https://i.ytimg.com/vi/d8Nd2jb7BDs/hqdefault.jpg',
    30
  ),
  (
    'dj-butterfly-flight-path-guest-mix',
    'Flight Path (20-Minute Guest Mix)',
    'DJ Butterfly',
    'A RuffCut guest mix moving through Afro House and Deep House.',
    'GKjU4Ac1Pzw',
    'https://www.youtube.com/watch?v=GKjU4Ac1Pzw',
    'https://i.ytimg.com/vi/GKjU4Ac1Pzw/hqdefault.jpg',
    40
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist_name = EXCLUDED.artist_name,
  description = EXCLUDED.description,
  video_id = EXCLUDED.video_id,
  video_url = EXCLUDED.video_url,
  thumbnail_url = EXCLUDED.thumbnail_url,
  rotation_position = EXCLUDED.rotation_position,
  active = TRUE;
