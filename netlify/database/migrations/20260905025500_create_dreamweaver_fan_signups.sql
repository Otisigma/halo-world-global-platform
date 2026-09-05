CREATE TABLE IF NOT EXISTS halo_dreamweaver_fan_signups (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  first_name        TEXT NOT NULL DEFAULT '',
  favorite_platform TEXT NOT NULL DEFAULT 'spotify',
  source            TEXT NOT NULL DEFAULT 'dreamweaver_satellite',
  unlock_reward     TEXT NOT NULL DEFAULT 'full_track_doorway',
  consent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_dreamweaver_fan_signups_created_idx
  ON halo_dreamweaver_fan_signups (created_at DESC);
