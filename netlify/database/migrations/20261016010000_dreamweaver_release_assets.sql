CREATE TABLE IF NOT EXISTS halo_release_assets (
  song_id text PRIMARY KEY REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  master_version_id text NOT NULL REFERENCES halo_song_versions(id) ON DELETE CASCADE,
  canonical_master_url text NOT NULL,
  visual_act_1 text NOT NULL,
  visual_act_2 text NOT NULL,
  visual_act_3 text NOT NULL,
  visual_act_4 text NOT NULL,
  custom_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
