import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadMemberRewards, grantMemberReward, REWARD_TIERS } from "../netlify/lib/track-drops.mjs";
import { createTrackDropsHandler } from "../netlify/functions/track-drops.mjs";
import { tierFor } from "../signal-network/signal-satellite.js";
import { createFanSignalTracker, verifiedRewards } from "../signal-network/fan-signal-tracker.js";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }
const rewardDb = points => ({ sql: async () => [{ points, opt_in_points: Math.min(50, points), open_drop_points: Math.max(0, points - 50) }] });
const response = data => ({ ok: true, status: 200, json: async () => data });
const earned = async points => ({ rewards: await loadMemberRewards(rewardDb(points), "member", true) });

class Element {
  constructor() { this.attributes = {}; this.events = new Map(); this.children = []; this.hidden = false; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
  replaceChildren(...children) { this.children = children; }
}
function harness(fetch) {
  const root = new Element();
  const elements = Object.fromEntries(["concierge-status", "concierge-retry", "points-status", "points-progress", "points-breakdown"]
    .map(name => [name, new Element()]));
  root.querySelector = selector => elements[selector.slice(6, -1)];
  const timers = new Map();
  const ui = createFanSignalTracker(root, {
    fetch, document: { createElement: () => new Element() },
    setTimeout: fn => { const key = {}; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key)
  });
  return { root, elements, ui, timers };
}

await check("ledger balance, complete breakdown and server tier thresholds agree at every boundary", async () => {
  for (const points of [0, 50, 99, 100, 101, 299, 300, 749, 750, 10000]) {
    const data = await earned(points);
    const rewards = verifiedRewards(data);
    assert.equal(rewards.points, points);
    assert.equal(rewards.breakdown.reduce((sum, item) => sum + item.points, 0), points);
    const next = REWARD_TIERS.find(tier => tier.minPoints > points);
    assert.deepEqual(rewards.progress, next ? { value: points, max: next.minPoints, label: next.label } : null);
    assert.equal(rewards.tier.label, REWARD_TIERS.filter(tier => tier.minPoints <= points).at(-1).label);
  }
  const other = await loadMemberRewards({ sql: async () => [{ points: 90, opt_in_points: 50, open_drop_points: 30 }] }, "member", true);
  assert.equal(other.breakdown[2].points, 10, "unknown reward sources remain accounted for");
  assert.equal(tierFor(499).progress, 99, "local preview must not round up to a completed tier");
  assert.equal(tierFor(500).progress, 0);
  let queried = false;
  assert.equal((await loadMemberRewards({ sql() { queried = true; } }, "member", false)).enabled, false);
  assert.equal(queried, false, "disabled rewards must not report a misleading zero verified balance");
});

await check("verified summaries reject malformed balances, mismatched breakdowns and impossible progress", async () => {
  const data = await earned(50);
  for (const rewards of [
    { ...data.rewards, points: -1 }, { ...data.rewards, points: "50" },
    { ...data.rewards, points: Infinity }, { ...data.rewards, breakdown: [] },
    { ...data.rewards, breakdown: [{ label: "Spoof", points: 10000 }, ...data.rewards.breakdown.slice(1)] },
    { ...data.rewards, progress: { value: 50, max: 50, label: "Unlocked" } },
    { ...data.rewards, progress: { value: 10000, max: 20000, label: "Spoofed" } }
  ]) assert.throws(() => verifiedRewards({ rewards }));
});

await check("API reads only authenticated member ledger; client points, identity and unlock flags confer nothing", async () => {
  const queries = [];
  const handler = createTrackDropsHandler({
    currentUser: async () => ({ id: "authenticated-user" }),
    membershipFor: async (_db, user) => { assert.equal(user.id, "authenticated-user"); return { member_id: "actual-member" }; },
    database: async () => ({ sql: async (strings, ...values) => {
      queries.push({ text: strings.join("?"), values });
      return strings.join("").includes("SUM(points)") ? [{ points: 50, opt_in_points: 50, open_drop_points: 0 }] : [{ rewards_enabled: true }];
    } }),
    verifyOrigin: () => true
  });
  const result = await handler(new Request("https://halo.example/api/track-drops?memberId=victim&points=10000&unlocked=true"));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal((await result.json()).rewards.points, 50);
  assert.ok(queries.every(query => query.values.includes("actual-member") && !query.values.includes("victim")));
  const guest = createTrackDropsHandler({ currentUser: () => null, database() { throw new Error("must not query"); } });
  assert.equal((await guest(new Request("https://halo.example/api/track-drops"))).status, 401);
  for (const action of ["claim-album", "mint", "select-tracks"]) {
    const result = await handler(new Request("https://halo.example/api/track-drops", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, points: 10000, unlocked: true, tracks: ["invalid", "private", ...Array(50).fill("duplicate")] })
    }));
    assert.equal(result.status, 400, "no invented album claim or selection action is available");
  }
  assert.ok(queries.every(query => !/INSERT|UPDATE/.test(query.text)));
});

await check("existing reward grants remain persisted once per member and key, never album claims", async () => {
  const saved = new Set();
  const db = { sql: async (strings, ...values) => {
    assert.match(strings.join(""), /ON CONFLICT \(member_id, reward_key\) DO NOTHING/);
    const key = `${values[0]}:${values[1]}`;
    if (saved.has(key)) return [];
    saved.add(key); return [{ reward_key: values[1] }];
  } };
  const reward = { key: "track-drops-opt-in", points: 50, reason: "Joined HALO track drops" };
  assert.equal(await grantMemberReward(db, "member-a", reward), true);
  assert.equal(await grantMemberReward(db, "member-a", reward), false);
  assert.equal(await grantMemberReward(db, "member-b", reward), true);
});

await check("UI exposes loading, verified progress, empty concepts, safe text and read-only requests", async () => {
  const data = await earned(99);
  const calls = [];
  let complete;
  const wait = new Promise(resolve => { complete = resolve; });
  const h = harness(async (path, options) => {
    calls.push({ path, options }); await wait;
    return response(path === "/api/track-drops" ? data : { sessions: [] });
  });
  const loading = h.ui.refresh();
  assert.match(h.elements["points-status"].textContent, /Loading/);
  assert.equal(h.root.attributes["aria-busy"], "true");
  complete(); await loading;
  assert.match(h.elements["points-status"].textContent, /99 points.*1 points to Insider/);
  assert.equal(h.elements["points-progress"].value, 99);
  assert.equal(h.elements["points-progress"].max, 100);
  assert.equal(h.elements["points-progress"].hidden, false);
  assert.match(h.elements["concierge-status"].textContent, /No album concepts yet/);
  assert.equal(h.elements["points-breakdown"].children.length, 3);
  assert.ok(calls.every(({ options }) => options.method === "GET" && options.credentials === "same-origin" && !options.body));
  assert.equal(h.timers.size, 0);
  assert.equal(h.root.attributes["aria-busy"], "false");
});

await check("unauthenticated, disabled, failed, malformed, retry and saved-concept states stay honest", async () => {
  for (const payload of [response({ rewards: { enabled: false } }), { status: 401 }, { ok: false, status: 503 }, response({ rewards: { points: 10000, unlocked: true } })]) {
    const h = harness(async path => path === "/api/track-drops" ? payload : response({ sessions: [{ isPremium: true, title: "<script>", claimed: true }] }));
    await h.ui.refresh();
    assert.equal(h.elements["points-progress"].hidden, true);
    assert.match(h.elements["concierge-status"].textContent, /Recent album concepts: 1.*not reward claims/);
    assert.equal(h.elements["concierge-status"].textContent, "Recent album concepts: 1 (latest 20). These are saved creative sessions, not reward claims or owned recordings.");
  }
  let fail = true;
  const h = harness(async path => {
    if (fail) throw new Error("private server detail");
    return response(path === "/api/track-drops" ? await earned(750) : { sessions: [] });
  });
  await h.ui.refresh();
  assert.equal(h.elements["concierge-retry"].hidden, false);
  assert.doesNotMatch(h.elements["points-status"].textContent, /private server detail/);
  fail = false;
  await h.elements["concierge-retry"].events.get("click")();
  assert.match(h.elements["points-status"].textContent, /Top member reward tier/);
  assert.equal(h.elements["points-progress"].hidden, true);
  assert.equal(h.elements["concierge-retry"].hidden, true);
});

await check("account change, close and destruction discard late private responses; timeout permits retry", async () => {
  let complete;
  const wait = new Promise(resolve => { complete = resolve; });
  const h = harness(async () => { await wait; return response(await earned(50)); });
  const loading = h.ui.refresh();
  h.ui.reset(); complete(); await loading;
  assert.doesNotMatch(h.elements["points-status"].textContent, /Verified member rewards: 50/);
  assert.equal(h.elements["points-breakdown"].children.length, 0);
  h.ui.destroy();
  assert.equal(h.elements["concierge-retry"].events.size, 0);
  const timed = harness((_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("timeout")));
  }));
  const pending = timed.ui.refresh();
  [...timed.timers.values()][0](); await pending;
  assert.equal(timed.elements["concierge-retry"].hidden, false);
  assert.equal(timed.root.attributes["aria-busy"], "false");
});

await check("native keyboard controls, semantic progress, responsive and motion conventions are wired without modifying protected flows", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [page, script, styles, concierge] = await Promise.all([
    read("signal-network/index.html"), read("signal-network/signal-satellite.js"),
    read("signal-network/signal-satellite.css"), read("netlify/functions/album-concierge.mjs")
  ]);
  assert.match(page, /<progress data-points-progress aria-label=/);
  assert.match(page, /<summary>Local activity breakdown and unlock prerequisites<\/summary>/);
  assert.match(page, /data-concierge-retry type="button"/);
  assert.match(page, /href="\/album-concierge\/">Open Album Concierge concept tool/);
  assert.match(page, /No album entitlement or already-claimed status/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /repeat\(auto-fit/);
  assert.match(styles, /\.halo-satellite__modal \{[^}]*overflow-y: auto/s);
  assert.match(styles, /\.halo-satellite__modal\[open\] \{ display: block/);
  assert.match(styles, /\.halo-satellite__modal-header \{ position: sticky/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(script, /fanTracker\.refresh\(\)/);
  assert.match(script, /onAuthChange\(\(\) => \{\s+fanTracker\.reset\(\)/);
  assert.match(script, /function onModalClosed\(\) \{\s+fanTracker\.reset\(\)/);
  assert.match(concierge, /WHERE member_id = \$1 ORDER BY created_at DESC LIMIT 20/);
  assert.match(concierge, /WHERE id = \$1 AND member_id = \$2 LIMIT 1/);
});

console.log(`Fan Signal tracker contracts: ${checks}/${checks} checks passed.`);
