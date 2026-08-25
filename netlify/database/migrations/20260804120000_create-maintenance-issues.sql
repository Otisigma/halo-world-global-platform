CREATE TABLE maintenance_issues (
  id BIGSERIAL PRIMARY KEY,
  issue_key VARCHAR(64) NOT NULL UNIQUE,
  source VARCHAR(32) NOT NULL,
  category VARCHAR(48) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'medium',
  title VARCHAR(180) NOT NULL,
  details TEXT NOT NULL,
  page_path VARCHAR(256) NOT NULL DEFAULT '/',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  triage_status VARCHAR(24) NOT NULL DEFAULT 'pending',
  ai_summary TEXT,
  ai_fix_plan JSONB,
  dispatch_status VARCHAR(24) NOT NULL DEFAULT 'pending',
  maintenance_reference VARCHAR(180),
  resolution_summary TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  healed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX maintenance_issues_status_updated_idx
  ON maintenance_issues (status, updated_at DESC);

CREATE INDEX maintenance_issues_dispatch_updated_idx
  ON maintenance_issues (dispatch_status, updated_at DESC);

CREATE TABLE maintenance_report_events (
  id BIGSERIAL PRIMARY KEY,
  reporter_key VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX maintenance_report_events_reporter_created_idx
  ON maintenance_report_events (reporter_key, created_at DESC);
