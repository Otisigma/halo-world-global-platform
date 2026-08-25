CREATE TABLE IF NOT EXISTS halo_dreamweaver_campaign_jobs (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  campaign_id TEXT UNIQUE REFERENCES halo_dreamweaver_campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 4,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (status IN ('queued', 'working', 'ready', 'failed')),
  CHECK (stage IN ('queued', 'gathering', 'planning', 'writing', 'packaging', 'ready', 'failed')),
  CHECK (progress BETWEEN 0 AND 100),
  CHECK (char_length(error_message) <= 500)
);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_campaign_job_member_idx
  ON halo_dreamweaver_campaign_jobs(member_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_campaign_job_mix_idx
  ON halo_dreamweaver_campaign_jobs(mix_id, updated_at DESC);
