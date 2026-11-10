-- Radio rotation is editorial, not a numeric vote threshold. Anonymous chart
-- votes cannot establish a member's identity and are deliberately not used.
ALTER TABLE halo_member_notification_preferences
  ADD COLUMN IF NOT EXISTS discoverer_in_app BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS halo_release_milestones (
  release_id TEXT PRIMARY KEY REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES halo_radio_tracks(id) ON DELETE SET NULL,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS halo_release_discoverers (
  release_id TEXT NOT NULL REFERENCES halo_release_milestones(release_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  discoverer_rank INTEGER NOT NULL CHECK (discoverer_rank BETWEEN 1 AND 20),
  supported_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  PRIMARY KEY (release_id, member_id),
  UNIQUE (release_id, discoverer_rank)
);

CREATE INDEX IF NOT EXISTS halo_release_discoverers_member_idx
  ON halo_release_discoverers(member_id, notified_at DESC);

CREATE TABLE IF NOT EXISTS halo_discoverer_request_limits (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 30)
);

CREATE OR REPLACE FUNCTION halo_capture_rotation_milestone() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  captured_release TEXT;
  crossing_time TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF OLD.status = 'rotation' OR NEW.status <> 'rotation'
    OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_member_id IS NULL
    OR NEW.release_id IS NULL OR NOT NEW.rights_confirmed THEN
    RETURN NEW;
  END IF;

  -- The unique release key serializes competing promotions. The winning event
  -- and all private in-app cards commit together, or all roll back.
  INSERT INTO halo_release_milestones (release_id, track_id, reached_at)
  SELECT release.id, NEW.id, crossing_time
  FROM halo_release_campaigns release
  WHERE release.id = NEW.release_id AND release.status IN ('passed', 'published')
  ON CONFLICT (release_id) DO NOTHING
  RETURNING release_id INTO captured_release;

  IF captured_release IS NULL THEN RETURN NEW; END IF;

  INSERT INTO halo_release_discoverers (
    release_id, member_id, discoverer_rank, supported_at, notified_at
  )
  SELECT captured_release, early.member_id,
    row_number() OVER (ORDER BY early.updated_at, early.member_id COLLATE "C"),
    early.updated_at,
    CASE WHEN preference.discoverer_in_app THEN crossing_time ELSE NULL END
  FROM (
    SELECT vote.member_id, vote.updated_at
    FROM halo_radio_votes vote
    JOIN halo_memberships member ON member.member_id = vote.member_id
    JOIN halo_release_campaigns release ON release.id = captured_release
    LEFT JOIN halo_artist_pages page ON page.slug = release.artist_slug
    WHERE vote.track_id = NEW.id AND vote.vote = 1
      AND vote.updated_at <= crossing_time
      AND vote.member_id <> NEW.member_id
      AND vote.member_id IS DISTINCT FROM release.owner_member_id
      AND vote.member_id IS DISTINCT FROM page.owner_member_id
    -- updated_at is the existing vote's last expression of support, not its
    -- creation (which could have been a downvote). Do not invent historical votes.
    ORDER BY vote.updated_at, vote.member_id COLLATE "C"
    LIMIT 20
  ) early
  LEFT JOIN halo_member_notification_preferences preference ON preference.member_id = early.member_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS halo_rotation_milestone ON halo_radio_tracks;
CREATE TRIGGER halo_rotation_milestone
  AFTER UPDATE OF status ON halo_radio_tracks
  FOR EACH ROW EXECUTE FUNCTION halo_capture_rotation_milestone();
