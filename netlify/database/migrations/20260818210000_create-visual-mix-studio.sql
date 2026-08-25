CREATE TABLE IF NOT EXISTS halo_visual_mix_projects (
  id UUID PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  package_type TEXT NOT NULL DEFAULT 'hybrid',
  brand_name TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#d85f35',
  secondary_color TEXT NOT NULL DEFAULT '#d7c6a5',
  visual_style TEXT NOT NULL DEFAULT 'cinematic_archive',
  creative_brief TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'storyboard_ready',
  scene_count INTEGER NOT NULL DEFAULT 0,
  source_video_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 2 AND 140),
  CHECK (package_type IN ('logo', 'hybrid', 'full_visual')),
  CHECK (char_length(brand_name) <= 120),
  CHECK (char_length(logo_url) <= 1000),
  CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (visual_style IN ('cinematic_archive', 'nightclub_signal', 'luxury_lounge', 'dreamscape', 'artist_world')),
  CHECK (char_length(creative_brief) BETWEEN 8 AND 2000),
  CHECK (duration_seconds BETWEEN 0 AND 43200),
  CHECK (status IN ('storyboard_ready', 'revision', 'render_brief_ready', 'archived')),
  CHECK (scene_count BETWEEN 0 AND 96),
  CHECK (source_video_count BETWEEN 0 AND 60)
);

CREATE TABLE IF NOT EXISTS halo_visual_mix_scenes (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES halo_visual_mix_projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  start_seconds INTEGER NOT NULL,
  end_seconds INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_video_id UUID REFERENCES halo_videos(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT '',
  transition_type TEXT NOT NULL DEFAULT 'crossfade',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, position),
  CHECK (position BETWEEN 0 AND 95),
  CHECK (start_seconds >= 0 AND end_seconds > start_seconds AND end_seconds <= 43200),
  CHECK (source_type IN ('logo_motion', 'source_video', 'dreamweaver')),
  CHECK (char_length(title) BETWEEN 2 AND 160),
  CHECK (char_length(direction) BETWEEN 8 AND 1200),
  CHECK (transition_type IN ('crossfade', 'film_dissolve', 'light_sweep', 'hard_cut', 'logo_reveal'))
);

CREATE INDEX IF NOT EXISTS halo_visual_mix_projects_member_idx
  ON halo_visual_mix_projects(member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_visual_mix_projects_mix_idx
  ON halo_visual_mix_projects(mix_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_visual_mix_scenes_project_idx
  ON halo_visual_mix_scenes(project_id, position);
