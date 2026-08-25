UPDATE halo_release_campaigns
SET
  official_url = 'https://distrokid.com/hyperfollow/owenanthony/the-cold-is-lasting-longer?ref=release',
  updated_at = NOW()
WHERE id = 'the-cold-is-lasting-longer';

UPDATE halo_artist_pages
SET
  tagline = 'A patient electronic and Afrobeat signal for late-night rooms and slow-building sets.',
  artwork_url = '/assets/releases/the-cold-is-lasting-longer.jpg',
  release_title = 'The Cold Is Lasting Longer',
  release_date = '2026-08-10',
  release_url = 'https://distrokid.com/hyperfollow/owenanthony/the-cold-is-lasting-longer?ref=release',
  dj_room_url = '/release-kit.html?audience=dj&slug=the-cold-is-lasting-longer',
  radio_room_url = '/release-kit.html?audience=radio&slug=the-cold-is-lasting-longer',
  press_room_url = '/release-kit.html?audience=press&slug=the-cold-is-lasting-longer',
  updated_at = NOW()
WHERE slug = 'owen-anthony';
