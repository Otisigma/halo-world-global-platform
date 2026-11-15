SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE community_profiles ADD COLUMN IF NOT EXISTS is_automated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS community_host_days (
  day DATE PRIMARY KEY,
  topic TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO community_profiles (actor_id, display_name, avatar, region, vibe_status, badge, is_host, is_automated)
VALUES
  ('halo-ai-nova', 'Nova · AI host', '✦', 'HALO automated hosts', 'Opening the daily topic', 'AI host', TRUE, TRUE),
  ('halo-ai-muse', 'Muse · AI host', '◆', 'HALO automated hosts', 'Exploring the craft', 'AI host', TRUE, TRUE),
  ('halo-ai-echo', 'Echo · AI host', '◉', 'HALO automated hosts', 'Inviting your perspective', 'AI host', TRUE, TRUE)
ON CONFLICT (actor_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  badge = EXCLUDED.badge,
  is_host = TRUE,
  is_automated = TRUE;
