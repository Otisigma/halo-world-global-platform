CREATE TABLE IF NOT EXISTS halo_master_campaigns (
  id UUID PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  source_fingerprint TEXT UNIQUE,
  version INTEGER NOT NULL CHECK (version > 0),
  aggregate JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_master_campaign_owner_idx ON halo_master_campaigns(owner_member_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS halo_master_campaign_versions (
  campaign_id UUID NOT NULL REFERENCES halo_master_campaigns(id),
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, version)
);
CREATE TABLE IF NOT EXISTS halo_campaign_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES halo_master_campaigns(id),
  version INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('signal','lobby','tiktok','instagram','youtube','twitter','facebook','discord','inbox')),
  recipient TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','sending','accepted','delivered','retry','failed','cancelled','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 5 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  external_started_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '{}',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, version, channel, recipient),
  FOREIGN KEY (campaign_id, version) REFERENCES halo_master_campaign_versions(campaign_id, version)
);
CREATE INDEX IF NOT EXISTS halo_campaign_outbox_due_idx ON halo_campaign_outbox(status, available_at);
CREATE TABLE IF NOT EXISTS halo_campaign_attempts (
  job_id UUID NOT NULL REFERENCES halo_campaign_outbox(id),
  attempt INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'leased',
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_id, attempt)
);
CREATE TABLE IF NOT EXISTS halo_campaign_preferences (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  purpose TEXT NOT NULL CHECK (purpose IN ('release_notes','halo_updates')),
  subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(member_id, purpose)
);
CREATE TABLE IF NOT EXISTS halo_campaign_preference_audit (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  purpose TEXT NOT NULL,
  subscribed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS halo_campaign_inbox (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL UNIQUE REFERENCES halo_campaign_outbox(id),
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  sender_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  purpose TEXT NOT NULL,
  output JSONB NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_campaign_inbox_member_idx ON halo_campaign_inbox(member_id, created_at DESC);
CREATE TABLE IF NOT EXISTS halo_campaign_receipts (
  job_id UUID PRIMARY KEY REFERENCES halo_campaign_outbox(id),
  nonce TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS halo_campaign_worker_budget (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed INTEGER NOT NULL DEFAULT 0
);
INSERT INTO halo_campaign_worker_budget(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS halo_campaign_api_limits (
  subject TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(subject,bucket)
);
CREATE OR REPLACE FUNCTION halo_campaign_api_rate(p_member TEXT, p_bucket TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s TEXT; cap INTEGER; allowed INTEGER;
BEGIN
  IF p_bucket NOT IN ('management','preferences') THEN RAISE EXCEPTION 'Invalid rate bucket'; END IF;
  -- Lock and update global before member consistently across concurrent requests.
  FOREACH s IN ARRAY ARRAY['global','member:' || p_member] LOOP
    cap := CASE WHEN s = 'global' THEN 2000 ELSE 60 END;
    INSERT INTO halo_campaign_api_limits(subject,bucket) VALUES(s,p_bucket)
      ON CONFLICT(subject,bucket) DO UPDATE SET
        attempts = CASE WHEN halo_campaign_api_limits.window_start < NOW() - INTERVAL '1 hour'
          THEN 1 ELSE halo_campaign_api_limits.attempts + 1 END,
        window_start = CASE WHEN halo_campaign_api_limits.window_start < NOW() - INTERVAL '1 hour'
          THEN NOW() ELSE halo_campaign_api_limits.window_start END
      WHERE halo_campaign_api_limits.attempts < cap OR halo_campaign_api_limits.window_start < NOW() - INTERVAL '1 hour'
      RETURNING attempts INTO allowed;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign API rate limit reached'; END IF;
  END LOOP;
END $$;

-- One database call is one transaction; never emulate transactions on pooled HTTP SQL connections.
CREATE OR REPLACE FUNCTION halo_campaign_create(p_owner TEXT, p_doc JSONB, p_fingerprint TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE existing JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('halo-master-campaign-create'));
  IF p_fingerprint IS NOT NULL THEN
    SELECT aggregate INTO existing FROM halo_master_campaigns WHERE source_fingerprint = p_fingerprint AND owner_member_id = p_owner;
    IF existing IS NOT NULL THEN RETURN existing; END IF;
  END IF;
  IF (SELECT COUNT(*) FROM halo_master_campaigns WHERE owner_member_id = p_owner) >= 500
    OR (SELECT COUNT(*) FROM halo_master_campaigns WHERE owner_member_id = p_owner AND created_at > NOW() - INTERVAL '1 day') >= 20
    OR (SELECT COUNT(*) FROM halo_master_campaigns WHERE created_at > NOW() - INTERVAL '1 day') >= 1000 THEN
    RAISE EXCEPTION 'Campaign creation limit reached';
  END IF;
  INSERT INTO halo_master_campaigns(id, owner_member_id, version, aggregate, source_fingerprint)
    VALUES((p_doc->>'id')::uuid, p_owner, 1, p_doc, p_fingerprint);
  INSERT INTO halo_master_campaign_versions(campaign_id, version, snapshot) VALUES((p_doc->>'id')::uuid, 1, p_doc);
  RETURN p_doc;
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_mutate(p_owner TEXT, p_id UUID, p_version INTEGER, p_action TEXT, p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE c halo_master_campaigns%ROWTYPE; doc JSONB; ch TEXT; n INTEGER; v_purpose TEXT;
  selected_channels JSONB; approved_channels JSONB; channel_approvals JSONB;
BEGIN
  SELECT * INTO c FROM halo_master_campaigns WHERE id = p_id AND owner_member_id = p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF c.version <> p_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  doc := c.aggregate;
  IF p_action IN ('revise','edit_output') THEN
    IF EXISTS(SELECT 1 FROM halo_campaign_outbox WHERE campaign_id = p_id AND status IN ('leased','sending')) THEN
      RAISE EXCEPTION 'Wait for in-flight work before revising';
    END IF;
    UPDATE halo_campaign_outbox SET status = 'cancelled', lease_token = NULL, lease_until = NULL
      WHERE campaign_id = p_id AND status IN ('pending','retry');
    doc := doc || p_patch || jsonb_build_object('version', c.version + 1, 'status','draft','approval',NULL,'updatedAt',NOW());
  ELSIF p_action = 'approve' THEN
    IF doc->>'status' = 'cancelled' THEN RAISE EXCEPTION 'Revise cancelled campaign before approval'; END IF;
    IF p_patch->>'rightsConfirmed' IS DISTINCT FROM 'true' OR p_patch->>'publicConsent' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Explicit rights and public consent required';
    END IF;
    selected_channels := COALESCE(p_patch->'channels',
      (SELECT jsonb_agg(key) FROM jsonb_object_keys(doc->'outputs') AS keys(key)));
    IF jsonb_array_length(selected_channels) < 1 THEN RAISE EXCEPTION 'Missing approved output'; END IF;
    channel_approvals := COALESCE(doc->'approval'->'channelApprovals','{}'::jsonb);
    FOR ch IN SELECT jsonb_array_elements_text(selected_channels) LOOP
      IF NOT (doc->'outputs' ? ch) THEN RAISE EXCEPTION 'Missing approved output'; END IF;
      IF EXISTS(SELECT 1 FROM halo_campaign_outbox WHERE campaign_id = p_id AND version = c.version AND channel = ch) THEN
        RAISE EXCEPTION 'Queued channel approval is immutable';
      END IF;
      channel_approvals := jsonb_set(channel_approvals,ARRAY[ch],jsonb_build_object(
        'version',c.version,'memberId',p_owner,'approvedAt',NOW(),'rightsConfirmed',TRUE,'publicConsent',TRUE,
        'overwritePin',ch = 'lobby' AND COALESCE(p_patch->>'overwritePin' = 'true',FALSE)),TRUE);
    END LOOP;
    SELECT jsonb_agg(value ORDER BY value) INTO approved_channels FROM
      (SELECT DISTINCT value FROM jsonb_array_elements_text(COALESCE(doc->'approval'->'channels','[]'::jsonb) || selected_channels)) AS approved;
    IF (SELECT COUNT(DISTINCT LOWER(BTRIM(doc->'outputs'->value->>'body'))) FROM jsonb_array_elements_text(approved_channels)) <> jsonb_array_length(approved_channels) THEN
      RAISE EXCEPTION 'Review distinct copy for each channel; duplicate variants cannot be approved';
    END IF;
    doc := doc || jsonb_build_object('status',CASE WHEN doc->>'status' = 'queued' THEN 'queued' ELSE 'approved' END,
      'approval',jsonb_build_object('version',c.version,'memberId',p_owner,'approvedAt',NOW(),
        'rightsConfirmed',TRUE,'publicConsent',TRUE,'channels',approved_channels,'channelApprovals',channel_approvals,
        'overwritePin',COALESCE((channel_approvals->'lobby'->>'overwritePin')::boolean,FALSE)));
  ELSIF p_action IN ('queue','retry') THEN
    IF doc->>'status' = 'cancelled' OR (doc->'approval'->>'version')::integer IS DISTINCT FROM c.version
      OR doc->'approval'->>'rightsConfirmed' IS DISTINCT FROM 'true'
      OR doc->'approval'->>'publicConsent' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Current version requires approval';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('halo-campaign-queue'));
    IF (SELECT COUNT(*) FROM halo_campaign_outbox WHERE status IN ('pending','retry','leased','sending')) >= 5000
      OR (SELECT COUNT(*) FROM halo_campaign_outbox WHERE created_at > NOW() - INTERVAL '1 day') >= 10000 THEN
      RAISE EXCEPTION 'Global campaign queue limit reached';
    END IF;
    IF p_action = 'retry' THEN
      -- Exhausted jobs require an explicit owner action; connector idempotency key remains unchanged.
      UPDATE halo_campaign_outbox SET status = 'retry', max_attempts = LEAST(20,attempts + 5), available_at = NOW(),
        lease_token = NULL, lease_until = NULL
        WHERE campaign_id = p_id AND version = c.version AND status = 'failed' AND attempts < 20
          AND (p_patch->>'deliveryId' IS NULL OR id = (p_patch->>'deliveryId')::uuid)
          AND COALESCE(doc->'approval'->'channels' ? channel,FALSE);
      IF NOT FOUND THEN RAISE EXCEPTION 'No retryable failed jobs; revise exhausted campaign'; END IF;
    ELSE
      FOR ch IN SELECT jsonb_array_elements_text(p_patch->'channels') LOOP
        IF NOT (doc->'outputs' ? ch) THEN RAISE EXCEPTION 'Missing approved output'; END IF;
        IF NOT COALESCE(doc->'approval'->'channels' ? ch,FALSE) THEN RAISE EXCEPTION 'Selected channel requires approval'; END IF;
        IF ch = 'inbox' THEN
          v_purpose := CASE WHEN doc->>'type' = 'halo_update' THEN 'halo_updates' ELSE 'release_notes' END;
          SELECT COUNT(*) INTO n FROM halo_campaign_preferences WHERE purpose = v_purpose AND subscribed
            AND (COALESCE(jsonb_array_length(p_patch->'recipientIds'),0) = 0
              OR member_id IN (SELECT jsonb_array_elements_text(p_patch->'recipientIds')));
          IF n > 500 THEN RAISE EXCEPTION 'Inbox fanout exceeds 500; split the audience operationally'; END IF;
          INSERT INTO halo_campaign_outbox(campaign_id,version,channel,recipient,payload)
            SELECT p_id,c.version,ch,p.member_id,doc->'outputs'->ch FROM halo_campaign_preferences p
            WHERE p.purpose = v_purpose AND p.subscribed
              AND (COALESCE(jsonb_array_length(p_patch->'recipientIds'),0) = 0
                OR p.member_id IN (SELECT jsonb_array_elements_text(p_patch->'recipientIds')))
              AND NOT EXISTS(SELECT 1 FROM halo_signal_blocks b WHERE
                (b.member_id = p_owner AND b.target_member_id = p.member_id)
                OR (b.member_id = p.member_id AND b.target_member_id = p_owner))
            ON CONFLICT DO NOTHING;
        ELSE
          INSERT INTO halo_campaign_outbox(campaign_id,version,channel,payload)
            VALUES(p_id,c.version,ch,doc->'outputs'->ch) ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
    IF (SELECT COUNT(*) FROM halo_campaign_outbox WHERE status IN ('pending','retry','leased','sending')) > 5000
      OR (SELECT COUNT(*) FROM halo_campaign_outbox WHERE created_at > NOW() - INTERVAL '1 day') > 10000 THEN
      RAISE EXCEPTION 'Global campaign queue limit reached';
    END IF;
    UPDATE halo_campaign_outbox SET available_at = GREATEST(available_at, (doc->'theme'->>'activeFrom')::timestamptz)
      WHERE campaign_id = p_id AND version = c.version AND status IN ('pending','retry')
        AND doc->'theme'->>'activeFrom' IS NOT NULL;
    doc := doc || jsonb_build_object('status','queued');
  ELSIF p_action = 'cancel' THEN
    doc := doc || jsonb_build_object('status','cancelled');
    UPDATE halo_campaign_outbox SET status = 'cancelled', lease_token = NULL, lease_until = NULL
      WHERE campaign_id = p_id AND status IN ('pending','retry','leased');
    UPDATE halo_campaign_attempts a SET status = 'cancelled',finished_at = NOW() FROM halo_campaign_outbox j
      WHERE a.job_id = j.id AND a.attempt = j.attempts AND j.campaign_id = p_id AND j.status = 'cancelled' AND a.finished_at IS NULL;
    -- Sending/accepted/delivered are intentionally retained: external acceptance cannot be undone.
  ELSE RAISE EXCEPTION 'Unknown campaign action';
  END IF;
  doc := doc || jsonb_build_object('updatedAt',NOW());
  UPDATE halo_master_campaigns SET aggregate = doc, version = (doc->>'version')::integer, updated_at = NOW() WHERE id = p_id;
  INSERT INTO halo_master_campaign_versions(campaign_id,version,snapshot)
    VALUES(p_id,(doc->>'version')::integer,doc)
    ON CONFLICT(campaign_id,version) DO UPDATE SET snapshot = EXCLUDED.snapshot;
  RETURN doc;
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_claim(p_limit INTEGER DEFAULT 10)
RETURNS SETOF halo_campaign_outbox LANGUAGE plpgsql AS $$
DECLARE budget halo_campaign_worker_budget%ROWTYPE; j halo_campaign_outbox%ROWTYPE; taken INTEGER := 0;
BEGIN
  SELECT * INTO budget FROM halo_campaign_worker_budget WHERE singleton FOR UPDATE;
  IF budget.window_start < NOW() - INTERVAL '1 minute' THEN
    UPDATE halo_campaign_worker_budget SET claimed = 0, window_start = NOW() WHERE singleton;
    budget.claimed := 0;
  END IF;
  FOR j IN SELECT * FROM halo_campaign_outbox
    WHERE ((status IN ('pending','retry') AND available_at <= NOW())
      OR (status IN ('leased','sending') AND lease_until < NOW())) AND attempts < max_attempts
    ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10,60-budget.claimed)
  LOOP
    UPDATE halo_campaign_outbox SET status = 'leased', attempts = attempts + 1,
      lease_token = gen_random_uuid(), lease_until = NOW() + INTERVAL '90 seconds'
      WHERE id = j.id RETURNING * INTO j;
    INSERT INTO halo_campaign_attempts(job_id,attempt) VALUES(j.id,j.attempts) ON CONFLICT DO NOTHING;
    taken := taken + 1;
    RETURN NEXT j;
  END LOOP;
  UPDATE halo_campaign_worker_budget SET claimed = claimed + taken WHERE singleton;
  UPDATE halo_campaign_outbox SET status = 'failed', last_error = 'Lease expired after final attempt'
    WHERE status IN ('leased','sending') AND lease_until < NOW() AND attempts >= max_attempts;
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_preference(p_member TEXT, p_purpose TEXT, p_subscribed BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO halo_campaign_preferences(member_id,purpose,subscribed) VALUES(p_member,p_purpose,p_subscribed)
    ON CONFLICT(member_id,purpose) DO UPDATE SET subscribed = EXCLUDED.subscribed, updated_at = NOW();
  INSERT INTO halo_campaign_preference_audit(member_id,purpose,subscribed) VALUES(p_member,p_purpose,p_subscribed);
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_deliver(p_job UUID, p_lease UUID, p_signal JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE j halo_campaign_outbox%ROWTYPE; c halo_master_campaigns%ROWTYPE; m halo_memberships%ROWTYPE;
  v_purpose TEXT; opted BOOLEAN; v_result JSONB := '{}';
BEGIN
  -- All effectful operations lock campaign then job, matching the cancellation lock order.
  SELECT * INTO c FROM halo_master_campaigns WHERE id = (SELECT campaign_id FROM halo_campaign_outbox WHERE id = p_job) FOR UPDATE;
  SELECT * INTO j FROM halo_campaign_outbox WHERE id = p_job FOR UPDATE;
  IF j.status <> 'leased' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until < NOW() THEN RETURN NULL; END IF;
  IF c.version <> j.version OR c.aggregate->>'status' = 'cancelled'
    OR (c.aggregate->'approval'->>'version')::integer IS DISTINCT FROM j.version
    OR NOT COALESCE(c.aggregate->'approval'->'channels' ? j.channel,FALSE)
    OR c.aggregate->'approval'->>'rightsConfirmed' IS DISTINCT FROM 'true'
    OR c.aggregate->'approval'->>'publicConsent' IS DISTINCT FROM 'true' THEN
    UPDATE halo_campaign_outbox SET status = 'cancelled', lease_until = NULL WHERE id = j.id;
    RETURN jsonb_build_object('status','cancelled');
  END IF;
  SELECT * INTO m FROM halo_memberships WHERE member_id = c.owner_member_id;
  IF m.member_id IS NULL THEN RAISE EXCEPTION 'Campaign identity unavailable'; END IF;
  IF c.aggregate->'theme'->>'activeUntil' IS NOT NULL AND (c.aggregate->'theme'->>'activeUntil')::timestamptz <= NOW() THEN
    UPDATE halo_campaign_outbox SET status = 'suppressed',result = '{"reason":"theme_expired"}',lease_until = NULL WHERE id = j.id;
    UPDATE halo_campaign_attempts SET finished_at = NOW(),status = 'suppressed' WHERE job_id = j.id AND attempt = j.attempts;
    RETURN jsonb_build_object('status','suppressed');
  END IF;
  IF j.channel = 'inbox' THEN
    v_purpose := CASE WHEN c.aggregate->>'type' = 'halo_update' THEN 'halo_updates' ELSE 'release_notes' END;
    -- Signal block inserts acquire membership FK locks, ordering simultaneous blocks before/after delivery.
    PERFORM 1 FROM halo_memberships WHERE member_id = j.recipient FOR UPDATE;
    SELECT subscribed INTO opted FROM halo_campaign_preferences
      WHERE member_id = j.recipient AND purpose = v_purpose FOR UPDATE;
    IF opted IS DISTINCT FROM TRUE OR EXISTS(SELECT 1 FROM halo_signal_blocks b WHERE
      (b.member_id = j.recipient AND b.target_member_id = m.member_id)
      OR (b.member_id = m.member_id AND b.target_member_id = j.recipient)) THEN
      UPDATE halo_campaign_outbox SET status = 'suppressed', result = '{"reason":"preference_or_block"}' WHERE id = j.id;
      UPDATE halo_campaign_attempts SET finished_at = NOW(),status = 'suppressed' WHERE job_id = j.id AND attempt = j.attempts;
      RETURN jsonb_build_object('status','suppressed');
    END IF;
    INSERT INTO halo_campaign_inbox(id,job_id,member_id,sender_member_id,purpose,output)
      VALUES(j.id,j.id,j.recipient,m.member_id,v_purpose,j.payload) ON CONFLICT(job_id) DO NOTHING;
    v_result := jsonb_build_object('inboxId',j.id);
  ELSIF j.channel = 'signal' THEN
    IF p_signal IS NULL OR p_signal->>'memberId' IS DISTINCT FROM m.member_id THEN RAISE EXCEPTION 'Validated Signal identity required'; END IF;
    INSERT INTO halo_signal_feed_posts(id,member_id,author_name,kind,body,release_id,link_url,include_purchase,visibility,audience)
      VALUES(j.id,m.member_id,m.display_name,p_signal->'input'->>'kind',p_signal->'input'->>'body',
        p_signal->'input'->>'releaseId',p_signal->'input'->>'linkUrl',FALSE,'PUBLIC','{}')
      ON CONFLICT(id) DO NOTHING;
    v_result := jsonb_build_object('postId',j.id);
  ELSIF j.channel = 'lobby' THEN
    -- Existing room pins are one per actor; do not silently overwrite an unrelated announcement.
    IF c.aggregate->'approval'->'channelApprovals'->'lobby'->>'overwritePin' IS DISTINCT FROM 'true'
      AND EXISTS(SELECT 1 FROM halo_room_pins WHERE actor_id = m.actor_id) THEN RAISE EXCEPTION 'Room pin overwrite approval required'; END IF;
    INSERT INTO halo_room_pins(actor_id,title,body,destination_url,cta_label)
      VALUES(m.actor_id,j.payload->>'title',j.payload->>'body',j.payload->>'destinationUrl',j.payload->>'cta')
      ON CONFLICT(actor_id) DO UPDATE SET title = EXCLUDED.title,body = EXCLUDED.body,
        destination_url = EXCLUDED.destination_url,cta_label = EXCLUDED.cta_label,updated_at = NOW();
    v_result := jsonb_build_object('actorId',m.actor_id);
  ELSE
    UPDATE halo_campaign_outbox SET status = 'sending', external_started_at = NOW() WHERE id = j.id;
    RETURN jsonb_build_object('status','sending');
  END IF;
  UPDATE halo_campaign_outbox SET status = 'delivered', delivered_at = NOW(), result = v_result, lease_until = NULL WHERE id = j.id;
  UPDATE halo_campaign_attempts SET finished_at = NOW(), status = 'delivered' WHERE job_id = j.id AND attempt = j.attempts;
  RETURN v_result || jsonb_build_object('status','delivered');
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_finish(p_job UUID, p_lease UUID, p_success BOOLEAN, p_error TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE j halo_campaign_outbox%ROWTYPE; cancelled BOOLEAN;
BEGIN
  SELECT aggregate->>'status' = 'cancelled' INTO cancelled FROM halo_master_campaigns
    WHERE id = (SELECT campaign_id FROM halo_campaign_outbox WHERE id = p_job) FOR UPDATE;
  SELECT * INTO j FROM halo_campaign_outbox WHERE id = p_job FOR UPDATE;
  IF j.lease_token IS DISTINCT FROM p_lease OR j.status NOT IN ('leased','sending') THEN RETURN; END IF;
  UPDATE halo_campaign_outbox SET
    status = CASE WHEN p_success THEN 'accepted' WHEN cancelled THEN 'cancelled' WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry' END,
    accepted_at = CASE WHEN p_success THEN NOW() ELSE accepted_at END,
    available_at = NOW() + LEAST(3600,30 * power(2,j.attempts)::integer) * INTERVAL '1 second',
    last_error = LEFT(p_error,240),lease_until = NULL WHERE id = j.id;
  UPDATE halo_campaign_attempts SET finished_at = NOW(), status = CASE WHEN p_success THEN 'accepted' ELSE 'failed' END,
    error = LEFT(p_error,240) WHERE job_id = j.id AND attempt = j.attempts;
END $$;

CREATE OR REPLACE FUNCTION halo_campaign_receipt(p_job UUID, p_channel TEXT, p_nonce TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE j halo_campaign_outbox%ROWTYPE;
BEGIN
  SELECT * INTO j FROM halo_campaign_outbox WHERE id = p_job FOR UPDATE;
  IF j.channel IS DISTINCT FROM p_channel OR j.external_started_at IS NULL
    OR j.status NOT IN ('sending','accepted','retry','leased','failed') THEN RETURN FALSE; END IF;
  INSERT INTO halo_campaign_receipts(job_id,nonce) VALUES(p_job,p_nonce) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE halo_campaign_outbox SET status = 'delivered',delivered_at = NOW(),lease_until = NULL,
    result = jsonb_build_object('verifiedReceipt',TRUE) WHERE id = p_job;
  UPDATE halo_campaign_attempts SET status = 'delivered',finished_at = NOW() WHERE job_id = j.id AND attempt = j.attempts;
  RETURN TRUE;
END $$;
