import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { energyFrames, selectHooks } from "../services/growth-engine/analysis.mjs";
import { metadataDraft, platformConfig, renderPlan } from "../services/growth-engine/platforms.mjs";
import { campaignInput, executeJob, GrowthBlocked, runGrowthAgent, runNextJob } from "../services/growth-engine/engine.mjs";
import { createGrowthStore, loadGrowthSource } from "../netlify/lib/growth-engine-store.mjs";
import { createGrowthHandler } from "../netlify/lib/growth-engine-http.mjs";

const owner = "owner";
const songId = "11111111-1111-4111-8111-111111111111";
const source = {
  id: songId, owner_member_id: owner, title: "Satellite", artist_name: "HALO Artist",
  genre: "House", rights_status: "cleared", master_version_id: "master",
  audio_url: "/api/song-catalog/audio?versionId=master", artwork_url: "/cover.jpg",
  duration_seconds: 60, source_fingerprint: "fingerprint",
};
const input = { requestKey: "release-1", rights: { master: true, visual: true, promotion: true } };
const campaign = campaignInput(source, input);
assert.deepEqual(campaign.settings.targets, ["youtube_shorts"]);
assert.equal(campaign.settings.publishApproved, false);
assert.equal(campaign.settings.adsEnabled, false);
assert.throws(() => campaignInput(source, { ...input, rights: { master: true } }), /rights/);
assert.throws(() => campaignInput({ ...source, rights_status: "disputed" }, input), /rights/);
assert.throws(() => campaignInput({ ...source, audio_url: "" }, input), /completed/);
assert.doesNotThrow(() => campaignInput({ ...source, audio_url: "", audio_storage_key: "owned/master" }, input));
assert.doesNotThrow(() => campaignInput({ ...source, audio_url: "", drive_file_id: "owned-drive-master" }, input));
assert.doesNotThrow(() => campaignInput({ ...source, audio_url: "", audio_blob_prefix: "chunks", audio_chunk_count: 2 }, input));
assert.throws(() => campaignInput(source, { ...input, targets: ["__proto__"] }), /platform/);
assert.throws(() => campaignInput(source, { ...input, targets: ["constructor"] }), /platform/);
assert.throws(() => campaignInput(source, { ...input, scheduledAt: "not-a-date" }), /schedule/);
assert.throws(() => campaignInput(source, { ...input, requestKey: "../unsafe" }), /requestKey/);

const samples = Float32Array.from({ length: 60 * 10 }, (_, index) => index >= 200 && index < 400 ? 1 : 0.1);
const frames = energyFrames(samples, 10);
const hooks = selectHooks(frames, { durationSeconds: 60 });
assert.equal(hooks[0].start, 20, "window index maps directly to audio seconds");
assert.equal(hooks[0].end, 40);
assert.equal(hooks[0].score, 1);
assert.equal(hooks[0].model, "rms-window-v1");
assert.equal(hooks.length, 3);
for (const hook of hooks) {
  assert.ok(hook.start >= 0 && hook.end <= 60);
  assert.ok(hook.score >= 0 && hook.score <= 1);
}
assert.deepEqual(selectHooks(energyFrames([0, 0, 0], 1), { durationSeconds: 3 }).map(hook => [hook.start, hook.end]), [[0, 3]]);
assert.equal(selectHooks(energyFrames([1, 1, 1, 1, 1], 2), { durationSeconds: 2.5 })[0].end, 2.5);
assert.throws(() => energyFrames([NaN], 1), /normalized/);
assert.throws(() => energyFrames([2], 1), /normalized/);
assert.throws(() => energyFrames([], 1), /Invalid/);
assert.throws(() => selectHooks(frames.slice(1), { durationSeconds: 60 }), /contiguous/);
assert.throws(() => selectHooks(frames.slice(0, 10), { durationSeconds: 60 }), /Incomplete/);
assert.throws(() => selectHooks(frames, { durationSeconds: 60, clipSeconds: 0 }), /Invalid/);
assert.throws(() => selectHooks(frames, { durationSeconds: 60, count: 100 }), /Invalid/);

for (const target of ["youtube_shorts", "tiktok", "instagram_reels"]) {
  const plan = renderPlan(hooks[0], target, "safe-variant");
  assert.equal(plan.width / plan.height, 9 / 16);
  assert.ok(plan.end - plan.start <= platformConfig(target).clipSeconds);
  assert.equal(plan.status, "planned");
  assert.ok(plan.args.includes("1:a:0"), "use master audio, not source video audio");
  assert.ok(plan.args.includes("yuv420p"));
  const metadata = metadataDraft({ ...campaign.snapshot, title: "<script>" + "x".repeat(200) }, target);
  assert.ok(metadata.title.length <= platformConfig(target).titleLimit);
  assert.ok(!metadata.title.includes("<"));
  assert.equal(metadata.privacyStatus, "private");
  assert.equal(metadata.requiresReview, true);
}
assert.ok(renderPlan(hooks[0], "youtube_shorts", "variant", "artwork").args.includes("-loop"));
assert.throws(() => renderPlan(hooks[0], "youtube_shorts", "../../output"), /Invalid/);
for (const duration of [59.8, 60.2]) {
  const decoded = await executeJob({ kind: "analysis" }, campaign, {
    decodeAudio: async () => ({ samples: new Float32Array(duration * 10).fill(0.5), sampleRate: 10 }),
  });
  assert.equal(decoded.result.durationSeconds, duration);
  assert.ok(decoded.result.hooks.every(hook => hook.end <= duration));
}
await assert.rejects(() => executeJob({ kind: "analysis" }, campaign, {
  decodeAudio: async () => ({ samples: new Float32Array(100), sampleRate: 10 }),
}), /duration/);

function memoryQueue() {
  const jobs = [{ id: "ingest", kind: "ingest", key: "ingest", payload: {}, status: "queued", attempts: 0 }];
  let authorized = true;
  return {
    jobs, revoke: () => { authorized = false; },
    async claim(member, id, kind) {
      assert.equal(member, owner);
      assert.equal(id, campaign.id);
      const job = jobs.find(item => item.status === "queued" && (!kind || item.kind === kind));
      if (!job) return null;
      job.status = "running";
      job.attempts++;
      return job;
    },
    async loadAuthorizedCampaign() { return authorized ? campaign : null; },
    async complete(job, output) {
      job.status = "succeeded";
      job.result = output.result;
      for (const item of output.next) {
        assert.ok(!jobs.some(existing => existing.key === item.key));
        jobs.push({ ...item, status: "queued", attempts: 0 });
      }
      return true;
    },
    async fail(job, status, message) { job.status = status; job.last_error = message; return true; },
  };
}

const options = { ownerMemberId: owner, campaignId: campaign.id };
const queue = memoryQueue();
assert.equal((await runGrowthAgent(queue, { ...options, role: "publisher" })).status, "idle");
assert.equal((await runGrowthAgent(queue, { ...options, role: "ingest" })).status, "succeeded");
assert.equal((await runNextJob(queue, options)).status, "blocked", "decoder is a safe extension point, not a network fetch");
assert.ok(queue.jobs[1].last_error.includes("decoder"));
queue.jobs[1].status = "queued";
const decodeAudio = async () => ({ samples, sampleRate: 10 });
while ((await runNextJob(queue, { ...options, adapters: { decodeAudio } })).status !== "idle") {}
assert.equal(queue.jobs.filter(job => job.kind === "render" && job.result.status === "planned").length, 3);
assert.equal(queue.jobs.filter(job => job.kind === "metadata" && job.status === "succeeded").length, 3);
assert.equal(queue.jobs.filter(job => job.kind === "publish" && job.status === "blocked").length, 3);
assert.ok(queue.jobs.filter(job => job.kind === "publish").every(job => !job.result?.publishId));

const liveQueue = memoryQueue();
campaign.settings.publishApproved = true;
const publishKeys = [];
const adapters = {
  decodeAudio,
  render: async (plan, current, context) => {
    assert.equal(current.id, campaign.id);
    assert.ok(context.idempotencyKey);
    return { status: "ready", artifactId: `artifact:${context.idempotencyKey}`, logs: ["encoder finished"] };
  },
  publishers: {
    youtube_shorts: {
      views: 42,
      publish: async request => {
        assert.ok(request.artifactId);
        assert.ok(request.idempotencyKey);
        publishKeys.push(request.idempotencyKey);
        return { publishId: `platform:${request.idempotencyKey}`, uploadId: "upload-id", status: "published" };
      },
      async analytics(publishId) { return { views: this.views, watchTimeSeconds: 300, publishId }; },
    },
  },
};
while ((await runNextJob(liveQueue, { ...options, adapters })).status !== "idle") {}
assert.equal(publishKeys.length, 3);
assert.equal(new Set(publishKeys).size, 3);
assert.equal(liveQueue.jobs.filter(job => job.kind === "analytics" && job.result.views === 42).length, 3);
const publishJob = queue.jobs.find(job => job.kind === "publish");
await assert.rejects(() => executeJob(publishJob, campaign, adapters), GrowthBlocked, "a render plan is never publishable");
await assert.rejects(() => executeJob({ ...publishJob, payload: { ...publishJob.payload, render: { status: "ready", artifactId: "a" } } },
  campaign, {}), /adapter/);

const revoked = memoryQueue();
revoked.revoke();
assert.equal((await runNextJob(revoked, options)).status, "blocked");
const broken = memoryQueue();
await runNextJob(broken, options);
assert.equal((await runNextJob(broken, { ...options, adapters: { decodeAudio: async () => { throw new Error("private credential"); } } })).status, "failed");
assert.ok(!JSON.stringify(broken.jobs).includes("private credential"));
const lost = memoryQueue();
lost.complete = async () => false;
assert.equal((await runNextJob(lost, options)).status, "lease_lost");

const statements = [];
let missingSource = false;
const db = { sql: async (strings, ...values) => {
  const query = strings.join("?").replace(/\s+/g, " ").trim();
  statements.push({ query, values });
  if (query.includes("FROM halo_song_catalog song")) {
    assert.deepEqual(values, [songId, owner], "canonical source lookups must be owner scoped");
    return missingSource ? [] : [source];
  }
  if (query.startsWith("WITH campaign AS")) return [{ ...campaign, owner_member_id: owner }];
  if (query.startsWith("SELECT * FROM halo_growth_campaigns")) return [];
  return [];
} };
assert.ok((await loadGrowthSource(db, owner, songId)).source_fingerprint);
const store = createGrowthStore(db);
await store.ingest(owner, songId, input);
await store.claim(owner, campaign.id, "render");
await store.complete({ id: "job", lease_token: "token" }, { result: {}, next: [] });
await store.fail({ id: "job", lease_token: "token" }, "blocked", "review");
await store.retry(owner, campaign.id, "job");
assert.ok(statements.some(({ query }) => /FOR UPDATE OF job SKIP LOCKED/.test(query)));
assert.ok(statements.some(({ query }) => /ON CONFLICT \(owner_member_id, song_id, request_key\)/.test(query)));
assert.ok(statements.some(({ query }) => /WITH finished AS/.test(query) && /jsonb_to_recordset/.test(query)));
for (const { query } of statements.filter(({ query }) => /WHERE id = \? AND lease_token/.test(query))) {
  assert.match(query, /locked_until > NOW\(\)/, "expired/stale workers cannot write results");
}
assert.ok(statements.every(({ query }) => !/^(UPDATE|INSERT INTO|DELETE FROM) halo_song_/.test(query)));

const handler = overrides => createGrowthHandler({
  getDatabase: async () => db, getUser: async () => ({ id: "user" }),
  verifyRequestOrigin: async () => true, ensureMembership: async () => ({ member_id: owner }), ...overrides,
});
const post = body => new Request("https://halo.test/api/growth-engine", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
assert.equal((await handler({ getUser: async () => null })(post(input))).status, 401);
assert.equal((await handler({ verifyRequestOrigin: async () => false })(post(input))).status, 403);
assert.equal((await handler()(post(null))).status, 400);
assert.equal((await handler()(post({ songId, ...input, rights: {} }))).status, 400);
assert.equal((await handler()(post({ songId, ...input, requestKey: "x".repeat(16001) }))).status, 413);
assert.equal((await handler()(post({ songId, ...input }))).status, 202);
missingSource = true;
assert.equal((await handler()(post({ songId, ...input }))).status, 404);
assert.equal((await handler()(new Request(`https://halo.test/api/growth-engine?campaignId=${campaign.id}`))).status, 404);
assert.equal((await handler()(new Request("https://halo.test/api/growth-engine", { method: "DELETE" }))).status, 405);

const migration = await readFile(new URL("../netlify/database/migrations/20261014120000_growth_engine.sql", import.meta.url), "utf8");
assert.match(migration, /REFERENCES halo_song_catalog\(id\)/);
assert.match(migration, /attempts BETWEEN 0 AND 3/);
assert.doesNotMatch(migration, /(?:ALTER|UPDATE|DELETE FROM|DROP) halo_song_/);
console.log("Growth engine behavioral and integration contracts passed");
