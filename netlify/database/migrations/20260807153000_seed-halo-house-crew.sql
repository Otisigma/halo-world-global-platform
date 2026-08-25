SET lock_timeout = '5s';
SET statement_timeout = '30s';

INSERT INTO community_profiles (actor_id, display_name, avatar, region, favorite_genres, vibe_status, badge, is_host)
VALUES
  ('halo-crew-maya', 'Maya · HALO Crew', '🎛️', 'London · HALO', ARRAY['House', 'Disco'], 'Welcoming the first arrivals', 'HALO House Crew', TRUE),
  ('halo-crew-noah', 'Noah · HALO Crew', '🌊', 'Lisbon · HALO', ARRAY['Progressive', 'Balearic'], 'Reading the room direction', 'HALO House Crew', TRUE),
  ('halo-crew-ami', 'Ami · HALO Crew', '🦋', 'Berlin · HALO', ARRAY['Melodic Techno', 'Ambient'], 'Collecting the deep cuts', 'HALO House Crew', TRUE),
  ('halo-crew-sol', 'Sol · HALO Crew', '🌅', 'Ibiza · HALO', ARRAY['Afro House', 'Organic House'], 'Holding the sunrise lane', 'HALO House Crew', TRUE)
ON CONFLICT (actor_id) DO NOTHING;

INSERT INTO community_messages (actor_id, body, is_spotlighted, created_at)
SELECT seed.actor_id, seed.body, seed.is_spotlighted, NOW() - seed.age
FROM (VALUES
  ('halo-crew-maya', 'House crew check-in: where are you listening from, and what time is it there?', TRUE, INTERVAL '18 minutes'),
  ('halo-crew-noah', 'I am leaning toward a warm progressive opening. Vote on the Room Stage and tell me what would change your mind.', FALSE, INTERVAL '15 minutes'),
  ('halo-crew-ami', 'Deep-cut question: which track still gives you the same feeling as the first time you heard it?', FALSE, INTERVAL '11 minutes'),
  ('halo-crew-sol', 'If we unlock the sunrise lane, I want one song chosen by someone joining HALO for the first time.', TRUE, INTERVAL '7 minutes'),
  ('halo-host', 'The house crew starts the spark, but the room belongs to everyone who joins. Introduce yourself or challenge our vote.', TRUE, INTERVAL '3 minutes')
) AS seed(actor_id, body, is_spotlighted, age)
WHERE NOT EXISTS (
  SELECT 1 FROM community_messages message
  WHERE message.actor_id = seed.actor_id AND message.body = seed.body
);

INSERT INTO community_room_posts (actor_id, title, description, video_url, created_at)
SELECT
  'halo-host',
  'House crew warm-up: choose the room direction',
  'Start with the HALO playlist, then vote on the energy the crew should build around. House-crew votes are included as conversation starters and remain open to every signed-in member.',
  'https://www.youtube.com/playlist?list=PLcmaoB9ss1YE',
  NOW() - INTERVAL '20 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM community_room_posts
  WHERE actor_id = 'halo-host' AND title = 'House crew warm-up: choose the room direction'
);

INSERT INTO community_room_poll_options (post_id, label, position)
SELECT post.id, option.label, option.position
FROM community_room_posts post
CROSS JOIN (VALUES
  ('Sunrise progressive', 1),
  ('Disco pressure', 2),
  ('Melodic after-hours', 3),
  ('Ocean-floor reset', 4)
) AS option(label, position)
WHERE post.actor_id = 'halo-host'
  AND post.title = 'House crew warm-up: choose the room direction'
  AND post.id = (
    SELECT MIN(target.id)
    FROM community_room_posts target
    WHERE target.actor_id = 'halo-host'
      AND target.title = 'House crew warm-up: choose the room direction'
  )
  AND NOT EXISTS (
    SELECT 1 FROM community_room_poll_options existing
    WHERE existing.post_id = post.id AND existing.position = option.position
  );

INSERT INTO community_room_votes (post_id, option_id, actor_id, created_at)
SELECT post.id, option.id, crew.actor_id, NOW() - crew.age
FROM (VALUES
  ('halo-crew-maya', 'Disco pressure', INTERVAL '14 minutes'),
  ('halo-crew-noah', 'Sunrise progressive', INTERVAL '12 minutes'),
  ('halo-crew-ami', 'Melodic after-hours', INTERVAL '9 minutes'),
  ('halo-crew-sol', 'Sunrise progressive', INTERVAL '6 minutes'),
  ('halo-host', 'Sunrise progressive', INTERVAL '2 minutes')
) AS crew(actor_id, option_label, age)
JOIN community_room_posts post
  ON post.actor_id = 'halo-host' AND post.title = 'House crew warm-up: choose the room direction'
  AND post.id = (
    SELECT MIN(target.id)
    FROM community_room_posts target
    WHERE target.actor_id = 'halo-host'
      AND target.title = 'House crew warm-up: choose the room direction'
  )
JOIN community_room_poll_options option
  ON option.post_id = post.id AND option.label = crew.option_label
ON CONFLICT (post_id, actor_id) DO NOTHING;
