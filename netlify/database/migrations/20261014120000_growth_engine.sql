CREATE TABLE IF NOT EXISTS halo_growth_campaigns (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  settings JSONB NOT NULL,
  rights JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT halo_growth_campaigns_request_idx UNIQUE (owner_member_id, song_id, request_key)
);

CREATE TABLE IF NOT EXISTS halo_growth_jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES halo_growth_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ingest', 'analysis', 'render', 'metadata', 'publish', 'analytics')),
  job_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'blocked', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  result JSONB,
  last_error TEXT NOT NULL DEFAULT '',
  audit JSONB NOT NULL DEFAULT '[]'::jsonb,
  lease_token TEXT,
  locked_until TIMESTAMPTZ,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT halo_growth_jobs_key_idx UNIQUE (campaign_id, job_key)
);

CREATE INDEX IF NOT EXISTS halo_growth_campaigns_owner_idx ON halo_growth_campaigns(owner_member_id, created_at);
CREATE INDEX IF NOT EXISTS halo_growth_jobs_queue_idx ON halo_growth_jobs(campaign_id, status, available_at);
