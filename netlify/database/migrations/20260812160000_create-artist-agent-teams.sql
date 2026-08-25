-- Per-artist AI agent teams.
-- The HALO Agent Council serves the platform owner. This migration gives every artist page its own
-- scoped team: plan and quota state, runs, specialist findings, approval-gated proposals, unpublished
-- content drafts, and per-artist working memory. Nothing here permits autonomous external publishing.

CREATE TABLE IF NOT EXISTS halo_artist_agent_plans (
  artist_slug TEXT PRIMARY KEY REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  plan_tier TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  enabled_agents JSONB NOT NULL DEFAULT '["scout", "manager", "amplifier", "circle"]'::jsonb,
  monthly_run_allowance INTEGER NOT NULL DEFAULT 4,
  runs_this_period INTEGER NOT NULL DEFAULT 0,
  period_started_on DATE NOT NULL DEFAULT CURRENT_DATE,
  external_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  activated_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (plan_tier IN ('starter', 'solo', 'pro', 'label')),
  CHECK (status IN ('active', 'paused', 'cancelled')),
  CHECK (monthly_run_allowance BETWEEN 0 AND 400),
  CHECK (runs_this_period >= 0)
);

CREATE TABLE IF NOT EXISTS halo_artist_agent_runs (
  id UUID PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL DEFAULT '',
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  briefing TEXT NOT NULL DEFAULT '',
  momentum_score INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0,
  wins JSONB NOT NULL DEFAULT '[]'::jsonb,
  concerns JSONB NOT NULL DEFAULT '[]'::jsonb,
  reflection JSONB NOT NULL DEFAULT '{}'::jsonb,
  grounding JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  inference_calls INTEGER NOT NULL DEFAULT 0,
  fallback_calls INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (trigger_type IN ('scheduled', 'manual')),
  CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  CHECK (momentum_score BETWEEN 0 AND 100),
  CHECK (input_tokens >= 0 AND output_tokens >= 0),
  CHECK (inference_calls >= 0 AND fallback_calls >= 0)
);

CREATE TABLE IF NOT EXISTS halo_artist_agent_findings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES halo_artist_agent_runs(id) ON DELETE CASCADE,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(agent_key) BETWEEN 2 AND 32)
);

CREATE TABLE IF NOT EXISTS halo_artist_agent_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES halo_artist_agent_runs(id) ON DELETE CASCADE,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'audience',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  needs_approval BOOLEAN NOT NULL DEFAULT TRUE,
  expected_metric TEXT NOT NULL DEFAULT '',
  signal_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  artist_note TEXT NOT NULL DEFAULT '',
  actual_outcome TEXT NOT NULL DEFAULT '',
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 1 AND 200),
  CHECK (category IN ('repertoire', 'campaign', 'audience', 'content', 'rights', 'risk')),
  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  CHECK (status IN ('proposed', 'approved', 'in_progress', 'completed', 'dismissed'))
);

-- Drafts are written by the content agent and never leave HALO on their own. A draft becomes
-- publishable only once an accountable member approves it, which the approval column records.
CREATE TABLE IF NOT EXISTS halo_artist_agent_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES halo_artist_agent_runs(id) ON DELETE CASCADE,
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'artist_room',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  signal_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed',
  requires_external_publish BOOLEAN NOT NULL DEFAULT FALSE,
  disclosure TEXT NOT NULL DEFAULT 'Drafted by this artist''s HALO agent team and approved by a human before publishing.',
  approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (surface IN ('artist_room', 'radio_note', 'fan_update', 'press_note', 'external_social')),
  CHECK (char_length(title) <= 200),
  CHECK (char_length(body) <= 4000),
  CHECK (status IN ('proposed', 'approved', 'published', 'dismissed')),
  CHECK (status NOT IN ('approved', 'published') OR approved_by_member_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS halo_artist_agent_memory (
  artist_slug TEXT NOT NULL REFERENCES halo_artist_pages(slug) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  working_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  lessons JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_reflection TEXT NOT NULL DEFAULT '',
  run_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artist_slug, agent_key)
);

CREATE INDEX IF NOT EXISTS halo_artist_agent_runs_artist_idx
  ON halo_artist_agent_runs(artist_slug, started_at DESC);
CREATE INDEX IF NOT EXISTS halo_artist_agent_findings_run_idx
  ON halo_artist_agent_findings(run_id, id);
CREATE INDEX IF NOT EXISTS halo_artist_agent_actions_artist_idx
  ON halo_artist_agent_actions(artist_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_artist_agent_drafts_artist_idx
  ON halo_artist_agent_drafts(artist_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_artist_agent_plans_status_idx
  ON halo_artist_agent_plans(status, updated_at DESC);

-- The first published artist room starts on the solo tier so the team can be exercised end to end.
INSERT INTO halo_artist_agent_plans (artist_slug, plan_tier, status, monthly_run_allowance)
SELECT 'owen-anthony', 'solo', 'active', 30
WHERE EXISTS (SELECT 1 FROM halo_artist_pages WHERE slug = 'owen-anthony')
ON CONFLICT (artist_slug) DO NOTHING;
