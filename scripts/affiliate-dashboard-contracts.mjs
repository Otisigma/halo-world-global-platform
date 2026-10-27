import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AFFILIATE_TERMS, createAffiliateDashboardHandler, loadAffiliateInvitations } from "../netlify/functions/affiliate-dashboard.mjs";
import { loadMemberRewards } from "../netlify/lib/track-drops.mjs";
import { connectAffiliateIdentity, createAffiliateDashboard } from "../affiliate/affiliate.js";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }
const request = (suffix = "", options) => new Request(`https://halo.example/api/affiliate-dashboard${suffix}`, options);
const token = "a".repeat(32);
const rewardDb = points => ({ sql: async () => [{ points, opt_in_points: 0, open_drop_points: points }] });
const disabled = await loadMemberRewards(rewardDb(0), "member-a", false);
const rewards = await loadMemberRewards(rewardDb(50), "member-a", true);
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
const database = queries => ({
  sql: async (strings, ...values) => {
    const text = strings.join("?");
    queries.push({ text, values });
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE)\b/);
    if (text.includes("joined_members")) return [{ token, joined_members: 2 }];
    if (text.includes("rewards_enabled")) return [{ rewards_enabled: true }];
    if (text.includes("SUM(points)")) return [{ points: 50, opt_in_points: 0, open_drop_points: 50 }];
    throw new Error("Unexpected query");
  }
});
const handler = createAffiliateDashboardHandler({
  currentUser: async () => ({ id: "member-a" }),
  database: async () => database([])
});
const payload = await (await handler(request())).json();

class Element {
  constructor() { this.hidden = false; this.value = ""; this.textContent = ""; this.attributes = {}; this.events = new Map(); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
}
function harness(fetch) {
  const root = new Element();
  const elements = Object.fromEntries(["status", "private", "signin", "refresh", "invite-details", "invite-link",
    "joins", "invite-empty", "referral-status", "points-status"].map(name => [name, new Element()]));
  root.querySelector = selector => elements[selector.slice(6, -1)];
  const timers = new Map();
  const ui = createAffiliateDashboard(root, {
    fetch,
    setTimeout: fn => { const key = {}; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key)
  });
  return { root, elements, ui, timers };
}

await check("API requires authentication before database access and rejects mutations", async () => {
  const guest = createAffiliateDashboardHandler({
    currentUser: () => null,
    database: () => { throw new Error("must not query"); }
  });
  assert.equal((await guest(request())).status, 401);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const result = await handler(request("", { method, body: JSON.stringify({ points: 5000, payout: true }) }));
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("Allow"), "GET");
  }
});

await check("authenticated ownership scopes every query; no invitee identity or payment secrets are returned", async () => {
  const queries = [];
  const api = createAffiliateDashboardHandler({ currentUser: () => ({ id: "member-a" }), database: () => database(queries) });
  const result = await api(request("?memberId=victim&points=5000&tier=sovereign&paid=true"));
  const data = await result.json();
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal(result.headers.get("Vary"), "Cookie");
  assert.equal(data.rewards.points, 50);
  assert.ok(queries.length >= 3);
  assert.ok(queries.every(query => query.values.every(value => value === "member-a")));
  assert.doesNotMatch(JSON.stringify(data), /victim|member-a|email|customer_id|stripeAccount|secret|roles/);
});

await check("invitation read contract excludes self-referrals, deduplicates members across invites and fixes link destination", async () => {
  const queries = [];
  assert.deepEqual(await loadAffiliateInvitations(database(queries), "member-a"), {
    status: "tracked_invite", url: `/halo-x.html?invite=${token}`, joinedMembers: 2
  });
  const { text, values } = queries[0];
  assert.match(text, /COUNT\(DISTINCT event.member_id\)/);
  assert.match(text, /event.event_type = 'joined'/);
  assert.match(text, /event.member_id <> \?/);
  assert.match(text, /invite.created_by_member_id = \?/);
  assert.deepEqual(values, ["member-a", "member-a", "member-a"]);
  const empty = await loadAffiliateInvitations({ sql: async () => [{ token: null, joined_members: 0 }] }, "member-a");
  assert.deepEqual(empty, { status: "no_invite", url: null, joinedMembers: 0 });
  for (const row of [{ token: "javascript:alert(1)", joined_members: 1 }, { token, joined_members: -1 }, { token, joined_members: null }]) {
    await assert.rejects(loadAffiliateInvitations({ sql: async () => [row] }, "member-a"));
  }
  const apiSource = await readFile(new URL("../netlify/functions/share-invite.mjs", import.meta.url), "utf8");
  assert.match(apiSource, /created_by_member_id === membership.member_id/);
  assert.match(apiSource, /ON CONFLICT \(invite_token, member_id\).*DO NOTHING/);
});

await check("no paid attribution, active-month accounting, money, tier or payout is fabricated", async () => {
  assert.deepEqual(AFFILIATE_TERMS, {
    revenueSharePercent: 10, activePaidMonthCap: 12, minimumPayoutMinor: 5000, currency: "USD",
    holdDays: 14, guidePoints: 5000, requestedGuideMultiplier: 1.5
  });
  assert.equal(payload.affiliate.status, "unavailable");
  for (const key of ["referralUrl", "activeReferrals", "activePaidMonths", "earnedMinor", "heldMinor", "availableMinor", "paidMinor", "payoutHistory"]) {
    assert.equal(payload.affiliate[key], null, `${key} must remain unknown, not zero or an empty payout history`);
  }
  assert.deepEqual(payload.guide, { status: "not_configured", awardedTier: null, appliedMultiplier: null, badge: null });
  // Boundaries are deliberately not calculated: there is no trustworthy billing ledger.
  for (const suffix of ["?paidMonth=12", "?paidMonth=13", "?holdDays=13", "?holdDays=14",
    "?availableMinor=4999", "?availableMinor=5000", "?refund=true", "?chargeback=true", "?payout=true"]) {
    assert.deepEqual((await (await handler(request(suffix))).json()).affiliate, payload.affiliate);
  }
  const repeated = await Promise.all(Array.from({ length: 10 }, () => handler(request("?eventId=retry&paid=true"))));
  for (const result of repeated) assert.deepEqual((await result.json()).affiliate, payload.affiliate);
  const source = await readFile(new URL("../netlify/functions/affiliate-dashboard.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /processRoyaltySplits|from ["']stripe|transfers\.create|grantMemberReward|\bINSERT\b|\bUPDATE\b/);
});

await check("missing integrations fail independently; disabled rewards never query a points balance", async () => {
  const partial = createAffiliateDashboardHandler({
    currentUser: () => ({ id: "member-a" }),
    database: () => ({ sql: async strings => {
      if (strings.join("").includes("rewards_enabled")) return [];
      throw new Error("missing migration");
    } })
  });
  const data = await (await partial(request())).json();
  assert.deepEqual(data.invitations, { status: "unavailable", url: null, joinedMembers: null });
  assert.equal(data.rewards.enabled, false);
  const failed = createAffiliateDashboardHandler({ currentUser: () => ({ id: "member-a" }), database: () => { throw new Error("private connection string"); } });
  const result = await failed(request());
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /connection string/);
});

await check("dashboard loading, real invitation, empty and partial-data states use read-only same-origin requests", async () => {
  let complete;
  const wait = new Promise(resolve => { complete = resolve; });
  const h = harness(async (path, options) => {
    assert.equal(path, "/api/affiliate-dashboard");
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    await wait; return response(payload);
  });
  const loading = h.ui.refresh();
  assert.match(h.elements.status.textContent, /Loading/);
  assert.equal(h.root.attributes["aria-busy"], "true");
  assert.equal(h.elements.private.hidden, true);
  complete(); await loading;
  assert.equal(h.elements.private.hidden, false);
  assert.equal(h.elements.joins.textContent, "2");
  assert.equal(h.elements["invite-link"].value, `/halo-x.html?invite=${token}`);
  assert.match(h.elements["points-status"].textContent, /50 points.*does not establish Verified Guide/);
  assert.equal(h.root.attributes["aria-busy"], "false");
  assert.equal(h.timers.size, 0);
  for (const invitations of [
    { status: "no_invite", url: null, joinedMembers: 0 },
    { status: "unavailable", url: null, joinedMembers: null }
  ]) {
    const empty = harness(async () => response({ ...payload, invitations, rewards: disabled }));
    await empty.ui.refresh();
    assert.equal(empty.elements["invite-details"].hidden, true);
    assert.equal(empty.elements["invite-link"].value, "");
    assert.match(empty.elements["points-status"].textContent, /rewards are off/);
    assert.equal(empty.elements.joins.textContent, invitations.status === "no_invite" ? "0" : "Unavailable");
  }
});

await check("401, errors, malformed data and timeout hide private data; refresh can recover", async () => {
  let result = response(payload);
  const h = harness(async () => result);
  await h.ui.refresh();
  assert.equal(h.elements.private.hidden, false);
  result = response({}, 401); await h.ui.refresh();
  assert.equal(h.elements.private.hidden, true);
  assert.equal(h.elements.signin.hidden, false);
  assert.equal(h.elements["invite-link"].value, "");
  for (const invalid of [
    response({}, 503), response({}),
    response({ ...payload, invitations: { status: "tracked_invite", url: "javascript:alert(1)", joinedMembers: 1 } }),
    response({ ...payload, rewards: { ...rewards, points: 5000 } }),
    response({ ...payload, affiliate: { ...payload.affiliate, paidMinor: 5000 } })
  ]) {
    result = invalid; await h.ui.refresh();
    assert.equal(h.elements.private.hidden, true);
    assert.match(h.elements.status.textContent, /Could not load/);
  }
  result = response(payload); await h.ui.refresh();
  assert.equal(h.elements.private.hidden, false);
  const timed = harness((_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("timeout")));
  }));
  const loading = timed.ui.refresh();
  for (const fn of timed.timers.values()) fn();
  await loading;
  assert.match(timed.elements.status.textContent, /Could not load/);
  assert.equal(timed.root.attributes["aria-busy"], "false");
});

await check("account changes, reset and destroy prevent late private responses resurfacing", async () => {
  let complete;
  const h = harness(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.ui.refresh();
  h.ui.reset();
  complete(response(payload)); await pending;
  assert.equal(h.elements.private.hidden, true);
  assert.equal(h.elements["invite-link"].value, "");
  const second = h.ui.refresh();
  h.ui.destroy();
  complete(response(payload)); await second;
  assert.equal(h.elements.private.hidden, true);
  assert.equal(h.elements.refresh.events.size, 0);
  let changed;
  const calls = [];
  connectAffiliateIdentity({ reset: () => calls.push("reset"), refresh: () => calls.push("refresh") }, {
    onAuthChange: fn => { changed = fn; }
  });
  changed("logout", null);
  assert.deepEqual(calls, ["refresh", "reset", "refresh"]);
});

await check("page exposes accessible private setup states and explicit deployment/reconciliation prerequisites", async () => {
  const html = await readFile(new URL("../affiliate/index.html", import.meta.url), "utf8");
  for (const pattern of [
    /data-private hidden/, /role="status" aria-live="polite"/, /type="text" readonly/,
    /10% recurring share/, /12 active paid months/, /\$50 USD minimum accrued/, /14-day refund\/chargeback hold/,
    /5,000 Signal Points.*1\.5× multiplier.*Gold badge/, /no affiliate payout records/,
    /signed payment-event verification/, /Transactions and locking/, /Refunds and chargebacks/,
    /reconciliation before marking individual ledger entries paid/, /test-mode/,
    /explicit tracking consent/, /No new migration/, /Self-hosted static serving/
  ]) assert.match(html, pattern);
  assert.doesNotMatch(html, /data-payout|onclick=|sk_live_|acct_|<form/);
  const signal = await readFile(new URL("../signal-network/index.html", import.meta.url), "utf8");
  assert.match(signal, /href="\/affiliate\/"/);
});

console.log(`Affiliate dashboard contracts passed (${checks} checks). Financial processing is not implemented or simulated.`);
