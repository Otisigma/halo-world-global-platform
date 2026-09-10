CREATE TABLE IF NOT EXISTS halo_relationship_signups (
  email TEXT PRIMARY KEY,
  source_signup_id TEXT REFERENCES halo_dreamweaver_fan_signups(id) ON DELETE SET NULL,
  linked_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  favorite_platform TEXT NOT NULL DEFAULT 'spotify',
  source TEXT NOT NULL DEFAULT 'dreamweaver_satellite',
  unlock_reward TEXT NOT NULL DEFAULT 'full_track_doorway',
  status TEXT NOT NULL DEFAULT 'received',
  signup_count INTEGER NOT NULL DEFAULT 1,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_signup_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_signup_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email = LOWER(email)),
  CHECK (char_length(email) BETWEEN 5 AND 254),
  CHECK (char_length(first_name) <= 80),
  CHECK (favorite_platform IN ('spotify', 'apple_music', 'youtube')),
  CHECK (char_length(source) BETWEEN 2 AND 80),
  CHECK (char_length(unlock_reward) BETWEEN 2 AND 80),
  CHECK (status IN ('received', 'repeat_signup', 'linked_member')),
  CHECK (signup_count BETWEEN 1 AND 100000)
);

CREATE INDEX IF NOT EXISTS halo_relationship_signups_status_idx
  ON halo_relationship_signups(status, last_signup_at DESC);

CREATE INDEX IF NOT EXISTS halo_relationship_signups_member_idx
  ON halo_relationship_signups(linked_member_id, last_signup_at DESC)
  WHERE linked_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS halo_relationship_signups_recent_idx
  ON halo_relationship_signups(last_signup_at DESC);

WITH dreamweaver_signup_totals AS (
  SELECT
    email,
    COUNT(*)::int AS signup_count,
    MIN(consent_at) AS consent_at,
    MIN(created_at) AS first_signup_at,
    MAX(created_at) AS last_signup_at
  FROM halo_dreamweaver_fan_signups
  GROUP BY email
),
latest_dreamweaver_signups AS (
  SELECT DISTINCT ON (s.email)
    s.email,
    s.id,
    s.first_name,
    s.favorite_platform,
    s.source,
    s.unlock_reward,
    m.member_id
  FROM halo_dreamweaver_fan_signups s
  LEFT JOIN halo_memberships m ON m.email = s.email
  ORDER BY s.email, s.created_at DESC, s.consent_at DESC, s.id DESC
)
INSERT INTO halo_relationship_signups (
  email,
  source_signup_id,
  linked_member_id,
  first_name,
  favorite_platform,
  source,
  unlock_reward,
  status,
  signup_count,
  consent_at,
  first_signup_at,
  last_signup_at
)
SELECT
  latest.email,
  latest.id,
  latest.member_id,
  latest.first_name,
  latest.favorite_platform,
  latest.source,
  latest.unlock_reward,
  CASE WHEN latest.member_id IS NOT NULL THEN 'linked_member' ELSE 'received' END,
  totals.signup_count,
  totals.consent_at,
  totals.first_signup_at,
  totals.last_signup_at
FROM latest_dreamweaver_signups latest
JOIN dreamweaver_signup_totals totals USING (email)
ON CONFLICT (email) DO UPDATE SET
  source_signup_id = EXCLUDED.source_signup_id,
  linked_member_id = COALESCE(EXCLUDED.linked_member_id, halo_relationship_signups.linked_member_id),
  first_name = EXCLUDED.first_name,
  favorite_platform = EXCLUDED.favorite_platform,
  source = EXCLUDED.source,
  unlock_reward = EXCLUDED.unlock_reward,
  signup_count = GREATEST(halo_relationship_signups.signup_count, EXCLUDED.signup_count),
  consent_at = COALESCE(
    LEAST(halo_relationship_signups.consent_at, EXCLUDED.consent_at),
    halo_relationship_signups.consent_at,
    EXCLUDED.consent_at
  ),
  first_signup_at = COALESCE(
    LEAST(halo_relationship_signups.first_signup_at, EXCLUDED.first_signup_at),
    halo_relationship_signups.first_signup_at,
    EXCLUDED.first_signup_at
  ),
  last_signup_at = COALESCE(
    GREATEST(halo_relationship_signups.last_signup_at, EXCLUDED.last_signup_at),
    halo_relationship_signups.last_signup_at,
    EXCLUDED.last_signup_at
  ),
  updated_at = NOW(),
  status = CASE
    WHEN COALESCE(EXCLUDED.linked_member_id, halo_relationship_signups.linked_member_id) IS NOT NULL THEN 'linked_member'
    ELSE halo_relationship_signups.status
  END;

INSERT INTO halo_relationship_profiles (member_id)
SELECT DISTINCT linked_member_id
FROM halo_relationship_signups
WHERE linked_member_id IS NOT NULL
ON CONFLICT (member_id) DO NOTHING;

UPDATE halo_relationship_profiles AS profile
SET
  tags = CASE
    WHEN 'dreamweaver' = ANY(profile.tags) THEN profile.tags
    ELSE array_append(profile.tags, 'dreamweaver')
  END,
  relationship_summary = CASE
    WHEN profile.relationship_summary = '' THEN 'Dreamweaver fan signup captured from the public unlock flow.'
    ELSE profile.relationship_summary
  END,
  updated_at = NOW()
FROM halo_relationship_signups AS signup
WHERE signup.linked_member_id = profile.member_id;
