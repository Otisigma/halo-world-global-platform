-- Separate opt-in for anonymous listening completion alerts to HALO operations.
ALTER TABLE halo_listening_preferences
  ADD COLUMN IF NOT EXISTS stream_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE halo_listening_sessions
  ADD COLUMN IF NOT EXISTS owner_alerted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION halo_set_stream_alert_consent(p_member TEXT, p_enabled BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  preference halo_listening_preferences%ROWTYPE;
BEGIN
  SELECT * INTO preference
    FROM halo_listening_preferences
    WHERE member_id = p_member
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'analytics_required'; END IF;
  IF p_enabled AND (NOT preference.enabled OR preference.consent_at IS NULL) THEN
    RETURN 'analytics_required';
  END IF;
  UPDATE halo_listening_preferences
    SET stream_alerts_enabled = p_enabled
    WHERE member_id = p_member;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION halo_ingest_listening(
  p_member TEXT, p_action TEXT, p_release TEXT, p_receipt UUID, p_enabled BOOLEAN
) RETURNS TABLE(receipt UUID, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  preference halo_listening_preferences%ROWTYPE;
  listening halo_listening_sessions%ROWTYPE;
BEGIN
  INSERT INTO halo_listening_preferences(member_id) VALUES (p_member) ON CONFLICT DO NOTHING;
  SELECT * INTO preference FROM halo_listening_preferences WHERE member_id = p_member FOR UPDATE;

  IF preference.window_start > NOW() - INTERVAL '1 minute' AND preference.attempts >= 60
    AND NOT (p_action = 'consent' AND p_enabled = FALSE AND (preference.enabled OR preference.stream_alerts_enabled)) THEN
    RETURN QUERY SELECT NULL::uuid, 'rate_limited'::text;
    RETURN;
  END IF;
  UPDATE halo_listening_preferences SET
    attempts = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN 1 ELSE attempts + 1 END,
    window_start = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN NOW() ELSE window_start END
    WHERE member_id = p_member;

  IF p_action = 'consent' AND p_enabled = FALSE THEN
    UPDATE halo_listening_preferences
      SET enabled = FALSE, consent_at = NULL, stream_alerts_enabled = FALSE
      WHERE member_id = p_member;
    DELETE FROM halo_listening_sessions WHERE member_id = p_member;
    RETURN QUERY SELECT NULL::uuid, 'ok'::text;
    RETURN;
  END IF;
  IF p_action <> 'consent'
    AND ((NOT preference.enabled OR preference.consent_at IS NULL) AND NOT preference.stream_alerts_enabled) THEN
    RETURN QUERY SELECT NULL::uuid, 'consent_required'::text;
    RETURN;
  END IF;
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
      INSERT INTO halo_listening_sessions(member_id, release_id)
        VALUES (p_member, p_release) RETURNING * INTO listening;
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
    UPDATE halo_listening_sessions SET outcome = p_action
      WHERE id = listening.id AND outcome IS NULL;
  ELSE
    RETURN QUERY SELECT NULL::uuid, 'unavailable'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT listening.id, 'ok'::text;
END;
$$;

CREATE OR REPLACE FUNCTION halo_claim_listening_owner_alert(p_member TEXT, p_receipt UUID)
RETURNS TABLE(owner_member_id TEXT, title TEXT, artist TEXT) LANGUAGE sql AS $$
  UPDATE halo_listening_sessions s
  SET owner_alerted_at = NOW()
  FROM halo_listening_preferences preference, halo_release_campaigns release
  WHERE s.id = p_receipt
    AND s.member_id = p_member
    AND s.outcome = 'listen_complete'
    AND s.owner_alerted_at IS NULL
    AND preference.member_id = s.member_id
    AND preference.stream_alerts_enabled = TRUE
    AND s.started_at > NOW() - INTERVAL '4 hours'
    AND release.id = s.release_id
    AND release.status = 'published'
    AND COALESCE(release.visibility, 'public') = 'public'
    AND release.owner_member_id IS NOT NULL
  RETURNING release.owner_member_id, release.title, release.artist;
$$;
