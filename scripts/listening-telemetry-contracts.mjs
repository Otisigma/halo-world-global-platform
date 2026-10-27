import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createListeningEventsHandler } from "../netlify/lib/listening-events.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const receipt = "10000000-0000-4000-8000-000000000001";
const start = { action: "listen_start", releaseId: "public-track" };
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

function server({ user = { id: "verified-member" }, origin = true, result = "ok", fail = false, enabled = false } = {}) {
  const queries = [];
  let memberships = 0;
  const handler = createListeningEventsHandler({
    getUser: () => user, verifyRequestOrigin: () => origin,
    ensureMembership: (_db, identity) => { memberships++; assert.equal(identity, user); },
    getDatabase: () => ({
      sql: async (strings, ...values) => {
        const sql = strings.join("?");
        queries.push({ sql, values });
        if (fail) throw new Error("sensitive database failure");
        return sql.includes("SELECT enabled") ? [{ enabled }] : [{ result, receipt }];
      }
    })
  });
  const request = (body, { headers = {}, method = body === undefined ? "GET" : "POST", query = "" } = {}) =>
    handler(new Request(`https://halo.example/api/listening-events${query}`, {
      method, headers: { Origin: "https://halo.example", "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    }));
  return { request, queries, memberships: () => memberships };
}

await check("guests, unverified origins, CSRF and query spoofing fail closed", async () => {
  const guest = server({ user: null });
  assert.equal((await guest.request(start)).status, 401);
  assert.equal((await guest.request()).status, 401);
  assert.equal(guest.queries.length, 0);
  for (const origin of [false]) assert.equal((await server({ origin }).request(start)).status, 403);
  for (const headers of [{ Origin: "" }, { Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await server().request(start, { headers })).status, 403);
  }
  assert.equal((await server().request(start, { query: "?user_id=victim" })).status, 403);
  assert.equal((await server().request(undefined, { method: "DELETE" })).status, 405);
});

await check("strict allowlist rejects identities, timestamps, event IDs, claims, arbitrary properties and injection", async () => {
  const api = server();
  for (const body of [null, [], "{bad", { action: "toString" }, { action: "milestone" },
    { action: "consent", enabled: "true" }, { action: "listen_start" },
    { ...start, releaseId: "x".repeat(101) }, { ...start, releaseId: "'; DROP TABLE users;--" },
    { action: "listen_complete", receipt: "forged" }]) {
    assert.equal((await api.request(body)).status, 400);
  }
  for (const key of ["user_id", "userId", "anonymousId", "sessionId", "timestamp", "created_at", "eventId", "ownerId", "milestone", "properties"]) {
    assert.equal((await api.request({ ...start, [key]: "spoofed" })).status, 400);
  }
  assert.equal(api.queries.length, 0);
  assert.equal((await api.request(start, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await api.request(start, { headers: { "Content-Length": "1025" } })).status, 413);
  assert.equal((await api.request(JSON.stringify({ ...start, padding: "é".repeat(600) }))).status, 413);
  assert.equal((await api.request(" ".repeat(1100), { headers: { "Content-Length": "1" } })).status, 413);
});

await check("only server identity and bound values reach persistence; responses never expose members", async () => {
  const api = server();
  const response = await api.request(start);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { accepted: true, receipt });
  assert.equal(api.memberships(), 1);
  assert.deepEqual(api.queries[0].values, ["verified-member", "listen_start", "public-track", null, null]);
  assert.ok(!api.queries[0].sql.includes("verified-member") && !api.queries[0].sql.includes("public-track"));
  const finish = server();
  assert.equal((await finish.request({ action: "listen_complete", receipt })).status, 202);
  assert.deepEqual(finish.queries[0].values, ["verified-member", "listen_complete", null, receipt, null]);
});

await check("consent defaults off, DNT/GPC override opt-in, deletion remains possible, quotas fail safely", async () => {
  assert.deepEqual(await (await server().request()).json(), { enabled: false });
  assert.deepEqual(await (await server({ enabled: true }).request()).json(), { enabled: true });
  for (const headers of [{ DNT: "1" }, { "Sec-GPC": "1" }]) {
    const api = server({ enabled: true });
    assert.deepEqual(await (await api.request(undefined, { headers })).json(), { enabled: false });
    assert.equal((await api.request(start, { headers })).status, 403);
    assert.equal((await api.request({ action: "consent", enabled: true }, { headers })).status, 403);
    assert.equal((await api.request({ action: "consent", enabled: false }, { headers })).status, 202);
  }
  for (const [result, status] of [["consent_required", 403], ["unavailable", 404], ["rate_limited", 429]]) {
    const response = await server({ result }).request(start);
    assert.equal(response.status, status);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
  }
  const failure = await server({ fail: true }).request(start);
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes("sensitive"));
});

const client = await read("listening-telemetry.js");
function target() {
  const handlers = {};
  return { handlers, addEventListener(name, callback) { (handlers[name] ||= []).push(callback); },
    emit(name, event = {}) { return Promise.all((handlers[name] || []).map(fn => fn(event))); } };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function browser({ consent = true, dnt = false, gpc = false, beacon = true, transport } = {}) {
  const checkbox = Object.assign(target(), { checked: false, disabled: true });
  const status = {};
  const window = target();
  const calls = [], beacons = [];
  const navigator = { doNotTrack: dnt ? "1" : "0", globalPrivacyControl: gpc, sendBeacon: (url, body) => {
    beacons.push({ url, body });
    if (beacon === "throws") throw new Error("beacon unavailable");
    return beacon;
  } };
  const fetch = async (url, init) => {
    const payload = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, payload });
    if (!payload) return Response.json({ enabled: consent });
    if (transport) return transport(payload);
    return Response.json(payload.action === "consent" ? { enabled: payload.enabled } : { accepted: true, receipt });
  };
  const context = vm.createContext({ window, navigator, fetch, Blob, document: {
    getElementById: id => id === "listeningAnalytics" ? checkbox : status
  } });
  vm.runInContext(client, context);
  const audio = target();
  let releaseId = "public-track";
  const binding = window.HaloListeningTelemetry.bindAudio(audio, () => releaseId);
  return { window, navigator, calls, beacons, checkbox, status, audio, binding, release: id => { releaseId = id; },
    events: () => calls.filter(c => c.payload && c.payload.action !== "consent") };
}

await check("no pre-consent, guest, DNT or GPC reports; playback errors never propagate", async () => {
  for (const options of [{ consent: false }, { dnt: true }, { gpc: true }]) {
    const h = browser(options);
    await settle();
    await h.audio.emit("playing");
    await h.audio.emit("ended");
    await h.window.emit("pagehide");
    await settle();
    assert.equal(h.events().length, 0);
    assert.equal(h.beacons.length, 0);
  }
  const h = browser({ transport: () => { throw new Error("offline"); } });
  await settle();
  await h.audio.emit("playing"); await settle();
  await h.audio.emit("ended"); h.binding.reset(); await h.window.emit("pagehide");
  assert.equal(h.events().length, 2, "one bounded retry, never a fabricated terminal report");
});

await check("native playing only, no buffering/resume duplicates, completion once, reset abandons once", async () => {
  const h = browser();
  await h.audio.emit("playing");
  assert.equal(h.events().length, 0, "no report before saved consent resolves");
  await settle();
  await h.audio.emit("playing"); await settle();
  await h.audio.emit("playing"); await h.audio.emit("pause"); await h.audio.emit("playing");
  await h.audio.emit("ended"); await h.audio.emit("ended"); h.binding.reset(); await settle();
  assert.deepEqual(h.events().map(c => c.payload.action), ["listen_start", "listen_complete"]);
  await h.audio.emit("playing"); await settle();
  h.binding.reset(); h.binding.reset(); await settle();
  assert.deepEqual(h.events().map(c => c.payload.action), ["listen_start", "listen_complete", "listen_start", "listen_abandon"]);
  assert.deepEqual(h.events()[1].payload, { action: "listen_complete", receipt });
  assert.equal(h.events()[0].init.credentials, "same-origin");
});

await check("unload uses typed JSON beacon, with safe fetch fallback for false/throw", async () => {
  for (const beacon of [true, false, "throws"]) {
    const h = browser({ beacon });
    await settle(); await h.audio.emit("playing"); await settle();
    await h.window.emit("pagehide"); await h.window.emit("pagehide"); await settle();
    assert.equal(h.beacons.length, 1);
    assert.equal(h.beacons[0].body.type, "application/json");
    assert.deepEqual(JSON.parse(await h.beacons[0].body.text()), { action: "listen_abandon", receipt });
    assert.equal(h.events().length, beacon === true ? 1 : 2);
    if (beacon !== true) assert.equal(h.events().at(-1).init.keepalive, true);
  }
});

await check("lost start response retries safely; pending completion waits for server receipt", async () => {
  let resolveStart, starts = 0;
  const h = browser({ transport: payload => {
    if (payload.action === "listen_start") {
      if (++starts === 1) throw new Error("lost response");
      return new Promise(resolve => { resolveStart = resolve; });
    }
    return Response.json({ accepted: true, receipt });
  } });
  await settle(); await h.audio.emit("playing"); await settle();
  await h.audio.emit("ended");
  assert.equal(h.events().length, 2);
  resolveStart(Response.json({ accepted: true, receipt }));
  await settle();
  assert.deepEqual(h.events().map(c => c.payload.action), ["listen_start", "listen_start", "listen_complete"]);
});

await check("opt-out clears in-flight reports; stale failures cannot undo newer consent", async () => {
  let resolveStart;
  const h = browser({ transport: payload => payload.action === "listen_start"
    ? new Promise(resolve => { resolveStart = resolve; }) : Response.json({ enabled: payload.enabled }) });
  await settle(); await h.audio.emit("playing"); await settle();
  h.checkbox.checked = false; await h.checkbox.emit("change");
  await h.audio.emit("ended"); await h.window.emit("pagehide");
  h.checkbox.checked = true; await h.checkbox.emit("change");
  resolveStart(Response.json({}, { status: 403 })); await settle();
  assert.equal(h.checkbox.checked, true);
  assert.equal(h.events().length, 1);
  assert.equal(h.beacons.length, 0);
});

await check("SQL enforces serialization, trusted releases, expiry, server IDs, quotas, deletion and first-terminal-wins", async () => {
  const migration = await read("netlify/database/migrations/20261027060000_listening_telemetry.sql");
  for (const pattern of [/DEFAULT gen_random_uuid\(\)/, /FOR UPDATE/, /preference\.consent_at IS NULL/,
    /status = 'published'/, /COALESCE\(visibility, 'public'\) = 'public'/, /s\.member_id = p_member/,
    /INTERVAL '4 hours'/, /preference\.attempts >= 60/, />= 200/, /AND outcome IS NULL/,
    /DELETE FROM halo_listening_sessions WHERE member_id = p_member/, /ON DELETE CASCADE/]) assert.match(migration, pattern);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /SECURITY DEFINER|metadata|user_agent|ip_address|position|duration\s+\w/i);
  assert.match(await read("netlify/functions/listening-events-cleanup.mjs"), /INTERVAL '30 days'/);
  assert.match(await read("netlify/functions/listening-events.mjs"), /getUser, verifyRequestOrigin/);
  assert.doesNotMatch(await read("music/music.js"), /haloStats\?\.track\("music_playback_start"/);
  assert.match(await read("music/music.js"), /this\.telemetry\?\.reset\(\)/);
});

console.log(`Listening telemetry contracts passed (${checks} groups).`);
