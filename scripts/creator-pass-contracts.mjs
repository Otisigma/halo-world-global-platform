import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  hasPremiumAccess, getCreatorPassEntitlements, getVaultCapacityBytes,
  STANDARD_VAULT_CAPACITY_BYTES
} from "../lib/creator-pass.js";
import { creatorPassFromRow, publicCreatorPassFromRow, loadCreatorPass } from "../netlify/lib/creator-pass.mjs";
import { createSmartSplitsHandler } from "../netlify/lib/dreamweaver-smart-splits.mjs";

const now = new Date("2026-10-04T00:00:00Z");
const premium = {
  subscriptionTier: "PREMIUM", subscriptionStatus: "active",
  subscriptionExpiresAt: "2026-11-04T00:00:00Z"
};
assert.equal(hasPremiumAccess(premium, now), true);
assert.equal(getVaultCapacityBytes(premium, now), Infinity);
assert.ok(Object.values(getCreatorPassEntitlements(premium, now)).every(Boolean));
for (const pass of [
  undefined, null, {}, { ...premium, subscriptionTier: "STANDARD" },
  ...["inactive", "past_due", "canceled", "expired", "invalid"].map(subscriptionStatus => ({ ...premium, subscriptionStatus })),
  ...[undefined, null, "", "invalid", now.toISOString(), "2020-01-01", 9999999999999]
    .map(subscriptionExpiresAt => ({ ...premium, subscriptionExpiresAt })),
  { ...premium, subscriptionStatus: "trialing" },
  { ...premium, subscriptionStatus: "trialing", trialEndsAt: "invalid" },
  { ...premium, subscriptionStatus: "trialing", trialEndsAt: "2099-01-01", subscriptionExpiresAt: "2020-01-01" }
]) {
  assert.equal(hasPremiumAccess(pass, now), false, JSON.stringify(pass));
  assert.equal(getVaultCapacityBytes(pass, now), STANDARD_VAULT_CAPACITY_BYTES);
  assert.ok(Object.values(getCreatorPassEntitlements(pass, now)).every(value => value === false));
}
assert.equal(hasPremiumAccess({ ...premium, subscriptionStatus: "trialing", trialEndsAt: "2026-11-01" }, now), true);
assert.equal(hasPremiumAccess({ ...premium, subscriptionStatus: "trialing", trialEndsAt: "2026-11-01", subscriptionExpiresAt: null }, now), true);
assert.equal(hasPremiumAccess(premium, new Date("invalid")), false);
assert.ok(Object.isFrozen(getCreatorPassEntitlements(premium, now)));
assert.equal(getVaultCapacityBytes({ subscriptionTier: "STANDARD", vaultCapacityBytes: Infinity, entitlements: { unlimitedVault: true } }, now),
  STANDARD_VAULT_CAPACITY_BYTES, "Client flags never grant premium");
const row = {
  member_id: "owner", subscription_tier: "PREMIUM", subscription_status: "active",
  subscription_expires_at: new Date("2099-01-01"), stripe_customer_id: "private",
  stripe_subscription_id: "private"
};
const pass = creatorPassFromRow(row, now);
assert.equal(pass.vaultCapacityBytes, null, "Unlimited capacity is JSON safe");
assert.equal(JSON.parse(JSON.stringify(pass)).entitlements.unlimitedVault, true);
assert.doesNotMatch(JSON.stringify(pass), /stripe|private/);
assert.deepEqual(Object.keys(publicCreatorPassFromRow(row, now)).sort(),
  ["dynamicBriefSurfacing", "priorityDiscovery", "verifiedPremiumBadge"]);
assert.equal((await loadCreatorPass({ sql: async () => [] }, "standard")).creatorId, "standard");
await assert.rejects(() => loadCreatorPass({ sql: async () => { throw new Error("unavailable"); } }, "owner"));

function fixture(options = {}) {
  const calls = [];
  const handler = createSmartSplitsHandler({
    getUser: async () => options.anonymous ? null : { id: "owner" },
    ensureMembership: async () => options.noMembership ? null : { member_id: "owner" },
    verifyRequestOrigin: async () => !options.badOrigin,
    getDatabase: async () => ({
      sql: async (parts, ...values) => {
        const query = parts.join("?").replace(/\s+/g, " ");
        calls.push(query);
        if (options.dbFailure) throw new Error("PRIVATE DATABASE");
        if (query.includes("halo_creator_passes")) return options.standard ? [] : [row];
        if (query.includes("halo_creator_projects")) {
          assert.match(query, /w.owner_member_id = \?/);
          assert.match(query, /p.owner_member_id = \?/);
          assert.deepEqual(values, ["owner", "project", "owner"]);
          return options.notOwner ? [] : [{ id: "project", title: "Song", work_id: "work", work_type: options.composition ? "composition" : "recording" }];
        }
        if (query.includes("halo_artist_rights_participants")) {
          assert.deepEqual(values, ["work"]);
          return options.allocations ?? [
            { participant_name: "Creator", role: options.composition ? "songwriter" : "master_owner", share_bps: 10000 }
          ];
        }
        throw new Error(`Unexpected query: ${query}`);
      }
    })
  });
  return { calls, request: (body = { projectId: "project" }, overrides = {}) =>
    handler(new Request("https://halo.test/api/dreamweaver-smart-splits", {
      method: "POST", headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body), ...overrides
    })) };
}
for (const composition of [false, true]) {
  const f = fixture({ composition });
  const response = await f.request();
  assert.equal(response.status, 200);
  const { draft } = await response.json();
  assert.equal(draft.pool, composition ? "publishing" : "master");
  assert.equal(draft.status, "draft");
  assert.equal(draft.consent, "not_recorded");
  assert.equal(draft.requiresHumanApproval, true);
  assert.match(draft.terms, /does not clear rights/);
  assert.ok(f.calls.every(query => !/INSERT|UPDATE|DELETE/.test(query)));
}
const separatePools = [
  { participant_name: "Writer", role: "songwriter", share_bps: 10000 },
  { participant_name: "Publisher", role: "publisher", share_bps: 10000 }
];
const compositionDraft = await (await fixture({ composition: true, allocations: separatePools }).request()).json();
assert.deepEqual(compositionDraft.draft.allocations.map(item => item.role), ["songwriter"]);
assert.deepEqual(compositionDraft.draft.publisherAllocations.map(item => item.role), ["publisher"]);
for (const allocations of [
  separatePools.map(item => ({ ...item, share_bps: 5000 })),
  [separatePools[0], { ...separatePools[1], share_bps: 5000 }]
]) {
  assert.equal((await fixture({ composition: true, allocations }).request()).status, 409,
    "Songwriter and publisher pools must each independently total 100%");
}
for (const [options, expected] of [
  [{ anonymous: true }, 401], [{ noMembership: true }, 403], [{ standard: true }, 403],
  [{ notOwner: true }, 404], [{ badOrigin: true }, 403], [{ dbFailure: true }, 503],
  [{ allocations: [] }, 409],
  [{ allocations: [{ role: "master_owner", share_bps: 5000 }] }, 409],
  [{ allocations: [{ role: "master_owner", share_bps: NaN }] }, 409],
  [{ allocations: Array(201).fill({ role: "master_owner", share_bps: 0 }) }, 409]
]) {
  const f = fixture(options);
  const response = await f.request();
  assert.equal(response.status, expected);
  assert.doesNotMatch(await response.text(), /PRIVATE DATABASE/);
  if (options.standard) assert.equal(f.calls.length, 1, "Denied users never access project rights");
}
for (const body of ["{", null, [], {}, { projectId: "project", entitlements: { smartSplitsEnabled: true } }, { projectId: "';DROP" }]) {
  assert.equal((await fixture().request(body)).status, 400);
}
assert.equal((await fixture().request("x".repeat(4097))).status, 413);
assert.equal((await fixture().request({}, { method: "GET", body: undefined })).status, 405);
assert.equal((await fixture().request({}, { headers: { "Content-Type": "application/json" } })).status, 403);
assert.equal((await fixture().request({}, { headers: { Origin: "https://halo.test", "Content-Type": "text/plain" } })).status, 415);
const migration = await readFile(new URL("../netlify/database/migrations/20261004030000_create_creator_passes.sql", import.meta.url), "utf8");
assert.match(migration, /PRIMARY KEY REFERENCES halo_memberships/);
assert.match(migration, /subscription_status <> 'active' OR subscription_expires_at IS NOT NULL/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/);
console.log("CreatorPass and smart split contracts passed (expiry, trials, fail-closed gates, private billing, ownership and consent).");
