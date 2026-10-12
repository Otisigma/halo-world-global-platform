-- Signal messages bound to a specific content item. target_id is either a Wire
-- post ID (e.g. wire-seed-independence-only-real-asset) or a track ID slug
-- (e.g. read-the-room), so comments render directly beneath that item.
CREATE TABLE IF NOT EXISTS halo_signal_thread_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id TEXT NOT NULL CHECK (target_id ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  sender_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  user_identifier TEXT NOT NULL CHECK (char_length(user_identifier) BETWEEN 1 AND 80),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_signal_thread_messages_target_idx
  ON halo_signal_thread_messages (target_id, created_at DESC, id DESC) WHERE hidden = FALSE;
CREATE INDEX IF NOT EXISTS halo_signal_thread_messages_sender_idx
  ON halo_signal_thread_messages (sender_member_id, created_at DESC);
