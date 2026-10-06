import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DNA_DIMENSIONS, DNA_LIMITS, DNA_TERMS } from "../lib/creative-dna.js";
import {
  canonicalTermIds, creatorDto, cursorFor, dnaDto, dnaInput,
  publishedReleaseLink, resolveDnaInvite, searchInput
} from "../netlify/lib/creative-dna.mjs";
import { createCreatorNetworkHandler } from "../netlify/lib/creator-network.mjs";

const migration = await readFile(new URL("../netlify/database/migrations/20261006060000_create_creative_dna.sql", import.meta.url), "utf8");
const service = await readFile(new URL("../netlify/lib/creative-dna.mjs", import.meta.url), "utf8");
assert.equal(Object.keys(DNA_DIMENSIONS).length, 6);
assert.ok(Object.isFrozen(DNA_TERMS) && Object.isFrozen(DNA_LIMITS));
assert.ok(DNA_TERMS.every(term => Object.isFrozen(term) && Object.isFrozen(term.aliases)));
assert.equal(new Set(DNA_TERMS.map(term => term.id)).size, DNA_TERMS.length);
for (const term of DNA_TERMS) {
  assert.ok(Object.hasOwn(DNA_DIMENSIONS, term.dimension));
  assert.ok(migration.includes(`'${term.dimension}','${term.key}','${term.label}'`), `Seed matches ${term.id}`);
}
const input = {
  action: "save_dna", creativeStatement: "  Cafe\u0301  ", creativeGoals: "Find a voice",
  workflowNotes: "Private session notes", visibility: "private", expectedRevision: 0,
  termIds: ["SONIC:ATMOSPHERIC", " sonic:ambient textures ", "ｍｏｏｄ:ｕｐｂｅａｔ", "mood:uplifting"]
};
const valid = dnaInput(input);
assert.equal(valid.creativeStatement, "Café");
assert.deepEqual(valid.termIds, ["mood:uplifting", "sonic:atmospheric"]);
assert.deepEqual(canonicalTermIds(["skill:producing", "SKILL:PRODUCTION"]), ["skill:production"]);
for (const bad of [
  { ...input, termIds: ["invented:value"] }, { ...input, termIds: Array(49).fill("mood:uplifting") },
  { ...input, termIds: DNA_TERMS.filter(term => term.dimension === "sonic").map(term => term.id) },
  { ...input, visibility: "friends" }, { ...input, expectedRevision: -1 },
  { ...input, expectedRevision: "0" }, { ...input, expectedRevision: 2147483647 },
  { ...input, creativeStatement: "a".repeat(601) }, { ...input, creativeGoals: "a".repeat(1001) },
  { ...input, workflowNotes: "a".repeat(1001) }, { ...input, creativeStatement: "\u0000" },
  { ...input, memberId: "victim" }, { ...input, termIds: null }
]) assert.throws(() => dnaInput(bad));
assert.equal([...dnaInput({ ...input, creativeStatement: "🎵".repeat(600) }).creativeStatement].length, 600);
const publicId = "11111111-1111-4111-8111-111111111111";
const otherPublicId = "22222222-2222-4222-8222-222222222222";
const row = {
  member_id: "secret-member-id", public_profile_id: publicId, display_name: "Artist", bio: "Bio",
  creative_statement: "Atmospheric sessions", creative_goals: "Make a record", workflow_notes: "NEVER PUBLIC",
  term_ids: ["sonic:atmospheric"], visibility: "public", revision: 1, premium_verified: false, score: 0
};
assert.ok(!JSON.stringify(creatorDto(row, "viewer")).includes("secret-member-id"));
assert.ok(!JSON.stringify(creatorDto(row, "viewer")).includes("NEVER PUBLIC"));
assert.deepEqual(Object.keys(dnaDto(row)).sort(), ["creativeGoals", "creativeStatement", "termIds"]);
assert.equal(dnaDto(row, true).workflowNotes, "NEVER PUBLIC");
assert.equal(creatorDto(row).canInvite, false);
assert.equal(creatorDto(row, row.member_id).canInvite, false);
assert.equal(creatorDto(row, "viewer").canInvite, true);
assert.equal(creatorDto({ ...row, premium_verified: "true" }).premiumVerified, false);
await assert.rejects(resolveDnaInvite({ sql: () => { throw new Error("No anonymous database calls"); } }, null, publicId),
  error => error.status === 401);
assert.equal(publishedReleaseLink("https://example.com/release"), "https://example.com/release");
assert.equal(publishedReleaseLink("/music/?song=published-song"), "/music/?song=published-song");
for (const url of ["javascript:alert(1)", "http://example.com", "https://example.com/private/master",
  "https://example.com/?token=secret", "******example.com", "/api/song-catalog?member=secret"]) {
  assert.equal(publishedReleaseLink(url), "");
}

function fixture({ user = null, sql = () => [], origin = () => true, activeTerms = DNA_TERMS, membershipFor = null } = {}) {
  const calls = [], userRequests = [];
  const handler = createCreatorNetworkHandler({
    getUser: async request => { userRequests.push(request); return user; },
    ensureMembership: async () => membershipFor ? membershipFor() : ({ member_id: user.id }),
    verifyRequestOrigin: origin,
    getDatabase: async () => ({ sql: async (parts, ...params) => {
      const query = parts.join("?").replace(/\s+/g, " ").trim();
      calls.push({ query, params });
      if (query.startsWith("SELECT id, dimension, key, label, aliases")) return activeTerms;
      if (query.includes("INSERT INTO halo_creator_dna_rate_limits")) return sql(query, params) ?? [{ attempts: 1 }];
      return sql(query, params) ?? [];
    } })
  });
  return { calls, userRequests,
    request: (path = "", body, headers = {}) => handler(new Request(`https://halo.test/api/creator-network${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin: "https://halo.test", "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    }))
  };
}
const defaultSql = query => query.includes("INSERT INTO halo_creator_dna_rate_limits") ? [{ attempts: 1 }] : [];
const absent = fixture({ user: { id: "owner" }, sql: defaultSql });
for (const membershipFor of [() => null, () => ({}), () => ({ member_id: "" }), () => { throw new Error("Membership lookup failed"); }]) {
  const missingMembership = fixture({ user: { id: "owner" }, membershipFor });
  assert.equal((await missingMembership.request("?view=dna")).status, 403);
  assert.equal((await missingMembership.request("?view=dna_search")).status, 403);
  assert.equal((await missingMembership.request(`?view=dna_profile&profile=${publicId}`)).status, 403);
  assert.equal(missingMembership.calls.length, 0);
}
const empty = await (await absent.request("?view=dna")).json();
assert.equal(empty.profile, null);
assert.equal(empty.dna.revision, 0);
assert.equal(empty.dna.visibility, "private");
assert.deepEqual(empty.projects, []);
assert.equal((await absent.request("", input)).status, 409);
assert.equal((await fixture().request("?view=dna")).status, 401);
assert.ok(absent.userRequests.every(request => request instanceof Request), "Use request-aware authentication");
for (const [field, value] of [
  ["creativeStatement", "x".repeat(601)], ["creativeGoals", "x".repeat(1001)],
  ["workflowNotes", "x".repeat(1001)], ["visibility", "invalid"], ["termIds", ["invented:term"]], ["expectedRevision", -1]
]) {
  const response = await absent.request("", { ...input, [field]: value });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(typeof result.fieldErrors?.[field], "string", `Field-specific error for ${field}`);
}

let revision = 0, savedTerms = [];
const owner = fixture({ user: { id: "owner" }, sql: (query, params) => {
  if (query.includes("halo_creator_dna_rate_limits")) return [{ attempts: 1 }];
  if (query.startsWith("SELECT public_profile_id")) return [{ public_profile_id: publicId }];
  if (query.includes("halo_save_creator_dna")) {
    if (params[5] !== revision) return [];
    revision++;
    savedTerms = params[6];
    return [{ ...row, revision, workflow_notes: params[3], visibility: params[4] }];
  }
  return [];
} });
const saved = await owner.request("", input);
assert.equal(saved.status, 200);
assert.equal((await saved.json()).dna.revision, 1);
assert.deepEqual(savedTerms, valid.termIds);
assert.equal((await owner.request("", input)).status, 409);
assert.deepEqual(savedTerms, valid.termIds);
assert.ok(owner.calls.filter(call => call.query.includes("halo_save_creator_dna")).every(call =>
  call.query.startsWith("SELECT * FROM halo_save_creator_dna")));
assert.ok(!owner.calls.some(call => /^(DELETE|INSERT).*halo_creator_dna_tags/.test(call.query)), "Atomic tag replacement is inside one database statement");
for (const headers of [
  { "content-type": "text/plain" }, { "content-type": "application/jsonp" },
  { origin: "https://evil.test" }, { origin: "" }
]) assert.equal((await owner.request("", input, headers)).status, headers["content-type"] ? 415 : 403);
assert.equal((await owner.request("", `{"action":"save_dna","creativeStatement":"${"🎵".repeat(5000)}"}`)).status, 413);
assert.equal((await owner.request("", input, { "content-length": "18001" })).status, 413);
assert.equal((await owner.request("", "{")).status, 400);
const inactive = fixture({ user: { id: "owner" }, activeTerms: [], sql: query =>
  query.includes("halo_creator_dna_rate_limits") ? [{ attempts: 1 }]
    : query.startsWith("SELECT public_profile_id") ? [{ public_profile_id: publicId }] : [] });
assert.equal((await inactive.request("", input)).status, 400);
assert.equal((await inactive.request("?view=dna_search&term=sonic:atmospheric")).status, 400);
assert.ok(!inactive.calls.some(call => call.query.includes("halo_save_creator_dna")));
assert.equal((await owner.request("", { action: "save_profile", displayName: "Legacy", ignored: "x".repeat(20000) })).status, 200,
  "The smaller DNA body limit does not change existing profile flows");
const originDenied = fixture({ user: { id: "owner" }, origin: () => false });
assert.equal((await originDenied.request("", input)).status, 403);
assert.equal(originDenied.calls.length, 0);

const quota = fixture({ user: { id: "owner" }, sql: () => [] });
assert.equal((await quota.request("?view=dna_search")).status, 429);
assert.equal((await quota.request("", input)).status, 429);
assert.ok(quota.calls.every(call => call.query.includes("halo_creator_dna_rate_limits")));
assert.ok(quota.calls.every(call => call.query.includes("ON CONFLICT") && call.query.includes("RETURNING attempts")));
const publicQuota = fixture({ sql: () => [] });
assert.equal((await publicQuota.request("?view=dna_search")).status, 429);
assert.equal(publicQuota.calls[0].params[0], "public:search");
assert.doesNotMatch(publicQuota.calls[0].query, /ip|address/i);

const search = fixture({ user: { id: "viewer" }, sql: query => {
  if (query.includes("halo_creator_dna_rate_limits")) return [{ attempts: 1 }];
  if (query.includes("WITH eligible")) return [{ total: 2, creators: [row, { ...row, public_profile_id: otherPublicId }] }];
  return [];
} });
const result = await (await search.request("?view=dna_search&limit=1&term=sonic:atmospheric")).json();
assert.equal(result.total, 2);
assert.equal(result.creators.length, 1);
assert.equal(result.creators[0].canInvite, true);
assert.deepEqual(result.creators[0].matchReasons, ["Shared DNA: Atmospheric"]);
assert.ok(result.nextCursor);
assert.equal((await search.request(`?view=dna_search&limit=1&term=sonic:atmospheric&cursor=${result.nextCursor}`)).status, 200);
assert.ok(!JSON.stringify(result).includes("NEVER PUBLIC"));
assert.ok(!JSON.stringify(result).includes("secret-member-id"));
const cursorUrl = new URL(`https://halo.test/?limit=1&term=sonic:atmospheric&cursor=${result.nextCursor}`);
assert.equal(searchInput(cursorUrl, "viewer").cursor.id, publicId);
for (const mutate of [
  url => url.searchParams.set("q", "changed"), url => url.searchParams.set("role", "Producer"),
  url => url.searchParams.set("limit", "2"), url => url.searchParams.append("term", "mood:uplifting")
]) {
  const url = new URL(cursorUrl); mutate(url);
  assert.throws(() => searchInput(url, "viewer"));
}
assert.throws(() => searchInput(cursorUrl, null));
assert.throws(() => searchInput(cursorUrl, "other-viewer"));
for (const suffix of ["&cursor=bad!", "&limit=0", "&limit=1e1", "&bpm=301",
  "&bpm=1e2", "&term=unknown", `&q=${"x".repeat(161)}`, `&${Array(13).fill("term=mood:uplifting").join("&")}`]) {
  assert.equal((await search.request(`?view=dna_search${suffix}`)).status, 400);
}
assert.throws(() => searchInput(new URL(`https://halo.test/?cursor=${cursorFor({ ...row, score: -1 }, "x")}`), null));
const searchQuery = search.calls.find(call => call.query.includes("WITH eligible")).query;
assert.match(searchQuery, /JOIN halo_creator_dna d USING\(member_id\)/);
assert.match(searchQuery, /d.visibility = 'public'.*d.visibility = 'members'/);
assert.doesNotMatch(searchQuery, /workflow_notes/);
assert.match(searchQuery, /NOT EXISTS.*halo_signal_blocks/);
assert.match(searchQuery, /c.roles @> ARRAY/);
assert.match(searchQuery, /ORDER BY score DESC, premium_verified DESC, public_profile_id ASC/);
assert.match(searchQuery, /LEAST\(1000000, floor\(100000/);
assert.match(searchQuery, /subscription_expires_at > NOW\(\)/);
assert.match(searchQuery, /trial_ends_at > NOW\(\)/);
assert.match(searchQuery, /score <.*premium_verified <.*public_profile_id >/);
assert.match(migration, /USING GIN\(to_tsvector\('simple', creative_statement \|\| ' ' \|\| creative_goals\)\)/);
assert.doesNotMatch(migration, /GIN.*workflow_notes/);
assert.match(service, /window_start <= NOW\(\) - INTERVAL '1 minute'/);

const offline = fixture({ sql: () => { throw new Error("Offline"); } });
const fallback = await (await offline.request("?view=dna_search")).json();
assert.equal(fallback.directoryUnavailable, true);
assert.deepEqual(fallback.creators, []);
assert.ok(fallback.curated.every(creator => !creator.canInvite && !creator.dna && !creator.member_id));
assert.equal((await offline.request("?view=dna_search&bpm=bad")).status, 400);

const visitor = fixture({ user: { id: "viewer" }, sql: query => {
  if (query.includes("halo_creator_dna_rate_limits")) return [{ attempts: 1 }];
  if (query.includes("FROM halo_creator_profiles c")) return [row];
  if (query.includes("FROM halo_release_campaigns")) return [
    { id: "released", title: "Released", official_url: "https://example.com/release" },
    { id: "internal", title: "Internal release", official_url: "/music/?song=internal" },
    { id: "private-url", title: "Private", official_url: "https://example.com/private/master" }
  ];
  if (query.includes("FROM halo_creator_projects")) return [{ id: "viewer-open", title: "Viewer's open project" }];
  throw new Error("Unexpected visitor query");
} });
const profileResult = await (await visitor.request(`?view=dna_profile&profile=${publicId}`)).json();
assert.equal(profileResult.releases.length, 2);
const visitorReleases = visitor.calls.find(call => call.query.includes("FROM halo_release_campaigns"));
assert.match(visitorReleases.query, /release.visibility = 'public'/);
assert.match(visitorReleases.query, /page.slug = release.artist_slug/);
assert.match(visitorReleases.query, /page.owner_member_id = release.owner_member_id AND page.status = 'published'/);
assert.deepEqual(profileResult.projects, [{ id: "viewer-open", title: "Viewer's open project" }]);
const visitorProjects = visitor.calls.find(call => call.query.includes("FROM halo_creator_projects"));
assert.deepEqual(visitorProjects.params, ["viewer"], "Invitation choices belong to the requesting member, never the visited creator");
assert.ok(!JSON.stringify(profileResult).includes("NEVER PUBLIC"));
assert.ok(!JSON.stringify(profileResult).includes("secret-member-id"));
assert.equal((await fixture({ sql: defaultSql }).request(`?view=dna_profile&profile=${publicId}`)).status, 404);
assert.equal((await visitor.request("?view=dna_profile&profile=member-id")).status, 400);

const project = { id: "project", owner_member_id: "owner", status: "open" };
const blocked = fixture({ user: { id: "owner" }, sql: query =>
  query.includes("halo_signal_blocks") ? [{ blocked: true }] : query.includes("halo_creator_projects") ? [project] : [] });
assert.equal((await blocked.request("", { action: "invite", projectId: "project", memberId: "target" })).status, 404);
assert.ok(!blocked.calls.some(call => call.query.startsWith("INSERT INTO halo_creator_participants")));
const blockedApply = fixture({ user: { id: "target" }, sql: query =>
  query.includes("halo_signal_blocks") ? [{ blocked: true }] : query.includes("halo_creator_projects") ? [project] : [] });
assert.equal((await blockedApply.request("", { action: "apply", projectId: "project" })).status, 404);
const opaqueInvite = fixture({ user: { id: "owner" }, sql: query => {
  if (query.includes("halo_creator_dna_rate_limits")) return [{ attempts: 1 }];
  if (query.startsWith("SELECT * FROM halo_creator_projects")) return [project];
  if (query.startsWith("SELECT c.member_id") || query.startsWith("SELECT member_id")) return [{ member_id: "resolved-target" }];
  if (query.startsWith("INSERT INTO halo_creator_participants")) return [{ member_id: "resolved-target" }];
  return [];
} });
assert.equal((await opaqueInvite.request("", { action: "invite", projectId: "project", publicProfileId: publicId })).status, 200);
const inviteWrite = opaqueInvite.calls.find(call => call.query.startsWith("INSERT INTO halo_creator_participants"));
assert.ok(inviteWrite.params.includes("resolved-target"));
assert.match(inviteWrite.query, /NOT EXISTS.*halo_signal_blocks/);
assert.match(inviteWrite.query, /AND \(\? OR EXISTS \( SELECT 1 FROM halo_creator_profiles c WHERE c.member_id = \? AND c.discoverable = TRUE \)\)/);
assert.match(inviteWrite.query, /AND \(\? OR owner_member_id = \?\)/);
assert.match(inviteWrite.query, /d.visibility IN \('members', 'public'\)/);
assert.equal((await opaqueInvite.request("", { action: "invite", projectId: "project", publicProfileId: publicId, memberId: "target" })).status, 400);
const denyOpaque = fixture({ user: { id: "owner" }, sql: query =>
  query.includes("halo_creator_dna_rate_limits") ? [{ attempts: 1 }]
    : query.startsWith("SELECT * FROM halo_creator_projects") ? [project] : [] });
assert.equal((await denyOpaque.request("", { action: "invite", projectId: "project", publicProfileId: publicId })).status, 404);
assert.equal((await opaqueInvite.request("", { action: "invite", projectId: "project", memberId: "resolved-target" })).status, 200);
const legacyInviteWrite = opaqueInvite.calls.filter(call => call.query.startsWith("INSERT INTO halo_creator_participants")).at(-1);
assert.match(legacyInviteWrite.query, /SELECT 1 FROM halo_creator_profiles c WHERE c.member_id = \? AND c.discoverable = TRUE/);

console.log("Creative DNA contracts passed: vocabulary, Unicode, redaction, validation, quotas, bounded JSON, origin, revisions, pagination, links and bilateral blocks");
