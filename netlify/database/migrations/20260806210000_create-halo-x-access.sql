CREATE TABLE IF NOT EXISTS halo_memberships (
  member_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL UNIQUE REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'member',
  source TEXT NOT NULL DEFAULT 'membership',
  access_ends_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tier IN ('member', 'gold', 'backstage', 'founder')),
  CHECK (char_length(display_name) BETWEEN 2 AND 64)
);

CREATE TABLE IF NOT EXISTS halo_access_passes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  label TEXT NOT NULL,
  pass_type TEXT NOT NULL,
  grants_tier TEXT NOT NULL,
  duration_days INTEGER,
  max_redemptions INTEGER NOT NULL DEFAULT 1,
  redemption_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (pass_type IN ('gold_ticket', 'backstage_pass', 'founders_key', 'event_pass')),
  CHECK (grants_tier IN ('gold', 'backstage', 'founder')),
  CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 3650),
  CHECK (max_redemptions BETWEEN 1 AND 10000),
  CHECK (redemption_count BETWEEN 0 AND max_redemptions),
  CHECK (status IN ('active', 'paused', 'retired'))
);

CREATE TABLE IF NOT EXISTS halo_pass_redemptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pass_id BIGINT NOT NULL REFERENCES halo_access_passes(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_ends_at TIMESTAMPTZ,
  UNIQUE (pass_id, member_id)
);

CREATE TABLE IF NOT EXISTS halo_room_pins (
  actor_id TEXT PRIMARY KEY REFERENCES community_profiles(actor_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT 'Open',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 2 AND 80),
  CHECK (char_length(body) <= 240),
  CHECK (char_length(destination_url) <= 500),
  CHECK (char_length(cta_label) BETWEEN 2 AND 24)
);

CREATE TABLE IF NOT EXISTS halo_daily_reports (
  report_date DATE PRIMARY KEY,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  recent_joins JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS halo_dj_sessions (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  session_name TEXT NOT NULL DEFAULT 'My HALO set',
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(session_name) BETWEEN 2 AND 80),
  CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS halo_memberships_joined_idx
  ON halo_memberships(joined_at DESC);
CREATE INDEX IF NOT EXISTS halo_memberships_seen_idx
  ON halo_memberships(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS halo_access_passes_status_idx
  ON halo_access_passes(status, expires_at);
CREATE INDEX IF NOT EXISTS halo_pass_redemptions_created_idx
  ON halo_pass_redemptions(redeemed_at DESC);
CREATE INDEX IF NOT EXISTS halo_room_pins_updated_idx
  ON halo_room_pins(updated_at DESC);

INSERT INTO halo_access_passes (
  code_hash,
  code_hint,
  label,
  pass_type,
  grants_tier,
  duration_days,
  max_redemptions,
  expires_at
)
VALUES (
  '6c293e5305ce4d8c93c05d7e027f1f866ea35437977400b48e8ccd8d358fd440',
  '2026',
  'VIP Private Beta Founders Key',
  'founders_key',
  'founder',
  NULL,
  250,
  '2027-01-01T00:00:00Z'
)
ON CONFLICT (code_hash) DO NOTHING;
