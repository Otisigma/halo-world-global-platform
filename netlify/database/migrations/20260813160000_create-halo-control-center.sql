CREATE TABLE IF NOT EXISTS halo_agent_commands (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_key TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  message TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  proposed_action JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (target_agent IN ('council', 'atlas', 'pulse', 'bridge', 'hearth', 'sentinel', 'mirror')),
  CHECK (status IN ('received', 'answered', 'awaiting_approval', 'failed')),
  CHECK (char_length(message) BETWEEN 2 AND 3000),
  CHECK (char_length(response) <= 4000),
  CHECK (char_length(assessment) <= 1200)
);

ALTER TABLE halo_agent_actions
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE halo_agent_actions
  ADD COLUMN IF NOT EXISTS source_command_id BIGINT REFERENCES halo_agent_commands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_agent_commands_created_idx
  ON halo_agent_commands(created_at DESC);

CREATE INDEX IF NOT EXISTS halo_agent_commands_target_idx
  ON halo_agent_commands(target_agent, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_agent_actions_command_idx
  ON halo_agent_actions(source_command_id)
  WHERE source_command_id IS NOT NULL;
