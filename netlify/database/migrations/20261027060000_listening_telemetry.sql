-- Optional, authenticated listening reports, separate from legacy anonymous stats.
CREATE TABLE IF NOT EXISTS halo_listening_preferences (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS halo_listening_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  outcome TEXT CHECK (outcome IN ('listen_complete', 'listen_abandon')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_listening_sessions_member_idx
  ON halo_listening_sessions(member_id, started_at DESC);
CREATE INDEX IF NOT EXISTS halo_listening_sessions_retention_idx
  ON halo_listening_sessions(started_at);

-- A member-row lock serializes consent revocation, retries and quotas across instances.
-- Server timestamps are for expiry only; no positions, durations, URLs or terminal timestamps.
CREATE OR REPLACE FUNCTION halo_ingest_listening(
  p_member TEXT, p_action TEXT, p_release TEXT, p_receipt UUID, p_enabled BOOLEAN
) RETURNS TABLE(receipt UUID, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  preference halo_listening_preferences%ROWTYPE;
  listening halo_listening_sessions%ROWTYPE;
BEGIN
  INSERT INTO halo_listening_preferences(member_id) VALUES (p_member) ON CONFLICT DO NOTHING;
  SELECT * INTO preference FROM halo_listening_preferences WHERE member_id = p_member FOR UPDATE;

  IF p_action = 'consent' AND p_enabled = FALSE THEN
    UPDATE halo_listening_preferences SET enabled = FALSE, consent_at = NULL WHERE member_id = p_member;
    DELETE FROM halo_listening_sessions WHERE member_id = p_member;
    RETURN QUERY SELECT NULL::uuid, 'ok'::text;
    RETURN;
  END IF;
  IF p_action <> 'consent' AND (NOT preference.enabled OR preference.consent_at IS NULL) THEN
    RETURN QUERY SELECT NULL::uuid, 'consent_required'::text;
    RETURN;
  END IF;
  IF preference.window_start > NOW() - INTERVAL '1 minute' AND preference.attempts >= 60 THEN
    RETURN QUERY SELECT NULL::uuid, 'rate_limited'::text;
    RETURN;
  END IF;
  UPDATE halo_listening_preferences SET
    attempts = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN 1 ELSE attempts + 1 END,
    window_start = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN NOW() ELSE window_start END
    WHERE member_id = p_member;

  IF p_action = 'consent' AND p_enabled = TRUE THEN
    UPDATE halo_listening_preferences SET enabled = TRUE, consent_at = COALESCE(consent_at, NOW())
      WHERE member_id = p_member;
    RETURN QUERY SELECT NULL::uuid, 'ok'::text;
    RETURN;
  END IF;
  IF p_action = 'listen_start' THEN
    IF NOT EXISTS (SELECT 1 FROM halo_release_campaigns
      WHERE id = p_release AND status = 'published' AND COALESCE(visibility, 'public') = 'public') THEN
      RETURN QUERY SELECT NULL::uuid, 'unavailable'::text;
      RETURN;
    END IF;
    -- Lost responses/retries share a server receipt, not a caller-chosen event ID.
    SELECT * INTO listening FROM halo_listening_sessions
      WHERE member_id = p_member AND release_id = p_release AND outcome IS NULL
        AND started_at > NOW() - INTERVAL '4 hours'
      ORDER BY started_at DESC LIMIT 1;
    IF NOT FOUND THEN
      IF (SELECT COUNT(*) FROM halo_listening_sessions
        WHERE member_id = p_member AND started_at > NOW() - INTERVAL '1 day') >= 200 THEN
        RETURN QUERY SELECT NULL::uuid, 'rate_limited'::text;
        RETURN;
      END IF;
      INSERT INTO halo_listening_sessions(member_id, release_id) VALUES (p_member, p_release) RETURNING * INTO listening;
    END IF;
  ELSIF p_action IN ('listen_complete', 'listen_abandon') THEN
    SELECT s.* INTO listening FROM halo_listening_sessions s
      JOIN halo_release_campaigns r ON r.id = s.release_id
      WHERE s.id = p_receipt AND s.member_id = p_member
        AND s.started_at > NOW() - INTERVAL '4 hours'
        AND r.status = 'published' AND COALESCE(r.visibility, 'public') = 'public';
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, 'unavailable'::text;
      RETURN;
    END IF;
    -- First terminal report wins; retrying or sending a conflicting outcome cannot double count.
    UPDATE halo_listening_sessions SET outcome = p_action WHERE id = listening.id AND outcome IS NULL;
  ELSE
    RETURN QUERY SELECT NULL::uuid, 'unavailable'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT listening.id, 'ok'::text;
END;
$$;
