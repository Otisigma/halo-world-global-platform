import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HaloAIService, createStudioGuardianHandler } from "../netlify/lib/halo-ai-service.mjs";

const project = {
  id: "project", owner_member_id: "owner", kind: "audio",
  stem_pack_id: "pack", rights_work_id: "work", has_brief: true
};
const rights = { work_type: "recording", rights_status: "cleared", restrictions: [] };
const allocations = [
  { participant_name: "Owner A", role: "master_owner", share_bps: 7000, collection_status: "collecting" },
  { participant_name: "Owner B", role: "master_owner", share_bps: 3000, collection_status: "registered" }
];
function geminiResponse(priorities = ["listening", "consent", "rights"]) {
  return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [
    { text: JSON.stringify({ priorities }) }
  ] } }] });
}

function fixture(options = {}) {
  const calls = [], fetches = [], counts = options.counts || new Map();
  const memberId = options.memberId || "owner";
  let memberships = 0, authCalls = 0;
  const db = {
    sql: async (parts, ...params) => {
      const query = parts.join("?").replace(/\s+/g, " ").trim();
      calls.push({ query, params });
      if (options.failDb) throw new Error("PRIVATE DATABASE DETAILS");
      if (query.includes("FROM halo_creator_projects")) {
        assert.match(query, /p.owner_member_id = \? OR EXISTS/);
        assert.match(query, /cp.status = 'accepted'/);
        assert.equal(params[0], options.projectId || "project");
        const accessible = memberId === "owner" || options.participantStatus === "accepted";
        return accessible && !options.missingProject ? [{ ...project, ...options.project }] : [];
      }
      if (query.includes("INSERT INTO halo_studio_guardian_usage")) {
        if (options.usageUnavailable) throw new Error("PRIVATE QUOTA DETAILS");
        assert.match(query, /ON CONFLICT.*DO UPDATE.*request_count.*< \?/);
        assert.match(query, /SET request_count = halo_studio_guardian_usage.request_count \+ 1 WHERE halo_studio_guardian_usage.request_count < \? RETURNING request_count/);
        const [key, limit] = params;
        const count = counts.get(key) || 0;
        if (count >= limit || options.rateLimited) return [];
        counts.set(key, count + 1);
        return [{ request_count: count + 1 }];
      }
      assert.equal(params[1], "owner", "Asset queries scope the owner, not the requesting participant");
      if (query.includes("FROM halo_stem_packs")) return options.noPack ? [] : [
        { status: options.packStatus || "private", rights_attested: true }
      ];
      if (query.includes("FROM halo_stem_files")) {
        assert.match(query, /JOIN halo_stem_packs/);
        return options.files ?? [{ stem_type: "drums", byte_size: 100, chunk_count: 1 }];
      }
      if (query.includes("FROM halo_artist_rights_participants")) {
        assert.match(query, /JOIN halo_artist_rights_works/);
        return options.allocations ?? allocations;
      }
      if (query.includes("FROM halo_artist_rights_works")) return options.noWork ? [] : [{ ...rights, ...options.rights }];
      throw new Error(`Unexpected query: ${query}`);
    }
  };
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    return options.fetchImpl ? options.fetchImpl(url, init) : geminiResponse();
  };
  const handler = createStudioGuardianHandler({
    getUser: async () => { authCalls++; return options.anonymous ? null : { id: memberId }; },
    getDatabase: async () => db,
    ensureMembership: async () => {
      memberships++;
      return options.noMembership ? null : { member_id: memberId };
    },
    verifyRequestOrigin: options.originVerifier || (async () => true),
    env: options.key ? { GEMINI_API_KEY: options.key } : {},
    fetchImpl, timeoutMs: options.timeoutMs || 100
  });
  return {
    calls, fetches, counts, memberships: () => memberships, authCalls: () => authCalls,
    service: new HaloAIService({ db, memberId, fetchImpl }),
    request: (body = { action: "health", projectId: "project" }, overrides = {}) => handler(new Request(
      "https://halo.test/api/studio-guardian", {
        method: "POST", headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body), ...overrides
      }
    ))
  };
}

const healthFixture = fixture({ key: "contract-placeholder" });
const healthyEnvelope = await (await healthFixture.request()).json();
const healthy = healthyEnvelope.health;
assert.equal(healthyEnvelope.provider, "checklist");
assert.equal(healthy.score, 50);
assert.ok(Number.isInteger(healthy.score) && healthy.score >= 0 && healthy.score <= 100);
assert.match(healthy.summary, /Metadata checklist coverage.*not an audio quality or legal readiness score/);
assert.ok(healthy.audioInsights.every(item => typeof item === "string"));
assert.match(healthy.audioInsights[0], /no audio was listened to or analyzed/);
assert.ok(healthy.actionableNextSteps.some(item => /explicit consent/.test(item)));
assert.equal(healthy.provider, "checklist");
assert.equal(healthy.status, "blocked");
assert.equal(healthy.metrics.stemCount, 1);
assert.equal(healthy.metrics.masterShareBps, 10000);
assert.deepEqual(healthy.metrics.allocations.map(item => item.shareBps), [7000, 3000]);
assert.equal(healthy.metrics.allocationVisibility, "owner");
assert.deepEqual(healthy.metrics.allocations.map(item => item.participantName), ["Owner A", "Owner B"]);
assert.deepEqual(healthy.metrics.allocations.map(item => item.collectionStatus), ["collecting", "registered"]);
assert.equal(healthy.checklist.find(item => item.id === "allocations").status, "pass");
assert.deepEqual(healthy.blockers.map(item => item.id), ["consent"]);
assert.equal(healthy.metrics.consent, "not_recorded");
assert.equal(healthFixture.fetches.length, 0, "Health always stays local even with a key");
assert.match(healthy.limitations.join(" "), /no audio.*not legal.*not split consent/i);

for (const options of [
  { files: [] }, { files: [{ stem_type: "full", byte_size: 100, chunk_count: 1 }] },
  { noPack: true }, { packStatus: "archived" },
  { files: [{ stem_type: "drums", byte_size: 0, chunk_count: 1 }] }
]) {
  const health = await fixture(options).service.analyzeProjectHealth("project");
  assert.ok(health.blockers.some(item => item.id === "stems"), JSON.stringify(options));
}
for (const options of [
  { noWork: true }, { allocations: [] },
  { allocations: [{ ...allocations[0], share_bps: 5000 }] },
  { allocations: [...allocations, { ...allocations[0], role: "songwriter", share_bps: 9000 }] },
  { allocations: Array(201).fill({ ...allocations[0], share_bps: 0 }) }
]) {
  const health = await fixture(options).service.analyzeProjectHealth("project");
  assert.ok(health.blockers.some(item => item.id === "allocations"));
  assert.ok(health.blockers.some(item => item.id === "consent"));
}
const composition = await fixture({
  rights: { work_type: "composition" },
  allocations: [{ ...allocations[0], role: "songwriter", share_bps: 10000 }]
}).service.analyzeProjectHealth("project");
assert.equal(composition.checklist.find(item => item.id === "allocations").status, "pass");
for (const rights_status of ["hold", "disputed", "incomplete"]) {
  assert.ok((await fixture({ rights: { rights_status } }).service.analyzeProjectHealth("project")).blockers.some(item => item.id === "rights"));
}
assert.equal((await fixture({ project: { kind: "visual" }, noPack: true }).service.analyzeProjectHealth("project"))
  .checklist.find(item => item.id === "stems").status, "not_applicable");

for (const participantStatus of ["pending", "declined", undefined]) {
  const denied = fixture({ memberId: "stranger", participantStatus, key: "contract-placeholder" });
  assert.equal((await denied.request({ action: "council", projectId: "project" })).status, 404);
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.fetches.length, 0);
}
const acceptedResponse = await fixture({ memberId: "collaborator", participantStatus: "accepted" }).request();
assert.equal(acceptedResponse.status, 200);
const acceptedHealth = (await acceptedResponse.json()).health;
assert.equal(acceptedHealth.metrics.consent, "not_recorded");
assert.ok(acceptedHealth.blockers.some(item => item.id === "consent"),
  "An accepted invitation grants project access, not split consent");
assert.deepEqual(acceptedHealth.metrics.allocations, []);
assert.equal(acceptedHealth.metrics.allocationVisibility, "redacted");
assert.equal(acceptedHealth.metrics.masterShareBps, 10000);
assert.equal(acceptedHealth.checklist.find(item => item.id === "allocations").status, "pass");
assert.doesNotMatch(JSON.stringify(acceptedHealth), /Owner A|Owner B|participantName|shareBps|collectionStatus|collecting|registered/);
const acceptedCouncil = await fixture({ memberId: "collaborator", participantStatus: "accepted" })
  .request({ action: "council", projectId: "project" });
const acceptedReview = (await acceptedCouncil.json()).review;
assert.deepEqual(acceptedReview.health.metrics.allocations, []);
assert.equal(acceptedReview.health.metrics.allocationVisibility, "redacted");
assert.doesNotMatch(JSON.stringify(acceptedReview), /Owner A|Owner B|participantName|shareBps|collectionStatus|collecting|registered/);
const acceptedCloud = await fixture({ memberId: "collaborator", participantStatus: "accepted", key: "contract-placeholder" })
  .request({ action: "council", projectId: "project" });
const acceptedCloudReview = (await acceptedCloud.json()).review;
assert.equal(acceptedCloudReview.provider, "gemini");
assert.deepEqual(acceptedCloudReview.health.metrics.allocations, []);
assert.doesNotMatch(JSON.stringify(acceptedCloudReview), /Owner A|Owner B|participantName|shareBps|collectionStatus|collecting|registered/);
assert.equal((await fixture({ missingProject: true }).request()).status, 404);

for (const [options, overrides, expected] of [
  [{ anonymous: true }, {}, 401], [{ noMembership: true }, {}, 403],
  [{}, { method: "GET", body: undefined }, 405],
  [{}, { headers: { Origin: "https://evil.test", "Content-Type": "application/json" } }, 403],
  [{}, { headers: { "Content-Type": "application/json" } }, 403],
  [{}, { headers: { Origin: "null", "Content-Type": "application/json" } }, 403],
  [{}, { headers: { Origin: "https://halo.test", "Content-Type": "text/plain" } }, 415],
  [{ originVerifier: async () => false }, {}, 403],
  [{ originVerifier: async () => { throw new Error("private origin error"); } }, {}, 403],
  [{}, { headers: { Origin: "https://halo.test", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" } }, 403]
]) {
  const f = fixture({ ...options, key: "contract-placeholder" });
  assert.equal((await f.request(undefined, overrides)).status, expected);
  assert.equal(f.fetches.length, 0);
}
for (const body of [
  "{", null, [], { action: "health", projectId: "" },
  { action: "health", projectId: "';DROP TABLE" }, { action: "wrong", projectId: "project" },
  { action: "health", projectId: "project", stemCount: 200, splitsAgreed: true },
  { action: "health", projectId: "project", apiKey: "client-placeholder" }
]) {
  const f = fixture({ key: "contract-placeholder" });
  assert.equal((await f.request(body)).status, 400);
  assert.equal(f.memberships(), 0);
  assert.equal(f.fetches.length, 0);
}
for (const body of ["x".repeat(4097), "é".repeat(2500)]) {
  assert.equal((await fixture().request(body)).status, 413);
}
assert.equal((await fixture().request("{}", { headers: {
  Origin: "https://halo.test", "Content-Type": "application/json", "Content-Length": "9000"
} })).status, 413);
const safeError = await fixture({ failDb: true }).request();
assert.equal(safeError.status, 503);
assert.doesNotMatch(await safeError.text(), /PRIVATE|DATABASE/);

const councilBody = { action: "council", projectId: "project" };
const local = fixture();
const localReview = (await (await local.request(councilBody)).json()).review;
assert.equal(localReview.provider, "checklist");
assert.equal(localReview.fallbackReason, "not_configured");
assert.ok(localReview.council.every(item =>
  typeof item.agentName === "string" && typeof item.role === "string" && typeof item.content === "string"));
assert.equal(typeof localReview.finalVerdict, "string");
assert.ok(localReview.recommendedActions.every(item => typeof item === "string"));
assert.equal(local.calls.some(item => item.query.includes("halo_studio_guardian_usage")), false);

const cloud = fixture({ key: "contract-placeholder", files: [], allocations: [] });
const cloudResponse = await cloud.request(councilBody);
const cloudEnvelope = await cloudResponse.json();
const cloudReview = cloudEnvelope.review;
assert.equal(cloudEnvelope.provider, "gemini");
assert.ok(cloudReview.council.every(item =>
  typeof item.agentName === "string" && typeof item.role === "string" && typeof item.content === "string"));
assert.match(cloudReview.finalVerdict, /not legal verification or release approval/);
assert.deepEqual(cloudReview.recommendedActions, cloudReview.recommendations);
assert.equal(cloudReview.provider, "gemini");
assert.equal(cloudReview.model, "gemini-2.5-flash");
assert.equal(cloudReview.fallbackReason, null);
assert.equal(cloudReview.status, "blocked");
assert.ok(cloudReview.health.blockers.some(item => item.id === "stems"));
assert.ok(cloudReview.health.blockers.some(item => item.id === "allocations"));
assert.ok(cloudReview.recommendations.some(text => /stem pack/.test(text)));
assert.ok(cloudReview.recommendations.some(text => /explicit allocations/.test(text)));
assert.equal(cloudResponse.headers.get("Cache-Control"), "no-store");
const providerRequest = cloud.fetches[0];
assert.match(providerRequest.url, /models\/gemini-2\.5-flash:generateContent$/);
assert.doesNotMatch(providerRequest.url, /contract-placeholder/);
assert.equal(providerRequest.init.headers["x-goog-api-key"], "contract-placeholder");
assert.doesNotMatch(providerRequest.init.body, /Owner A|Owner B|owner_member_id|participant_name|projectId|brief/);
assert.equal(cloud.calls.filter(item => item.query.includes("INSERT INTO halo_studio_guardian_usage")).length, 2);

const quota = fixture({ key: "contract-placeholder" });
for (let i = 0; i < 6; i++) assert.equal((await (await quota.request(councilBody)).json()).review.provider, "gemini");
const limited = (await (await quota.request(councilBody)).json()).review;
assert.equal(limited.provider, "checklist");
assert.equal(limited.fallbackReason, "rate_limited");
assert.equal(quota.fetches.length, 6);
assert.equal(quota.counts.get("global"), 6, "Member denial must not consume the global quota");
const globalCallsBefore = quota.calls.filter(call =>
  call.query.includes("INSERT INTO halo_studio_guardian_usage") && call.params[0] === "global"
).length;
for (let i = 0; i < 10; i++) {
  assert.equal((await (await quota.request(councilBody)).json()).review.fallbackReason, "rate_limited");
}
assert.equal(quota.counts.get("global"), 6);
assert.equal(quota.calls.filter(call =>
  call.query.includes("INSERT INTO halo_studio_guardian_usage") && call.params[0] === "global"
).length, globalCallsBefore, "Repeated member-denied reservations must not touch the global bucket");
const concurrentQuota = fixture({ key: "contract-placeholder" });
const concurrentResults = await Promise.all(Array.from({ length: 24 }, async () =>
  (await (await concurrentQuota.request(councilBody)).json()).review
));
assert.equal(concurrentResults.filter(review => review.provider === "gemini").length, 6);
assert.equal(concurrentResults.filter(review => review.fallbackReason === "rate_limited").length, 18);
assert.equal(concurrentQuota.fetches.length, 6, "Parallel calls cannot exceed the member reservation cap");
assert.equal(concurrentQuota.counts.get("member:owner"), 6);
assert.equal(concurrentQuota.counts.get("global"), 6);
const sharedCounts = new Map();
const instances = Array.from({ length: 20 }, (_, index) => fixture({
  memberId: `member-${index}`, participantStatus: "accepted", key: "contract-placeholder", counts: sharedCounts
}));
const globalResults = await Promise.all(instances.flatMap(instance =>
  Array.from({ length: 6 }, async () => (await (await instance.request(councilBody)).json()).review)
));
assert.equal(globalResults.filter(review => review.provider === "gemini").length, 60);
assert.equal(instances.reduce((count, instance) => count + instance.fetches.length, 0), 60,
  "Separate handler instances share the database global reservation cap");
assert.equal(sharedCounts.get("global"), 60);
assert.ok([...sharedCounts.entries()].filter(([key]) => key.startsWith("member:")).every(([, count]) => count <= 6));
const globalQuota = fixture({ key: "contract-placeholder" });
globalQuota.counts.set("global", 60);
assert.equal((await (await globalQuota.request(councilBody)).json()).review.fallbackReason, "rate_limited");
assert.equal(globalQuota.fetches.length, 0);
assert.equal(globalQuota.counts.get("member:owner"), 1, "Global denial may consume a member reservation fail-closed");
for (const options of [{ rateLimited: true }, { usageUnavailable: true }]) {
  const f = fixture({ key: "contract-placeholder", ...options });
  assert.equal((await (await f.request(councilBody)).json()).review.provider, "checklist");
  assert.equal(f.fetches.length, 0);
}

for (const fetchImpl of [
  async () => { throw new Error("PRIVATE API KEY DETAILS"); },
  async () => new Response("private provider error", { status: 429 }),
  async () => new Response("not json"),
  async () => new Response("x".repeat(16385)),
  async () => geminiResponse(["approve_release"]),
  async () => geminiResponse(["consent", "consent"]),
  async () => geminiResponse([]),
  async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] }),
  async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{
    text: JSON.stringify({ priorities: ["consent"], summary: "All rights legally verified" })
  }] } }] }),
  async () => Response.json({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
  async () => new Promise(() => {}),
  async () => new Response(new ReadableStream({ start() {} }))
]) {
  const f = fixture({ key: "contract-placeholder", fetchImpl, timeoutMs: 10 });
  const response = await f.request(councilBody);
  assert.equal(response.status, 200, "Provider failure must not disable the checklist");
  const review = (await response.json()).review;
  assert.equal(review.provider, "checklist");
  assert.equal(review.fallbackReason, "unavailable");
  assert.equal(review.status, "blocked");
  assert.doesNotMatch(JSON.stringify(review), /PRIVATE|contract-placeholder|legally verified/);
}

const migration = await readFile(new URL("../netlify/database/migrations/20261003153000_create_studio_guardian_usage.sql", import.meta.url), "utf8");
assert.match(migration, /PRIMARY KEY \(scope_key, bucket_start\)/);
assert.match(migration, /request_count INTEGER NOT NULL CHECK \(request_count BETWEEN 1 AND 60\)/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE|ALTER TABLE/);
const api = await readFile(new URL("../netlify/functions/studio-guardian.mjs", import.meta.url), "utf8");
assert.match(api, /path: "\/api\/studio-guardian"/);
console.log("Studio Guardian behavioral contracts passed (authorization, trusted metrics, consent, quotas, Gemini validation and fallback).");
