-- Private listening collections reference public releases; no recording rights are granted.
CREATE TABLE IF NOT EXISTS halo_fan_curations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  release_ids TEXT[] NOT NULL CHECK (cardinality(release_ids) BETWEEN 3 AND 12),
  release_set TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, release_set)
);

CREATE INDEX IF NOT EXISTS halo_fan_curations_member_created_idx
  ON halo_fan_curations(member_id, created_at DESC);

-- Spending is separate from lifetime earned points, so existing reward tiers stay stable.
CREATE TABLE IF NOT EXISTS halo_fan_reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  curation_id UUID NOT NULL REFERENCES halo_fan_curations(id),
  reward_id TEXT NOT NULL CHECK (reward_id = 'listening-card'),
  points INTEGER NOT NULL CHECK (points = 25),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, curation_id, reward_id)
);

CREATE OR REPLACE FUNCTION halo_save_fan_curation(
  p_member TEXT, p_title TEXT, p_releases TEXT[]
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_set TEXT[];
  v_id UUID;
  v_enabled BOOLEAN;
  v_count INTEGER;
  v_granted INTEGER := 0;
  v_day TEXT := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  IF p_title IS NULL OR char_length(trim(p_title)) NOT BETWEEN 1 AND 120
    OR p_releases IS NULL OR cardinality(p_releases) NOT BETWEEN 3 AND 12
    OR array_ndims(p_releases) <> 1
    OR EXISTS (SELECT 1 FROM unnest(p_releases) id
      WHERE id IS NULL OR id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(id) NOT BETWEEN 2 AND 96) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_set FROM unnest(p_releases) id;
  IF cardinality(v_set) <> cardinality(p_releases) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  INSERT INTO halo_member_notification_preferences(member_id) VALUES (p_member)
    ON CONFLICT (member_id) DO NOTHING;
  -- All saves and debits lock this same member row, including preference updates.
  SELECT rewards_enabled INTO v_enabled FROM halo_member_notification_preferences
    WHERE member_id = p_member FOR UPDATE;

  SELECT id INTO v_id FROM halo_fan_curations WHERE member_id = p_member AND release_set = v_set;
  IF FOUND THEN
    RETURN jsonb_build_object('result', 'duplicate', 'id', v_id, 'rewardGranted', FALSE);
  END IF;
  IF (SELECT COUNT(*) FROM halo_fan_curations WHERE member_id = p_member) >= 50
    OR (SELECT COUNT(*) FROM halo_fan_curations WHERE member_id = p_member
      AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') >= 10 THEN
    RETURN jsonb_build_object('result', 'limit');
  END IF;

  PERFORM id FROM halo_release_campaigns
    WHERE id = ANY(v_set) AND status = 'published' AND visibility = 'public'
    ORDER BY id FOR SHARE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(v_set) THEN
    RETURN jsonb_build_object('result', 'unavailable');
  END IF;

  INSERT INTO halo_fan_curations(member_id, title, release_ids, release_set)
    VALUES (p_member, trim(p_title), p_releases, v_set) RETURNING id INTO v_id;
  IF v_enabled THEN
    INSERT INTO halo_member_reward_events(member_id, reward_key, points, reason)
      VALUES (p_member, 'fan-curation:' || v_day, 25, 'Saved a new public-release listening curation')
      ON CONFLICT (member_id, reward_key) DO NOTHING;
    GET DIAGNOSTICS v_granted = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('result', 'saved', 'id', v_id, 'rewardGranted', v_granted = 1);
END;
$$;

CREATE OR REPLACE FUNCTION halo_redeem_fan_card(p_member TEXT, p_curation UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_enabled BOOLEAN;
  v_releases TEXT[];
  v_id UUID;
  v_earned BIGINT;
  v_spent BIGINT;
  v_count INTEGER;
BEGIN
  SELECT rewards_enabled INTO v_enabled FROM halo_member_notification_preferences
    WHERE member_id = p_member FOR UPDATE;
  IF NOT FOUND OR NOT v_enabled THEN
    RETURN jsonb_build_object('result', 'rewards_disabled');
  END IF;
  SELECT release_ids INTO v_releases FROM halo_fan_curations
    WHERE id = p_curation AND member_id = p_member;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;

  PERFORM id FROM halo_release_campaigns
    WHERE id = ANY(v_releases) AND status = 'published' AND visibility = 'public'
    ORDER BY id FOR SHARE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(v_releases) THEN
    RETURN jsonb_build_object('result', 'unavailable');
  END IF;
  SELECT id INTO v_id FROM halo_fan_reward_redemptions
    WHERE member_id = p_member AND curation_id = p_curation AND reward_id = 'listening-card';
  IF FOUND THEN RETURN jsonb_build_object('result', 'already_claimed', 'id', v_id); END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_earned FROM halo_member_reward_events WHERE member_id = p_member;
  SELECT COALESCE(SUM(points), 0) INTO v_spent FROM halo_fan_reward_redemptions WHERE member_id = p_member;
  IF v_earned - v_spent < 25 THEN RETURN jsonb_build_object('result', 'insufficient_points'); END IF;
  INSERT INTO halo_fan_reward_redemptions(member_id, curation_id, reward_id, points)
    VALUES (p_member, p_curation, 'listening-card', 25) RETURNING id INTO v_id;
  RETURN jsonb_build_object('result', 'claimed', 'id', v_id);
END;
$$;
