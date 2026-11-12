-- Additive playlist storage. Apply only through the reviewed database migration process.
CREATE TABLE IF NOT EXISTS halo_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 120),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  release_ids TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(release_ids) <= 100),
  world JSONB NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  share_hash TEXT UNIQUE,
  room JSONB,
  room_revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_member_id, source_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS halo_playlists_owner_name_idx ON halo_playlists(owner_member_id, lower(name));
CREATE INDEX IF NOT EXISTS halo_playlists_owner_updated_idx ON halo_playlists(owner_member_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS halo_playlist_members (
  playlist_id UUID NOT NULL REFERENCES halo_playlists(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'contributor')),
  PRIMARY KEY (playlist_id, member_id)
);
CREATE TABLE IF NOT EXISTS halo_playlist_invites (
  token_hash TEXT PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES halo_playlists(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'contributor')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  used_by TEXT REFERENCES halo_memberships(member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS halo_playlist_members_member_idx ON halo_playlist_members(member_id, playlist_id);
CREATE INDEX IF NOT EXISTS halo_playlist_invites_playlist_idx ON halo_playlist_invites(playlist_id, expires_at);
CREATE TABLE IF NOT EXISTS halo_playlist_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES halo_playlists(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (playlist_id, release_id)
);
CREATE TABLE IF NOT EXISTS halo_playlist_votes (
  suggestion_id UUID NOT NULL REFERENCES halo_playlist_suggestions(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  PRIMARY KEY (suggestion_id, member_id)
);
CREATE TABLE IF NOT EXISTS halo_playlist_rate_limits (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION halo_playlist_mutate(p_member TEXT, p_action TEXT, p_input JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_playlist halo_playlists%ROWTYPE;
  v_role TEXT;
  v_id UUID;
  v_invite halo_playlist_invites%ROWTYPE;
  v_ids TEXT[];
  v_count INTEGER;
  v_artists INTEGER;
  v_points INTEGER := 0;
  v_enabled BOOLEAN;
  v_suggestion halo_playlist_suggestions%ROWTYPE;
BEGIN
  -- Serialize each member's mutations, including create limits and reward claims.
  PERFORM member_id FROM halo_memberships WHERE member_id = p_member FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
  INSERT INTO halo_playlist_rate_limits(member_id) VALUES (p_member)
    ON CONFLICT (member_id) DO UPDATE SET
      attempts = CASE WHEN halo_playlist_rate_limits.window_start < NOW() - INTERVAL '1 minute'
        THEN 1 ELSE halo_playlist_rate_limits.attempts + 1 END,
      window_start = CASE WHEN halo_playlist_rate_limits.window_start < NOW() - INTERVAL '1 minute'
        THEN NOW() ELSE halo_playlist_rate_limits.window_start END
    WHERE halo_playlist_rate_limits.attempts < 60 OR halo_playlist_rate_limits.window_start < NOW() - INTERVAL '1 minute';
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'rate_limit'); END IF;

  IF p_action = 'join' THEN
    -- Lock playlist before invite so owner revoke and concurrent claim use the same lock order.
    SELECT playlist_id INTO v_id FROM halo_playlist_invites WHERE token_hash = p_input->>'tokenHash';
    SELECT * INTO v_playlist FROM halo_playlists WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
    SELECT * INTO v_invite FROM halo_playlist_invites
      WHERE token_hash = p_input->>'tokenHash' AND expires_at > NOW() FOR UPDATE;
    IF NOT FOUND OR (v_invite.used_by IS NOT NULL AND v_invite.used_by <> p_member) THEN
      RETURN jsonb_build_object('result', 'not_found');
    END IF;
    IF v_playlist.owner_member_id = p_member THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
    IF (SELECT COUNT(*) FROM halo_playlist_members WHERE member_id = p_member) >= 20
      AND NOT EXISTS (SELECT 1 FROM halo_playlist_members WHERE playlist_id = v_playlist.id AND member_id = p_member) THEN
      RETURN jsonb_build_object('result', 'limit');
    END IF;
    IF (SELECT COUNT(*) FROM halo_playlist_members WHERE playlist_id = v_playlist.id) >= 20
      AND NOT EXISTS (SELECT 1 FROM halo_playlist_members WHERE playlist_id = v_playlist.id AND member_id = p_member) THEN
      RETURN jsonb_build_object('result', 'limit');
    END IF;
    INSERT INTO halo_playlist_members(playlist_id, member_id, role) VALUES (v_playlist.id, p_member, v_invite.role)
      ON CONFLICT (playlist_id, member_id) DO NOTHING;
    UPDATE halo_playlist_invites SET used_by = p_member WHERE token_hash = v_invite.token_hash;
    RETURN jsonb_build_object('result', 'joined', 'id', v_playlist.id);
  END IF;
  IF p_action = 'create' THEN
    SELECT * INTO v_playlist FROM halo_playlists
      WHERE owner_member_id = p_member AND source_id = p_input->>'sourceId';
    IF FOUND THEN RETURN jsonb_build_object('result', 'exists', 'id', v_playlist.id); END IF;
    IF (SELECT COUNT(*) FROM halo_playlists WHERE owner_member_id = p_member) >= 100 THEN
      RETURN jsonb_build_object('result', 'limit');
    END IF;
  ELSE
    SELECT * INTO v_playlist FROM halo_playlists WHERE id = (p_input->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
    v_role := CASE WHEN v_playlist.owner_member_id = p_member THEN 'owner' ELSE
      (SELECT role FROM halo_playlist_members WHERE playlist_id = v_playlist.id AND member_id = p_member) END;
    IF v_role IS NULL THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  END IF;

  IF p_action IN ('create', 'update') THEN
    IF p_action = 'update' AND v_role NOT IN ('owner', 'editor') THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
    IF p_action = 'update' AND v_playlist.revision <> (p_input->>'revision')::integer THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;
    SELECT COALESCE(array_agg(value ORDER BY ordinal), '{}') INTO v_ids
      FROM jsonb_array_elements_text(p_input->'releaseIds') WITH ORDINALITY items(value, ordinal);
    IF cardinality(v_ids) > 100 OR cardinality(v_ids) <> (SELECT COUNT(DISTINCT value) FROM unnest(v_ids) value)
      OR char_length(trim(p_input->>'name')) NOT BETWEEN 1 AND 80 THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
    -- Retaining an unavailable saved position is allowed; adding a private/nonexistent release is not.
    PERFORM id FROM halo_release_campaigns WHERE id = ANY(v_ids)
      AND status = 'published' AND visibility = 'public' ORDER BY id FOR SHARE;
    IF EXISTS (SELECT 1 FROM unnest(v_ids) item WHERE NOT (item = ANY(COALESCE(v_playlist.release_ids, '{}')))
      AND NOT EXISTS (SELECT 1 FROM halo_release_campaigns WHERE id = item AND status = 'published' AND visibility = 'public')) THEN
      RETURN jsonb_build_object('result', 'unavailable');
    END IF;
    IF EXISTS (SELECT 1 FROM halo_playlists WHERE owner_member_id = COALESCE(v_playlist.owner_member_id, p_member)
      AND lower(name) = lower(trim(p_input->>'name')) AND id IS DISTINCT FROM v_playlist.id) THEN
      RETURN jsonb_build_object('result', 'name_exists');
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO halo_playlists(owner_member_id, source_id, name, release_ids, world)
        VALUES (p_member, p_input->>'sourceId', trim(p_input->>'name'), v_ids, p_input->'world') RETURNING id INTO v_id;
    ELSE
      UPDATE halo_playlists SET name = trim(p_input->>'name'), release_ids = v_ids, world = p_input->'world',
        revision = revision + 1, updated_at = NOW(),
        room = CASE WHEN (room->>'releaseId') = ANY(v_ids) THEN room ELSE NULL END
        WHERE id = v_playlist.id RETURNING id INTO v_id;
    END IF;
    RETURN jsonb_build_object('result', 'saved', 'id', v_id);
  ELSIF p_action = 'leave' THEN
    IF v_role = 'owner' THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
    DELETE FROM halo_playlist_members WHERE playlist_id = v_playlist.id AND member_id = p_member;
    DELETE FROM halo_playlist_votes WHERE member_id = p_member AND suggestion_id IN
      (SELECT id FROM halo_playlist_suggestions WHERE playlist_id = v_playlist.id);
    RETURN jsonb_build_object('result', 'left', 'id', v_playlist.id);
  ELSIF p_action IN ('delete', 'share', 'invite', 'revoke', 'room', 'reward') THEN
    IF v_role <> 'owner' THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
    IF p_action = 'delete' THEN
      DELETE FROM halo_playlists WHERE id = v_playlist.id;
      RETURN jsonb_build_object('result', 'deleted', 'id', v_playlist.id);
    ELSIF p_action = 'share' THEN
      UPDATE halo_playlists SET share_hash = p_input->>'tokenHash' WHERE id = v_playlist.id;
      RETURN jsonb_build_object('result', 'shared', 'id', v_playlist.id);
    ELSIF p_action = 'invite' THEN
      DELETE FROM halo_playlist_invites WHERE playlist_id = v_playlist.id AND (expires_at < NOW() OR used_by IS NOT NULL);
      IF (SELECT COUNT(*) FROM halo_playlist_invites WHERE playlist_id = v_playlist.id) >= 20 THEN
        RETURN jsonb_build_object('result', 'limit');
      END IF;
      INSERT INTO halo_playlist_invites(token_hash, playlist_id, role)
        VALUES (p_input->>'tokenHash', v_playlist.id, p_input->>'role');
      RETURN jsonb_build_object('result', 'invited', 'id', v_playlist.id);
    ELSIF p_action = 'revoke' THEN
      DELETE FROM halo_playlist_invites WHERE playlist_id = v_playlist.id;
      DELETE FROM halo_playlist_members WHERE playlist_id = v_playlist.id AND member_id = p_input->>'memberId';
      DELETE FROM halo_playlist_votes WHERE member_id = p_input->>'memberId' AND suggestion_id IN
        (SELECT id FROM halo_playlist_suggestions WHERE playlist_id = v_playlist.id);
      RETURN jsonb_build_object('result', 'revoked', 'id', v_playlist.id);
    ELSIF p_action = 'room' THEN
      IF p_input->'state' = 'null'::jsonb THEN
        UPDATE halo_playlists SET room = NULL, room_revision = room_revision + 1 WHERE id = v_playlist.id;
      ELSE
        IF NOT ((p_input->'state'->>'releaseId') = ANY(v_playlist.release_ids)) OR NOT EXISTS
          (SELECT 1 FROM halo_release_campaigns WHERE id = p_input->'state'->>'releaseId' AND status = 'published' AND visibility = 'public') THEN
          RETURN jsonb_build_object('result', 'unavailable');
        END IF;
        UPDATE halo_playlists SET room = (p_input->'state') || jsonb_build_object('at', NOW()),
          room_revision = room_revision + 1 WHERE id = v_playlist.id;
      END IF;
      RETURN jsonb_build_object('result', 'room_updated', 'id', v_playlist.id);
    ELSE
      SELECT rewards_enabled INTO v_enabled FROM halo_member_notification_preferences WHERE member_id = p_member FOR UPDATE;
      IF NOT FOUND OR NOT v_enabled THEN RETURN jsonb_build_object('result', 'rewards_disabled'); END IF;
      PERFORM id FROM halo_release_campaigns WHERE id = ANY(v_playlist.release_ids)
        AND status = 'published' AND visibility = 'public' ORDER BY id FOR SHARE;
      SELECT COUNT(*), COUNT(DISTINCT lower(trim(r.artist))) INTO v_count, v_artists
        FROM halo_release_campaigns r WHERE r.id = ANY(v_playlist.release_ids) AND r.status = 'published' AND r.visibility = 'public'
        AND trim(r.artist) <> '' AND NOT EXISTS
          (SELECT 1 FROM halo_song_catalog s WHERE s.source_release_id = r.id AND s.owner_member_id = p_member);
      IF v_count < 5 OR v_artists < 3 THEN RETURN jsonb_build_object('result', 'milestone_required'); END IF;
      WITH grants AS (
        INSERT INTO halo_member_reward_events(member_id, reward_key, points, reason)
          SELECT p_member, 'playlist-curator:' || milestone.count, milestone.points, 'Curated public songs from at least three other artists'
          FROM (VALUES (5, 25), (10, 50)) milestone(count, points) WHERE v_count >= milestone.count
          ON CONFLICT (member_id, reward_key) DO NOTHING RETURNING points
      ) SELECT COALESCE(SUM(points), 0) INTO v_points FROM grants;
      RETURN jsonb_build_object('result', 'reward_checked', 'id', v_playlist.id, 'points', v_points);
    END IF;
  ELSIF p_action = 'suggest' THEN
    IF NOT EXISTS (SELECT 1 FROM halo_release_campaigns WHERE id = p_input->>'releaseId'
      AND status = 'published' AND visibility = 'public') THEN RETURN jsonb_build_object('result', 'unavailable'); END IF;
    IF (SELECT COUNT(*) FROM halo_playlist_suggestions WHERE playlist_id = v_playlist.id) >= 100 THEN
      RETURN jsonb_build_object('result', 'limit');
    END IF;
    INSERT INTO halo_playlist_suggestions(playlist_id, member_id, release_id)
      VALUES (v_playlist.id, p_member, p_input->>'releaseId') ON CONFLICT (playlist_id, release_id) DO NOTHING;
    RETURN jsonb_build_object('result', 'suggested', 'id', v_playlist.id);
  ELSIF p_action IN ('vote', 'moderate') THEN
    SELECT * INTO v_suggestion FROM halo_playlist_suggestions WHERE id = (p_input->>'suggestionId')::uuid
      AND playlist_id = v_playlist.id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
    IF p_action = 'vote' THEN
      INSERT INTO halo_playlist_votes(suggestion_id, member_id) VALUES (v_suggestion.id, p_member) ON CONFLICT DO NOTHING;
    ELSE
      IF v_role NOT IN ('owner', 'editor') THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
      IF (p_input->>'approve')::boolean AND NOT (v_suggestion.release_id = ANY(v_playlist.release_ids)) THEN
        IF cardinality(v_playlist.release_ids) >= 100 THEN RETURN jsonb_build_object('result', 'limit'); END IF;
        PERFORM id FROM halo_release_campaigns WHERE id = v_suggestion.release_id
          AND status = 'published' AND visibility = 'public' FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('result', 'unavailable'); END IF;
        UPDATE halo_playlists SET release_ids = array_append(release_ids, v_suggestion.release_id), revision = revision + 1,
          updated_at = NOW() WHERE id = v_playlist.id;
      END IF;
      UPDATE halo_playlist_suggestions SET status = CASE WHEN (p_input->>'approve')::boolean THEN 'approved' ELSE 'rejected' END
        WHERE id = v_suggestion.id;
    END IF;
    RETURN jsonb_build_object('result', 'suggestion_updated', 'id', v_playlist.id);
  END IF;
  RETURN jsonb_build_object('result', 'invalid');
END;
$$;
