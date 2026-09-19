CREATE TABLE IF NOT EXISTS halo_song_publication_sync (
  song_id TEXT PRIMARY KEY REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  release_id TEXT REFERENCES halo_release_campaigns(id) ON DELETE SET NULL,
  radio_track_id TEXT REFERENCES halo_radio_tracks(id) ON DELETE SET NULL,
  canonical_url TEXT NOT NULL DEFAULT '',
  release_status TEXT NOT NULL DEFAULT 'pending',
  radio_status TEXT NOT NULL DEFAULT 'pending',
  dreamweaver_status TEXT NOT NULL DEFAULT 'pending',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reconciled_at TIMESTAMPTZ,
  CHECK (release_status IN ('pending', 'published', 'error')),
  CHECK (radio_status IN ('pending', 'rotation', 'preview', 'held', 'queued', 'error')),
  CHECK (dreamweaver_status IN ('pending', 'ready', 'error'))
);

CREATE INDEX IF NOT EXISTS halo_song_publication_sync_status_idx
  ON halo_song_publication_sync(release_status, radio_status, updated_at DESC);

INSERT INTO halo_song_publication_sync (
  song_id,
  owner_member_id,
  release_id,
  canonical_url,
  release_status,
  radio_status,
  dreamweaver_status,
  details,
  last_reconciled_at
)
SELECT
  song.id,
  song.owner_member_id,
  song.source_release_id,
  CASE
    WHEN COALESCE(song.source_release_id, '') <> '' THEN '/music/?song=' || song.source_release_id
    ELSE ''
  END,
  CASE
    WHEN COALESCE(release.id, '') <> '' AND release.status = 'published' THEN 'published'
    ELSE 'pending'
  END,
  CASE
    WHEN radio.id IS NOT NULL THEN radio.status
    ELSE 'pending'
  END,
  CASE
    WHEN COALESCE(song.source_release_id, '') <> '' THEN 'ready'
    ELSE 'pending'
  END,
  jsonb_build_object(
    'backfilled', TRUE,
    'sourceReleaseId', COALESCE(song.source_release_id, ''),
    'radioTrackId', COALESCE(radio.id, '')
  ),
  NOW()
FROM halo_song_catalog song
LEFT JOIN halo_release_campaigns release ON release.id = song.source_release_id
LEFT JOIN LATERAL (
  SELECT id, status
  FROM halo_radio_tracks
  WHERE master_song_id = song.id
    AND status IN ('preview', 'rotation', 'held')
  ORDER BY created_at DESC
  LIMIT 1
) radio ON TRUE
WHERE song.status = 'active'
  AND song.pipeline_status = 'published'
ON CONFLICT (song_id) DO UPDATE SET
  owner_member_id = EXCLUDED.owner_member_id,
  release_id = COALESCE(EXCLUDED.release_id, halo_song_publication_sync.release_id),
  radio_track_id = COALESCE(halo_song_publication_sync.radio_track_id, EXCLUDED.radio_track_id),
  canonical_url = CASE
    WHEN halo_song_publication_sync.canonical_url = '' THEN EXCLUDED.canonical_url
    ELSE halo_song_publication_sync.canonical_url
  END,
  release_status = CASE
    WHEN halo_song_publication_sync.release_status = 'published' THEN halo_song_publication_sync.release_status
    ELSE EXCLUDED.release_status
  END,
  radio_status = CASE
    WHEN halo_song_publication_sync.radio_status IN ('rotation', 'preview', 'held') THEN halo_song_publication_sync.radio_status
    ELSE EXCLUDED.radio_status
  END,
  dreamweaver_status = CASE
    WHEN halo_song_publication_sync.dreamweaver_status = 'ready' THEN halo_song_publication_sync.dreamweaver_status
    ELSE EXCLUDED.dreamweaver_status
  END,
  details = halo_song_publication_sync.details || EXCLUDED.details,
  updated_at = NOW(),
  last_reconciled_at = NOW();
