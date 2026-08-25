CREATE TABLE IF NOT EXISTS halo_share_invites (
  token TEXT PRIMARY KEY,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  destination_path TEXT NOT NULL DEFAULT '/halo-x.html',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (token ~ '^[a-f0-9]{32}$'),
  CHECK (destination_path ~ '^/[a-zA-Z0-9/_-]*(\.html)?$')
);

CREATE TABLE IF NOT EXISTS halo_share_invite_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_token TEXT NOT NULL REFERENCES halo_share_invites(token) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  event_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('created', 'shared', 'opened', 'joined')),
  CHECK (event_key IS NULL OR char_length(event_key) BETWEEN 8 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_share_invite_event_key_idx
  ON halo_share_invite_events(invite_token, event_type, event_key)
  WHERE event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS halo_share_invite_joined_member_idx
  ON halo_share_invite_events(invite_token, member_id)
  WHERE event_type = 'joined' AND member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS halo_share_invite_events_member_idx
  ON halo_share_invite_events(member_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS halo_share_invite_events_time_idx
  ON halo_share_invite_events(occurred_at DESC);
