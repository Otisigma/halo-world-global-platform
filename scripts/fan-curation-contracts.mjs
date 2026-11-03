import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { curationInput, createFanCurationsHandler, FAN_CURATION_POLICY } from "../netlify/lib/fan-curations.mjs";
import { createFanCurationDesk } from "../album-concierge/fan-curations.js";

const id = "10000000-0000-4000-8000-000000000001";
const save = { action: "save", title: "Night Drive", releaseIds: ["release-one", "release-two", "release-three"] };
let groups = 0;
async function check(name, run) { await run(); groups++; console.log(`PASS: ${name}`); }
function server({ user = { id: "verified-member" }, origin = true, outcome = { result: "saved", id, rewardGranted: true }, fail = false } = {}) {
  const queries = [];
  const handler = createFanCurationsHandler({
    getUser: () => user, verifyRequestOrigin: () => origin,
    ensureMembership: (_db, member) => assert.equal(member, user),
    getDatabase: () => ({ sql: async (strings, ...values) => {
      const text = strings.join("?");
      queries.push({ text, values });
      if (fail) throw new Error("private-database-detail");
      if (text.includes("AS outcome")) return [{ outcome }];
      if (text.includes("AS earned")) return [{ enabled: true, earned: "25", spent: "0" }];
      if (text.includes("JOIN halo_fan_reward_redemptions") && text.includes("c.id =")) {
        return [{ title: '<script>alert("x")</script>', tracks: [{ id: "release-one", title: "<b>Song</b>", artist: '"Artist"' }] }];
      }
      return [];
    } })
  });
  const request = (body, { headers = {}, method = body === undefined ? "GET" : "POST", path = "/api/fan-curations" } = {}) =>
    handler(new Request(`https://halo.example${path}`, {
      method, headers: { Origin: "https://halo.example", "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    }));
  return { request, queries };
}

await check("identity and same-origin boundaries reject guests, spoofing and unsupported methods", async () => {
  const guest = server({ user: null });
  assert.equal((await guest.request()).status, 401);
  assert.equal((await guest.request(save)).status, 401);
  assert.equal(guest.queries.length, 0);
  assert.equal((await server({ origin: false }).request(save)).status, 403);
  for (const headers of [{ Origin: "" }, { Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await server().request(save, { headers })).status, 403);
  }
  assert.equal((await server().request(undefined, { path: "/api/fan-curations?memberId=victim" })).status, 403);
  assert.equal((await server().request(undefined, { method: "DELETE" })).status, 405);
});

await check("strict inputs reject forged balances, tiers, prices, URLs, oversized bodies and duplicate tracks", async () => {
  for (const invalid of [null, [], "{broken", { action: "mint" }, { ...save, title: "" }, { ...save, title: "x".repeat(121) },
    { ...save, title: "Null\0title" }, { ...save, releaseIds: ["x", "y"] }, { ...save, releaseIds: ["release-one", "release-one", "release-two"] },
    { ...save, releaseIds: ["release-one", "release-two", "'; DROP TABLE members;--"] },
    { action: "redeem", curationId: "forged", rewardId: "listening-card" },
    { action: "redeem", curationId: id, rewardId: "paid-audio" }]) {
    const api = server();
    assert.equal((await api.request(invalid)).status, 400);
    assert.equal(api.queries.length, 0);
  }
  for (const key of ["userId", "memberId", "points", "tier", "price", "rewardPoints", "audioUrl", "ownerId", "createdAt"]) {
    assert.equal((await server().request({ ...save, [key]: "forged" })).status, 400);
  }
  assert.equal((await server().request(save, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await server().request(" ".repeat(4097), { headers: { "Content-Length": "1" } })).status, 413);
  assert.equal((await server().request(save, { headers: { "Content-Length": "4097" } })).status, 413);
  assert.equal(curationInput({ ...save, title: "  Night Drive  " }).title, "Night Drive");
});

await check("mutations bind only verified identity and report committed outcomes without a masking read", async () => {
  const api = server();
  const result = await api.request(save);
  assert.equal(result.status, 201);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await result.json()).rewardGranted, true);
  assert.equal(api.queries.length, 1);
  assert.deepEqual(api.queries[0].values, ["verified-member", "Night Drive", save.releaseIds]);
  assert.ok(!api.queries[0].text.includes("verified-member"));
  const claim = server({ outcome: { result: "claimed", id: "redemption-id" } });
  const response = await claim.request({ action: "redeem", curationId: id, rewardId: "listening-card" });
  assert.equal((await response.json()).curationId, id);
  assert.deepEqual(claim.queries[0].values, ["verified-member", id]);
  for (const [outcome, status] of [["duplicate", 200], ["already_claimed", 200], ["invalid", 400], ["limit", 429],
    ["unavailable", 409], ["rewards_disabled", 409], ["not_found", 404], ["insufficient_points", 409]]) {
    const response = await server({ outcome: { result: outcome, id } }).request(save);
    assert.equal(response.status, status);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "86400");
  }
  const resultFail = await server({ fail: true }).request(save);
  assert.equal(resultFail.status, 503);
  assert.doesNotMatch(await resultFail.text(), /private-database-detail/);
});

await check("wallet distinguishes lifetime and spending; card output escapes content and enforces its own query shape", async () => {
  const response = await server().request();
  assert.deepEqual((await response.json()).wallet, { enabled: true, earned: 25, spent: 0, available: 25 });
  const card = await server().request(undefined, { path: `/api/fan-curations/card?curationId=${id}` });
  assert.equal(card.status, 200);
  assert.match(card.headers.get("Content-Disposition"), /attachment/);
  assert.match(card.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const html = await card.text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<b>Song<\/b>|verified-member/);
  assert.match(html, /https:\/\/halo\.example\/music\/\?song=release-one/);
  for (const path of ["/api/fan-curations/card", `/api/fan-curations/card?curationId=${id}&memberId=victim`,
    `/api/fan-curations/card?curationId=${id}&curationId=${id}`, "/api/fan-curations/card?curationId=bad"]) {
    assert.equal((await server().request(undefined, { path })).status, 400);
  }
  assert.equal((await server().request(save, { path: `/api/fan-curations/card?curationId=${id}` })).status, 405);
});

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.events = new Map(); this.attributes = {}; this.dataset = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.tag === selector || (selector === "input:checked" && child.tag === "input" && child.checked)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}
const state = () => ({
  policy: FAN_CURATION_POLICY, wallet: { enabled: true, earned: 25, spent: 0, available: 25 },
  releases: save.releaseIds.map(id => ({ id, title: "<b>Song</b>", artist: "Artist", available: true })),
  curations: [{ id, title: "<script>Curation</script>", redeemed: false,
    tracks: save.releaseIds.map(id => ({ id, title: "Song", artist: "Artist", available: true })) }]
});
function browser(transport) {
  const elements = Object.fromEntries(["form", "title", "tracks", "save", "refresh", "status", "wallet", "saved", "selection"]
    .map(name => [name, new Element(name === "form" ? "form" : name === "title" ? "input" : "div")]));
  const root = new Element();
  root.querySelector = selector => elements[selector.match(/data-curation-(\w+)/)[1]];
  elements.form.reset = () => {
    elements.title.value = "";
    for (const input of elements.tracks.querySelectorAll("input")) input.checked = false;
  };
  const calls = [];
  const desk = createFanCurationDesk(root, {
    document: { createElement: tag => new Element(tag) },
    fetch: async (path, options) => { calls.push({ path, options }); return transport(path, options); }
  });
  return { elements, root, calls, desk };
}
const event = { preventDefault() {} };
await check("client saves only selected catalog IDs, redeems explicitly and shows server balances", async () => {
  let data = state();
  const h = browser(async (_path, options) => {
    if (options.method !== "POST") return Response.json(data);
    const payload = JSON.parse(options.body);
    if (payload.action === "redeem") {
      data = { ...data, wallet: { enabled: true, earned: 25, spent: 25, available: 0 },
        curations: [{ ...data.curations[0], redeemed: true }] };
    }
    return Response.json({ message: "Committed server result." }, { status: 201 });
  });
  await h.desk.refresh();
  assert.match(h.elements.wallet.textContent, /25 available.*25 lifetime.*0 spent/);
  assert.equal(h.elements.tracks.children[0].children[1].textContent, "<b>Song</b> - Artist");
  for (const input of h.elements.tracks.querySelectorAll("input")) input.checked = true;
  h.elements.tracks.events.get("change")();
  assert.equal(h.elements.save.disabled, false);
  h.elements.title.value = "Night Drive";
  await h.elements.form.events.get("submit")(event);
  const post = h.calls.find(call => call.options.method === "POST");
  assert.deepEqual(JSON.parse(post.options.body), save);
  const button = h.elements.saved.querySelectorAll("button")[0];
  await h.elements.saved.events.get("click")({ target: { closest: () => button } });
  assert.match(h.elements.wallet.textContent, /0 available.*25 lifetime.*25 spent/);
  const download = h.elements.saved.querySelectorAll("a").at(-1);
  assert.equal(download.href, `/api/fan-curations/card?curationId=${id}`);
});

await check("client failures, consent-off, unavailable releases and late account responses stay honest", async () => {
  const h = browser(async () => Response.json({ ...state(), wallet: { enabled: false, earned: 25, spent: 0, available: 25 } }));
  await h.desk.refresh();
  assert.equal(h.elements.saved.querySelectorAll("button")[0].disabled, true);
  const hidden = browser(async () => Response.json({ ...state(), curations: [{ ...state().curations[0], tracks: [{ available: false }] }] }));
  await hidden.desk.refresh();
  assert.equal(hidden.elements.saved.querySelectorAll("button")[0].disabled, true);
  assert.equal(hidden.elements.saved.querySelectorAll("a").length, 0);
  const fail = browser(async () => Response.json({ message: "Unavailable" }, { status: 503 }));
  await fail.desk.refresh();
  assert.equal(fail.elements.save.disabled, true);
  assert.match(fail.elements.wallet.textContent, /Balance unavailable/);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const late = browser(async () => { await pending; return Response.json(state()); });
  const loading = late.desk.refresh();
  late.desk.reset();
  finish(); await loading;
  assert.equal(late.elements.saved.children.length, 0);
  assert.match(late.elements.wallet.textContent, /Sign in/);
  const guest = browser(async () => Response.json({}, { status: 401 }));
  await guest.desk.refresh();
  assert.match(guest.elements.status.textContent, /Sign in/);
});

await check("committed mutation plus failed refresh does not report an uncommitted operation", async () => {
  let gets = 0;
  const h = browser(async (_path, options) => options.method === "POST"
    ? Response.json({ message: "Curation saved. +25 verified Signal Points." }, { status: 201 })
    : ++gets === 1 ? Response.json(state()) : Response.json({}, { status: 503 }));
  await h.desk.refresh();
  h.elements.title.value = "Night Drive";
  for (const input of h.elements.tracks.querySelectorAll("input")) input.checked = true;
  await h.elements.form.events.get("submit")(event);
  assert.match(h.elements.status.textContent, /Curation saved.*Could not refresh.*do not assume the operation failed/);
  assert.equal(h.elements.save.disabled, true);
});

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
await check("navigation, keyboard semantics and reward policy remain connected", async () => {
  const [page, music, network, migration, ci] = await Promise.all([
    read("album-concierge/index.html"), read("music/index.html"), read("signal-network/index.html"),
    read("netlify/database/migrations/20261103110000_fan_curation_rewards.sql"), read(".github/workflows/ci.yml")
  ]);
  assert.match(page, /<fieldset>[\s\S]*<legend>Choose public releases/);
  assert.match(page, /data-curation-status role="status" aria-live="polite"/);
  assert.match(page, /fan-curations\.js" type="module"/);
  assert.match(music, /href="\/album-concierge\/#fan-curations"/);
  assert.match(network, /href="\/album-concierge\/#fan-curations"/);
  assert.match(migration, /'fan-curation:' \|\| v_day, 25/);
  assert.match(migration, /v_earned - v_spent < 25/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /UNIQUE \(member_id, curation_id, reward_id\)/);
  assert.match(ci, /name: Fan curation \+ atomic reward contracts/);
  assert.match(ci, /run: npm run test:fan-curations:db/);
});
console.log(`Fan curation contracts passed (${groups} groups).`);
