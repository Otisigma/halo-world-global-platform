import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const migration = await readFile(new URL("../netlify/database/migrations/20261006170000_master_campaign_engine.sql", import.meta.url), "utf8");
for (const pattern of [
  /UNIQUE \(campaign_id, version, channel, recipient\)/,
  /FOR UPDATE SKIP LOCKED/,
  /lease_until < NOW\(\)/,
  /pg_advisory_xact_lock/,
  /halo_campaign_preference_audit/,
  /ON CONFLICT\(job_id\) DO NOTHING/,
  /status = 'suppressed'/,
  /attempts < max_attempts/,
  /status NOT IN \('sending','accepted','retry','leased','failed'\)/,
  /external_started_at IS NULL/
]) assert.match(migration, pattern);
assert.doesNotMatch(migration, /SECURITY DEFINER|http_post|net\.http|DROP TABLE/);
if (!process.env.CAMPAIGN_TEST_DATABASE_URL) {
  console.log("Master campaign SQL static contracts passed; set CAMPAIGN_TEST_DATABASE_URL for isolated PostgreSQL transactional tests.");
} else {
  const sql = `
BEGIN;
CREATE SCHEMA campaign_contract;
SET LOCAL search_path TO campaign_contract,public;
CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY,actor_id TEXT,display_name TEXT);
CREATE TABLE halo_signal_blocks(member_id TEXT,target_member_id TEXT);
CREATE TABLE halo_signal_feed_posts(id UUID PRIMARY KEY,member_id TEXT,author_name TEXT,kind TEXT,body TEXT,release_id TEXT,link_url TEXT,include_purchase BOOLEAN,visibility TEXT,audience TEXT[]);
CREATE TABLE halo_room_pins(actor_id TEXT PRIMARY KEY,title TEXT CHECK(length(title) BETWEEN 2 AND 80),body TEXT CHECK(length(body)<=240),destination_url TEXT,cta_label TEXT,updated_at TIMESTAMPTZ DEFAULT NOW());
${migration}
INSERT INTO halo_memberships VALUES('owner','actor','Artist'),('reader','reader-actor','Reader'),
  ('reader2','reader2-actor','Reader 2'),('release-only','release-actor','Release subscriber'),('off','off-actor','Unsubscribed');
DO $test$
DECLARE c JSONB; v JSONB; j halo_campaign_outbox%ROWTYPE; r JSONB; found BOOLEAN; receipt BOOLEAN; count_posts INTEGER;
  cid UUID := '11111111-1111-4111-8111-111111111111'; lease UUID;
BEGIN
  c := jsonb_build_object('id',cid,'version',1,'type','halo_update','status','draft','approval',NULL,
    'outputs',jsonb_build_object('signal',jsonb_build_object('title','Signal','body','Reviewed fact','cta','Read','destinationUrl',''),
      'lobby',jsonb_build_object('title','Lobby','body','Pin fact','cta','Open','destinationUrl',''),
      'inbox',jsonb_build_object('title','Inbox','body','Inbox fact','cta','Read','destinationUrl',''),
      'tiktok',jsonb_build_object('title','TikTok','body','Distinct TikTok fact','cta','Open','destinationUrl',''),
      'discord',jsonb_build_object('title','Discord','body','Distinct Discord fact','cta','Open','destinationUrl','')));
  v := halo_campaign_create('owner',c,'stable-fingerprint');
  ASSERT v->>'status' = 'draft';
  ASSERT halo_campaign_create('owner',c,'stable-fingerprint')->>'id' = cid::text;
  ASSERT (SELECT COUNT(*) FROM halo_master_campaigns) = 1, 'Deduplication failed';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE campaign_id = cid AND kind = 'generated') = 1, 'Repair duplicated generation activity';
  v := c || jsonb_build_object('id',gen_random_uuid());
  v := jsonb_set(v,'{outputs,tiktok,body}',c->'outputs'->'signal'->'body');
  PERFORM halo_campaign_create('owner',v,NULL);
  PERFORM halo_campaign_mutate('owner',(v->>'id')::uuid,1,'approve','{"channels":["signal"],"rightsConfirmed":true,"publicConsent":true}');
  BEGIN
    PERFORM halo_campaign_mutate('owner',(v->>'id')::uuid,1,'approve','{"channels":["tiktok"],"rightsConfirmed":true,"publicConsent":true}');
    RAISE EXCEPTION 'Duplicate channel copy passed transactional approval';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Review distinct copy for each channel; duplicate variants cannot be approved'; END;
  BEGIN
    PERFORM halo_campaign_mutate('other',cid,1,'approve','{"rightsConfirmed":true,"publicConsent":true}');
    RAISE EXCEPTION 'Ownership check missing';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Campaign not found'; END;
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,1,'queue','{"channels":["signal"]}');
    RAISE EXCEPTION 'Approval check missing';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Current version requires approval'; END;
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,2,'cancel','{}');
    RAISE EXCEPTION 'Version check missing';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Version conflict'; END;
  v := halo_campaign_mutate('owner',cid,1,'approve','{"channels":["signal"],"rightsConfirmed":true,"publicConsent":true}');
  ASSERT v->'approval'->>'memberId' = 'owner';
  ASSERT v->'approval'->'channels' = '["signal"]'::jsonb, 'Individual approval silently approved other channels';
  ASSERT v->'approval'->'channelApprovals'->'signal'->>'version' = '1';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE campaign_id = cid AND kind = 'approved' AND channel = 'signal') = 1;
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,1,'export','{"channel":"inbox"}');
    RAISE EXCEPTION 'Unapproved output exported';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Selected channel requires approval'; END;
  v := halo_campaign_mutate('owner',cid,1,'export','{"channel":"signal"}');
  v := halo_campaign_mutate('owner',cid,1,'export','{"channel":"signal"}');
  ASSERT v->'exports'->'signal'->>'status' = 'ready';
  ASSERT v->'exports'->'signal'->>'count' = '2';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_outbox) = 0, 'Export caused a send';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE campaign_id = cid AND kind = 'exported' AND details->>'status' = 'ready') = 2;
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,1,'queue','{"channels":["inbox"]}');
    RAISE EXCEPTION 'Unapproved channel queued';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Selected channel requires approval'; END;
  PERFORM halo_campaign_mutate('owner',cid,1,'queue','{"channels":["signal"]}');
  v := halo_campaign_mutate('owner',cid,1,'approve','{"channels":["lobby","inbox","tiktok","discord"],"rightsConfirmed":true,"publicConsent":true}');
  ASSERT jsonb_array_length(v->'approval'->'channels') = 5, 'Independent approvals were not merged';
  ASSERT v->>'status' = 'queued', 'Approving another channel rewrote queue status';
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,1,'approve','{"channels":["signal"],"rightsConfirmed":true,"publicConsent":true}');
    RAISE EXCEPTION 'Queued channel approval changed';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Queued channel approval is immutable'; END;
  PERFORM halo_campaign_preference('reader','halo_updates',TRUE);
  ASSERT (SELECT COUNT(*) FROM halo_campaign_preference_audit) = 1;
  PERFORM halo_campaign_preference('reader2','halo_updates',TRUE);
  PERFORM halo_campaign_preference('release-only','release_notes',TRUE);
  PERFORM halo_campaign_preference('off','halo_updates',FALSE);
  PERFORM halo_campaign_mutate('owner',cid,1,'queue','{"channels":["inbox","signal","tiktok"],"recipientIds":["reader","release-only","off","unknown"]}');
  PERFORM halo_campaign_mutate('owner',cid,1,'queue','{"channels":["inbox","signal","tiktok"],"recipientIds":["reader","release-only","off","unknown"]}');
  ASSERT (SELECT COUNT(*) FROM halo_campaign_outbox) = 3, 'Queue idempotency failed';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE campaign_id = cid AND kind = 'queued') = 3, 'Duplicate queue activity';
  ASSERT (SELECT recipient FROM halo_campaign_outbox WHERE channel = 'inbox') = 'reader', 'Recipient subset or opt-in purpose ignored';
  PERFORM halo_campaign_preference('reader','halo_updates',FALSE);
  SELECT * INTO j FROM halo_campaign_claim(10) WHERE channel = 'inbox';
  ASSERT j.attempts = 1 AND j.lease_token IS NOT NULL;
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'suppressed', 'Unsubscribe was not rechecked';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_inbox) = 0;
  SELECT * INTO j FROM halo_campaign_outbox WHERE channel = 'signal';
  lease := j.lease_token;
  r := halo_campaign_deliver(j.id,lease,'{"memberId":"owner","input":{"kind":"TEXT","body":"Reviewed fact"}}');
  ASSERT r->>'status' = 'delivered';
  ASSERT halo_campaign_deliver(j.id,lease,'{"memberId":"owner"}') IS NULL;
  ASSERT (SELECT COUNT(*) FROM halo_signal_feed_posts) = 1, 'Native Signal duplicated';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE campaign_id = cid AND channel = 'signal' AND kind = 'delivered') = 1, 'Native delivery audit duplicated';
  SELECT * INTO j FROM halo_campaign_outbox WHERE channel = 'tiktok';
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'sending';
  PERFORM halo_campaign_finish(j.id,j.lease_token,TRUE,'');
  ASSERT (SELECT status FROM halo_campaign_outbox WHERE id = j.id) = 'accepted';
  ASSERT (SELECT delivered_at FROM halo_campaign_outbox WHERE id = j.id) IS NULL, '2xx incorrectly marked delivered';
  ASSERT EXISTS(SELECT 1 FROM halo_campaign_activity WHERE job_id = j.id AND kind = 'accepted');
  ASSERT NOT EXISTS(SELECT 1 FROM halo_campaign_activity WHERE job_id = j.id AND kind = 'delivered'), 'Accepted activity claimed delivery';
  receipt := halo_campaign_receipt(j.id,'instagram','nonce1234567890123456');
  ASSERT receipt = FALSE, 'Cross-channel receipt accepted';
  receipt := halo_campaign_receipt(j.id,'tiktok','nonce1234567890123456');
  ASSERT receipt = TRUE;
  ASSERT halo_campaign_receipt(j.id,'tiktok','nonce1234567890123456') = FALSE, 'Receipt replay accepted';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_activity WHERE job_id = j.id AND kind = 'receipt_verified') = 1, 'Receipt replay duplicated activity';
  v := halo_campaign_mutate('owner',cid,1,'revise','{"summary":"Updated fact"}');
  ASSERT v->>'version' = '2' AND v->'approval' = 'null'::jsonb AND v->>'status' = 'draft';
  ASSERT v->'exports' = '{}'::jsonb, 'New revision retained current export status';
  ASSERT (SELECT snapshot->'exports'->'signal'->>'status' FROM halo_master_campaign_versions WHERE campaign_id = cid AND version = 1) = 'ready', 'Historical export state lost';
  ASSERT EXISTS(SELECT 1 FROM halo_campaign_activity WHERE campaign_id = cid AND version = 2 AND kind = 'generated');
  ASSERT (SELECT snapshot->'outputs'->'signal'->>'body' FROM halo_master_campaign_versions WHERE campaign_id = cid AND version = 1) = 'Reviewed fact';
  PERFORM halo_campaign_preference('reader','halo_updates',TRUE);
  PERFORM halo_campaign_mutate('owner',cid,2,'approve','{"rightsConfirmed":true,"publicConsent":true}');
  PERFORM halo_campaign_mutate('owner',cid,2,'queue','{"channels":["inbox","lobby"],"recipientIds":["reader"]}');
  SELECT * INTO j FROM halo_campaign_claim(10) WHERE version = 2 AND channel = 'inbox';
  INSERT INTO halo_signal_blocks VALUES('reader','owner');
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'suppressed', 'Block was not rechecked';
  DELETE FROM halo_signal_blocks;
  SELECT * INTO j FROM halo_campaign_outbox WHERE version = 2 AND channel = 'lobby';
  INSERT INTO halo_room_pins(actor_id,title,body,cta_label) VALUES('actor','Existing','Do not overwrite','Open');
  BEGIN
    PERFORM halo_campaign_deliver(j.id,j.lease_token,NULL);
    RAISE EXCEPTION 'Pin overwrite check missing';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Room pin overwrite approval required'; END;
  ASSERT (SELECT body FROM halo_room_pins WHERE actor_id = 'actor') = 'Do not overwrite';
  PERFORM halo_campaign_mutate('owner',cid,2,'cancel','{}');
  ASSERT halo_campaign_deliver(j.id,j.lease_token,NULL) IS NULL, 'Cancelled lease published';
  v := halo_campaign_mutate('owner',cid,2,'revise','{}');
  PERFORM halo_campaign_mutate('owner',cid,3,'approve','{"rightsConfirmed":true,"publicConsent":true,"overwritePin":true}');
  PERFORM halo_campaign_mutate('owner',cid,3,'queue','{"channels":["lobby","inbox","tiktok"],"recipientIds":["reader"]}');
  SELECT * INTO j FROM halo_campaign_claim(10) WHERE version = 3 AND channel = 'lobby';
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'delivered';
  ASSERT (SELECT body FROM halo_room_pins WHERE actor_id = 'actor') = 'Pin fact';
  SELECT * INTO j FROM halo_campaign_outbox WHERE version = 3 AND channel = 'inbox';
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'delivered';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_inbox WHERE member_id = 'reader') = 1;
  SELECT * INTO j FROM halo_campaign_outbox WHERE version = 3 AND channel = 'tiktok';
  UPDATE halo_campaign_outbox SET lease_until = NOW() - INTERVAL '1 second' WHERE id = j.id;
  SELECT * INTO j FROM halo_campaign_claim(10) WHERE id = j.id;
  ASSERT j.attempts = 2, 'Expired lease not recovered';
  PERFORM halo_campaign_finish(j.id,j.lease_token,FALSE,'Safe error');
  ASSERT (SELECT status FROM halo_campaign_outbox WHERE id = j.id) = 'retry';
  ASSERT (SELECT available_at > NOW() FROM halo_campaign_outbox WHERE id = j.id), 'Backoff not applied';
  ASSERT (SELECT COUNT(*) FROM halo_campaign_attempts WHERE job_id = j.id) = 2;
  UPDATE halo_campaign_outbox SET attempts = 5,status = 'sending',lease_until = NOW() - INTERVAL '1 second' WHERE id = j.id;
  PERFORM halo_campaign_claim(10);
  ASSERT (SELECT status FROM halo_campaign_outbox WHERE id = j.id) = 'failed', 'Expired final attempt not failed';
  INSERT INTO halo_campaign_outbox(campaign_id,version,channel,payload,status,attempts)
    VALUES(cid,3,'discord','{"body":"Different approved variant"}','failed',5);
  PERFORM halo_campaign_mutate('owner',cid,3,'retry',jsonb_build_object('deliveryId',j.id));
  ASSERT (SELECT max_attempts FROM halo_campaign_outbox WHERE id = j.id) = 10;
  ASSERT (SELECT COUNT(*) FROM halo_campaign_attempts WHERE job_id = j.id) = 2, 'Retry erased attempt audit';
  ASSERT (SELECT status FROM halo_campaign_outbox WHERE campaign_id = cid AND version = 3 AND channel = 'discord') = 'failed', 'Targeted retry changed another job';
  BEGIN
    PERFORM halo_campaign_mutate('owner',cid,3,'retry',jsonb_build_object('deliveryId',j.id));
    RAISE EXCEPTION 'Retry without failed jobs accepted';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'No retryable failed jobs; revise exhausted campaign'; END;
  UPDATE halo_campaign_worker_budget SET claimed = 60;
  ASSERT NOT EXISTS(SELECT 1 FROM halo_campaign_claim(10)), 'Global minute quota not enforced';
  FOR count_posts IN 1..60 LOOP PERFORM halo_campaign_api_rate('owner','preferences'); END LOOP;
  BEGIN
    PERFORM halo_campaign_api_rate('owner','preferences');
    RAISE EXCEPTION 'API rate check missing';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM = 'Campaign API rate limit reached'; END;
  UPDATE halo_campaign_worker_budget SET claimed = 0;
  PERFORM halo_campaign_mutate('owner',cid,3,'revise',jsonb_build_object('theme',jsonb_build_object('activeFrom',NOW()+INTERVAL '1 day')));
  PERFORM halo_campaign_mutate('owner',cid,4,'approve','{"rightsConfirmed":true,"publicConsent":true}');
  PERFORM halo_campaign_mutate('owner',cid,4,'queue','{"channels":["signal"]}');
  ASSERT (SELECT available_at > NOW() FROM halo_campaign_outbox WHERE campaign_id = cid AND version = 4), 'Seasonal start ignored';
  ASSERT NOT EXISTS(SELECT 1 FROM halo_campaign_claim(10)), 'Future seasonal campaign claimed early';
  PERFORM halo_campaign_mutate('owner',cid,4,'revise','{"theme":{"activeUntil":"2020-01-01T00:00:00Z"}}');
  PERFORM halo_campaign_mutate('owner',cid,5,'approve','{"rightsConfirmed":true,"publicConsent":true}');
  PERFORM halo_campaign_mutate('owner',cid,5,'queue','{"channels":["lobby"]}');
  SELECT * INTO j FROM halo_campaign_claim(10) WHERE version = 5;
  r := halo_campaign_deliver(j.id,j.lease_token,NULL);
  ASSERT r->>'status' = 'suppressed', 'Expired seasonal campaign delivered';
  ASSERT (SELECT result->>'reason' FROM halo_campaign_outbox WHERE id = j.id) = 'theme_expired';
END $test$;
ROLLBACK;`;
  const result = spawnSync("psql", [process.env.CAMPAIGN_TEST_DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  console.log("Master campaign PostgreSQL transactional contracts passed (deduplication, approval/version, queue idempotency, suppression, native effects, pin overwrite, cancel, receipts, retries, crash recovery and quota).");
  const schema = `campaign_contract_race_${process.pid}`;
  const execute = statement => {
    const run = spawnSync("psql", [process.env.CAMPAIGN_TEST_DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: `SET search_path TO ${schema},public; ${statement}`, encoding: "utf8"
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const setup = sql.slice(sql.indexOf("CREATE SCHEMA campaign_contract"), sql.indexOf("DO $test$")).replaceAll("campaign_contract", schema);
  const prepared = spawnSync("psql", [process.env.CAMPAIGN_TEST_DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: `BEGIN; ${setup} COMMIT;`, encoding: "utf8"
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  function concurrent(statement, marker = false) {
    const child = spawn("psql", [process.env.CAMPAIGN_TEST_DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"]);
    let output = "", errors = "", mark;
    const ready = new Promise(resolve => { mark = resolve; });
    child.stdout.on("data", data => { output += data; if (output.includes("LOCK_READY")) mark(); });
    child.stderr.on("data", data => { errors += data; });
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve(output) : reject(new Error(errors)));
    });
    child.stdin.end(`SET search_path TO ${schema},public; ${statement}`);
    if (!marker) mark();
    return { ready, done };
  }
  const createJob = (campaignId, channel = "signal") => {
    const doc = JSON.stringify({ id: campaignId, version: 1, type: "halo_update", status: "draft", approval: null,
      outputs: { [channel]: { title: "Reviewed title", body: "Reviewed fact", cta: "Read", destinationUrl: "" } } });
    execute(`SELECT halo_campaign_create('owner','${doc}'::jsonb,NULL);
      SELECT halo_campaign_mutate('owner','${campaignId}',1,'approve','{"rightsConfirmed":true,"publicConsent":true}');
      SELECT halo_campaign_mutate('owner','${campaignId}',1,'queue','{"channels":["${channel}"]}');`);
    return JSON.parse(execute("SELECT row_to_json(j) FROM halo_campaign_claim(1) j;"));
  };
  try {
    const firstId = "33333333-3333-4333-8333-333333333333";
    const first = createJob(firstId);
    const canceller = concurrent(`BEGIN;
      SELECT id FROM halo_master_campaigns WHERE id = '${firstId}' FOR UPDATE;
      SELECT 'LOCK_READY'; SELECT pg_sleep(0.3);
      SELECT halo_campaign_mutate('owner','${firstId}',1,'cancel','{}'); COMMIT;`, true);
    await canceller.ready;
    const publisher = concurrent(`SELECT halo_campaign_deliver('${first.id}','${first.lease_token}','{"memberId":"owner","input":{"kind":"TEXT","body":"Reviewed fact"}}');`);
    await Promise.all([publisher.done, canceller.done]);
    assert.equal(execute("SELECT COUNT(*) FROM halo_signal_feed_posts"), "0", "Cancellation lost its publication race");
    assert.equal(execute(`SELECT status FROM halo_campaign_outbox WHERE id = '${first.id}'`), "cancelled");
    const secondId = "44444444-4444-4444-8444-444444444444";
    const second = createJob(secondId);
    const effect = concurrent(`BEGIN;
      SELECT halo_campaign_deliver('${second.id}','${second.lease_token}','{"memberId":"owner","input":{"kind":"TEXT","body":"Reviewed fact"}}');
      SELECT 'LOCK_READY'; SELECT pg_sleep(0.3); COMMIT;`, true);
    await effect.ready;
    const lateCancel = concurrent(`SELECT halo_campaign_mutate('owner','${secondId}',1,'cancel','{}');`);
    await Promise.all([effect.done, lateCancel.done]);
    assert.equal(execute(`SELECT status FROM halo_campaign_outbox WHERE id = '${second.id}'`), "delivered", "Cancellation rewrote a completed native effect");
    assert.equal(execute("SELECT COUNT(*) FROM halo_signal_feed_posts"), "1", "Native effect duplicated");
    const thirdId = "55555555-5555-4555-8555-555555555555";
    const third = createJob(thirdId, "tiktok");
    execute(`SELECT halo_campaign_deliver('${third.id}','${third.lease_token}',NULL);
      SELECT halo_campaign_mutate('owner','${thirdId}',1,'cancel','{}');
      SELECT halo_campaign_finish('${third.id}','${third.lease_token}',TRUE,'');`);
    assert.equal(execute(`SELECT status FROM halo_campaign_outbox WHERE id = '${third.id}'`), "accepted", "Cancellation incorrectly recalled external acceptance");
    console.log("Master campaign PostgreSQL concurrent cancellation/publication and in-flight connector contracts passed.");
  } finally { execute(`DROP SCHEMA ${schema} CASCADE;`); }
}
