INSERT INTO halo_release_campaigns (
  id,
  title,
  artist,
  release_date,
  duration,
  genres,
  artwork_url,
  official_url,
  dj_url,
  radio_url,
  press_url,
  bpm,
  musical_key,
  isrc,
  content_rating,
  pitch,
  press_description,
  credits,
  contact_name,
  available_versions,
  status
)
VALUES (
  'closest-thing-to-heaven',
  'Closest Thing To Heaven. DJ Halo Mix (Extended Remix)',
  'DJ Halo',
  '2026-07-09',
  'Extended remix',
  ARRAY['Progressive', 'Melodic'],
  'https://distrokid.imgix.net/http%3A%2F%2Fgather.fandalism.com%2F13116989--64A855A9-3BA3-4940-A3604996808D3424--0--2232062--GeminiGeneratedImage1sa5o1sa5o1sa5o1.png?fm=jpg&mark-y=568&mark-x=620&mark-w=180&q=75&w=800&mark=http%3A%2F%2Fgather.fandalism.com%2Fdistrokid-sticker-sm.png&s=039f6f0830e41f25642e38bdcf720517',
  'https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-',
  'https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-',
  'https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-',
  'https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-',
  124,
  '8A (A minor)',
  'Available from distributor',
  'unspecified',
  'A progressive melodic extended remix shaped for sunrise transitions, patient builds, and emotionally lifted dancefloors.',
  'DJ Halo expands Closest Thing To Heaven into a longer progressive melodic journey, giving selectors more room to blend the opening and carry the final lift.',
  'DJ Halo Mix (Extended Remix). Campaign room prepared by HALO from the verified public release page.',
  'HALO release desk',
  ARRAY['Official streaming release', 'Extended remix', 'Cover artwork and verified release details', 'DJ, radio, and press support'],
  'published'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  release_date = EXCLUDED.release_date,
  duration = EXCLUDED.duration,
  genres = EXCLUDED.genres,
  artwork_url = EXCLUDED.artwork_url,
  official_url = EXCLUDED.official_url,
  dj_url = EXCLUDED.dj_url,
  radio_url = EXCLUDED.radio_url,
  press_url = EXCLUDED.press_url,
  bpm = EXCLUDED.bpm,
  musical_key = EXCLUDED.musical_key,
  isrc = EXCLUDED.isrc,
  content_rating = EXCLUDED.content_rating,
  pitch = EXCLUDED.pitch,
  press_description = EXCLUDED.press_description,
  credits = EXCLUDED.credits,
  contact_name = EXCLUDED.contact_name,
  available_versions = EXCLUDED.available_versions,
  status = EXCLUDED.status,
  updated_at = NOW();

UPDATE halo_release_campaigns
SET
  duration = CASE
    WHEN duration = '' THEN 'Campaign demo'
    ELSE duration
  END,
  genres = CASE
    WHEN cardinality(genres) = 0 THEN ARRAY['HALO release']
    ELSE genres
  END,
  dj_url = CASE
    WHEN dj_url = '' OR dj_url LIKE '/release-kit.html%' THEN official_url
    ELSE dj_url
  END,
  radio_url = CASE
    WHEN radio_url = '' OR radio_url LIKE '/release-kit.html%' THEN official_url
    ELSE radio_url
  END,
  press_url = CASE
    WHEN press_url = '' OR press_url LIKE '/release-kit.html%' THEN official_url
    ELSE press_url
  END,
  musical_key = CASE
    WHEN musical_key = '' THEN 'Demo metadata'
    ELSE musical_key
  END,
  isrc = CASE
    WHEN isrc = '' THEN 'Available from distributor'
    ELSE isrc
  END,
  credits = CASE
    WHEN credits = '' THEN artist || ' — ' || title || E'\nCampaign room prepared by HALO.'
    ELSE credits
  END,
  contact_name = CASE
    WHEN contact_name = '' THEN 'HALO release desk'
    ELSE contact_name
  END,
  available_versions = CASE
    WHEN cardinality(available_versions) = 0 THEN ARRAY['Official release link', 'Cover artwork and release details', 'DJ, radio, and press support']
    ELSE available_versions
  END,
  updated_at = NOW()
WHERE status = 'published';

INSERT INTO halo_artist_pages (
  slug,
  artist_name,
  tagline,
  bio,
  location,
  accent_color,
  artwork_url,
  release_title,
  release_date,
  release_url,
  video_title,
  video_url,
  community_url,
  dj_room_url,
  radio_room_url,
  press_room_url,
  booking_url,
  website_url,
  status
)
VALUES (
  'dj-halo',
  'DJ Halo',
  'Closest Thing To Heaven. DJ Halo Mix (Extended Remix), available now.',
  'DJ Halo builds progressive melodic records for long blends, sunrise rooms, and the point where a patient set opens into release. This room connects the verified music, visual, community, and professional campaign doors in one place.',
  'HALO network',
  '#d5ff52',
  'https://distrokid.imgix.net/http%3A%2F%2Fgather.fandalism.com%2F13116989--64A855A9-3BA3-4940-A3604996808D3424--0--2232062--GeminiGeneratedImage1sa5o1sa5o1sa5o1.png?fm=jpg&mark-y=568&mark-x=620&mark-w=180&q=75&w=800&mark=http%3A%2F%2Fgather.fandalism.com%2Fdistrokid-sticker-sm.png&s=039f6f0830e41f25642e38bdcf720517',
  'Closest Thing To Heaven. DJ Halo Mix (Extended Remix)',
  '2026-07-09',
  'https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-',
  'Closest Thing To Heaven — DJ Halo Mix',
  'https://www.youtube.com/watch?v=PLfCukEFNTE',
  '/#community',
  '/release-kit.html?audience=dj&slug=closest-thing-to-heaven',
  '/release-kit.html?audience=radio&slug=closest-thing-to-heaven',
  '/release-kit.html?audience=press&slug=closest-thing-to-heaven',
  '/creators/',
  'https://open.spotify.com/album/2QobtboKMPAvePm8C2W2VB',
  'published'
)
ON CONFLICT (slug) DO UPDATE SET
  artist_name = EXCLUDED.artist_name,
  tagline = EXCLUDED.tagline,
  bio = EXCLUDED.bio,
  location = EXCLUDED.location,
  accent_color = EXCLUDED.accent_color,
  artwork_url = EXCLUDED.artwork_url,
  release_title = EXCLUDED.release_title,
  release_date = EXCLUDED.release_date,
  release_url = EXCLUDED.release_url,
  video_title = EXCLUDED.video_title,
  video_url = EXCLUDED.video_url,
  community_url = EXCLUDED.community_url,
  dj_room_url = EXCLUDED.dj_room_url,
  radio_room_url = EXCLUDED.radio_room_url,
  press_room_url = EXCLUDED.press_room_url,
  booking_url = EXCLUDED.booking_url,
  website_url = EXCLUDED.website_url,
  status = EXCLUDED.status,
  updated_at = NOW();
