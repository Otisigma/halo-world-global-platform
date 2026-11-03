import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { createSentinel, sentinelSource } from "../lib/halo-sentinel.js";
import { createSentinelEventsHandler, normalizeSentinelEvent } from "../netlify/lib/sentinel-events.mjs";
import { repairSentinelMarkup, SENTINEL_PAGES } from "./sentinel-source-repair.mjs";

class Media extends EventTarget {
  constructor() { super(); this.source = ""; this.dataset = {}; this.loads = 0; this.plays = 0; }
  getAttribute(name) { return name === "src" ? this.source : null; }
  set src(value) { this.source = value; }
  get src() { return this.source; }
  load() { this.loads++; }
  play() { this.plays++; }
}

function fixture(transport = async (_url, init) => init.method === "POST"
  ? Response.json({ stored: true }) : new Response(null, { headers: { "Content-Type": "audio/wav" } }), clock) {
  const window = new EventTarget();
  const warnings = [], errors = [], timers = new Map(), links = [];
  window.location = new URL("https://halo.test/dreamweaver/?song=private-id");
  window.console = { warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) };
  window.setInterval = (callback, ms) => { timers.set(1, { callback, ms }); return 1; };
  window.clearInterval = id => timers.delete(id);
  let disconnected = false;
  window.MutationObserver = class { observe() {} disconnect() { disconnected = true; } };
  const document = { documentElement: {}, querySelectorAll: () => links };
  const calls = [];
  const sentinel = createSentinel({ window, document, clock, fetch: async (url, init) => {
    calls.push({ url, init });
    return transport(url, init);
  } });
  const audio = new Media();
  let unavailable = 0, blocked = 0;
  sentinel.bind({
    audio, expectedSource: () => "https://halo.test/audio/master.wav",
    onUnavailable: () => unavailable++, onBlocked: () => blocked++
  });
  return { sentinel, audio, window, links, timers, errors, warnings, calls,
    unavailable: () => unavailable, blocked: () => blocked, disconnected: () => disconnected };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

await check("bind repair is source-authorized, load-after-src, no autoplay, and bounded to 15 seconds", async () => {
  const f = fixture();
  assert.equal(f.timers.get(1).ms, 15000);
  f.sentinel.checkBindings();
  assert.equal(f.audio.src, "https://halo.test/audio/master.wav");
  assert.equal(f.audio.loads, 1);
  assert.equal(f.audio.plays, 0);
  f.sentinel.checkBindings();
  assert.equal(f.audio.loads, 1);
  await settle();
  assert.equal(f.audio.dataset.sentinelTransport, "headers-verified");
  const audit = f.sentinel.snapshot().events;
  assert.ok(audit.every(event => event.delivery === "stored"));
  assert.ok(!JSON.stringify(audit).includes("private-id"));
  assert.ok(!audit.some(event => event.state === "recovered"), "load is not proof of recovery");
  f.audio.dispatchEvent(new Event("playing"));
  assert.ok(f.sentinel.snapshot().events.some(event => event.kind === "binding" && event.state === "recovered"));
  f.sentinel.dispose();
});

await check("HEAD verifies transport over real HTTP without downloading audio or counting a GET play", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.method);
    response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": "4096" }).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const source = `http://127.0.0.1:${server.address().port}/audio.wav`;
  const f = fixture((url, init) => init.method === "POST" ? Response.json({ stored: true }) : fetch(url, init));
  // The fake page's local origin mirrors a real development deployment.
  f.sentinel.dispose();
  f.window.location = new URL(source);
  const sentinel = createSentinel({ window: f.window, document: { documentElement: {}, querySelectorAll: () => [] },
    fetch: (url, init) => init.method === "POST" ? Promise.resolve(Response.json({ stored: true })) : fetch(url, init) });
  sentinel.bind({ audio: f.audio, expectedSource: () => source });
  f.audio.src = source;
  try {
    assert.deepEqual(await sentinel.preflight(f.audio, source), { ok: true, checked: true });
    assert.deepEqual(requests, ["HEAD"]);
  } finally {
    sentinel.dispose();
    server.close();
    await once(server, "close");
  }
});

await check("broken/non-audio transport offers recovery without declaring healing", async () => {
  const f = fixture(async (_url, init) => init.method === "POST" ? Response.json({ stored: true })
    : new Response(null, { status: 404, headers: { "Content-Type": "text/html" } }));
  f.audio.src = "https://halo.test/audio/master.wav";
  assert.equal((await f.sentinel.preflight(f.audio, f.audio.src)).ok, false);
  assert.equal(f.unavailable(), 1);
  assert.ok(f.sentinel.snapshot().events.some(event => event.state === "recovery_available"));
  assert.ok(!f.sentinel.snapshot().events.some(event => event.state === "recovered"));
  f.audio.dispatchEvent(new Event("error"));
  assert.equal(f.unavailable(), 1, "same source cannot loop through recovery");
  await f.sentinel.preflight(f.audio, f.audio.src, { recover: false });
  assert.equal(f.unavailable(), 1, "diagnostic-only preflight failure cannot interrupt playback");
  await f.sentinel.preflight(f.audio, f.audio.src);
  assert.equal(f.unavailable(), 2, "an explicit retry of the same URL can still recover on a later failure");
  f.audio.dispatchEvent(new Event("playing"));
  assert.ok(f.sentinel.snapshot().events.some(event => event.state === "recovered"));
  f.sentinel.dispose();
});

await check("policy blocking requires a gesture and does not suppress unknown promise failures", async () => {
  const f = fixture();
  f.sentinel.blocked(f.audio);
  assert.equal(f.blocked(), 1);
  assert.equal(f.audio.plays, 0);
  f.sentinel.checkBindings();
  const rejection = new Event("unhandledrejection", { cancelable: true });
  f.window.dispatchEvent(rejection);
  assert.equal(rejection.defaultPrevented, false);
  assert.ok(f.sentinel.snapshot().events.some(event => event.kind === "runtime" && event.state === "unresolved"));
  f.audio.dispatchEvent(new Event("playing"));
  assert.ok(f.sentinel.snapshot().events.some(event => event.kind === "autoplay" && event.state === "recovered"));
  assert.ok(f.sentinel.snapshot().events.some(event => event.kind === "binding" && event.state === "recovered"),
    "one playing event resolves each independently observed recovery, not just the latest fault");
  f.sentinel.dispose();
});

await check("canonical correction changes only a known same-origin trailing slash and preserves IDs", async () => {
  const f = fixture();
  const link = { href: "/dreamweaver?song=correct&mix=exact", dataset: { sentinelCanonical: "/dreamweaver/" },
    getAttribute() { return this.href; } };
  f.links.push(link);
  f.sentinel.checkBindings();
  assert.equal(link.href, "https://halo.test/dreamweaver/?song=correct&mix=exact");
  link.href = "https://other.test/dreamweaver/?song=wrong";
  f.sentinel.checkBindings();
  assert.equal(link.href, "https://other.test/dreamweaver/?song=wrong", "unknown distribution targets are never guessed");
  assert.ok(f.sentinel.snapshot().events.some(event => event.kind === "canonical" && event.state === "unresolved"));
  f.sentinel.dispose();
});

await check("stale probes, local previews, disable/dispose and no-credential cross-origin probes are safe", async () => {
  let complete;
  const f = fixture(async (_url, init) => init.method === "POST" ? Response.json({ stored: true })
    : new Promise(resolve => { complete = resolve; }));
  f.audio.src = "https://cdn.test/master.wav?signed=never-log";
  const pending = f.sentinel.preflight(f.audio, f.audio.src);
  assert.equal(f.calls[0].init.credentials, "omit");
  f.audio.src = "blob:https://halo.test/local";
  complete(new Response(null, { status: 404 }));
  assert.equal((await pending).stale, true);
  assert.equal(f.unavailable(), 0);
  f.audio.dataset.sentinelTransport = "headers-verified";
  assert.equal((await f.sentinel.preflight(f.audio, f.audio.src)).checked, false);
  assert.equal(f.audio.dataset.sentinelTransport, undefined, "a local replacement cannot inherit transport verification");
  f.sentinel.setEnabled(false);
  f.audio.src = "";
  f.sentinel.checkBindings();
  assert.equal(f.audio.loads, 0);
  f.sentinel.dispose();
  assert.equal(f.disconnected(), true);
  assert.equal(f.timers.size, 0);
  assert.equal(sentinelSource("javascript:alert(1)", "https://halo.test"), "");
  assert.equal(sentinelSource("https://user:password@halo.test/a.wav", "https://halo.test"), "");
  assert.equal(sentinelSource("blob:https://other.test/local", "https://halo.test"), "");
});

await check("canvas failure and failed ledger delivery stay explicitly unresolved", async () => {
  const f = fixture(async () => new Response(null, { status: 503 }));
  assert.equal(f.sentinel.canvasContext({ getContext: () => null }), null);
  await settle();
  assert.equal(f.sentinel.snapshot().events[0].state, "unresolved");
  assert.equal(f.sentinel.snapshot().events[0].delivery, "failed");
  assert.equal(f.errors.length, 1);
  f.sentinel.dispose();
});

await check("audit retries stay within 16 attempts per minute and three per event without a lifetime cutoff", async () => {
  let now = 0;
  const f = fixture(async () => new Response(null, { status: 503 }), () => now);
  f.audio.src = "https://halo.test/audio/master.wav";
  f.sentinel.canvasContext({ getContext: () => null });
  f.sentinel.blocked(f.audio);
  f.window.dispatchEvent(new Event("unhandledrejection"));
  f.links.push({ href: "/wrong/", dataset: { sentinelCanonical: "/dreamweaver/" },
    getAttribute() { return this.href; } });
  f.sentinel.checkBindings();
  f.audio.dispatchEvent(new Event("error"));
  await settle();
  f.sentinel.checkBindings();
  await settle();
  f.sentinel.checkBindings();
  await settle();
  f.sentinel.checkBindings();
  assert.equal(f.calls.length, 16, "delivery must stop at the current minute's budget");
  f.links.length = 0;
  now += 60000;
  f.sentinel.checkBindings();
  await settle();
  assert.equal(f.calls.length, 21, "the next window retries remaining events beyond the old lifetime cap");
  f.sentinel.checkBindings();
  assert.equal(f.calls.length, 21, "no event may exceed three delivery attempts");
  assert.ok(f.sentinel.snapshot().events.every(event => event.delivery === "failed"));
  f.sentinel.dispose();
});

await check("event API enforces origin, bounded body, enum-only data, rate limit, and durable ledger acknowledgement", async () => {
  const entries = [];
  let accept = true, fail = false;
  const handler = createSentinelEventsHandler({
    getDatabase: () => ({}), acceptReport: async () => accept,
    append: async (_db, entry) => {
      if (fail) throw new Error("storage unavailable");
      entries.push(entry); return "ledger-id";
    }
  });
  const payload = { kind: "transport", state: "detected", target: "player", page: "/dreamweaver/" };
  const request = (body = payload, origin = "https://halo.test") => new Request("https://halo.test/api/sentinel/events", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  assert.equal((await handler(request())).status, 201);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].details.sourceFixApplied, false);
  assert.equal(entries[0].details.evidence, "untrusted-browser-observation");
  assert.equal(entries[0].outcome, "pending");
  assert.equal((await handler(request(payload, "https://evil.test"))).status, 403);
  assert.equal((await handler(request(payload, ""))).status, 403);
  assert.equal((await handler(request({ ...payload, kind: "execute" }))).status, 400);
  assert.equal((await handler(request({ ...payload, padding: "x".repeat(3000) }))).status, 413);
  accept = false;
  assert.equal((await handler(request())).status, 429);
  accept = true; fail = true;
  const failure = await handler(request());
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).stored, false);
  assert.equal(normalizeSentinelEvent({ ...payload, url: "https://secret.test/?token=private" }).url, undefined);
  assert.equal((await handler(new Request("https://halo.test/api/sentinel/events"))).status, 405);
});

await check("finite source recipes restore known bindings, are idempotent and reject uncertain repairs", async () => {
  for (const page of SENTINEL_PAGES) {
    const source = await readFile(new URL(`../${page.path}`, import.meta.url), "utf8");
    assert.equal(repairSentinelMarkup(page.path, source).source, source);
    const broken = source.replace('<script type="module" src="/halo-sentinel.js"></script>', "")
      .replace('<link rel="stylesheet" href="/halo-sentinel.css">', "");
    const repaired = repairSentinelMarkup(page.path, broken);
    assert.equal(repaired.changes.length, 2);
    assert.equal(repairSentinelMarkup(page.path, repaired.source).changes.length, 0);
    assert.ok(repaired.source.indexOf('src="/halo-sentinel.js"') < repaired.source.indexOf(page.anchor));
    assert.throws(() => repairSentinelMarkup(page.path, source.replace(page.anchor, "")), /Ambiguous/);
    const audio = page.path.startsWith("dreamweaver") ? 'id="showAudio" preload="auto"' : 'data-showcase-audio controls preload="none"';
    const mutated = source.replace(audio, audio.replace(/preload="[^"]+"/, 'preload="wrong"'));
    assert.equal(repairSentinelMarkup(page.path, mutated).changes.length, 1);
  }
  assert.throws(() => repairSentinelMarkup("netlify/functions/private.mjs", ""), /allowlisted/);
  const workflow = await readFile(new URL("../.github/workflows/halo-sentinel.yml", import.meta.url), "utf8");
  assert.match(workflow, /HALO_SENTINEL_REPAIR_ENABLED == 'true'/);
  assert.match(workflow, /test:sentinel.*test:drive-catalog.*test:audio-preloader.*test:concierge-showcase.*build/);
  assert.doesNotMatch(workflow, /pull_request_target|gh pr merge|git push.*main|--force/);
});

console.log(`HALO Sentinel contracts: ${checks}/${checks} passed.`);
