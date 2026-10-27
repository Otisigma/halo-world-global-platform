-- Run against a disposable PostgreSQL database; all fixture objects are rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA listening_telemetry_contract;
SET LOCAL search_path TO listening_telemetry_contract, public;
CREATE TABLE halo_memberships (member_id TEXT PRIMARY KEY);
CREATE TABLE halo_release_campaigns (
  id TEXT PRIMARY KEY, status TEXT, visibility TEXT, owner_member_id TEXT
);
\ir ../netlify/database/migrations/20261027060000_listening_telemetry.sql
\ir ../netlify/database/migrations/20261027060000_listening_telemetry.sql
INSERT INTO halo_memberships VALUES ('fan'), ('other'), ('daily-limit');
INSERT INTO halo_release_campaigns VALUES
  ('published', 'published', 'public', 'artist'), ('private', 'published', 'private', 'artist'),
  ('draft', 'draft', 'public', 'artist');

DO $$
DECLARE
  first_receipt UUID;
  other_receipt UUID;
BEGIN
  ASSERT (SELECT result = 'consent_required' FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL));
  ASSERT (SELECT COUNT(*) = 0 FROM halo_listening_sessions);
  PERFORM * FROM halo_ingest_listening('fan', 'consent', NULL, NULL, TRUE);
  PERFORM * FROM halo_ingest_listening('other', 'consent', NULL, NULL, TRUE);
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('fan', 'listen_start', 'private', NULL, NULL));
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('fan', 'listen_start', 'draft', NULL, NULL));
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('fan', 'listen_start', '''; DROP TABLE halo_memberships;--', NULL, NULL));
  SELECT receipt INTO first_receipt FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL);
  ASSERT first_receipt IS NOT NULL;
  ASSERT (SELECT receipt = first_receipt FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL));
  ASSERT (SELECT COUNT(*) = 1 FROM halo_listening_sessions);
  ASSERT (SELECT member_id = 'fan' AND started_at = NOW() FROM halo_listening_sessions WHERE id = first_receipt);
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('other', 'listen_complete', NULL, first_receipt, NULL));
  PERFORM * FROM halo_ingest_listening('fan', 'listen_complete', NULL, first_receipt, NULL);
  PERFORM * FROM halo_ingest_listening('fan', 'listen_complete', NULL, first_receipt, NULL);
  PERFORM * FROM halo_ingest_listening('fan', 'listen_abandon', NULL, first_receipt, NULL);
  ASSERT (SELECT outcome = 'listen_complete' FROM halo_listening_sessions WHERE id = first_receipt);
  SELECT receipt INTO other_receipt FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL);
  ASSERT other_receipt <> first_receipt;
  UPDATE halo_listening_sessions SET started_at = NOW() - INTERVAL '5 hours' WHERE id = other_receipt;
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('fan', 'listen_complete', NULL, other_receipt, NULL));
  UPDATE halo_release_campaigns SET visibility = 'private' WHERE id = 'published';
  ASSERT (SELECT result = 'unavailable' FROM halo_ingest_listening('fan', 'listen_complete', NULL, first_receipt, NULL));
  UPDATE halo_release_campaigns SET visibility = 'public' WHERE id = 'published';
  UPDATE halo_listening_preferences SET attempts = 59, window_start = NOW() WHERE member_id = 'fan';
  ASSERT (SELECT result = 'ok' FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL));
  ASSERT (SELECT result = 'rate_limited' FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL));
  PERFORM * FROM halo_ingest_listening('fan', 'consent', NULL, NULL, FALSE);
  ASSERT (SELECT COUNT(*) = 0 FROM halo_listening_sessions WHERE member_id = 'fan');
  ASSERT (SELECT enabled = FALSE AND consent_at IS NULL FROM halo_listening_preferences WHERE member_id = 'fan');
  ASSERT (SELECT result = 'consent_required' FROM halo_ingest_listening('fan', 'listen_start', 'published', NULL, NULL));
  UPDATE halo_listening_preferences SET window_start = NOW() - INTERVAL '2 minutes' WHERE member_id = 'fan';
  ASSERT (SELECT result = 'ok' FROM halo_ingest_listening('fan', 'consent', NULL, NULL, TRUE));
  ASSERT (SELECT attempts = 1 FROM halo_listening_preferences WHERE member_id = 'fan');
  PERFORM * FROM halo_ingest_listening('daily-limit', 'consent', NULL, NULL, TRUE);
  INSERT INTO halo_listening_sessions(member_id, release_id, outcome)
    SELECT 'daily-limit', 'published', 'listen_complete' FROM generate_series(1, 200);
  ASSERT (SELECT result = 'rate_limited' FROM halo_ingest_listening('daily-limit', 'listen_start', 'published', NULL, NULL));
  INSERT INTO halo_listening_sessions(member_id, release_id, started_at)
    VALUES ('other', 'published', NOW() - INTERVAL '31 days');
  DELETE FROM halo_listening_sessions WHERE started_at < NOW() - INTERVAL '30 days';
  ASSERT (SELECT COUNT(*) = 0 FROM halo_listening_sessions WHERE member_id = 'other');
  DELETE FROM halo_memberships WHERE member_id = 'daily-limit';
  ASSERT (SELECT COUNT(*) = 0 FROM halo_listening_sessions WHERE member_id = 'daily-limit');
END;
$$;
ROLLBACK;
\echo 'Listening telemetry SQL contracts passed'
