import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CAMPAIGN_TYPES, CHANNELS, THEMES, buildCampaignDraft, campaignMetadata, connectorConfig, createMasterCampaignHandler,
  createCampaignReceiptHandler, publicationCampaignFingerprint, resolveCampaignSource, runCampaignWorker,
  sanitizeOutput, safeDestination, signCampaignPayload, verifyCampaignSignature, ensurePublishedSongCampaignDraft
} from "../netlify/lib/master-campaigns.mjs";
import { createCampaignUpdatesHandler } from "../netlify/lib/campaign-updates.mjs";
import { publishSignalPost } from "../netlify/lib/signal-feed.mjs";
import { fallbackPackage } from "../netlify/lib/dreamweaver-campaigns.mjs";

let passed = 0;
const check = async (name, test) => { await test(); passed++; console.log(`PASS: ${name}`); };
const id = "11111111-1111-4111-8111-111111111111";
const lease = "22222222-2222-4222-8222-222222222222";
const member = { member_id: "owner-id", actor_id: "actor-id", display_name: "Artist" };
const owner = { id: "owner-id", app_metadata: { roles: ["owner"] } };
const source = { kind: "mix", id: "mix-source", title: "Owned mix", artistName: "Artist" };
const generate = async () => ({ package: {}, model: "test", usedFallback: true });
const draft = await buildCampaignDraft({ type: "halo_update", title: "HALO update", summary: "A confirmed interface update.", destinationUrl: "/halo-relations/" }, null, { generate });
const doc = { ...draft, id };
const approved = { ...doc, status: "approved", approval: {
  version: 1, rightsConfirmed: true, publicConsent: true, channels: Object.keys(doc.outputs), channelApprovals: {}
} };
const envValues = { HALO_CAMPAIGN_HOOK_HOSTS: "hooks.example.com", HALO_CAMPAIGN_TIKTOK_HOOK: "https://hooks.example.com/tiktok", HALO_CAMPAIGN_TIKTOK_SECRET: "a".repeat(48) };
const readEnv = name => envValues[name] || "";
const post = body => new Request("https://halo.example/api/master-campaigns", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
function database(steps) {
  const queue = [...steps], calls = [];
  return {
    calls,
    sql: async (strings, ...values) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      calls.push({ sql, values });
      if (sql.includes("halo_campaign_api_rate")) return [];
      const step = queue.shift();
      assert.ok(step, `Unexpected SQL: ${sql}`);
      if (step.match) assert.match(sql, step.match);
      step.inspect?.(sql, values);
      if (step.error) throw step.error;
      return step.rows || [];
    },
    complete() { assert.equal(queue.length, 0); }
  };
}
function management({ user = owner, origin = true, steps = [] } = {}) {
  const db = database(steps);
  return { db, handler: createMasterCampaignHandler({
    getDatabase: () => db, getUser: () => user, ensureMembership: () => member,
    verifyRequestOrigin: () => { if (origin instanceof Error) throw origin; return origin; }, generate, readEnv
  }) };
}
const load = campaign => ({ match: /SELECT aggregate.*owner_member_id/, rows: [{ aggregate: campaign }] });
const jobs = { match: /JOIN halo_master_campaigns.*owner_member_id/, rows: [] };
const activity = { match: /FROM halo_campaign_activity.*owner_member_id.*LIMIT 201/, rows: [] };

await check("revise regenerates review-only channel variants from the updated facts and preserves source/type identity", async () => {
  const h = management({ steps: [load(approved), { match: /halo_campaign_mutate/, rows: [{ campaign: doc }], inspect(sql, values) {
    const patch = JSON.parse(values[4]);
    assert.equal(patch.title, "New title"); assert.equal(patch.summary, "New factual brief");
    assert.equal(patch.theme.id, "summer");
    assert.match(patch.outputs.signal.body, /New factual brief/); assert.doesNotMatch(patch.outputs.signal.body, /confirmed interface/);
  } }, jobs] });
  assert.equal((await h.handler(post({ action: "revise", id, version: 1, title: "New title", summary: "New factual brief", themeId: "summer" }))).status, 200);
  h.db.complete();
  const changeSource = management({ steps: [load(doc)] });
  assert.equal((await changeSource.handler(post({ action: "revise", id, version: 1, source: { kind: "mix", id: "different" } }))).status, 400);
});
await check("metadata describes all fourteen distinct outputs, bounded limits and versioned themes", () => {
  assert.equal(CHANNELS.length, 14); assert.equal(new Set(CHANNELS.map(c => c.id)).size, 14);
  assert.deepEqual(CAMPAIGN_TYPES, ["release", "mix", "listening_party", "halo_update"]);
  assert.ok(THEMES.every(theme => theme.version === 1));
  const metadata = campaignMetadata(readEnv);
  assert.equal(metadata.channels.find(c => c.id === "tiktok").available, true);
  assert.equal(metadata.channels.find(c => c.id === "instagram").available, true);
  assert.equal(metadata.channels.find(c => c.id === "instagram").mode, "export");
  assert.equal(metadata.channels.find(c => c.id === "instagram").canQueue, false);
  assert.equal(metadata.channels.find(c => c.id === "tiktok").canQueue, true);
  assert.equal(metadata.channels.find(c => c.id === "email").mode, "export");
  assert.match(metadata.delivery, /accepted.*signed receipts.*delivered/);
});
await check("updates and parties require no mix/YouTube source and share grounded generation facts", async () => {
  for (const type of ["halo_update", "listening_party", "release"]) {
    const result = await buildCampaignDraft({ type, title: "Actual title", summary: "Actual fact", channels: ["signal", "email"] }, null, { generate: async input => {
      assert.equal(input.campaignType, type); assert.equal(input.factsSummary, "Actual fact");
      assert.equal(input.youtubeSourceTitle, undefined);
      return generate(input);
    } });
    assert.equal(result.status, "draft"); assert.equal(result.approval, null); assert.equal(result.version, 1);
    assert.match(result.outputs.signal.body, /Actual fact/);
    assert.notEqual(result.outputs.signal.body, result.outputs.email.body);
    assert.doesNotMatch(JSON.stringify(result.outputs), /complete mix|YouTube|achievements/);
  }
});
await check("mix generation reuses existing sanitized Dreamweaver package and falls back per channel", async () => {
  let facts;
  const result = await buildCampaignDraft({ type: "mix", title: "Owned mix", summary: "Artist fact" }, source, {
    generate: async input => { facts = input; return { package: { platforms: { tiktok: { caption: "Generated opening" } } }, model: "existing-model", usedFallback: false }; }
  });
  assert.equal(facts.artistName, "Artist"); assert.equal(facts.mixTitle, "Owned mix");
  assert.match(result.outputs.tiktok.body, /Generated opening/);
  assert.match(result.outputs.press.body, /Artist fact/); assert.equal(result.generation.usedFallback, false);
});
await check("existing structured fallback is type-aware and never invents a mix/clip for release or platform updates", () => {
  for (const campaignType of ["release", "listening_party", "halo_update"]) {
    const fallback = fallbackPackage({ campaignType, campaignTitle: "Verified title", factsSummary: "Verified fact.", artistName: "HALO" });
    assert.match(fallback.platforms.youtube.caption, /Verified fact/);
    assert.doesNotMatch(JSON.stringify(fallback), /complete mix|second doorway|#DJMix|YouTube world/);
    assert.equal(Object.keys(fallback.platforms).length, 3);
  }
});
await check("output limits, plain text sanitation, channel uniqueness and public URL safety", async () => {
  assert.throws(() => sanitizeOutput("twitter", { title: "T", body: "x".repeat(281) }));
  assert.throws(() => sanitizeOutput("lobby", { title: "x", body: "Body" }));
  assert.doesNotMatch(sanitizeOutput("signal", { title: "<Title>", body: "<script>text</script>" }).body, /[<>]/);
  for (const url of ["http://example.com", "https://127.0.0.1/", "https://host.internal/", "******example.com", "/api/song-catalog/audio?versionId=x", "//example.com"]) assert.throws(() => safeDestination(url));
  assert.equal(safeDestination("/music/?song=actual-release"), "/music/?song=actual-release");
  for (const route of ["/halo", "/halo/", "/halo.html", "/halo?campaign=public"]) assert.equal(safeDestination(route), route);
  for (const route of ["/haloevil", "/halo/private", "/halo?token=secret", "//halo"]) assert.throws(() => safeDestination(route));
  await assert.rejects(buildCampaignDraft({ type: "halo_update", title: "T", summary: "F", channels: ["signal", "signal"] }, null));
});
await check("owner-only management and origin checks precede all database access", async () => {
  for (const [options, expected] of [[{ user: null }, 401], [{ user: { id: "member" } }, 403], [{ origin: false }, 403], [{ origin: new Error("bad") }, 403]]) {
    const h = management(options);
    assert.equal((await h.handler(post({ action: "create" }))).status, expected);
    assert.equal(h.db.calls.length, 0);
  }
});
await check("workspace and detail use authenticated ownership and bounded job projection", async () => {
  const h = management({ steps: [{ match: /owner_member_id.*LIMIT 101/, rows: [{ aggregate: doc }] }] });
  const response = await h.handler(new Request("https://halo.example/api/master-campaigns"));
  assert.equal(response.status, 200); assert.equal((await response.json()).campaigns[0].id, id); h.db.complete();
  const d = management({ steps: [load(doc), jobs, activity] });
  assert.equal((await d.handler(new Request(`https://halo.example/api/master-campaigns?id=${id}`))).status, 200); d.db.complete();
});
await check("detail serializes scoped CRM delivery recipients as camelCase without leaking lease fields", async () => {
  const row = {
    id, version: 1, channel: "signal", status: "delivered", attempts: 1, max_attempts: 5,
    available_at: "2026-10-06T12:00:00Z", delivered_at: "2026-10-06T12:00:01Z",
    last_error: "", result: { postId: id }, created_at: "2026-10-06T12:00:00Z",
    recipient: "private-member", lease_token: "private-lease"
  };
  const h = management({ steps: [load(doc), { rows: [row] }, activity] });
  const response = await h.handler(new Request(`https://halo.example/api/master-campaigns?id=${id}`));
  const job = (await response.json()).jobs[0];
  assert.equal(job.maxAttempts, 5); assert.equal(job.deliveredAt, row.delivered_at);
  assert.equal(job.recipientId, row.recipient);
  assert.equal(job.recipient, row.recipient);
  assert.equal(job.lastError, ""); assert.deepEqual(job.result, { postId: id });
  assert.doesNotMatch(JSON.stringify(job), /max_attempts|delivered_at|lease_token|private-lease/);
  h.db.complete();
});
await check("owned source verification is mandatory for release, mix and listening-party campaigns", async () => {
  for (const kind of ["song", "release", "mix", "fan_campaign"]) {
    const db = database([{ match: /WHERE .* (owner_member_id|member_id) =/, rows: [] }]);
    await assert.rejects(resolveCampaignSource(db, member, { kind, id: kind === "mix" || kind === "release" ? "source" : id }, "listening_party"), /not owned/);
    db.complete();
  }
  await assert.rejects(resolveCampaignSource(database([]), member, null, "release"), /owned source/);
  assert.equal(await resolveCampaignSource(database([]), member, null, "halo_update"), null);
});
await check("Song Lab imports require explicit input approval, rights, ready status and package fingerprint", async () => {
  await assert.rejects(resolveCampaignSource(database([]), member, { kind: "song_lab", id }, "release"), /Explicitly approve/);
  const db = database([{ match: /member_id.*status = 'ready' AND rights_attested = TRUE/, rows: [{
    id, title: "Song", artist: "Artist", creative_package: { campaign: { tagline: "Approved hook", releaseCopy: "Approved release fact", privateDeliveryNote: "secret" }, lyrics: "private" }
  }] }]);
  const owned = await resolveCampaignSource(db, member, { kind: "song_lab", id, inputApproved: true }, "release");
  assert.equal(owned.approvedPackage.releaseCopy, "Approved release fact");
  assert.doesNotMatch(JSON.stringify(owned), /secret|private/);
  const changed = database([{ rows: [{ id, title: "Song", creative_package: { campaign: { releaseCopy: "changed" } } }] }]);
  await assert.rejects(resolveCampaignSource(changed, member, { ...owned }, "release"), /Source package changed/);
});
await check("create persists one reviewable aggregate with all outputs and no publication", async () => {
  const h = management({ steps: [{ match: /SELECT halo_campaign_create/, rows: [{ campaign: doc }], inspect(sql, values) {
    const saved = JSON.parse(values[1]); assert.equal(saved.approval, null); assert.equal(saved.status, "draft");
    assert.equal(Object.keys(saved.outputs).length, 14);
  } }] });
  const response = await h.handler(post({ action: "create", type: "halo_update", title: "Update", summary: "Fact" }));
  assert.equal(response.status, 201); h.db.complete();
});
await check("approval requires explicit rights and consent tied to current version", async () => {
  for (const body of [{}, { rightsConfirmed: true }, { rightsConfirmed: "true", publicConsent: true }]) {
    const h = management({ steps: [load(doc)] });
    assert.equal((await h.handler(post({ action: "approve", id, version: 1, ...body }))).status, 400); h.db.complete();
  }
  const h = management({ steps: [load(doc), { match: /halo_campaign_mutate/, rows: [{ campaign: approved }], inspect(sql, values) {
    assert.equal(values[2], 1); assert.equal(values[3], "approve");
    assert.deepEqual(JSON.parse(values[4]), { channels: Object.keys(doc.outputs), rightsConfirmed: true, publicConsent: true, overwritePin: true });
  } }, jobs] });
  assert.equal((await h.handler(post({ action: "approve", id, version: 1, rightsConfirmed: true, publicConsent: true, overwritePin: true }))).status, 200); h.db.complete();
});
await check("approval rejects copy-pasted cross-channel variants and theme snapshots validate explicit dates and locale", async () => {
  const duplicate = { ...doc, outputs: { ...doc.outputs, email: { ...doc.outputs.email, body: doc.outputs.signal.body } } };
  const h = management({ steps: [load(duplicate)] });
  assert.equal((await h.handler(post({ action: "approve", id, version: 1, rightsConfirmed: true, publicConsent: true }))).status, 400);
  await assert.rejects(buildCampaignDraft({ type: "halo_update", title: "T", summary: "Fact", locale: "<script>" }, null), /language tag/);
  await assert.rejects(buildCampaignDraft({ type: "halo_update", title: "T", summary: "Fact", activeFrom: "2027-02-02", activeUntil: "2027-02-01" }, null), /end must follow/);
  const snapshot = await buildCampaignDraft({ type: "halo_update", title: "T", summary: "Fact", themeId: "winter", locale: "en-GB", region: "UK", activeFrom: "2027-01-01", activeUntil: "2027-02-01" }, null, { generate });
  assert.equal(snapshot.theme.version, 1); assert.equal(snapshot.theme.locale, "en-GB");
  assert.equal(snapshot.theme.activeFrom, "2027-01-01T00:00:00.000Z");
});
await check("stale revisions conflict and edit_output only changes an existing sanitized variant", async () => {
  const stale = management({ steps: [load(doc)] });
  assert.equal((await stale.handler(post({ action: "cancel", id, version: 2 }))).status, 409); stale.db.complete();
  const edit = management({ steps: [load(approved), { rows: [{ campaign: doc }], inspect(sql, values) {
    const outputs = JSON.parse(values[4]).outputs;
    assert.equal(outputs.signal.body, "Reviewed replacement");
    assert.equal(outputs.email.body, approved.outputs.email.body);
  } }, jobs] });
  assert.equal((await edit.handler(post({ action: "edit_output", id, version: 1, channel: "signal", output: { title: "Reviewed", body: "Reviewed replacement" } }))).status, 200); edit.db.complete();
});
await check("email and professional outputs can never enter the sending queue", async () => {
  for (const channel of ["email", "press", "radio", "dj", "advance"]) {
    const h = management({ steps: [load(approved)] });
    assert.equal((await h.handler(post({ action: "queue", id, version: 1, channels: [channel] }))).status, 400); h.db.complete();
  }
  const unconfigured = management({ steps: [load(approved)] });
  assert.equal((await unconfigured.handler(post({ action: "queue", id, version: 1, channels: ["instagram"] }))).status, 409);
});
await check("export reports ready, never sent or delivered, and requires approval", async () => {
  const exported = { ...approved, exports: { press: { version: 1, status: "ready", memberId: member.member_id, count: 1 } } };
  const h = management({ steps: [load(approved), { match: /halo_campaign_mutate.*'export'/, rows: [{ campaign: exported }], inspect(sql, values) {
    assert.equal(values[2], 1); assert.deepEqual(JSON.parse(values[3]), { channel: "press" });
  } }] });
  const response = await h.handler(post({ action: "export", id, version: 1, channel: "press" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.autoSent, false); assert.equal(result.export.status, "ready");
  assert.equal(result.campaign.exports.press.count, 1); h.db.complete();
  const unapproved = management({ steps: [load(doc)] });
  assert.equal((await unapproved.handler(post({ action: "export", id, version: 1, channel: "press" }))).status, 409);
});
await check("malformed, oversized bodies and unexpected database errors fail closed", async () => {
  const h = management();
  assert.equal((await h.handler(new Request("https://halo.example/api/master-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" }))).status, 400);
  assert.equal((await h.handler(post({ text: "x".repeat(24577) }))).status, 413);
  const fail = management({ steps: [{ error: new Error("postgres ******") }] });
  const response = await fail.handler(new Request("https://halo.example/api/master-campaigns"));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|postgres/);
  const wrapped = management({ steps: [load(approved), { error: new Error("Driver query with private infrastructure details", { cause: new Error("Version conflict") }) }] });
  const conflict = await wrapped.handler(post({ action: "cancel", id, version: 1 }));
  assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { message: "Version conflict" });
});
await check("management mutations enforce durable API quotas before source resolution and generation", async () => {
  let generationCalls = 0;
  const handler = createMasterCampaignHandler({
    getDatabase: () => ({ sql: async strings => { assert.match(strings.join(""), /halo_campaign_api_rate/); throw new Error("Campaign API rate limit reached"); } }),
    getUser: () => owner, ensureMembership: () => member, verifyRequestOrigin: () => true,
    generate: async () => { generationCalls++; }
  });
  assert.equal((await handler(post({ action: "create", type: "mix", source: { kind: "mix", id: "owned" } }))).status, 429);
  assert.equal(generationCalls, 0);
});
await check("connector configuration is server-only HTTPS with exact allowlisted hosts and strong signing keys", () => {
  assert.equal(connectorConfig("tiktok", readEnv).url, "https://hooks.example.com/tiktok");
  for (const url of ["http://hooks.example.com/tiktok", "https://hooks.example.com.evil.com/tiktok", "******hooks.example.com/tiktok", "https://hooks.example.com:8443/tiktok", "https://hooks.example.com/tiktok?token=secret"]) {
    assert.equal(connectorConfig("tiktok", name => name === "HALO_CAMPAIGN_TIKTOK_HOOK" ? url : readEnv(name)), null);
  }
  assert.equal(connectorConfig("email", readEnv), null);
});
await check("HMAC validates bounded timestamp and rejects tampering, stale timestamps and malformed signatures", () => {
  const timestamp = String(Math.floor(Date.now() / 1000)), body = '{"actual":"payload"}', secret = "secret";
  const signature = signCampaignPayload(secret, timestamp, body);
  assert.equal(verifyCampaignSignature(secret, timestamp, body, signature), true);
  assert.equal(verifyCampaignSignature(secret, timestamp, body + "x", signature), false);
  assert.equal(verifyCampaignSignature(secret, timestamp, body, signature, Date.now() + 301000), false);
  assert.equal(verifyCampaignSignature(secret, timestamp, body, "short"), false);
});
await check("connector worker sends only channel snapshot, signs request, preserves idempotency and reports accepted", async () => {
  const job = { id, lease_token: lease, campaign_id: id, version: 1, channel: "tiktok", payload: approved.outputs.tiktok };
  let fetched = 0;
  const db = database([
    { match: /halo_campaign_claim\(3\)/, rows: [job] },
    { rows: [{ ...member, aggregate: { ...approved, privateDeliveryNote: "sensitive CRM note" } }] },
    { match: /halo_campaign_deliver/, rows: [{ result: { status: "sending" } }] },
    { match: /halo_campaign_finish.*TRUE/ }
  ]);
  const result = await runCampaignWorker(db, { readEnv, fetchImpl: async (url, options) => {
    fetched++; assert.equal(url, "https://hooks.example.com/tiktok"); assert.equal(options.redirect, "error");
    assert.equal(options.headers["Idempotency-Key"], id);
    assert.equal(verifyCampaignSignature(envValues.HALO_CAMPAIGN_TIKTOK_SECRET, options.headers["X-HALO-Timestamp"], options.body, options.headers["X-HALO-Signature"]), true);
    const payload = JSON.parse(options.body); assert.equal(payload.channel, "tiktok"); assert.deepEqual(payload.output, job.payload);
    assert.doesNotMatch(options.body, /sensitive|CRM|owner-id|artistName|source/);
    return new Response(null, { status: 202 });
  } });
  assert.equal(fetched, 1); assert.equal(result.results[0].status, "accepted"); db.complete();
});
await check("cancelled claims never invoke external hook and failures persist safe retry state", async () => {
  const job = { id, lease_token: lease, campaign_id: id, version: 1, channel: "tiktok", payload: approved.outputs.tiktok };
  const cancelled = database([{ rows: [job] }, { rows: [member] }, { rows: [{ result: { status: "cancelled" } }] }]);
  const result = await runCampaignWorker(cancelled, { readEnv, fetchImpl: () => { throw new Error("must not call"); } });
  assert.equal(result.results[0].status, "cancelled"); cancelled.complete();
  const failed = database([{ rows: [job] }, { rows: [member] }, { rows: [{ result: { status: "sending" } }] }, {
    match: /halo_campaign_finish.*FALSE/, inspect(sql, values) { assert.equal(values.at(-1), "Delivery attempt failed"); }
  }]);
  await runCampaignWorker(failed, { readEnv, fetchImpl: () => { throw new Error("credential secret"); } }); failed.complete();
});
await check("native Signal worker uses explicit membership, shared validation and durable transactional persistence", async () => {
  const job = { id, lease_token: lease, campaign_id: id, version: 1, channel: "signal", payload: approved.outputs.signal };
  const db = database([{ rows: [job] }, { rows: [member] },
    { match: /halo_signal_feed_rate_limits/, rows: [{ attempts: 1 }], inspect(sql, values) { assert.ok(values.includes("write")); } },
    { match: /halo_signal_feed_rate_limits/, rows: [{ attempts: 1 }] },
    { match: /halo_campaign_deliver/, rows: [{ result: { status: "delivered", postId: id } }], inspect(sql, values) {
      const validated = JSON.parse(values[2]); assert.equal(validated.memberId, member.member_id);
      assert.equal(validated.input.visibility, "PUBLIC"); assert.match(validated.input.body, /\/halo-relations\//);
    } }]);
  assert.equal((await runCampaignWorker(db)).results[0].status, "delivered"); db.complete();
  await assert.rejects(publishSignalPost(database([]), null, { kind: "TEXT", body: "fact", publishPublic: true }), /identity required/);
  await assert.rejects(publishSignalPost(database([]), member, { kind: "TEXT", body: "fact" }), /Confirm deliberate/);
});
await check("authenticated signed receipts are timestamp checked and scoped to job and channel with replay rejection", async () => {
  const body = { jobId: id, channel: "tiktok", status: "delivered", nonce: "receipt_nonce_123456" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCampaignPayload(envValues.HALO_CAMPAIGN_TIKTOK_SECRET, timestamp, JSON.stringify(body));
  const request = () => new Request("https://halo.example/api/campaign-delivery-receipts", {
    method: "POST", headers: { "Content-Type": "application/json", "X-HALO-Timestamp": timestamp, "X-HALO-Signature": signature }, body: JSON.stringify(body)
  });
  const db = database([{ match: /halo_campaign_receipt/, rows: [{ verified: true }], inspect(sql, values) {
    assert.deepEqual(values, [id, "tiktok", body.nonce]);
  } }, { rows: [{ verified: false }] }]);
  const handler = createCampaignReceiptHandler({ getDatabase: () => db, readEnv });
  assert.equal((await handler(request())).status, 200); assert.equal((await handler(request())).status, 409); db.complete();
  body.channel = "instagram"; assert.equal((await handler(request())).status, 401);
});
await check("publication fingerprint ignores reconcile timestamps, order and private notes but includes meaningful stable version changes", () => {
  const song = { id, owner_member_id: member.member_id, title: "Song", artist_name: "Artist", rights_status: "owned" };
  const versions = [{ id: "a", version_type: "sale_master", audio_url: "https://cdn.example/a.mp3", status: "active" }, { id: "b", version_type: "radio_edit", audio_url: "https://cdn.example/b.mp3", status: "active" }];
  const fingerprint = publicationCampaignFingerprint(song, versions);
  assert.equal(fingerprint, publicationCampaignFingerprint({ ...song, updated_at: "tomorrow", notes: "private" }, [...versions].reverse()));
  assert.notEqual(fingerprint, publicationCampaignFingerprint(song, [{ ...versions[0], audio_url: "https://cdn.example/new.mp3" }, versions[1]]));
});
await check("source reconciliation creates only a deduplicated draft and campaign errors cannot poison publication", async () => {
  const song = { id, owner_member_id: member.member_id, title: "Song", artist_name: "Artist" };
  const db = database([{ match: /halo_campaign_create/, rows: [{ campaign: doc }], inspect(sql, values) {
    const saved = JSON.parse(values[1]); assert.equal(saved.status, "draft"); assert.equal(saved.approval, null);
    assert.equal(saved.source.kind, "song"); assert.match(values[2], /^[a-f0-9]{64}$/);
  } }]);
  await ensurePublishedSongCampaignDraft(db, song, [], { publicUrl: "/music/?song=published" }); db.complete();
  const publication = await readFile(new URL("../netlify/lib/song-publication.mjs", import.meta.url), "utf8");
  assert.match(publication, /try \{\s*masterCampaignDraft = await ensurePublishedSongCampaignDraft[\s\S]*?catch \{[\s\S]*?campaign draft unavailable/);
});
await check("self-service preferences are purpose-specific, default off and never accept another member's identity", async () => {
  const db = database([{ rows: [{ purpose: "release_notes", subscribed: true }] }, { match: /halo_signal_blocks/, rows: [] },
    { match: /halo_campaign_preference/, inspect(sql, values) { assert.deepEqual(values, [member.member_id, "halo_updates", false]); } }]);
  const handler = createCampaignUpdatesHandler({ getDatabase: () => db, getUser: () => ({ id: "member" }), ensureMembership: () => member, verifyRequestOrigin: () => true });
  const response = await handler(new Request("https://halo.example/api/campaign-updates"));
  assert.deepEqual((await response.json()).preferences, [{ purpose: "release_notes", subscribed: true }, { purpose: "halo_updates", subscribed: false }]);
  assert.equal((await handler(post({ action: "unsubscribe", purpose: "halo_updates", memberId: "other" }))).status, 200); db.complete();
});
await check("inbox read is recipient-owned and rejects unauthenticated, cross-origin and unknown-purpose requests", async () => {
  const db = database([{ match: /WHERE id = .* AND member_id =/, rows: [] }]);
  const handler = createCampaignUpdatesHandler({ getDatabase: () => db, getUser: () => ({ id: "member" }), ensureMembership: () => member, verifyRequestOrigin: () => true });
  assert.equal((await handler(post({ action: "read", id }))).status, 404);
  assert.equal((await handler(post({ action: "subscribe", purpose: "marketing" }))).status, 400); db.complete();
  const denied = createCampaignUpdatesHandler({ getUser: () => null, verifyRequestOrigin: () => false });
  assert.equal((await denied(new Request("https://halo.example/api/campaign-updates"))).status, 401);
  assert.equal((await denied(post({ action: "subscribe", purpose: "halo_updates" }))).status, 403);
});
await check("channels approve independently for a version and unapproved channels cannot export", async () => {
  const partial = { ...approved, approval: { ...approved.approval, channels: ["signal"] } };
  const h = management({ steps: [load(partial), { match: /halo_campaign_mutate/, rows: [{ campaign: approved }], inspect(sql, values) {
    assert.deepEqual(JSON.parse(values[4]).channels, ["email"]);
    assert.equal(values[2], 1);
  } }, jobs] });
  assert.equal((await h.handler(post({ action: "approve", id, version: 1, channels: ["email"], rightsConfirmed: true, publicConsent: true }))).status, 200);
  h.db.complete();
  const unapproved = management({ steps: [load(partial)] });
  assert.equal((await unapproved.handler(post({ action: "export", id, version: 1, channel: "email" }))).status, 409);
  unapproved.db.complete();
  const unqueued = management({ steps: [load(partial)] });
  assert.equal((await unqueued.handler(post({ action: "queue", id, version: 1, channels: ["inbox"] }))).status, 409);
  unqueued.db.complete();
  const unknown = management({ steps: [load(partial)] });
  assert.equal((await unknown.handler(post({ action: "approve", id, version: 1, channels: ["imaginary"], rightsConfirmed: true, publicConsent: true }))).status, 400);
});
await check("CRM recipient subsets are bounded, distinct, inbox-only and passed into the transactional queue", async () => {
  const h = management({ steps: [load(approved), { match: /halo_campaign_mutate/, rows: [{ campaign: approved }], inspect(sql, values) {
    assert.deepEqual(JSON.parse(values[4]), { channels: ["inbox"], recipientIds: ["reader", "member-2"] });
  } }, jobs] });
  assert.equal((await h.handler(post({ action: "queue", id, version: 1, channels: ["inbox"], recipientIds: ["reader", "member-2"] }))).status, 200);
  h.db.complete();
  for (const recipientIds of [["reader", "reader"], ["invalid member"], Array.from({ length: 501 }, (_, i) => `member-${i}`)]) {
    const invalid = management({ steps: [load(approved)] });
    assert.equal((await invalid.handler(post({ action: "queue", id, version: 1, channels: ["inbox"], recipientIds }))).status, 400);
    invalid.db.complete();
  }
  const wrongChannel = management({ steps: [load(approved)] });
  assert.equal((await wrongChannel.handler(post({ action: "queue", id, version: 1, channels: ["signal"], recipientIds: ["reader"] }))).status, 400);
});
await check("retry retains an explicit deliveryId and still requires the current campaign version", async () => {
  const h = management({ steps: [load(approved), { match: /halo_campaign_mutate/, rows: [{ campaign: approved }], inspect(sql, values) {
    assert.equal(values[3], "retry"); assert.deepEqual(JSON.parse(values[4]), { deliveryId: lease });
  } }, jobs] });
  assert.equal((await h.handler(post({ action: "retry", id, version: 1, deliveryId: lease }))).status, 200);
  h.db.complete();
  const stale = management({ steps: [load(approved)] });
  assert.equal((await stale.handler(post({ action: "retry", id, version: 2, deliveryId: lease }))).status, 409);
});
await check("seasonal theme and region affect every channel's actual copy, with localized fallback tone and date snapshots", async () => {
  const brief = { type: "halo_update", title: "Verified update", summary: "Verified fact", region: "UK", locale: "en-GB" };
  const spring = await buildCampaignDraft({ ...brief, themeId: "spring" }, null, { generate });
  const winter = await buildCampaignDraft({ ...brief, themeId: "winter", activeFrom: "2027-01-01", activeUntil: "2027-02-01" }, null, { generate });
  for (const channel of CHANNELS) {
    assert.notEqual(spring.outputs[channel.id].body, winter.outputs[channel.id].body);
    assert.match(winter.outputs[channel.id].body, /quiet light/);
    assert.match(winter.outputs[channel.id].body, /For UK/);
  }
  const french = await buildCampaignDraft({ ...brief, themeId: "winter", locale: "fr-FR", region: "France" }, null, { generate });
  assert.match(french.outputs.email.body, /Une lumière paisible.*Pour France/);
  assert.equal(winter.theme.activeUntil, "2027-02-01T00:00:00.000Z");
  assert.equal(winter.theme.locale, "en-GB");
});
await check("revision accepts an unchanged owned source and validates destination, objective and audience updates", async () => {
  const owned = { ...approved, type: "mix", source };
  const h = management({ steps: [
    load(owned),
    { match: /FROM halo_mixes.*member_id/, rows: [{ id: source.id, title: source.title }] },
    { match: /halo_campaign_mutate/, rows: [{ campaign: doc }], inspect(sql, values) {
      const patch = JSON.parse(values[4]);
      assert.equal(patch.destinationUrl, "/halo");
      assert.equal(patch.objective, "Community growth"); assert.equal(patch.audience, "Consenting members");
      assert.equal(patch.outputs.signal.destinationUrl, "/halo");
      assert.match(patch.outputs.signal.body, /New verified facts/);
      assert.equal(patch.source, undefined);
    } }, jobs
  ] });
  assert.equal((await h.handler(post({
    action: "revise", id, version: 1, type: "mix", source: { kind: "mix", id: source.id, inputApproved: false },
    summary: "New verified facts", destinationUrl: "/halo", objective: "Community growth", audience: "Consenting members"
  }))).status, 200);
  h.db.complete();
  const unowned = management({ steps: [load(owned), { rows: [] }] });
  assert.equal((await unowned.handler(post({ action: "revise", id, version: 1, source: { kind: "mix", id: source.id } }))).status, 403);
  const unsafe = management({ steps: [load(doc)] });
  assert.equal((await unsafe.handler(post({ action: "revise", id, version: 1, source: null, destinationUrl: "//private.example" }))).status, 400);
});
await check("detail provides bounded owner-scoped camelCase activity with durable ready metadata", async () => {
  const h = management({ steps: [load(approved), jobs, {
    match: /FROM halo_campaign_activity.*owner_member_id.*LIMIT 201/,
    rows: Array.from({ length: 201 }, () => ({
      id, version: 1, channel: "press", job_id: null, kind: "exported",
      actor_member_id: member.member_id, details: { status: "ready" }, created_at: "2026-10-06T12:00:00Z"
    })),
    inspect(sql, values) { assert.deepEqual(values, [id, member.member_id]); }
  }] });
  const response = await h.handler(new Request(`https://halo.example/api/master-campaigns?id=${id}`));
  const data = await response.json();
  assert.equal(data.activity.length, 200); assert.equal(data.activityTruncated, true);
  assert.equal(data.activity[0].actorMemberId, member.member_id);
  assert.equal(data.activity[0].details.status, "ready"); assert.equal(data.activity[0].jobId, null);
  assert.doesNotMatch(JSON.stringify(data.activity), /actor_member_id|created_at|job_id/);
  h.db.complete();
});
console.log(`Master campaign contracts: ${passed} checks passed.`);
