-- Release-consideration polls: an opt-in, advisory Campaign Studio purpose where signed-in members
-- who have earned the Insider reward tier recommend which eligible catalog song the artist team
-- should consider next. A result never publishes, distributes, or changes catalog/publication state.
-- Existing listening-party campaigns keep their default purpose and open (member + device) voting.

ALTER TABLE halo_fan_vote_campaigns
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'listening_party',
  ADD COLUMN IF NOT EXISTS voter_min_reward_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommendation JSONB,
  ADD COLUMN IF NOT EXISTS recommendation_recorded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'halo_fan_vote_campaigns_purpose_check') THEN
    ALTER TABLE halo_fan_vote_campaigns ADD CONSTRAINT halo_fan_vote_campaigns_purpose_check
      CHECK (purpose IN ('listening_party', 'release_consideration'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'halo_fan_vote_campaigns_voter_min_points_check') THEN
    ALTER TABLE halo_fan_vote_campaigns ADD CONSTRAINT halo_fan_vote_campaigns_voter_min_points_check
      CHECK (voter_min_reward_points BETWEEN 0 AND 100000
        AND (purpose <> 'release_consideration' OR voter_min_reward_points >= 100));
  END IF;
END $$;

-- Release candidates snapshot the authorized catalog song they were checked against.
ALTER TABLE halo_fan_vote_campaign_tracks
  ADD COLUMN IF NOT EXISTS source_song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL;

-- Member votes already use voter_key = 'member:<id>'; this makes one current choice per member explicit.
CREATE UNIQUE INDEX IF NOT EXISTS halo_fan_vote_campaign_votes_member_unique_idx
  ON halo_fan_vote_campaign_votes(campaign_id, member_id)
  WHERE member_id IS NOT NULL;

-- Append-only audit of release-poll vote submissions (current choice lives in the votes table).
CREATE TABLE IF NOT EXISTS halo_fan_release_poll_vote_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES halo_fan_vote_campaigns(id) ON DELETE CASCADE,
  campaign_track_id BIGINT NOT NULL REFERENCES halo_fan_vote_campaign_tracks(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  reward_tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(reward_tier) BETWEEN 1 AND 40)
);

CREATE INDEX IF NOT EXISTS halo_fan_release_poll_vote_events_member_idx
  ON halo_fan_release_poll_vote_events(campaign_id, member_id, created_at DESC);

-- Database guard: release-poll votes must come from an opted-in member at or above the poll threshold,
-- inside the published vote window. Device-token voter keys can never qualify.
CREATE OR REPLACE FUNCTION halo_fan_release_poll_vote_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_campaign RECORD;
  v_points BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM halo_fan_vote_campaigns
    WHERE id = NEW.campaign_id AND purpose = 'release_consideration'
  ) THEN
    RETURN NEW;
  END IF;
  -- Share-lock the poll so a concurrent close waits for in-flight votes and later votes see it closed.
  SELECT purpose, status, starts_at, ends_at, voter_min_reward_points
  INTO v_campaign
  FROM halo_fan_vote_campaigns
  WHERE id = NEW.campaign_id
  FOR SHARE;
  IF NEW.member_id IS NULL OR NEW.voter_key <> 'member:' || NEW.member_id THEN
    RAISE EXCEPTION 'release_poll_member_required';
  END IF;
  IF v_campaign.status <> 'published' OR v_campaign.starts_at > NOW() OR v_campaign.ends_at <= NOW() THEN
    RAISE EXCEPTION 'release_poll_closed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM halo_member_notification_preferences
    WHERE member_id = NEW.member_id AND rewards_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'release_poll_rewards_required';
  END IF;
  SELECT COALESCE(SUM(points), 0) INTO v_points
  FROM halo_member_reward_events
  WHERE member_id = NEW.member_id;
  IF v_points < GREATEST(v_campaign.voter_min_reward_points, 100) THEN
    RAISE EXCEPTION 'release_poll_rank_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS halo_fan_release_poll_vote_guard ON halo_fan_vote_campaign_votes;
CREATE TRIGGER halo_fan_release_poll_vote_guard
  BEFORE INSERT OR UPDATE ON halo_fan_vote_campaign_votes
  FOR EACH ROW EXECUTE FUNCTION halo_fan_release_poll_vote_guard();

-- Database guard: a release poll's shortlist is locked once it leaves draft.
CREATE OR REPLACE FUNCTION halo_fan_release_poll_candidate_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM halo_fan_vote_campaigns
    WHERE id = NEW.campaign_id AND purpose = 'release_consideration' AND status <> 'draft'
  ) OR (TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM halo_fan_vote_campaigns
    WHERE id = OLD.campaign_id AND purpose = 'release_consideration' AND status <> 'draft'
  )) THEN
    RAISE EXCEPTION 'release_poll_candidates_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS halo_fan_release_poll_candidate_guard ON halo_fan_vote_campaign_tracks;
CREATE TRIGGER halo_fan_release_poll_candidate_guard
  BEFORE INSERT OR UPDATE OF campaign_id, title, artist_name, position ON halo_fan_vote_campaign_tracks
  FOR EACH ROW EXECUTE FUNCTION halo_fan_release_poll_candidate_guard();

-- Database guard: poll purpose and threshold are fixed at creation, and a closed release poll stays closed.
CREATE OR REPLACE FUNCTION halo_fan_release_poll_campaign_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.voter_min_reward_points IS DISTINCT FROM OLD.voter_min_reward_points THEN
    RAISE EXCEPTION 'campaign_purpose_locked';
  END IF;
  IF OLD.purpose = 'release_consideration' AND OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'release_poll_closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS halo_fan_release_poll_campaign_guard ON halo_fan_vote_campaigns;
CREATE TRIGGER halo_fan_release_poll_campaign_guard
  BEFORE UPDATE ON halo_fan_vote_campaigns
  FOR EACH ROW EXECUTE FUNCTION halo_fan_release_poll_campaign_guard();
