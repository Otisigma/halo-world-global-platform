import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createCreatorNetworkHandler } from "../netlify/lib/creator-network.mjs";
import { curatedCreators } from "../lib/creator-directory.js";
import { getCreatorPassEntitlements } from "../lib/creator-pass.js";

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const premiumRow = {
  member_id: "owner", subscription_tier: "PREMIUM", subscription_status: "active",
  subscription_expires_at: future, stripe_customer_id: "private-customer", stripe_subscription_id: "private-subscription"
};
const profile = {
  member_id: "owner", display_name: "Owner", roles: ["Producer"], genres: ["House"],
  languages: ["English"], bpm_min: 120, bpm_max: 130
};
const projects = [
  { id: "match", title: "Open House Session", brief: "Human collaborators wanted", status: "open",
    owner_member_id: "other", creator_name: "Another artist", role_needed: "Producer",
    genre: "House", language: "English", bpm: 124, premium_promoted: true },
  { id: "standard-match", title: "Standard Creator Session", brief: "Manual collaboration",
    status: "open", owner_member_id: "standard-owner", creator_name: "Standard artist",
    role_needed: "Producer", premium_promoted: false },
  { id: "wrong-role", title: "Vocals", status: "open", owner_member_id: "other", role_needed: "Vocalist" },
  { id: "wrong-genre", title: "Jazz", status: "open", owner_member_id: "other", genre: "Jazz" },
  { id: "wrong-language", title: "French", status: "open", owner_member_id: "other", language: "French" },
  { id: "wrong-tempo", title: "Fast", status: "open", owner_member_id: "other", bpm: 150 }
];

function fixture(passRow, { authenticated = true } = {}) {
  const calls = [];
  const handler = createCreatorNetworkHandler({
    getUser: async () => authenticated ? { id: "identity-owner" } : null,
    getDatabase: async () => ({
      sql: async (parts, ...params) => {
        const query = parts.join("?").replace(/\s+/g, " ").trim();
        calls.push({ query, params });
        if (query.includes("FROM halo_creator_passes WHERE")) return passRow ? [passRow] : [];
        if (query.startsWith("SELECT * FROM halo_creator_profiles")) return [profile];
        if (query.includes("WHERE p.status = 'open'")) return projects;
        if (query.includes("AS premium_verified")) return [{
          display_name: "Active Premium Creator", bio: "", roles: ["Producer"], genres: ["House"],
          languages: ["English"], premium_verified: true
        }];
        return [];
      }
    }),
    ensureMembership: async () => ({ member_id: "owner" }),
    verifyRequestOrigin: async () => true
  });
  return {
    calls,
    get: async query => {
      const response = await handler(new Request(`https://halo.test/api/creator-network${query || ""}`));
      assert.equal(response.status, 200);
      return response.json();
    }
  };
}

const member = fixture(premiumRow);
const workspace = await member.get("?memberId=victim&dynamicBriefSurfacing=true");
assert.equal(workspace.creatorPass.creatorId, "owner", "Own pass is bound to membership");
assert.equal(workspace.creatorPass.entitlements.priorityDiscovery, true);
assert.deepEqual(workspace.dynamicBriefs.map(project => project.id), ["match", "standard-match"],
  "Premium viewer matching can suggest both Premium-promoted and Standard-owner briefs");
assert.equal(workspace.dynamicBriefs[0].personaDraft.requiresHumanApproval, true);
assert.equal(workspace.dynamicBriefs[0].personaDraft.publishPublic, false);
assert.equal(workspace.dynamicBriefs[0].personaDraft.demo, true);
assert.equal(workspace.projects.length, projects.length, "Standard opportunities are unchanged");
assert.doesNotMatch(JSON.stringify(workspace), /private-customer|private-subscription|stripe_/);
assert.deepEqual(member.calls.find(call => call.query.includes("FROM halo_creator_passes WHERE")).params, ["owner"]);
assert.ok(member.calls.every(call => call.query.startsWith("SELECT")), "Surfacing never posts or mutates");
assert.ok(workspace.creators.filter(creator => creator.curated).every(creator => !creator.premium_verified));
const opportunitiesQuery = member.calls.find(call => call.query.includes("LIMIT 100")).query;
assert.match(opportunitiesQuery, /LEFT JOIN halo_creator_passes owner_pass ON owner_pass.member_id = p.owner_member_id/);
assert.match(opportunitiesQuery, /p.status = 'open' AND NULLIF\(BTRIM\(p.brief\), ''\) IS NOT NULL/);
assert.match(opportunitiesQuery, /owner_pass.subscription_tier = 'PREMIUM'/);
assert.match(opportunitiesQuery, /owner_pass.subscription_status = 'active' AND owner_pass.subscription_expires_at > NOW\(\)/);
assert.match(opportunitiesQuery, /owner_pass.subscription_status = 'trialing' AND owner_pass.trial_ends_at > NOW\(\)/);
assert.match(opportunitiesQuery, /owner_pass.subscription_expires_at IS NULL OR owner_pass.subscription_expires_at > NOW\(\)/);
assert.match(opportunitiesQuery, /ORDER BY premium_promoted DESC, p.updated_at DESC LIMIT 100/);
assert.doesNotMatch(opportunitiesQuery.split(" FROM ")[0], /owner_pass\.\*/);

for (const row of [
  null,
  { ...premiumRow, subscription_tier: "STANDARD" },
  ...["inactive", "past_due", "canceled", "expired"].map(subscription_status => ({ ...premiumRow, subscription_status })),
  { ...premiumRow, subscription_expires_at: past },
  { ...premiumRow, subscription_expires_at: null, entitlements: { dynamicBriefSurfacing: true } },
  { ...premiumRow, subscription_status: "trialing", trial_ends_at: null },
  { ...premiumRow, subscription_status: "trialing", trial_ends_at: past },
  { ...premiumRow, subscription_status: "trialing", trial_ends_at: future, subscription_expires_at: past }
]) {
  const state = await fixture(row).get("?dynamicBriefSurfacing=true&subscriptionTier=PREMIUM");
  assert.deepEqual(state.dynamicBriefs, [], "Client flags and non-current passes cannot surface premium briefs");
  assert.equal(state.creatorPass.entitlements.aiGuardianAccess, false);
  assert.equal(state.projects.length, projects.length);
  assert.equal(state.projects[0].premium_promoted, true,
    "Owner-side priority is visible even to Standard viewers, without granting them dynamic matching");
}
const trial = await fixture({
  ...premiumRow, subscription_status: "trialing", trial_ends_at: future, subscription_expires_at: null
}).get();
assert.equal(trial.dynamicBriefs.length, 2);

const guest = fixture(premiumRow, { authenticated: false });
const publicState = await guest.get("?view=public");
assert.equal(publicState.creators[0].premium_verified, true);
assert.equal(publicState.creatorPass, undefined);
assert.equal(guest.calls.length, 1, "Public discovery never loads a private member pass");
assert.doesNotMatch(JSON.stringify(publicState), /member_id|subscription_|trial_ends|stripe_/);
for (const [call, limit] of [[member.calls.find(call => call.query.includes("LIMIT 60")), 60], [guest.calls[0], 48]]) {
  assert.match(call.query, /LEFT JOIN halo_creator_passes pass USING \(member_id\)/);
  assert.match(call.query, /pass.subscription_tier = 'PREMIUM'/);
  assert.match(call.query, /pass.subscription_status = 'active' AND pass.subscription_expires_at > NOW\(\)/);
  assert.match(call.query, /pass.subscription_status = 'trialing' AND pass.trial_ends_at > NOW\(\)/);
  assert.match(call.query, /pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > NOW\(\)/);
  assert.match(call.query, new RegExp(`ORDER BY premium_verified DESC, c.updated_at DESC LIMIT ${limit}`),
    "Premium ranking happens in SQL before the cap, not after fetching the limited set");
  assert.doesNotMatch(call.query.split(" FROM ")[0], /SELECT \*|pass\.\*/);
}

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, html, css] = await Promise.all([
  read("creator-network/network.js"), read("creator-network/index.html"), read("creator-network/network.css")
]);
assert.match(html, /id="passTier"/);
assert.match(html, /id="dynamicBriefs"/);
assert.match(html, /Human.*|human action/);
assert.match(css, /\.premium-badge/);
assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|\/api\/signal-network/);

function uiFixture(state) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", children: [], listeners: new Map(), value: "", disabled: false,
      addEventListener(type, callback) { this.listeners.set(type, callback); },
      append(...children) { this.children.push(...children); },
      prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, reset() {},
      querySelector() { return element("submit"); },
      querySelectorAll() { return [element("health"), element("council")]; },
      get elements() { return []; }
    });
    return elements.get(id);
  };
  const calls = [];
  vm.runInNewContext(client.replace(/^import .+;\s*/gm, ""), {
    curatedCreators, URLSearchParams,
    mountMusicHomeCustomizer: () => ({ load() {}, clear() {} }),
    FormData: class { [Symbol.iterator]() { return [][Symbol.iterator](); } },
    document: { getElementById: element, createElement: tag => ({
      tagName: tag.toUpperCase(), textContent: "", children: [],
      append(...children) { this.children.push(...children); }, addEventListener() {}, setAttribute() {}
    }) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => String(url).includes("release-catalog") ? { releases: [] }
        : String(url).includes("view=public") ? { creators: state.creators } : state };
    },
    window: { haloIdentity: { getUser: async () => ({ id: "owner" }), onAuthChange() {} } }
  });
  return { element, calls };
}

const premiumUI = uiFixture({
  ...workspace, projects: [{ ...projects[0], owner_member_id: "owner" }],
  creators: [publicState.creators[0], ...curatedCreators().map(creator => ({ ...creator, premium_verified: true }))]
});
await new Promise(resolve => setImmediate(resolve));
for (const id of ["publicCreators", "creators"]) {
  const cards = premiumUI.element(id).children;
  assert.equal(cards[0].children.filter(child => child.className === "premium-badge").length, 1);
  assert.ok(cards.slice(1).every(card => card.children.every(child => child.className !== "premium-badge")),
    "Even an erroneous premium flag never badges curated demos");
}
assert.equal(premiumUI.element("passTier").textContent, "✓ VERIFIED PREMIUM");
assert.equal(premiumUI.element("health").disabled, false);
assert.equal(premiumUI.element("guardianProject").disabled, false);
assert.equal(premiumUI.element("dynamicBriefs").children[0].children.some(child =>
  child.textContent.includes("Human review and approval")), true);
assert.equal(premiumUI.element("dynamicBriefs").children[0].children.some(child =>
  child.href === "/signal-network/#feed"), true, "Signal handoff does not send a private title or draft");

const standardPass = {
  subscriptionTier: "STANDARD", subscriptionStatus: "active", subscriptionExpiresAt: future
};
const standardUI = uiFixture({
  ...workspace, creatorPass: { ...standardPass, entitlements: getCreatorPassEntitlements(standardPass) }
});
await new Promise(resolve => setImmediate(resolve));
assert.equal(standardUI.element("health").disabled, true);
assert.equal(standardUI.element("council").disabled, true);
assert.equal(standardUI.element("guardianProject").disabled, true);
assert.equal(standardUI.element("passTier").textContent, "STANDARD MEMBER");
assert.match(standardUI.element("dynamicBriefs").children[0].textContent, /active Premium Creator Pass/);
standardUI.element("guardianProject").value = "match";
await standardUI.element("guardianForm").listeners.get("submit")({
  preventDefault() {}, currentTarget: standardUI.element("guardianForm"), submitter: { value: "health" }
});
assert.equal(standardUI.calls.some(call => String(call.url).includes("studio-guardian")), false,
  "Manipulating disabled controls still cannot trigger a Standard review");

console.log("Creator Pass discovery contracts passed: SQL priority, public privacy, premium badges, gated dynamic briefs, human-only drafts and Guardian UI.");
