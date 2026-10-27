import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHypeRoomHandler } from "../netlify/lib/hype-room.mjs";
import { createRoomSession, createHypeRoom } from "../signal-network/hype-room.js";

const room = "10000000-0000-4000-8000-000000000001";
const otherRoom = "10000000-0000-4000-8000-000000000002";
const messageId = "20000000-0000-4000-8000-000000000001";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

function harness({ user = { id: "fan" }, member = "fan", origin = true, available = true, quota = 0, milestone = null } = {}) {
  const posts = new Map([
    [room, { id: room, member_id: "artist", visibility: "INNER_CIRCLE", audience: ["fan"] }],
    [otherRoom, { id: otherRoom, member_id: "outsider", visibility: "PUBLIC", audience: [] }]
  ]);
  const messages = [
    { id: messageId, post_id: room, member_id: "artist", author_name: "Artist", body: "<script>text only</script>", created_at: new Date() },
    { id: "hidden", post_id: room, member_id: "blocked", author_name: "Blocked", body: "hidden", created_at: new Date() },
    { id: "elsewhere", post_id: otherRoom, member_id: "outsider", author_name: "Elsewhere", body: "Other room", created_at: new Date() }
  ];
  const queries = [];
  const db = {
    async sql(strings, ...values) {
      const sql = strings.join("?");
      queries.push({ sql, values });
      if (!available) throw new Error("private database detail");
      if (sql.includes("FROM halo_signal_feed_posts WHERE id")) {
        const post = posts.get(values[0]);
        return post && (post.visibility === "PUBLIC" || post.member_id === member || post.audience.includes(member)) ? [post] : [];
      }
      if (sql.startsWith("SELECT 1 FROM halo_signal_blocks")) return [];
      if (sql.includes("INSERT INTO halo_signal_feed_rate_limits")) return quota++ < 30 ? [{ attempts: quota }] : [];
      if (sql.includes("INSERT INTO halo_signal_feed_comments")) {
        const [id, member_id, author_name, body, post_id] = values;
        const post = posts.get(post_id);
        assert.match(sql, /ANY\(p.audience\)/);
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM halo_signal_blocks/);
        if (!post || !(post.visibility === "PUBLIC" || post.member_id === member || post.audience.includes(member))) return [];
        messages.push({ id, member_id, author_name, body, post_id, created_at: new Date() });
        return [{ id }];
      }
      if (sql.includes("SELECT member_id FROM halo_signal_feed_comments")) {
        return messages.filter(m => m.id === values[0] && m.post_id === values[1]);
      }
      if (sql.includes("DELETE FROM halo_signal_feed_comments")) {
        const index = messages.findIndex(m => m.id === values[0] && m.post_id === values[1] && m.member_id === values[2]);
        if (index >= 0) messages.splice(index, 1);
        return [];
      }
      if (sql.includes("FROM halo_signal_feed_comments c WHERE")) {
        assert.match(sql, /ORDER BY c.created_at DESC, c.id DESC LIMIT/);
        assert.match(sql, /b.target_member_id = c.member_id/);
        assert.match(sql, /b.member_id = c.member_id/);
        assert.match(sql, /parent.id = c.parent_id/);
        return messages.filter(m => m.post_id === values[1] && m.member_id !== "blocked").slice(-values.at(-1)).reverse()
          .map(m => ({ ...m, own: m.member_id === member }));
      }
      if (sql.includes("halo_release_milestones")) {
        assert.match(sql, /release.status = 'published'/);
        assert.match(sql, /COALESCE\(release.visibility, 'public'\) = 'public'/);
        assert.match(sql, /JOIN halo_release_milestones milestone/);
        assert.match(sql, /track.status = 'rotation'/);
        assert.match(sql, /track.reviewed_at IS NOT NULL AND track.reviewed_by_member_id IS NOT NULL/);
        assert.match(sql, /p.id = \?/);
        assert.ok(!sql.includes("discoverer_rank"));
        return milestone ? [milestone] : [];
      }
      if (sql.includes("INSERT INTO halo_signal_reports") || sql.includes("INSERT INTO halo_signal_blocks")) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const handler = createHypeRoomHandler({
    getUser: () => user, getDatabase: () => db,
    ensureMembership: () => ({ member_id: member, display_name: "Public name" }),
    verifyRequestOrigin: typeof origin === "function" ? origin : () => origin
  });
  const request = (body, { query = `roomId=${room}`, headers = {}, method = body === undefined ? "GET" : "POST" } = {}) =>
    handler(new Request(`https://halo.example/api/hype-room?${query}`, {
      method, headers: { Origin: "https://halo.example", "Content-Type": "application/json", ...headers },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {})
    }));
  const send = body => request({ action: "message", roomId: room, body, confirmAudience: true });
  return { request, send, messages, posts, queries };
}

await check("identity, origin and room authorization fail closed before messages are read", async () => {
  const anonymous = harness({ user: null });
  assert.equal((await anonymous.request()).status, 401);
  assert.equal((await anonymous.send("hi")).status, 401);
  assert.equal(anonymous.queries.length, 0);
  assert.equal((await harness({ member: "stranger" }).request()).status, 404);
  assert.equal((await harness({ member: "stranger" }).send("hi")).status, 404);
  assert.equal((await harness().request(undefined, { query: `roomId=${room}&userId=artist` })).status, 400);
  assert.equal((await harness().request(undefined, { query: "roomId=arbitrary-new-room" })).status, 400);
  for (const origin of [false, () => { throw new Error(); }]) {
    const api = harness({ origin });
    assert.equal((await api.send("hi")).status, 403);
    assert.equal(api.queries.length, 0);
  }
  assert.equal((await harness().request(undefined, { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await harness().request({}, { headers: { Origin: "" } })).status, 403);
});

await check("strict payloads reject forged identity/events, unsupported actions and length/byte overflow", async () => {
  const api = harness();
  for (const body of [null, [], "{bad", { action: "BREAKOUT_ACHIEVEMENT", roomId: room },
    { action: "toString" }, { action: "message", roomId: room, body: "hi", confirmAudience: true, userId: "artist" },
    { action: "message", roomId: room, body: "hi", confirmAudience: true, type: "system" }]) {
    assert.equal((await api.request(body)).status, 400);
  }
  for (const body of ["", " ", 3, "a".repeat(501)]) assert.equal((await api.send(body)).status, 400);
  assert.equal((await api.request({ action: "message", roomId: room, body: "hi" })).status, 400);
  assert.equal((await api.send("x".repeat(5000))).status, 413);
  assert.equal((await api.request("{}", { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await api.request(undefined, { method: "DELETE" })).status, 405);
  assert.equal((await api.send("a".repeat(500))).status, 201);
});

await check("persisted delivery is post-isolated, bounded, blocked-filtered, and identity/rank private", async () => {
  const api = harness();
  assert.equal((await api.send("  Hello  ")).status, 201);
  assert.equal(api.messages.at(-1).member_id, "fan");
  const data = await (await api.request()).json();
  assert.deepEqual(data.messages.map(m => m.body), ["<script>text only</script>", "Hello"]);
  assert.deepEqual(Object.keys(data.messages[0]).sort(), ["authorName", "body", "createdAt", "id", "own"]);
  assert.equal(data.milestone, null);
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("member_id") && !serialized.includes("rank"));
  const elsewhere = await (await api.request(undefined, { query: `roomId=${otherRoom}` })).json();
  assert.deepEqual(elsewhere.messages.map(m => m.body), ["Other room"]);
  for (let i = 0; i < 80; i++) api.messages.push({ ...api.messages[0], id: `m${i}` });
  assert.equal((await (await api.request()).json()).messages.length, 50);
  api.posts.get(room).audience = [];
  assert.equal((await api.request()).status, 404);
  assert.equal((await api.send("revoked")).status, 404);
});

await check("shared atomic write quotas reject overflow and room safety actions resolve targets server-side", async () => {
  const api = harness({ quota: 29 });
  assert.deepEqual((await Promise.all([api.send("one"), api.send("two")])).map(r => r.status).sort(), [201, 429]);
  const safety = harness();
  const action = (action, extra = {}) => safety.request({ action, roomId: room, messageId, ...extra });
  assert.equal((await action("report", { reason: "Please review" })).status, 200);
  assert.equal((await action("block")).status, 200);
  assert.equal((await action("remove")).status, 403);
  assert.equal((await safety.request({ action: "block", roomId: otherRoom, messageId })).status, 404);
  const report = safety.queries.find(q => q.sql.includes("INSERT INTO halo_signal_reports"));
  assert.equal(report.values[1], "artist");
  assert.ok(report.values[2].includes(messageId));
  assert.equal((await harness({ available: false }).request()).status, 503);
  assert.ok(!JSON.stringify(await (await harness({ available: false }).request()).json()).includes("private database"));
});

await check("authorized persisted milestone exposes only public release fields and resolved artwork", async () => {
  const milestone = {
    release_id: "real-release", title: "<b>Real release</b>", artist: "Real artist",
    reached_at: "2026-10-01T10:00:00.000Z",
    artwork_url: "/legacy.jpg", imported_artwork_url: "/imported.jpg", artwork_override_url: "/override.jpg",
    discoverer_rank: 1, member_id: "private-supporter"
  };
  const api = harness({ milestone });
  const data = await (await api.request()).json();
  assert.deepEqual(data.milestone, {
    kind: "reviewed-radio-rotation", releaseId: "real-release", title: milestone.title,
    artist: "Real artist", reachedAt: milestone.reached_at, artwork: "/override.jpg"
  });
  const outsider = harness({ member: "stranger", milestone });
  assert.equal((await outsider.request()).status, 404);
  assert.ok(!outsider.queries.some(q => q.sql.includes("halo_release_milestones")));
});

function sessionHarness(fetch) {
  let next = 0;
  const timers = new Map(), states = [];
  let visible = true;
  const session = createRoomSession({
    fetch, onState: state => states.push(state), isVisible: () => visible,
    setTimeout: (callback, ms) => { timers.set(++next, { callback, ms }); return next; },
    clearTimeout: id => timers.delete(id)
  });
  return { session, timers, states, visible: value => { visible = value; } };
}
const roomResponse = (id = room, messages = []) => Response.json({ roomId: id, visibility: "PUBLIC", messages, milestone: null });

await check("polling loads, bounds history, recovers from errors and never retries a send", async () => {
  let calls = 0, fail = false;
  const h = sessionHarness(async (_url, init) => {
    calls++;
    if (fail) throw new Error("offline");
    assert.equal(init.credentials, "same-origin");
    return roomResponse(room, Array.from({ length: 60 }, (_, i) => ({ id: i })));
  });
  const initial = h.session.join(room);
  assert.equal(h.states.at(-1).phase, "loading");
  await initial;
  assert.equal(h.states.at(-1).snapshot.messages.length, 50);
  assert.equal(h.states.at(-1).phase, "connected");
  assert.ok([...h.timers.values()].some(t => t.ms === 10000));
  fail = true;
  assert.equal(await h.session.mutate({ action: "message", body: "no resend" }), false);
  assert.equal(calls, 2);
  assert.equal(h.states.at(-1).phase, "reconnecting");
  assert.equal(h.states.at(-1).snapshot, null);
  assert.ok([...h.timers.values()].some(t => t.ms === 20000));
  fail = false;
  await h.session.refresh();
  assert.equal(h.states.at(-1).phase, "connected");
  h.session.leave();
  assert.equal(h.timers.size, 0);
  assert.equal(h.states.at(-1).snapshot, null);
});

await check("switch, logout, hidden page and late requests cannot leak a previous room", async () => {
  const pending = [];
  const h = sessionHarness((url, init) => new Promise(resolve => pending.push({ url, init, resolve })));
  const first = h.session.join(room);
  const second = h.session.join(otherRoom);
  assert.equal(pending[0].init.signal.aborted, true);
  pending[1].resolve(roomResponse(otherRoom));
  await second;
  pending[0].resolve(roomResponse(room, [{ body: "private old room" }]));
  await first;
  assert.equal(h.states.at(-1).snapshot.roomId, otherRoom);
  h.visible(false); h.session.visibilityChanged();
  assert.equal(h.states.at(-1).phase, "paused");
  assert.equal(h.states.at(-1).snapshot, null);
  assert.equal(h.timers.size, 0);
  h.visible(true);
  const resumed = h.session.visibilityChanged();
  h.session.leave();
  pending.at(-1).resolve(roomResponse(otherRoom));
  await resumed;
  assert.equal(h.states.at(-1).phase, "idle");
  assert.equal(h.timers.size, 0);
  const denied = sessionHarness(async () => Response.json({ message: "No access" }, { status: 403 }));
  await denied.session.join(room);
  assert.equal(denied.states.at(-1).phase, "error");
  assert.equal(denied.timers.size, 0);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = new Map(); this.attributes = {}; this.value = ""; this.style = { setProperty() {} }; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  remove() {}
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
  focus() {}
  scrollIntoView() {}
}
await check("accessible UI distinguishes idle/loading/empty/error and cleans up listeners", async () => {
  const document = new Element("document"), window = new Element("window"), root = new Element("section");
  document.createElement = tag => new Element(tag);
  window.clearTimeout = () => {};
  let resolve;
  const timers = new Map();
  const ui = createHypeRoom(root, { document, window, fetch: () => new Promise(r => { resolve = r; }),
    setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: id => timers.delete(id) });
  const [title, status, , , list, form] = root.children;
  assert.equal(title.textContent, "Hype Room");
  assert.match(status.textContent, /Choose/);
  assert.equal(form.hidden, true);
  assert.equal(status.attributes.role, "status");
  ui.open(room);
  assert.match(status.textContent, /Loading/);
  assert.equal(list.attributes["aria-busy"], "true");
  resolve(roomResponse());
  await new Promise(r => setImmediate(r));
  assert.match(list.children[0].textContent, /No messages/);
  assert.equal(form.hidden, false);
  ui.reset();
  ui.open(room);
  resolve(Response.json({ message: "Unavailable" }, { status: 503 }));
  await new Promise(r => setImmediate(r));
  assert.match(status.textContent, /Unavailable/);
  assert.equal(list.children.length, 0);
  ui.destroy();
  assert.equal(document.events.size, 0);
  assert.equal(window.events.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(root.children.length, 0);
});

await check("integration uses safe text, existing post routes and no simulated socket/system trigger", async () => {
  const ui = await read("signal-network/hype-room.js");
  assert.ok(!/innerHTML|WebSocket|localStorage|console\.log/.test(ui));
  assert.match(ui, /textContent/);
  assert.match(await read("signal-network/signal-feed.js"), /hypeRoom.open\(post.id\)/);
  assert.match(await read("signal-network/index.html"), /id="hypeRoom"/);
  const api = await read("netlify/lib/hype-room.mjs");
  assert.ok(!/console\.|INSERT INTO halo_release_milestones|discoverer_rank/.test(api));
  const feed = await read("netlify/lib/signal-feed.mjs");
  assert.match(feed, /ON CONFLICT \(member_id, bucket\) DO UPDATE SET[\s\S]+RETURNING attempts/);
});

const databaseUrl = process.env.HYPE_ROOM_TEST_DATABASE_URL;
if (databaseUrl) {
  const exec = promisify(execFile);
  const schema = `hype_test_${process.pid}`;
  const sql = async (text, scoped = true) => {
    const { stdout } = await exec("psql", [databaseUrl, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", text], {
      env: { ...process.env, ...(scoped ? { PGOPTIONS: `-c search_path=${schema}` } : {}) },
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  };
  await sql(`CREATE SCHEMA ${schema}`, false);
  try {
    await sql(`
      CREATE TABLE halo_memberships (member_id TEXT PRIMARY KEY);
      CREATE TABLE halo_release_campaigns (id TEXT PRIMARY KEY, title TEXT, artist TEXT, status TEXT, visibility TEXT,
        artwork_url TEXT, imported_artwork_url TEXT, artwork_override_url TEXT);
      CREATE TABLE halo_radio_tracks (id TEXT PRIMARY KEY, status TEXT, reviewed_at TIMESTAMPTZ, reviewed_by_member_id TEXT);
      CREATE TABLE halo_release_milestones (release_id TEXT PRIMARY KEY REFERENCES halo_release_campaigns(id),
        track_id TEXT REFERENCES halo_radio_tracks(id), reached_at TIMESTAMPTZ DEFAULT NOW());
      ${await read("netlify/database/migrations/20260829150000_create_signal_command_center.sql")}
      ${await read("netlify/database/migrations/20261003160000_create_signal_public_feed.sql")}
      ${await read("netlify/database/migrations/20261006080000_signal_feed_media.sql")}
      INSERT INTO halo_memberships VALUES ('fan'), ('artist'), ('stranger');
      INSERT INTO halo_release_campaigns (id, title, artist, status, visibility)
        VALUES ('release-one', 'Real release', 'Real artist', 'published', 'public');
      INSERT INTO halo_radio_tracks VALUES ('track-one', 'rotation', NOW(), 'artist');
      INSERT INTO halo_release_milestones (release_id, track_id) VALUES ('release-one', 'track-one');
      INSERT INTO halo_signal_feed_posts (id, member_id, author_name, kind, body, release_id, visibility, audience)
        VALUES ('${room}', 'artist', 'Artist', 'AUDIO', 'A real post', 'release-one', 'INNER_CIRCLE', ARRAY['fan']);
      INSERT INTO halo_signal_feed_posts (id, member_id, author_name, kind, body)
        VALUES ('${otherRoom}', 'stranger', 'Other artist', 'TEXT', 'Other room');
    `);
    const literal = value => value == null ? "NULL" : typeof value === "number" ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
    const db = {
      async sql(strings, ...values) {
        const query = strings.reduce((result, part, index) => result + part + (index < values.length ? literal(values[index]) : ""), "");
        if (/^\s*SELECT/i.test(query) || /\bRETURNING\b/i.test(query)) {
          return JSON.parse(await sql(`WITH result AS (${query}) SELECT COALESCE(json_agg(result), '[]'::json) FROM result`));
        }
        await sql(query);
        return [];
      }
    };
    const forMember = member => createHypeRoomHandler({
      getDatabase: () => db, getUser: () => ({ id: member }),
      ensureMembership: () => ({ member_id: member, display_name: "Public name" }),
      verifyRequestOrigin: () => true
    });
    const request = (body, id = room) => new Request(`https://halo.example/api/hype-room?roomId=${id}`, {
      method: body ? "POST" : "GET",
      headers: { Origin: "https://halo.example", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify({ ...body, roomId: id }) } : {})
    });
    const fan = forMember("fan");
    const send = body => fan(request({ action: "message", body, confirmAudience: true }));
    await check("PostgreSQL persists and delivers real comments with audience, isolation and milestone privacy", async () => {
      const text = "Safe text <b>not HTML</b> with 'quotes'";
      const saved = await send(text);
      assert.equal(saved.status, 201);
      const savedId = (await saved.json()).id;
      assert.equal(await sql("SELECT member_id FROM halo_signal_feed_comments LIMIT 1"), "fan");
      const ownerData = await (await forMember("artist")(request())).json();
      assert.deepEqual(ownerData.messages.map(m => m.body), [text]);
      assert.equal(ownerData.milestone.title, "Real release");
      assert.ok(!JSON.stringify(ownerData).includes("member_id"));
      assert.equal((await forMember("stranger")(request())).status, 404);
      assert.deepEqual((await (await fan(request(undefined, otherRoom))).json()).messages, []);
      assert.equal((await fan(request({ action: "block", messageId: savedId }, otherRoom))).status, 404);
      assert.equal((await forMember("artist")(request({ action: "report", messageId: savedId, reason: "Review concern" }))).status, 200);
      assert.equal(await sql("SELECT target_member_id FROM halo_signal_reports"), "fan");
      assert.equal((await forMember("artist")(request({ action: "block", messageId: savedId }))).status, 200);
      assert.equal((await fan(request())).status, 404, "owner block revokes this room");
      await sql("DELETE FROM halo_signal_blocks");
      await sql("UPDATE halo_release_campaigns SET visibility = 'private'");
      assert.equal((await (await fan(request())).json()).milestone, null);
      await sql("UPDATE halo_radio_tracks SET reviewed_at = NULL; UPDATE halo_release_campaigns SET visibility = 'public'");
      assert.equal((await (await fan(request())).json()).milestone, null);
      await sql("UPDATE halo_signal_feed_posts SET audience = '{}' WHERE visibility = 'INNER_CIRCLE'");
      assert.equal((await send("revoked")).status, 404);
      await sql("UPDATE halo_signal_feed_posts SET audience = ARRAY['fan'] WHERE visibility = 'INNER_CIRCLE'");
      assert.equal((await fan(request({ action: "remove", messageId: savedId }))).status, 200);
      assert.equal(await sql("SELECT COUNT(*) FROM halo_signal_feed_comments"), "0");
    });
    await check("PostgreSQL concurrent writes cannot overrun the shared atomic quota", async () => {
      await sql("UPDATE halo_signal_feed_rate_limits SET attempts = 29, window_start = NOW() WHERE member_id = 'fan' AND bucket = 'write'");
      const responses = await Promise.all([send("raced one"), send("raced two"), send("raced three")]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 429, 429]);
      assert.equal(await sql("SELECT COUNT(*) FROM halo_signal_feed_comments"), "1");
    });
  } finally { await sql(`DROP SCHEMA ${schema} CASCADE`, false); }
} else {
  console.log("PostgreSQL integration skipped (set HYPE_ROOM_TEST_DATABASE_URL to an isolated test database)");
}
console.log(`Hype Room contracts: ${checks}/${checks} checks passed.`);
