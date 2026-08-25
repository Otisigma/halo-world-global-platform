CREATE TABLE IF NOT EXISTS halo_fan_vote_campaigns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  reward_title TEXT NOT NULL DEFAULT 'Exclusive 60-minute DJ mix',
  reward_description TEXT NOT NULL DEFAULT '',
  vote_goal INTEGER NOT NULL DEFAULT 100,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  promotion JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (char_length(slug) BETWEEN 3 AND 96),
  CHECK (char_length(title) BETWEEN 2 AND 140),
  CHECK (char_length(subtitle) <= 240),
  CHECK (char_length(reward_title) BETWEEN 2 AND 140),
  CHECK (char_length(reward_description) <= 500),
  CHECK (vote_goal BETWEEN 10 AND 100000),
  CHECK (ends_at > starts_at),
  CHECK (status IN ('draft', 'published', 'closed'))
);

CREATE TABLE IF NOT EXISTS halo_fan_vote_campaign_tracks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES halo_fan_vote_campaigns(id) ON DELETE CASCADE,
  source_track_id TEXT REFERENCES halo_radio_tracks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  position SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, position),
  CHECK (char_length(title) BETWEEN 1 AND 140),
  CHECK (char_length(artist_name) BETWEEN 1 AND 140),
  CHECK (char_length(description) <= 500),
  CHECK (char_length(genre) <= 80),
  CHECK (duration_seconds BETWEEN 0 AND 7200),
  CHECK (position BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS halo_fan_vote_campaign_votes (
  campaign_id TEXT NOT NULL REFERENCES halo_fan_vote_campaigns(id) ON DELETE CASCADE,
  campaign_track_id BIGINT NOT NULL REFERENCES halo_fan_vote_campaign_tracks(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, voter_key),
  CHECK (char_length(voter_key) BETWEEN 10 AND 96)
);

CREATE INDEX IF NOT EXISTS halo_fan_vote_campaigns_owner_idx
  ON halo_fan_vote_campaigns(owner_member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_fan_vote_campaigns_public_idx
  ON halo_fan_vote_campaigns(status, ends_at DESC);
CREATE INDEX IF NOT EXISTS halo_fan_vote_campaign_tracks_campaign_idx
  ON halo_fan_vote_campaign_tracks(campaign_id, position);
CREATE INDEX IF NOT EXISTS halo_fan_vote_campaign_votes_track_idx
  ON halo_fan_vote_campaign_votes(campaign_track_id, updated_at DESC);
