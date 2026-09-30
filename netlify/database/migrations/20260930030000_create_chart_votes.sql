-- Chart votes for /api/catalog/chart and /api/catalog/vote.
--
-- One row per release, anonymous voter key (hashed), and UTC day, so each
-- listener can boost a release at most once a day. The chart ranks releases
-- by COUNT(*) of these rows alongside recent listening activity.
CREATE TABLE IF NOT EXISTS halo_chart_votes (
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  vote_day DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (release_id, voter_key, vote_day),
  CHECK (char_length(voter_key) BETWEEN 8 AND 96)
);

CREATE INDEX IF NOT EXISTS halo_chart_votes_release_idx
  ON halo_chart_votes(release_id);
