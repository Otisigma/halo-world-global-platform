CREATE TABLE IF NOT EXISTS halo_finish_house_projects (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  release_project_id TEXT REFERENCES halo_release_house_projects(id) ON DELETE SET NULL,
  artist_name TEXT NOT NULL DEFAULT '',
  track_title TEXT NOT NULL DEFAULT '',
  intended_use TEXT NOT NULL DEFAULT 'streaming',
  mastering_status TEXT NOT NULL DEFAULT 'brief',
  mastering_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_deliverables TEXT[] NOT NULL DEFAULT ARRAY['streaming_master']::TEXT[],
  licensing_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  licensing_status TEXT NOT NULL DEFAULT 'preparing',
  licensing_destination TEXT NOT NULL DEFAULT 'halo_house',
  submission_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CHECK (char_length(artist_name) <= 120),
  CHECK (char_length(track_title) <= 160),
  CHECK (intended_use IN ('streaming', 'radio', 'club', 'film_tv', 'games', 'general')),
  CHECK (mastering_status IN ('brief', 'requested', 'in_progress', 'review', 'approved')),
  CHECK (requested_deliverables <@ ARRAY['streaming_master', 'high_resolution_master', 'instrumental', 'clean', 'performance', 'acapella']::TEXT[]),
  CHECK (licensing_status IN ('preparing', 'rights_review', 'ready', 'submitted', 'placed', 'declined')),
  CHECK (licensing_destination IN ('halo_house', 'disco', 'sync_library', 'music_supervisor', 'brand_agency', 'games')),
  CHECK (char_length(submission_notes) <= 4000),
  CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_finish_house_release_owner_idx
  ON halo_finish_house_projects(owner_member_id, release_project_id)
  WHERE release_project_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS halo_finish_house_owner_updated_idx
  ON halo_finish_house_projects(owner_member_id, status, updated_at DESC);
