-- Halo Ledger: persistent, searchable operational memory for the platform.
-- Every request, upload, fix, department action, and agent activity creates
-- a first-class ledger entry so the site can learn from its own history.

CREATE TABLE IF NOT EXISTS halo_ledger (
  id              TEXT        PRIMARY KEY,
  -- Who or what created this entry (member_id, agent name, or "system")
  actor_id        TEXT        NOT NULL DEFAULT 'system',
  actor_type      TEXT        NOT NULL DEFAULT 'system',
  -- Typed event category
  event_category  TEXT        NOT NULL,
  -- Optional references back to source records
  ref_song_id     TEXT,
  ref_issue_id    TEXT,
  ref_release_id  TEXT,
  ref_agent_id    TEXT,
  -- Human-readable summary visible in the UI
  summary         TEXT        NOT NULL DEFAULT '',
  -- Structured details (JSON blob; schema varies by category)
  details         JSONB       NOT NULL DEFAULT '{}',
  -- Free-text body for longer notes (searchable)
  body            TEXT        NOT NULL DEFAULT '',
  -- Pipeline stage at the time of the event (upload events)
  pipeline_stage  TEXT,
  -- Outcome of the event
  outcome         TEXT        NOT NULL DEFAULT 'success',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CONSTRAINT: event_category must be one of the known types.
-- Enforced in application code; listed here as documentation.
-- Known categories:
--   upload_event        – song uploaded or pipeline stage advanced
--   issue_report        – bug or problem submitted
--   fix_record          – repair or patch applied
--   department_action   – department-specific workflow action
--   approval_event      – item approved or published
--   agent_activity      – agent/task execution record
--   feature_request     – user feature ask
--   system_event        – platform-level operational note

-- Indexes for the most common access patterns.
CREATE INDEX IF NOT EXISTS halo_ledger_created_idx
  ON halo_ledger (created_at DESC);

CREATE INDEX IF NOT EXISTS halo_ledger_category_idx
  ON halo_ledger (event_category, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_ledger_actor_idx
  ON halo_ledger (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_ledger_song_idx
  ON halo_ledger (ref_song_id, created_at DESC)
  WHERE ref_song_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS halo_ledger_issue_idx
  ON halo_ledger (ref_issue_id, created_at DESC)
  WHERE ref_issue_id IS NOT NULL;
