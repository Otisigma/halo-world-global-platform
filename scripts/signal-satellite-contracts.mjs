import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CHAT_COOLDOWN_MS, DAILY_CEILING, EARN_RULES, REWARD_CATALOG, SATELLITE_EVENT, SATELLITE_STORAGE_KEY, TIERS, WELCOME_BONUS,
  createSatelliteEngine, createSignalSatellite, sanitizeState, tierFor
} from "../signal-network/signal-satellite.js";

const root = new URL("../signal-network/", import.meta.url);
const [page, styles, feed, script] = await Promise.all(
  ["index.html", "signal-satellite.css", "signal-feed.js", "signal-satellite.js"].map(file => readFile(new URL(file, root), "utf8"))
);
let passed = 0;
const check = (name, fn) => { fn(); passed++; };

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value))
  };
}
function clock(start = new Date(2026, 9, 7, 12).getTime()) {
  let time = start;
  return { now: () => time, advance: ms => { time += ms; } };
}

check("first visit grants a one-time welcome bonus and persists it", () => {
  const storage = memoryStorage();
  const engine = createSatelliteEngine({ storage, now: clock().now });
  assert.equal(engine.getState().points, WELCOME_BONUS);
  assert.equal(engine.getState().lifetimePoints, WELCOME_BONUS);
  assert.equal(engine.getState().history.length, 1);
  const again = createSatelliteEngine({ storage, now: clock().now });
  assert.equal(again.getState().points, WELCOME_BONUS, "reload does not re-grant the bonus");
  assert.equal(again.getState().history.length, 1);
});

check("corrupt, hostile or unavailable storage falls back to safe defaults", () => {
  for (const value of ["{not json", "null", "[]", "\"text\"", "42"]) {
    const engine = createSatelliteEngine({ storage: memoryStorage({ [SATELLITE_STORAGE_KEY]: value }), now: clock().now });
    assert.equal(engine.getState().points, WELCOME_BONUS);
  }
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  const engine = createSatelliteEngine({ storage: throwing, now: clock().now });
  assert.equal(engine.getState().points, WELCOME_BONUS);
  assert.equal(engine.persistFailed, true);
  assert.equal(createSatelliteEngine({ storage: null, now: clock().now }).getState().activeChannel, "inner_circle");
  const state = sanitizeState({
    welcomed: true, points: 9e99, lifetimePoints: -5, unread: "7", activeChannel: "admin",
    redeemedRewards: ["track_wav", "track_wav", "free_money"], history: [{ reason: 1 }, { reason: "ok", pts: 3, at: "x" }],
    messages: [{ text: "<img src=x onerror=alert(1)>", channel: "inner_circle" }, { text: "bad", channel: "nope" }],
    awardedPosts: { boost: [1, "", "p1"] }, daily: { day: "1999-01-01", total: 99 }
  });
  assert.equal(state.lifetimePoints, 0);
  assert.equal(state.points, 0, "points never exceed lifetime points");
  assert.equal(state.unread, 0);
  assert.equal(state.activeChannel, "inner_circle");
  assert.deepEqual(state.redeemedRewards, ["track_wav"]);
  assert.equal(state.history.length, 1);
  assert.equal(state.messages.length, 1);
  assert.deepEqual(state.awardedPosts.boost, ["p1"]);
  assert.equal(state.daily.total, 0, "stale daily ledger resets");
});

check("tiers derive from lifetime points with in-tier progress", () => {
  assert.equal(tierFor(0).tier.name, "Initiate");
  assert.equal(tierFor(250).progress, 50);
  assert.equal(tierFor(500).tier.name, "Signal Artisan");
  assert.equal(tierFor(500).progress, 0);
  assert.equal(tierFor(19999).tier.name, "Vault Architect");
  const top = tierFor(TIERS.at(-1).minHP + 1);
  assert.equal(top.next, null);
  assert.equal(top.progress, 100);
});

check("chat earns with cooldown, duplicate, length and daily caps", () => {
  const time = clock();
  const engine = createSatelliteEngine({ storage: memoryStorage(), now: time.now });
  assert.equal(engine.sendMessage("   ").ok, false);
  assert.equal(engine.sendMessage("Love the sax lead").award.awarded, EARN_RULES.chat.points);
  assert.equal(engine.sendMessage("Another idea").award.reason, "cooldown");
  time.advance(CHAT_COOLDOWN_MS);
  assert.equal(engine.sendMessage("another IDEA").award.reason, "duplicate");
  assert.equal(engine.sendMessage("ok").award.reason, "short");
  let earned = EARN_RULES.chat.points;
  for (let index = 0; index < 20; index++) {
    time.advance(CHAT_COOLDOWN_MS);
    earned += engine.sendMessage(`fresh thought ${index}`).award.awarded;
  }
  assert.equal(earned, EARN_RULES.chat.dailyCap);
  assert.equal(engine.getState().points, WELCOME_BONUS + EARN_RULES.chat.dailyCap);
  time.advance(24 * 60 * 60 * 1000);
  assert.equal(engine.sendMessage("a new day").award.awarded, EARN_RULES.chat.points, "caps reset the next day");
  assert.ok(engine.getState().messages.every(message => message.text.length <= 500));
});

check("feed engagement awards once per post and respects the daily ceiling", () => {
  const engine = createSatelliteEngine({ storage: memoryStorage(), now: clock().now });
  assert.equal(engine.award("boost", { postId: "post-1" }).awarded, EARN_RULES.boost.points);
  assert.equal(engine.award("boost", { postId: "post-1" }).reason, "repeat");
  assert.equal(engine.award("save").reason, "invalid");
  assert.equal(engine.award("admin").reason, "unknown");
  let total = EARN_RULES.boost.points;
  for (let index = 0; index < 50; index++) {
    for (const kind of ["publish", "boost", "save", "comment", "chat"]) total += engine.award(kind, { postId: `p-${index}` }).awarded;
  }
  assert.equal(total, DAILY_CEILING);
  assert.equal(engine.getState().daily.total, DAILY_CEILING);
});

check("redemption requires balance, is single-use and never touches lifetime points", () => {
  const time = clock();
  const storage = memoryStorage();
  const engine = createSatelliteEngine({ storage, now: time.now });
  const cheapest = REWARD_CATALOG.reduce((low, item) => item.cost < low.cost ? item : low);
  assert.equal(engine.redeem(cheapest.id).reason, "insufficient");
  for (let day = 0; day < 2; day++) {
    for (let index = 0; index < 10; index++) engine.award("publish", { postId: `${day}-${index}` });
    time.advance(24 * 60 * 60 * 1000);
  }
  const before = engine.getState();
  assert.ok(before.points >= cheapest.cost);
  assert.equal(engine.redeem(cheapest.id).ok, true);
  const after = engine.getState();
  assert.equal(after.points, before.points - cheapest.cost);
  assert.equal(after.lifetimePoints, before.lifetimePoints);
  assert.equal(after.history[0].pts, -cheapest.cost);
  assert.equal(engine.redeem(cheapest.id).reason, "redeemed");
  assert.equal(engine.redeem("unknown").reason, "unknown");
  assert.deepEqual(JSON.parse(storage.getItem(SATELLITE_STORAGE_KEY)).redeemedRewards, [cheapest.id]);
});

check("unread, channels and notifications stay consistent", () => {
  const engine = createSatelliteEngine({ storage: memoryStorage(), now: clock().now });
  engine.notify("+5 HP · Boosted a signal");
  engine.notify("quiet", { unread: false });
  assert.equal(engine.getState().unread, 1);
  engine.markRead();
  assert.equal(engine.getState().unread, 0);
  assert.equal(engine.setChannel("collaborator_vault"), true);
  assert.equal(engine.setChannel("not-a-channel"), false);
  engine.sendMessage("vault note");
  const messages = engine.getState().messages;
  assert.equal(messages.at(-1).channel, "collaborator_vault");
  assert.equal(messages[0].system, true);
});

check("controller is inert without the satellite markup", () => {
  const controller = createSignalSatellite({ document: null, window: null });
  assert.equal(controller.openDrawer(), false);
  assert.equal(createSignalSatellite({ document: { querySelector: () => null, getElementById: () => null } }).openRewards(), false);
});

check("Signal Network page ships the satellite shell with accessible semantics", () => {
  assert.match(page, /href="\/signal-network\/signal-satellite.css"/);
  assert.match(page, /<script type="module" src="\/signal-network\/signal-satellite.js"><\/script>/);
  assert.match(page, /data-signal-satellite hidden/);
  for (const id of ["haloPointsBadgeBtn", "haloChatToggleBtn", "haloChatDrawer", "haloChatForm", "haloChatMessageInput", "haloRewardsModal",
    "haloRewardsGrid", "haloEarnHistoryList", "haloTiersBody", "modalTierProgressBar", "haloCloseChatBtn", "haloCloseRewardsBtn"]) {
    assert.equal(page.split(`id="${id}"`).length - 1, 1, `${id} appears once`);
  }
  assert.match(page, /<dialog class="halo-satellite__modal" id="haloRewardsModal" aria-labelledby="haloRewardsTitle"/);
  assert.match(page, /id="haloChatToggleBtn" type="button" aria-controls="haloChatDrawer" aria-expanded="false"/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /id="haloChatMessages" role="log"/);
  assert.match(page, /data-halo-command-search aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(page, /data-halo-search-fallback/);
  assert.match(page, /never grant ownership, licensing rights or paid access/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.halo-satellite \[hidden\]/);
});

check("feed emits server-confirmed engagement and the satellite renders without innerHTML or alerts", () => {
  assert.equal(SATELLITE_EVENT, "halo:signal-engagement");
  assert.match(feed, /"halo:signal-engagement"/);
  assert.match(feed, /await mutate\(kind, \{ postId: post\.id, active \}\);\n\s+emitEngagement\(kind, \{ postId: post\.id, active \}\);/);
  assert.match(feed, /await mutate\("publish", data, origin\);\n\s+emitEngagement\("publish"/);
  assert.match(feed, /emitEngagement\("comment", \{ postId: post\.id \}\)/);
  assert.ok(!/innerHTML|alert\(/.test(script));
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.metaKey \|\| event\.ctrlKey/);
});

console.log(`Signal satellite contracts: ${passed}/${passed} checks passed.`);
