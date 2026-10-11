import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { validSignalWord } from "../lib/signal-emotion.js";
import { createSignalEmotionHandler } from "../netlify/lib/signal-emotion.mjs";
import { createSignalMapController } from "../music/signal-map.js";

const secret = "signal-contract-only-identity";
const releaseId = "red-flags";
const row = { id: "00000000-0000-4000-8000-000000000001", emotion_word: "Clarity", created_at: "2026-10-10T17:00:00Z" };
const body = { releaseId, word: "Clarity", playbackSeconds: 12 };
function fixture(options = {}) {
  const state = { queries: [], saved: [], allowed: true, eligible: true, user: null, ...options };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    state.queries.push({ query, values });
    if (state.fail) throw new Error("private database details");
    if (query.includes("halo_signal_emotion_allow")) return [{ allowed: state.allowed }];
    if (query.includes("INSERT INTO halo_signal_emotions")) {
      assert.match(query, /WITH eligible[\s\S]+visibility = 'public' AND status = 'published'/);
      assert.match(query, /INSERT INTO halo_ledger[\s\S]+FROM inserted/);
      assert.match(query, /SELECT \?, 'listener'/);
      assert.equal(values.includes("private-member"), false);
      assert.ok(values.some(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)));
      assert.ok(values.includes(12));
      if (!state.eligible) return [];
      state.saved.push(row);
      return [row];
    }
    assert.match(query, /emotion.hidden = FALSE/);
    assert.match(query, /release.visibility = 'public' AND release.status = 'published'/);
    assert.match(query, /ORDER BY emotion.created_at DESC, emotion.id DESC LIMIT 24/);
    assert.ok(values.includes(releaseId));
    return state.saved;
  } };
  const handler = createSignalEmotionHandler({ getDatabase: () => db, getUser: () => state.user,
    verifyRequestOrigin: () => state.origin !== false,
    env: state.env || { SIGNAL_EMOTION_IDENTITY_SECRET: secret } });
  return { state, request: (value, headers = {}, context = { ip: "192.0.2.1" }) => handler(
    new Request(`https://halo.example/api/signal/emotion${value === undefined ? `?releaseId=${releaseId}` : ""}`,
      value === undefined ? {} : { method: "POST", headers: { Origin: "https://halo.example", "Content-Type": "application/json", ...headers },
        body: typeof value === "string" ? value : JSON.stringify(value) }), context), handler };
}

for (const word of ["Clarity", "自由", "paix", "éveillé", "a".repeat(20)]) assert.ok(validSignalWord(word));
for (const word of ["", "two words", " space", "space ", "new\nline", "tab\tword", "two\u00a0words", "a".repeat(21),
  "<script>", "peace!", "123", "free\u200b", "e\u0301", null, {}, ["peace"]]) {
  assert.equal(validSignalWord(word), false);
  const f = fixture();
  assert.equal((await f.request({ ...body, word })).status, 400);
  assert.equal(f.state.queries.length, 0);
}
let f = fixture();
let response = await f.request(body);
assert.equal(response.status, 201);
assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
assert.doesNotMatch(JSON.stringify(await response.json()), /identity|session|192\.0/);
response = await f.request();
assert.deepEqual((await response.json()).words, [{ id: row.id, word: row.emotion_word, createdAt: row.created_at }]);
assert.equal(response.headers.get("cache-control"), "private, no-store");

const cookie = (await f.request(body)).headers.get("set-cookie").split(";")[0];
await f.request(body, { Cookie: cookie });
const anonHash = f.state.queries.filter(call => call.query.includes("allow"))[3].values[0];
const nextHash = f.state.queries.filter(call => call.query.includes("allow"))[5].values[0];
assert.equal(anonHash, nextHash, "signed session persists across submissions");
assert.ok(cookie.startsWith("__Host-halo_signal="));
const forged = `__Host-halo_signal=00000000-0000-4000-8000-000000000001.${"0".repeat(64)}`;
assert.ok((await f.request(body, { Cookie: forged })).headers.has("set-cookie"));
f = fixture({ user: { id: "private-member" } });
response = await f.request(body);
assert.equal(response.status, 201);
assert.equal(response.headers.has("set-cookie"), false);
assert.equal(f.state.queries[1].values[0], createHmac("sha256", secret).update("account:private-member").digest("hex"));

for (const word of ["FUCK", "ｆｕｃｋ", "die"]) {
  f = fixture();
  assert.equal((await f.request({ ...body, word })).status, 422);
  assert.equal(f.state.queries.length, 0);
}
f = fixture({ env: { SIGNAL_EMOTION_IDENTITY_SECRET: secret, SIGNAL_EMOTION_BLOCKED_WORDS: "clarity" }, saved: [row] });
assert.equal((await f.request(body)).status, 422);
assert.deepEqual((await (await f.request()).json()).words, []);
for (const options of [{ origin: false }, { env: {} }, { env: { SIGNAL_EMOTION_WRITES_DISABLED: "true" } }]) {
  f = fixture(options);
  assert.ok([403, 503].includes((await f.request(body)).status));
  assert.equal(f.state.queries.length, 0);
}
f = fixture();
assert.equal((await f.request(body, { Origin: "https://attacker.example" })).status, 403);
assert.equal((await f.request(body, {}, {})).status, 503, "trusted platform IP is required");
assert.equal((await f.request(body, { "Content-Type": "text/plain" })).status, 415);
assert.equal((await f.request("x".repeat(1025))).status, 413);
assert.equal((await f.request("{")).status, 400);
for (const invalid of [{ ...body, releaseId: "../private" }, { ...body, identity: "spoofed" },
  { ...body, playbackSeconds: -1 }, { ...body, playbackSeconds: "12" }, { ...body, playbackSeconds: 86401 }]) {
  assert.equal((await f.request(invalid)).status, 400);
}
assert.equal(f.state.queries.length, 0);
assert.equal((await f.handler(new Request("https://halo.example/api/signal/emotion?releaseId=../private"))).status, 400);
assert.equal((await f.handler(new Request("https://halo.example/api/signal/emotion", { method: "DELETE" }))).status, 405);
f = fixture({ allowed: false });
response = await f.request(body);
assert.equal(response.status, 429);
assert.equal(response.headers.get("retry-after"), "60");
assert.equal(f.state.saved.length, 0);
f = fixture({ eligible: false });
assert.equal((await f.request(body)).status, 404);
assert.equal(f.state.saved.length, 0);
f = fixture({ fail: true });
response = await f.request(body);
assert.equal(response.status, 503);
assert.doesNotMatch(await response.text(), /private database/);

f = fixture();
let displayed = [], message = "", requests = 0;
const controller = createSignalMapController({
  fetcher: async (url, options) => {
    requests++;
    return url.includes("?") ? f.request() : f.request(JSON.parse(options.body));
  },
  render: words => { displayed = words; }, status: text => { message = text; }
});
await controller.setTrack({ id: releaseId });
assert.deepEqual(displayed, []);
assert.equal(await controller.submit("two words", 12), false);
assert.equal(requests, 1);
assert.equal(await controller.submit("Clarity", 12), true);
assert.equal(displayed[0].word, "Clarity");
assert.equal(message, "Your word is part of the map.");
await controller.setTrack(null);
assert.deepEqual(displayed, []);
assert.equal(await controller.submit("Peace", 12), false);

let finish;
const stale = createSignalMapController({ fetcher: () => new Promise(resolve => { finish = resolve; }),
  render: words => { displayed = words; }, status: () => {} });
const loading = stale.setTrack({ id: releaseId });
await stale.setTrack(null);
finish(Response.json({ words: [{ word: "Old" }] }));
await loading;
assert.deepEqual(displayed, [], "old track requests cannot paint the new map");

const refreshes = [];
const ordered = createSignalMapController({ fetcher: () => new Promise(resolve => refreshes.push(resolve)),
  render: words => { displayed = words; }, status: () => {} });
const first = ordered.setTrack({ id: releaseId });
const second = ordered.refresh();
refreshes[1](Response.json({ words: [{ word: "Fresh" }] }));
await second;
refreshes[0](Response.json({ words: [{ word: "Stale" }] }));
await first;
assert.equal(displayed[0].word, "Fresh", "overlapping polls cannot replace newer words with older results");

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("netlify/database/migrations/20261010170000_signal_emotions.sql");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_signal_emotions/);
assert.match(migration, /REFERENCES halo_release_campaigns\(id\)/);
assert.match(migration, /track_name TEXT NOT NULL/);
assert.match(migration, /VARCHAR\(20\)/);
assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
assert.match(migration, /ON CONFLICT \(identity_hash\) DO UPDATE/);
assert.doesNotMatch(migration, /(?:UPDATE|ALTER|DROP|DELETE FROM) halo_(?:release|song|journey|dreamweaver)/);
const ui = await read("music/signal-map.js");
assert.match(ui, /node.textContent = item.word/);
assert.match(ui, /maxlength="20"/);
assert.match(ui, /15000/);
assert.match(ui, /!document.hidden/);
assert.match(await read("music/signal-map.css"), /prefers-reduced-motion: reduce/);
assert.match(await read("netlify/functions/signal-emotion.mjs"), /path: "\/api\/signal\/emotion"/);
for (const file of ["music/index.html", "music-world.html"]) assert.match(await read(file), /type="module" src="\/music\/signal-map.js"/);
console.log("Signal emotion API, persistence, moderation, and live-map contracts passed");
