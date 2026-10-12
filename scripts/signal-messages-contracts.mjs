import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SIGNAL_THREAD_LIMIT, cleanSignalMessage, cleanSignalTargetId, createSignalMessagesHandler } from "../netlify/lib/signal-messages.mjs";
import {
  SIGNAL_MESSAGES_API_URL, pickCommunityPulse, renderPulse, renderSignalMessages, renderSignalThread, renderWirePost,
  signalMessagesUrl, signalTargetId, threadMessages
} from "../signal-network/industry-wire.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS: ${name}`); }

// In-memory stand-in for halo_signal_thread_messages that honours the handler's SQL shape.
function memoryDatabase(seed = []) {
  const rows = seed.map(row => ({ hidden: false, sender_member_id: "member-x", ...row }));
  const queries = [];
  let sequence = 0;
  return {
    rows,
    queries,
    async sql(strings, ...values) {
      const query = strings.join("?");
      queries.push({ query, values });
      if (query.includes("SELECT COUNT(*)")) {
        assert.match(query, /sender_member_id = \?/);
        return [{ total: rows.filter(row => row.sender_member_id === values[0]).length }];
      }
      if (query.includes("INSERT INTO halo_signal_thread_messages")) {
        const [target_id, sender_member_id, user_identifier, message] = values;
        const row = { id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, target_id, sender_member_id, user_identifier, message, hidden: false, created_at: new Date(Date.UTC(2026, 9, 12, 16, sequence)) };
        rows.push(row);
        return [row];
      }
      assert.match(query, /WHERE target_id = \? AND hidden = FALSE/);
      assert.match(query, /ORDER BY created_at DESC, id DESC/);
      const [targetId, limit] = values;
      return rows.filter(row => row.target_id === targetId && !row.hidden)
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at) || String(right.id).localeCompare(String(left.id)))
        .slice(0, limit);
    }
  };
}

function harness({ user = { id: "member-1" }, db = memoryDatabase(), origin = true } = {}) {
  let membershipCalls = 0;
  const handler = createSignalMessagesHandler({
    getDatabase: () => db,
    getUser: () => user,
    ensureMembership: (_db, member) => { membershipCalls++; return { member_id: member.id, display_name: "Nova <DJ>" }; },
    verifyRequestOrigin: () => origin
  });
  return {
    db,
    get membershipCalls() { return membershipCalls; },
    get: query => handler(new Request(`https://halo.example/api/signal/messages${query}`)),
    post: (body, options = {}) => handler(new Request("https://halo.example/api/signal/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...options
    }))
  };
}

const message = overrides => ({ id: "m1", target_id: "wire-a", user_identifier: "Nova", message: "Fire", created_at: "2026-10-12T16:00:00.000Z", ...overrides });

await check("target IDs accept Wire post IDs and track slugs only", async () => {
  assert.equal(cleanSignalTargetId("wire-seed-independence-only-real-asset"), "wire-seed-independence-only-real-asset");
  assert.equal(cleanSignalTargetId("read-the-room"), "read-the-room");
  for (const bad of ["", "../escape", "Read The Room", "-lead", "a".repeat(121), null, 42, ["wire-a"]]) assert.equal(cleanSignalTargetId(bad), "", String(bad));
  assert.equal(signalTargetId("Read The Room"), "read-the-room");
  assert.equal(signalTargetId("Read The Room (DJ Mix)"), "read-the-room-dj-mix");
  assert.equal(signalTargetId("wire-a"), "wire-a");
  assert.equal(signalTargetId("  ##  "), "");
  assert.ok(cleanSignalTargetId(signalTargetId(`Track ${"x".repeat(200)}`)), "client slugs always satisfy the server pattern");
  assert.equal(cleanSignalMessage("  one   word \n"), "one word");
  assert.equal(cleanSignalMessage("x".repeat(900)).length, 500);
  assert.equal(signalMessagesUrl("read-the-room"), `${SIGNAL_MESSAGES_API_URL}?target_id=read-the-room`);
});

await check("GET returns only messages bound to the requested target_id", async () => {
  const db = memoryDatabase([
    { id: "a1", target_id: "wire-a", user_identifier: "Nova", message: "First", created_at: "2026-10-12T15:00:00Z" },
    { id: "a2", target_id: "wire-a", user_identifier: "Kai", message: "Second", created_at: "2026-10-12T15:05:00Z" },
    { id: "b1", target_id: "read-the-room", user_identifier: "Kai", message: "Banger", created_at: "2026-10-12T15:02:00Z" },
    { id: "a3", target_id: "wire-a", user_identifier: "Mod", message: "Hidden", created_at: "2026-10-12T15:06:00Z", hidden: true }
  ]);
  const member = harness({ db });
  const response = await member.get("?target_id=wire-a");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.target_id, "wire-a");
  assert.deepEqual(payload.messages.map(item => item.id), ["a1", "a2"], "oldest-first, scoped, hidden excluded");
  assert.deepEqual(Object.keys(payload.messages[0]).sort(), ["created_at", "id", "message", "target_id", "user_identifier"]);
  assert.ok(!JSON.stringify(payload).includes("member-x"), "sender member IDs stay private");
  const track = await (await member.get("?target_id=read-the-room")).json();
  assert.deepEqual(track.messages.map(item => item.id), ["b1"]);
  assert.equal(member.membershipCalls, 2);
  assert.equal(db.queries.at(-1).values[1], SIGNAL_THREAD_LIMIT);
});

await check("GET rejects anonymous readers and missing or unsafe target_ids", async () => {
  assert.equal((await harness({ user: null }).get("?target_id=wire-a")).status, 401);
  const member = harness();
  assert.equal((await member.get("")).status, 400, "threads are always scoped to a target");
  assert.equal((await member.get("?target_id=..%2Fescape")).status, 400);
  assert.equal(member.db.queries.length, 0);
  assert.equal((await member.post(null, { method: "DELETE", body: undefined })).status, 405);
});

await check("POST binds a member's message to its target and uses their display name", async () => {
  const member = harness();
  const response = await member.post({ target_id: "read-the-room", message: "  Vibes  " });
  assert.equal(response.status, 201);
  const { message: saved } = await response.json();
  assert.equal(saved.target_id, "read-the-room");
  assert.equal(saved.message, "Vibes");
  assert.equal(saved.user_identifier, "Nova <DJ>");
  assert.equal(member.db.rows[0].sender_member_id, "member-1");
  const thread = await (await member.get("?target_id=read-the-room")).json();
  assert.deepEqual(thread.messages.map(item => item.message), ["Vibes"]);
  assert.deepEqual((await (await member.get("?target_id=wire-a")).json()).messages, [], "other targets stay empty");
});

await check("POST validates origin, payload and rate limit", async () => {
  assert.equal((await harness({ user: null }).post({ target_id: "wire-a", message: "x" })).status, 401);
  assert.equal((await harness({ origin: false }).post({ target_id: "wire-a", message: "x" })).status, 403);
  const member = harness();
  assert.equal((await member.post("not json")).status, 400);
  assert.equal((await member.post({ target_id: "", message: "x" })).status, 400);
  assert.equal((await member.post({ target_id: "wire-a", message: "   " })).status, 400);
  assert.equal((await member.post({ target_id: "wire-a", message: "y".repeat(5000) })).status, 413);
  for (let index = 0; index < 12; index++) assert.equal((await member.post({ target_id: "wire-a", message: `m${index}` })).status, 201);
  assert.equal((await member.post({ target_id: "wire-a", message: "one more" })).status, 429);
});

await check("thread rendering is escaped and only shows the active target", async () => {
  const html = renderSignalMessages([
    message({ id: "m2", message: "<img src=x onerror=alert(1)>", created_at: "2026-10-12T16:05:00Z" }),
    message({ id: "m1", message: "First" }),
    message({ id: "other", target_id: "read-the-room", message: "Leaked" }),
    message({ id: "bad", created_at: "nope" })
  ], "wire-a");
  assert.ok(html.indexOf('data-signal-message="m1"') < html.indexOf('data-signal-message="m2"'), "oldest first");
  assert.ok(!html.includes("<img") && html.includes("&lt;img"));
  assert.ok(!html.includes("Leaked") && !html.includes('"bad"'));
  assert.deepEqual(threadMessages(null, "wire-a"), []);
  assert.match(renderSignalMessages([], "wire-a"), /No signals yet/);
  const thread = renderSignalThread("read-the-room", "Read <The> Room");
  assert.match(thread, /id="signal-feed-read-the-room"/);
  assert.match(thread, /data-signal-thread="read-the-room"/);
  assert.match(thread, /data-signal-thread-form/);
  assert.match(thread, /maxlength="500"/);
  assert.ok(thread.includes("Read &lt;The&gt; Room") && !thread.includes("<The>"));
  assert.equal(renderSignalThread("", "x"), "");
});

await check("each Wire post and the active track carry their own thread", async () => {
  const post = renderWirePost({ id: "wire-a", title: "Indie", summary: "S", visibility: "internal_community", status: "published", created_at: "2026-10-12T00:00:00Z" });
  assert.match(post, /data-signal-thread="wire-a"/);
  assert.ok(post.indexOf("data-signal-thread") < post.lastIndexOf("</article>"), "thread sits inside its post");
  assert.match(post, /Signal thread below/);
  const pulse = pickCommunityPulse({ rooms: [{ name: "Club", listeners: 3, nowPlaying: { title: "Read The Room", artist: "HALO" } }] });
  assert.equal(pulse.trackId, "read-the-room");
  assert.match(renderPulse(pulse), /data-signal-thread="read-the-room"/);
  assert.doesNotMatch(renderPulse(null), /data-signal-thread/);
});

await check("schema, route and client wiring stay in place", async () => {
  const [migration, fn, client, styles, satellite] = await Promise.all([
    read("netlify/database/migrations/20261012160000_signal_thread_messages.sql"), read("netlify/functions/signal-messages.mjs"),
    read("signal-network/industry-wire.js"), read("signal-network/industry-wire.css"), read("signal-network/signal-satellite.js")
  ]);
  for (const column of ["id UUID PRIMARY KEY", "target_id TEXT NOT NULL", "user_identifier TEXT NOT NULL", "message TEXT NOT NULL", "created_at TIMESTAMPTZ NOT NULL"]) {
    assert.ok(migration.includes(column), column);
  }
  assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_signal_thread_messages/);
  assert.match(migration, /ON halo_signal_thread_messages \(target_id, created_at DESC, id DESC\) WHERE hidden = FALSE/);
  assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE|ALTER)\s/im, "existing Signal tables are untouched");
  assert.ok(fn.includes('path: "/api/signal/messages"') && fn.includes("ensureMembership") && fn.includes("verifyRequestOrigin"));
  assert.ok(client.includes("IntersectionObserver") && client.includes("signalMessagesUrl(targetId)"), "threads lazy-load per target");
  assert.ok(styles.includes(".signal-thread") && styles.includes("@media (max-width: 760px)"));
  assert.ok(!satellite.includes("/api/signal/messages"), "the floating satellite chat stays unscoped and local");
});

console.log(`Signal message contracts: ${passed}/${passed} checks passed.`);
