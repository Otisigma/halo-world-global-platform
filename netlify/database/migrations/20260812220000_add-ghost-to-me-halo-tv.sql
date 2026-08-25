INSERT INTO halo_radio_long_plays (
  id,
  title,
  artist_name,
  description,
  video_id,
  video_url,
  thumbnail_url,
  rotation_position
) VALUES (
  'ghost-to-me-dj-halo-x-remix',
  'Ghost To Me (DJ Halo X Remix)',
  'DJ Halo X',
  'A permanent Halo TV selection that continues into the next Long Play automatically.',
  'yh7qQGvzmdw',
  'https://www.youtube.com/watch?v=yh7qQGvzmdw',
  'https://i.ytimg.com/vi/yh7qQGvzmdw/hqdefault.jpg',
  50
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
