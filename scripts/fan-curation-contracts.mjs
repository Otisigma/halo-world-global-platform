import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { curationInput, createFanCurationsHandler, FAN_CURATION_POLICY, constellationPilotAccess, constellationDatabaseUrl } from "../netlify/lib/fan-curations.mjs";
import { createFanCurationDesk } from "../satellites/constellation-lab/fan-curations.js";
import { constellationSvg, IMAGINED_TRACKS } from "../satellites/constellation-lab/constellation.js";
import { constellationPreviewUrl } from "../lib/constellation-media.js";
import { realConstellationSvg, createRealSongStars } from "../satellites/constellation-lab/real-stars.js";

const id = "10000000-0000-4000-8000-000000000001";
const save = { action: "save", title: "Night Drive", releaseIds: ["release-one", "release-two", "release-three"] };
let groups = 0;
async function check(name, run) { await run(); groups++; console.log(`PASS: ${name}`); }
function server({
  user = { id: "verified-member" }, origin = true,
  environment = name => ({
    CONTEXT: "dev", HALO_CONSTELLATION_ENABLED: "true", HALO_CONSTELLATION_PILOT_MEMBERS: "verified-member",
    HALO_CONSTELLATION_DATABASE_URL: "postgresql://test@preview.example/constellation"
  })[name] ?? "",
  outcome = { result: "saved", id, rewardGranted: true }, fail = false
} = {}) {
  const queries = [];
  const handler = createFanCurationsHandler({
    environment,
    getUser: () => user, verifyRequestOrigin: () => origin,
    ensureMembership: (_db, member) => assert.equal(member, user),
    getDatabase: options => {
      assert.equal(options.connectionString, environment("HALO_CONSTELLATION_DATABASE_URL"));
      return { sql: async (strings, ...values) => {
      const text = strings.join("?");
      queries.push({ text, values });
      if (fail) throw new Error("private-database-detail");
      if (text.includes("AS outcome")) return [{ outcome }];
      if (text.includes("id = ? AND status")) return [{ id: "release-one", title: "Public song", artist: "Artist", stream_url: "/assets/public.wav" }];
      if (text.includes("AS earned")) return [{ enabled: true, earned: "25", spent: "0" }];
      if (text.includes("JOIN halo_fan_reward_redemptions") && text.includes("c.id =")) {
        return [{ title: '<script>alert("x")</script>', tracks: [{ id: "release-one", title: "<b>Song</b>", artist: '"Artist"' }] }];
      }
      return [];
    } };
    }
  });
  const request = (body, { headers = {}, method = body === undefined ? "GET" : "POST", path = "/api/fan-curations" } = {}) =>
    handler(new Request(`https://halo.example${path}`, {
      method, headers: { Origin: "https://halo.example", "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    }));
  return { request, queries };
}

await check("pilot is default-off, production-blocked and exact-member allowlisted before database access", async () => {
  for (const settings of [{}, { HALO_CONSTELLATION_ENABLED: "true" },
    { CONTEXT: "production", HALO_CONSTELLATION_ENABLED: "true", HALO_CONSTELLATION_PILOT_MEMBERS: "verified-member" },
    { CONTEXT: "dev", HALO_CONSTELLATION_ENABLED: "TRUE", HALO_CONSTELLATION_PILOT_MEMBERS: "verified-member" },
    { CONTEXT: "dev", HALO_CONSTELLATION_ENABLED: "false" }]) {
    const api = server({ environment: name => settings[name] ?? "" });
    for (const [body, path] of [[undefined, "/api/fan-curations"], [save, "/api/fan-curations"],
      [{ action: "redeem", curationId: id, rewardId: "listening-card" }, "/api/fan-curations"],
      [undefined, `/api/fan-curations/card?curationId=${id}`],
      [undefined, "/api/fan-curations/preview?releaseId=release-one"]]) {
      assert.equal((await api.request(body, { path })).status, 503);
    }
    assert.equal(api.queries.length, 0);
  }
  let identityCalls = 0;
  const closed = createFanCurationsHandler({
    environment: () => "", getUser: () => { identityCalls++; },
    getDatabase: () => { throw new Error("Closed pilot must not access database"); }
  });
  await check("real-song preview validates static public audio, checks identity and does not grant rewards", async () => {
    for (const value of ["/assets/song.wav", "https://audio.example/song.mp3"]) assert.equal(constellationPreviewUrl(value), value);
    for (const value of ["/api/song-catalog/audio?id=private", "/api/stem-vault/audio", "/private/song.wav",
      "https://audio.example/private/song.wav", "https://audio.example/song.mp3?token=secret",
      "https://drive.google.com/file/d/song.mp3", "//evil.example/song.mp3", "http://audio.example/song.mp3",
      "https://127.0.0.1/song.mp3", "https://localhost/song.mp3", "javascript:alert(1)", "/assets/page.html"]) {
      assert.equal(constellationPreviewUrl(value), "");
    }
    const api = server();
    const response = await api.request(undefined, { path: "/api/fan-curations/preview?releaseId=release-one" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).audioUrl, "/assets/public.wav");
    assert.equal(api.queries.length, 1);
    assert.deepEqual(api.queries[0].values, ["release-one"]);
    assert.equal((await server({ user: null }).request(undefined, { path: "/api/fan-curations/preview?releaseId=release-one" })).status, 401);
    for (const path of ["/api/fan-curations/preview", "/api/fan-curations/preview?releaseId=one&memberId=victim",
      "/api/fan-curations/preview?releaseId=one&releaseId=two"]) {
      assert.equal((await server().request(undefined, { path })).status, 400);
    }
    assert.equal((await server().request(save, { path: "/api/fan-curations/preview?releaseId=release-one" })).status, 405);
    const svg = realConstellationSvg([{ id: "one", title: "<script>Song</script>", artist: "Artist" }]);
    assert.match(svg, /&lt;script&gt;/);
    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /ARTIST OWNED/);
  });
  assert.equal((await closed(new Request("https://halo.example/api/fan-curations"))).status, 503);
  assert.equal(identityCalls, 0);
  const noInvitation = server({ environment: name => ({ CONTEXT: "deploy-preview", HALO_CONSTELLATION_ENABLED: "true",
    HALO_CONSTELLATION_PILOT_MEMBERS: "verified-member-other",
    HALO_CONSTELLATION_DATABASE_URL: "postgresql://test@preview.example/constellation" })[name] ?? "" });
  assert.equal((await noInvitation.request()).status, 403);
  assert.equal((await noInvitation.request(save)).status, 403);
  assert.equal(noInvitation.queries.length, 0);
  assert.equal(constellationPilotAccess("verified-member", name => ({ CONTEXT: "deploy-preview", HALO_CONSTELLATION_ENABLED: "true",
    HALO_CONSTELLATION_PILOT_MEMBERS: "other, verified-member " })[name] ?? ""), true);
});
await check("dedicated database is mandatory and cannot fall back to the primary connection", async () => {
  const settings = { CONTEXT: "deploy-preview", HALO_CONSTELLATION_ENABLED: "true",
    HALO_CONSTELLATION_PILOT_MEMBERS: "verified-member" };
  for (const database of [undefined, "", "https://preview.example/db", "postgresql://preview.example/",
    "postgresql://test:secret@primary.example:5432/halo?sslmode=require", "postgres://other@PRIMARY.EXAMPLE/halo",
    "postgresql://primary.example/%68alo"]) {
    const env = name => ({ ...settings, HALO_CONSTELLATION_DATABASE_URL: database,
      NETLIFY_DB_URL: "postgresql://main:password@primary.example/halo" })[name] ?? "";
    assert.equal(constellationDatabaseUrl(env), null);
    const api = server({ environment: env });
    assert.equal((await api.request()).status, 503);
    assert.equal((await api.request(save)).status, 503);
    assert.equal(api.queries.length, 0);
  }
  const preview = "postgresql://test@preview.example/constellation";
  assert.equal(constellationDatabaseUrl(name => ({ HALO_CONSTELLATION_DATABASE_URL: preview,
    NETLIFY_DB_URL: "postgresql://main@primary.example/halo" })[name] ?? ""), preview);
});

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
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() {}
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.tag === selector || (selector === "input:checked" && child.tag === "input" && child.checked)
        || (selector === "[data-real-star]" && child.dataset.realStar)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}
await check("real-star player has no autoplay, rejects unsafe sources and discards late playback after disconnect", async () => {
  const nodes = Object.fromEntries(["map", "stars", "selected", "audio", "status", "stop"].map(name => [name, new Element()]));
  let played = 0, paused = 0, source;
  Object.defineProperty(nodes.audio, "src", { get: () => source, set: value => { source = value; } });
  nodes.audio.pause = () => { paused++; };
  nodes.audio.load = () => {};
  nodes.audio.play = async () => { played++; };
  const root = { querySelector: selector => nodes[selector.match(/data-real-(\w+)/)[1]] };
  const track = { id: "release-one", title: "Actual title", artist: "Actual artist", previewAvailable: true };
  let finish, unsafe = false;
  const calls = [];
  const stars = createRealSongStars(root, {
    document: { createElement: tag => new Element(tag) },
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (!unsafe) return new Promise(resolve => { finish = resolve; });
      return Response.json({ id: track.id, audioUrl: "/api/song-catalog/audio?private=true" });
    }
  });
  stars.render([track]);
  assert.equal(played, 0);
  assert.equal(calls.length, 0);
  const preview = nodes.stars.children[0].children[1];
  const pending = preview.events.get("click")();
  stars.reset();
  assert.equal(calls[0].options.signal.aborted, true);
  finish(Response.json({ id: track.id, audioUrl: "/assets/song.wav" }));
  await pending;
  assert.equal(played, 0);
  assert.equal(nodes.stars.children.length, 0);
  unsafe = true;
  stars.render([track]);
  await nodes.stars.children[0].children[1].events.get("click")();
  assert.equal(played, 0);
  assert.match(nodes.status.textContent, /No approved public audio/);
  assert.ok(paused > 0);
});
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
await check("satellite is isolated from stable pages, with keyboard semantics and guarded reward policy", async () => {
  const [page, music, network, migration, ci, concierge, client] = await Promise.all([
    read("satellites/constellation-lab/index.html"), read("music/index.html"), read("signal-network/index.html"),
    read("netlify/database/migrations/20261103110000_fan_curation_rewards.sql"), read(".github/workflows/ci.yml"),
    read("album-concierge/index.html"), read("satellites/constellation-lab/constellation.js")
  ]);
  assert.match(page, /<fieldset>[\s\S]*<legend>Choose 3-12 public releases/);
  assert.match(page, /data-curation-status role="status" aria-live="polite"/);
  assert.match(page, /type="module" src="\.\/constellation\.js"/);
  assert.match(page, /data-fan-curation-desk hidden/);
  for (const stablePage of [music, network, concierge]) assert.doesNotMatch(stablePage, /constellation-lab|data-fan-curation-desk|fan-curations\.js/);
  assert.doesNotMatch(page, /stats\.js|site-monitor\.js|identity\.js|https:\/\//);
  assert.doesNotMatch(client, /localStorage|sessionStorage|sendBeacon/);
  assert.match(migration, /'fan-curation:' \|\| v_day, 25/);
  assert.match(migration, /v_earned - v_spent < 25/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /UNIQUE \(member_id, curation_id, reward_id\)/);
  assert.match(ci, /name: Fan curation \+ atomic reward contracts/);
  assert.match(ci, /run: npm run test:fan-curations:db/);
});
await check("local artwork is deterministic, escapes titles, preserves sequence and never grants points", async () => {
  const ids = IMAGINED_TRACKS.slice(0, 3).map(track => track.id);
  const first = constellationSvg(ids, '<script>alert("x")</script>', "aurora");
  assert.equal(constellationSvg(ids, '<script>alert("x")</script>', "aurora"), first);
  assert.match(first, /&lt;script&gt;/);
  assert.doesNotMatch(first, /<script>|onload=|<foreignObject/);
  assert.match(first, /no real points/);
  assert.notEqual(constellationSvg([...ids].reverse(), "Journey"), constellationSvg(ids, "Journey"));
  assert.notEqual(constellationSvg(ids, "Journey", "ocean"), constellationSvg(ids, "Journey", "aurora"));
  assert.throws(() => constellationSvg(["unknown"], "Journey"));
  assert.throws(() => constellationSvg([ids[0], ids[0]], "Journey"));
  assert.throws(() => constellationSvg(ids, "Journey", "javascript:alert(1)"));
  assert.throws(() => constellationSvg(ids, "x".repeat(81)));
});
console.log(`Fan curation contracts passed (${groups} groups).`);
