CREATE TABLE IF NOT EXISTS halo_signal_profiles (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  roles TEXT[] NOT NULL DEFAULT '{}',
  genres TEXT[] NOT NULL DEFAULT '{}',
  skills TEXT[] NOT NULL DEFAULT '{}',
  looking_for TEXT[] NOT NULL DEFAULT '{}',
  region_code TEXT NOT NULL DEFAULT '',
  region_label TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'open',
  discoverable BOOLEAN NOT NULL DEFAULT TRUE,
  map_visible BOOLEAN NOT NULL DEFAULT FALSE,
  accent TEXT NOT NULL DEFAULT 'gold',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(headline) <= 120),
  CHECK (char_length(bio) <= 900),
  CHECK (cardinality(roles) <= 8),
  CHECK (cardinality(genres) <= 12),
  CHECK (cardinality(skills) <= 12),
  CHECK (cardinality(looking_for) <= 8),
  CHECK (region_code ~ '^[a-z0-9-]{0,32}$'),
  CHECK (char_length(region_label) <= 80),
  CHECK (availability IN ('open', 'selective', 'unavailable')),
  CHECK (accent IN ('gold', 'cyan', 'violet', 'coral', 'lime'))
);

CREATE TABLE IF NOT EXISTS halo_signal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  recipient_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  request_kind TEXT NOT NULL DEFAULT 'signal',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  campaign_slug TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_member_id <> recipient_member_id),
  CHECK (request_kind IN ('signal', 'collaboration')),
  CHECK (char_length(subject) BETWEEN 2 AND 120),
  CHECK (char_length(body) BETWEEN 2 AND 1200),
  CHECK (campaign_slug IS NULL OR campaign_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (status IN ('pending', 'accepted', 'declined', 'archived'))
);

CREATE TABLE IF NOT EXISTS halo_signal_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_a_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  member_b_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  created_from_request_id UUID REFERENCES halo_signal_requests(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_a_id, member_b_id),
  CHECK (member_a_id < member_b_id)
);

CREATE TABLE IF NOT EXISTS halo_signal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES halo_signal_conversations(id) ON DELETE CASCADE,
  sender_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(body) BETWEEN 1 AND 2400)
);

CREATE TABLE IF NOT EXISTS halo_signal_blocks (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  target_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, target_member_id),
  CHECK (member_id <> target_member_id)
);

CREATE TABLE IF NOT EXISTS halo_signal_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  target_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  request_id UUID REFERENCES halo_signal_requests(id) ON DELETE SET NULL,
  message_id UUID REFERENCES halo_signal_messages(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CHECK (char_length(reason) BETWEEN 3 AND 800),
  CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  CHECK (target_member_id IS NOT NULL OR request_id IS NOT NULL OR message_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS halo_signal_profiles_discovery_idx
  ON halo_signal_profiles (discoverable, availability, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_profiles_region_idx
  ON halo_signal_profiles (region_code) WHERE map_visible = TRUE;
CREATE INDEX IF NOT EXISTS halo_signal_requests_recipient_idx
  ON halo_signal_requests (recipient_member_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_requests_sender_idx
  ON halo_signal_requests (sender_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_conversations_a_idx
  ON halo_signal_conversations (member_a_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_conversations_b_idx
  ON halo_signal_conversations (member_b_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_messages_conversation_idx
  ON halo_signal_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_signal_messages_unread_idx
  ON halo_signal_messages (conversation_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS halo_signal_reports_status_idx
  ON halo_signal_reports (status, created_at DESC);
