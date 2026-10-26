-- Track drop notifications: opted-in members hear when a new track enters the HALO shop.
CREATE TABLE IF NOT EXISTS halo_member_notification_preferences (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  track_drops_in_app BOOLEAN NOT NULL DEFAULT FALSE,
  track_drops_email BOOLEAN NOT NULL DEFAULT FALSE,
  rewards_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_consent_at TIMESTAMPTZ,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_member_notification_preferences_email_idx
  ON halo_member_notification_preferences(track_drops_email)
  WHERE track_drops_email = TRUE;

-- One announcement per song, ever: repeated publishes and repairs never re-notify.
CREATE TABLE IF NOT EXISTS halo_track_drop_events (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL UNIQUE REFERENCES halo_song_catalog(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL,
  owner_member_id TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artwork_url TEXT NOT NULL DEFAULT '',
  public_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_track_drop_events_created_idx
  ON halo_track_drop_events(created_at DESC);

CREATE TABLE IF NOT EXISTS halo_track_drop_deliveries (
  drop_id TEXT NOT NULL REFERENCES halo_track_drop_events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (drop_id, member_id, channel)
);

CREATE INDEX IF NOT EXISTS halo_track_drop_deliveries_queue_idx
  ON halo_track_drop_deliveries(status, created_at)
  WHERE status = 'queued';

-- Member rewards: each reward key is granted at most once per member.
CREATE TABLE IF NOT EXISTS halo_member_reward_events (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 100),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, reward_key)
);
