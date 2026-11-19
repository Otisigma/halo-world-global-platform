SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- One stored HALO Runners Briefing per UK calendar day (owner-only, read through the Control Center).
CREATE TABLE IF NOT EXISTS halo_runner_briefings (
  briefing_date DATE PRIMARY KEY,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN ('scheduled', 'manual')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_runner_briefings_generated_idx
  ON halo_runner_briefings(generated_at DESC);
