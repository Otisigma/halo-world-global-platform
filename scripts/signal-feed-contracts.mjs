import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createSocialAvatar, relativeTime } from "../lib/creator-social.js";
import { createSignalFeedHandler, pageInput, postInput, publicLink, releaseMedia, releaseMusicMetadata } from "../netlify/lib/signal-feed.mjs";

const postId = "11111111-1111-4111-8111-111111111111";
const commentId = "22222222-2222-4222-8222-222222222222";
const notificationId = "33333333-3333-4333-8333-333333333333";
const row = {
  id: postId, member_id: "author", author_name: "<Creator>", kind: "TEXT", body: "<script>not markup</script>",
  created_at: "2026-10-03T12:00:00.123Z", cursor_at: "2026-10-03 12:00:00.123456+00",
  boosts: 3, boosted: false, saved: false, link_url: ""
};
let passed = 0;
async function check(name, test) {
  await test(); passed++; console.log(`PASS: ${name}`);
}
function harness({ user = null, memberId = "viewer", origin = true, steps = [] } = {}) {
  const calls = [];
  let membershipCalls = 0;
  const queue = [...steps];
  const db = { sql: async (strings, ...values) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ sql, values });
    const step = queue.shift();
    assert.ok(step, `Unexpected SQL: ${sql}`);
    if (step.match) assert.match(sql, step.match);
    step.inspect?.(sql, values);
    if (step.error) throw step.error;
    return step.rows || [];
  }};
  const handler = createSignalFeedHandler({
    getDatabase: () => db, getUser: () => user,
    ensureMembership: () => { membershipCalls++; return { member_id: memberId, display_name: "Creator Pass" }; },
    verifyRequestOrigin: () => { if (origin instanceof Error) throw origin; return origin; }
  });
  return {
    db, calls, get membershipCalls() { return membershipCalls; },
    request: (body, params = "", options = {}) => handler(new Request(`https://halo.example/api/signal-feed${params}`, {
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), ...options
    })),
    complete: () => assert.equal(queue.length, 0, "All expected SQL executed")
  };
}
const rate = { match: /INSERT INTO halo_signal_feed_rate_limits/, rows: [{ attempts: 1 }], inspect(sql) {
  assert.match(sql, /ON CONFLICT .* DO UPDATE/); assert.match(sql, /WHERE halo_signal_feed_rate_limits.attempts/);
}};
const visible = { match: /SELECT id, member_id, kind FROM halo_signal_feed_posts/, rows: [{ id: postId, member_id: "author", kind: "AUDIO" }] };
const unblocked = { match: /FROM halo_signal_blocks/, rows: [] };
const publicRelease = { id: "published-release", title: "Published", artist: "Artist", stream_url: "https://cdn.example/music.mp3", purchase_url: "https://store.example/release" };
const releaseStep = rows => ({ match: /FROM halo_release_campaigns.*status = 'published'.*visibility/, rows });
const member = { user: { id: "identity" } };

await check("anonymous public chronological feed requires no membership", async () => {
  const h = harness({ steps: [{ match: /ORDER BY p.created_at DESC, p.id DESC/, rows: [row], inspect(sql, values) {
    assert.match(sql, /NOT EXISTS .*halo_signal_blocks/); assert.ok(values.includes("")); assert.ok(values.includes(21));
  }}] });
  const response = await h.request(null);
  assert.equal(response.status, 200); assert.equal(h.membershipCalls, 0);
  const data = await response.json();
  assert.equal(data.items[0].body, row.body); assert.equal(data.memberId, "");
  assert.equal(data.items[0].authorName, "<Creator>"); assert.equal(data.items[0].saved, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); h.complete();
});
await check("pagination retains PostgreSQL microsecond precision and UUID tie-breaker", async () => {
  const h = harness({ steps: [{ rows: [row, { ...row, id: commentId }] }] });
  const data = await (await h.request(null, "?limit=1")).json();
  assert.equal(data.items.length, 1); assert.ok(data.nextCursor);
  const page = pageInput(new URL(`https://halo.example/?cursor=${data.nextCursor}`));
  assert.equal(page.cursor.at, row.cursor_at); assert.equal(page.cursor.id, postId);
  const next = harness({ steps: [{ rows: [], inspect(sql, values) {
    assert.match(sql, /\(p.created_at, p.id\) < /); assert.ok(values.includes(row.cursor_at)); assert.ok(values.includes(postId));
  }}] });
  assert.equal((await next.request(null, `?cursor=${data.nextCursor}`)).status, 200); next.complete();
});
await check("pagination rejects oversized, malformed and out-of-range input", async () => {
  for (const query of ["?limit=0", "?limit=41", "?limit=1.5", "?cursor=not-json", `?cursor=${"a".repeat(241)}`]) {
    const h = harness(); assert.equal((await h.request(null, query)).status, 400);
  }
});
await check("private views require Creator Pass identity", async () => {
  for (const view of ["saved", "notifications", "blocked"]) {
    const h = harness(); assert.equal((await h.request(null, `?view=${view}`)).status, 401);
  }
  assert.equal((await harness().request({ action: "publish" })).status, 401);
});
await check("same-origin verification rejects false and thrown validation before database access", async () => {
  for (const origin of [false, new Error("bad origin")]) {
    const h = harness({ ...member, origin });
    assert.equal((await h.request({ action: "publish" })).status, 403);
    assert.equal(h.calls.length, 0); assert.equal(h.membershipCalls, 0);
  }
});
await check("bounded JSON rejects declared and actual body limits, non-JSON and arrays", async () => {
  const oversized = JSON.stringify({ body: "a".repeat(19000) });
  const cases = [
    { headers: { "Content-Type": "application/json", "Content-Length": "19001" }, body: "{}", status: 413 },
    { headers: { "Content-Type": "application/json" }, body: oversized, status: 413 },
    { headers: { "Content-Type": "text/plain" }, body: "{}", status: 415 },
    { headers: { "Content-Type": "application/json" }, body: "[1]", status: 400 },
    { headers: { "Content-Type": "application/json" }, body: "{broken", status: 400 }
  ];
  for (const item of cases) {
    const h = harness(member);
    assert.equal((await h.request(null, "", { method: "POST", headers: item.headers, body: item.body })).status, item.status);
    assert.equal(h.calls.length, 0);
  }
});
await check("TEXT publication requires explicit consent and uses parameterized member and text", async () => {
  const content = "'); DROP TABLE halo_memberships; -- <script>x</script>";
  const h = harness({ ...member, steps: [rate, rate, { match: /INSERT INTO halo_signal_feed_posts/, inspect(sql, values) {
    assert.ok(!sql.includes(content)); assert.ok(values.includes(content)); assert.ok(values.includes("viewer"));
    assert.ok(values.includes("Creator Pass")); assert.ok(values.includes(null));
  }}] });
  assert.equal((await h.request({ action: "publish", kind: "TEXT", body: content, publishPublic: true })).status, 201);
  assert.equal(h.membershipCalls, 1); h.complete();
  const denied = harness({ ...member, steps: [rate] });
  assert.equal((await denied.request({ action: "publish", kind: "TEXT", body: "Hi" })).status, 400); denied.complete();
});
await check("post validation covers all four types and rejects private asset and checkout overrides", async () => {
  for (const kind of ["TEXT", "AUDIO", "VIDEO", "BRIEF_LINK"]) {
    assert.equal(postInput({ kind, body: "Public", publishPublic: true, releaseId: "release", linkUrl: "https://example.com/public" }).kind, kind);
  }
  for (const fields of [{ audioUrl: "https://cdn.example/a.mp3" }, { assetUrl: "/private/a" }, { purchaseUrl: "https://store.example/new" },
    { body: "a".repeat(1001) }, { kind: "UPLOAD" }, { includePurchase: "true" }, { includePurchase: true }]) {
    assert.throws(() => postInput({ kind: "TEXT", body: "Valid", publishPublic: true, ...fields }));
  }
});
await check("standard posts accept exactly 1000 characters and reject 1001 at the handler", async () => {
  const h = harness({ ...member, steps: [rate, rate, { match: /INSERT INTO halo_signal_feed_posts/, inspect(sql, values) {
    assert.ok(values.includes("a".repeat(1000)));
  }}] });
  assert.equal((await h.request({ action: "publish", kind: "TEXT", body: "a".repeat(1000), publishPublic: true })).status, 201); h.complete();
  const denied = harness({ ...member, steps: [rate] });
  assert.equal((await denied.request({ action: "publish", kind: "TEXT", body: "a".repeat(1001), publishPublic: true })).status, 400); denied.complete();
});
await check("public URLs reject credentials, private API URLs, signed assets and unsafe schemes", async () => {
  const credentialUrl = new URL("https://cdn.example/a.mp3"); credentialUrl.username = "fixture-user";
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.example", credentialUrl.href,
    "https://cdn.example/a.mp3?X-Amz-Signature=private", "https://halo.example/api/song-catalog/audio?id=private",
    "https://halo.example/api/stem-vault/audio?id=private", "https://localhost/a.mp3", "https://127.0.0.1/a.mp3", "https://[::1]/a.mp3"]) {
    assert.equal(publicLink(url), "");
  }
  assert.equal(publicLink("https://example.com/public-video"), "https://example.com/public-video");
});
await check("AUDIO publication resolves only published public release streams and existing commerce", async () => {
  const h = harness({ ...member, steps: [rate, rate, releaseStep([publicRelease]), { match: /INSERT INTO halo_signal_feed_posts/, inspect(sql, values) {
    assert.ok(values.includes("published-release")); assert.ok(!values.includes(publicRelease.stream_url));
    assert.ok(!values.includes(publicRelease.purchase_url)); assert.ok(values.includes(true));
  }}] });
  assert.equal((await h.request({ action: "publish", kind: "AUDIO", releaseId: publicRelease.id, body: "Listen", publishPublic: true, includePurchase: true })).status, 201); h.complete();
});
await check("audio cards expose available validated BPM, musical key and genres from published releases", async () => {
  const release = { ...publicRelease, bpm: 128, musical_key: "A minor", genres: ["Techno", " House ", "Techno"] };
  const h = harness({ steps: [{ rows: [{ ...row, kind: "AUDIO", release_id: release.id }] }, {
    ...releaseStep([release]), inspect(sql) { assert.match(sql, /bpm, musical_key, genres/); }
  }] });
  const response = await h.request(null); assert.equal(response.status, 200);
  const media = (await response.json()).items[0].media;
  assert.equal(media.bpm, 128); assert.equal(media.musicalKey, "A minor"); assert.deepEqual(media.genres, ["Techno", "House"]);
  h.complete();
  for (const key of ["C#m", "B♭ major", "F dorian", "8A", "12B"]) {
    assert.equal(releaseMusicMetadata({ musical_key: key }).musicalKey, key);
  }
  assert.equal(releaseMusicMetadata({ bpm: "140" }).bpm, 140);
});
await check("missing, malformed or hostile catalog music metadata is omitted, never fabricated", async () => {
  assert.deepEqual(releaseMusicMetadata({}), { bpm: null, musicalKey: "", genres: [] });
  for (const bpm of [null, "", " ", true, -1, 0, 19, 301, 128.5, "128 BPM", Infinity, {}]) {
    assert.equal(releaseMusicMetadata({ bpm }).bpm, null);
  }
  for (const musical_key of ["Unknown", "<script>x</script>", "13A", "C\nminor", "A".repeat(100), 42]) {
    assert.equal(releaseMusicMetadata({ musical_key }).musicalKey, "");
  }
  assert.deepEqual(releaseMusicMetadata({ genres: ["", " ", "<script>x</script>", "bad\u0000genre", "a".repeat(81), 2, "Ambient"] }).genres, ["Ambient"]);
  assert.equal(releaseMusicMetadata({ genres: Array.from({ length: 20 }, (_, i) => `Genre ${i}`) }).genres.length, 12);
  assert.deepEqual(releaseMusicMetadata({ genres: "Techno" }).genres, []);
});
await check("draft, private, missing, owner-only and signed audio cannot be published", async () => {
  for (const releases of [[], [{ ...publicRelease, stream_url: "/api/song-catalog/audio?id=secret" }],
    [{ ...publicRelease, stream_url: "https://cdn.example/a.mp3?token=private" }],
    [{ ...publicRelease, stream_url: "/api/stem-vault/audio?id=private" }]]) {
    const h = harness({ ...member, steps: [rate, rate, releaseStep(releases)] });
    assert.equal((await h.request({ action: "publish", kind: "AUDIO", releaseId: "x", body: "Listen", publishPublic: true })).status, 400);
    h.complete();
  }
});
await check("public audio proxies independently verify public mix or rotation status", async () => {
  for (const [stream, match] of [
    ["/api/mixes/audio?id=public-mix", /FROM halo_mixes .*visibility = 'public'/],
    ["/api/radio/audio?id=public-mix", /FROM halo_radio_tracks .*status = 'rotation'/]
  ]) {
    for (const allowed of [true, false]) {
      const h = harness({ steps: [releaseStep([{ ...publicRelease, stream_url: stream }]), { match, rows: allowed ? [{ id: "public-mix" }] : [] }] });
      assert.equal(Boolean((await releaseMedia(h.db, publicRelease.id)).audioUrl), allowed); h.complete();
    }
  }
  const h = harness({ steps: [releaseStep([{ ...publicRelease, stream_url: "/api/mixes/audio?id=public-mix&version=original" }])] });
  assert.equal((await releaseMedia(h.db, publicRelease.id)).audioUrl, ""); h.complete();
});
await check("unpublished audio is withheld on every read and purchase links remain opt-in", async () => {
  for (const [releaseRows, include, expected] of [[[], false, null], [[publicRelease], false, ""], [[publicRelease], true, publicRelease.purchase_url]]) {
    const h = harness({ steps: [{ rows: [{ ...row, kind: "AUDIO", release_id: publicRelease.id, include_purchase: include }] }, releaseStep(releaseRows)] });
    const result = await (await h.request(null)).json();
    if (expected === null) assert.equal(result.items[0].media, null);
    else assert.equal(result.items[0].media.purchaseUrl, expected);
    h.complete();
  }
});
await check("persistent rate counters reject concurrent quota overflow before insertion", async () => {
  const h = harness({ ...member, steps: [{ ...rate, rows: [] }] });
  assert.equal((await h.request({ action: "publish", kind: "TEXT", body: "Hi", publishPublic: true })).status, 429); h.complete();
  const publish = harness({ ...member, steps: [rate, { ...rate, rows: [] }] });
  assert.equal((await publish.request({ action: "publish", kind: "TEXT", body: "Hi", publishPublic: true })).status, 429); publish.complete();
});
await check("root comments and one-level replies persist atomically with recipient notifications", async () => {
  for (const isReply of [false, true]) {
    const h = harness({ ...member, steps: [rate, visible, unblocked, ...(isReply ? [
      { match: /FROM halo_signal_feed_comments/, rows: [{ member_id: "root-author", parent_id: null }] }, unblocked
    ] : []), { match: /WITH inserted AS .*INSERT INTO halo_signal_feed_comments.*INSERT INTO halo_signal_feed_notifications/, inspect(sql, values) {
      assert.ok(values.includes(isReply ? "root-author" : "author")); assert.ok(values.includes(isReply ? "reply" : "comment"));
      assert.ok(values.includes(90)); assert.ok(values.includes("Public comment"));
    }}] });
    assert.equal((await h.request({ action: "comment", postId, body: "Public comment", parentId: isReply ? commentId : null, timestampSeconds: 90, publishPublic: true })).status, 201);
    h.complete();
  }
});
await check("missing, cross-post, blocked or nested reply parents are rejected", async () => {
  for (const parent of [[], [{ member_id: "root-author", parent_id: commentId }]]) {
    const h = harness({ ...member, steps: [rate, visible, unblocked, { rows: parent }] });
    assert.equal((await h.request({ action: "comment", postId, parentId: commentId, body: "Hi", publishPublic: true })).status, 400); h.complete();
  }
  const h = harness({ ...member, steps: [rate, visible, unblocked, { rows: [{ member_id: "blocked", parent_id: null }] }, { rows: [{ exists: 1 }] }] });
  assert.equal((await h.request({ action: "comment", postId, parentId: commentId, body: "Hi", publishPublic: true })).status, 400); h.complete();
});
await check("comments require public consent and enforce timestamp bounds and media types", async () => {
  for (const overrides of [{ publishPublic: false }, { timestampSeconds: -1 }, { timestampSeconds: 1.5 }, { timestampSeconds: 86401 }, { timestampSeconds: "1" }]) {
    const h = harness({ ...member, steps: [rate, visible, unblocked] });
    assert.equal((await h.request({ action: "comment", postId, body: "Hi", publishPublic: true, ...overrides })).status, 400); h.complete();
  }
  const h = harness({ ...member, steps: [rate, { ...visible, rows: [{ ...visible.rows[0], kind: "TEXT" }] }, unblocked] });
  assert.equal((await h.request({ action: "comment", postId, body: "Hi", timestampSeconds: 5, publishPublic: true })).status, 400); h.complete();
});
await check("blocked members cannot comment, boost or save posts in either direction", async () => {
  for (const action of ["comment", "boost", "save"]) {
    const h = harness({ ...member, steps: [rate, visible, { rows: [{ exists: 1 }], inspect(sql) {
      assert.match(sql, /member_id = \? AND target_member_id = \?.*OR .*member_id = \? AND target_member_id = \?/);
    }}] });
    assert.equal((await h.request({ action, postId, body: "Hi", active: true, publishPublic: true })).status, 404); h.complete();
  }
});
await check("comments paginate oldest first and filter blocked replies and their parents", async () => {
  const h = harness({ steps: [visible, { match: /ORDER BY c.created_at, c.id/, rows: [], inspect(sql) {
    assert.match(sql, /halo_signal_blocks/); assert.match(sql, /parent.id = c.parent_id/);
  }}] });
  assert.equal((await h.request(null, `?view=comments&postId=${postId}`)).status, 200); h.complete();
});
await check("boost and save toggles are explicit, idempotent and saves never notify", async () => {
  for (const action of ["boost", "save"]) {
    for (const active of [true, false]) {
      const h = harness({ ...member, steps: [rate, visible, unblocked, {
        match: active ? /ON CONFLICT DO NOTHING RETURNING post_id/ : /DELETE FROM halo_signal_feed_reactions/,
        inspect(sql, values) {
          assert.ok(values.includes(action)); assert.ok(values.includes("viewer"));
          if (active) assert.match(sql, /WHERE \? = 'boost' AND \? <> \?/);
        }
      }] });
      const result = await h.request({ action, postId, active });
      assert.equal(result.status, 200); assert.equal((await result.json()).active, active); h.complete();
    }
  }
  const h = harness({ ...member, steps: [rate, visible, unblocked] });
  assert.equal((await h.request({ action: "boost", postId })).status, 400); h.complete();
});
await check("saved posts are scoped to member and chronological", async () => {
  const h = harness({ ...member, steps: [{ rows: [], inspect(sql, values) {
    assert.match(sql, /r.kind = 'save'/); assert.ok(values.includes("viewer")); assert.ok(values.includes(true));
    assert.match(sql, /ORDER BY p.created_at DESC, p.id DESC/);
  }}] });
  assert.equal((await h.request(null, "?view=saved")).status, 200); h.complete();
});
await check("notification read and pagination are scoped and block-filtered", async () => {
  const h = harness({ ...member, steps: [{ match: /n.recipient_member_id = \?/, rows: [], inspect(sql) {
    assert.match(sql, /halo_signal_blocks/); assert.match(sql, /JOIN halo_signal_feed_posts/);
  }}] });
  assert.equal((await h.request(null, "?view=notifications")).status, 200); h.complete();
  const read = harness({ ...member, steps: [rate, { match: /WHERE id = \? AND recipient_member_id = \?/, inspect(sql, values) {
    assert.deepEqual(values, [notificationId, "viewer"]);
  }}] });
  assert.equal((await read.request({ action: "read_notification", notificationId })).status, 200); read.complete();
});
await check("authors may remove their own post but cannot remove someone else's", async () => {
  const denied = harness({ ...member, steps: [rate, visible, unblocked] });
  assert.equal((await denied.request({ action: "delete_post", postId })).status, 403); denied.complete();
  const h = harness({ ...member, memberId: "author", steps: [rate, visible, unblocked, { match: /DELETE FROM halo_signal_feed_posts.*member_id = \?/ }] });
  assert.equal((await h.request({ action: "delete_post", postId })).status, 200); h.complete();
});
await check("comment deletion includes author and post authorization", async () => {
  for (const rows of [[], [{ id: commentId }]]) {
    const h = harness({ ...member, steps: [rate, { match: /DELETE FROM halo_signal_feed_comments .*member_id = \?/, rows }] });
    assert.equal((await h.request({ action: "delete_comment", postId, commentId })).status, rows.length ? 200 : 404); h.complete();
  }
});
await check("comment owners can delete their public content despite either-direction blocks", async () => {
  const h = harness({ ...member, steps: [rate, {
    match: /DELETE FROM halo_signal_feed_comments/,
    rows: [{ id: commentId }],
    inspect(sql, values) {
      assert.deepEqual(values, [commentId, postId, "viewer"]);
      assert.ok(!sql.includes("halo_signal_blocks"));
    }
  }] });
  assert.equal((await h.request({ action: "delete_comment", postId, commentId })).status, 200);
  assert.equal(h.calls.length, 2); h.complete();
});
await check("block, unblock and private reports reuse existing Signal safety tables", async () => {
  for (const action of ["block", "unblock", "report"]) {
    const h = harness({ ...member, steps: [rate, { match: /FROM halo_memberships/, rows: [{ member_id: "author" }] }, {
      match: action === "report" ? /INSERT INTO halo_signal_reports/ : action === "block" ? /INSERT INTO halo_signal_blocks/ : /DELETE FROM halo_signal_blocks/
    }] });
    assert.equal((await h.request({ action, memberId: "author", reason: "Public abuse" })).status, 200); h.complete();
  }
  const self = harness({ ...member, steps: [rate] });
  assert.equal((await self.request({ action: "block", memberId: "viewer" })).status, 400); self.complete();
});
await check("block management lists only the authenticated member's own blocks", async () => {
  const h = harness({ ...member, steps: [{ match: /FROM halo_signal_blocks .*WHERE b.member_id = \?.*LIMIT 101/,
    rows: [{ target_member_id: "author", display_name: "Author" }], inspect(sql, values) { assert.deepEqual(values, ["viewer"]); }
  }] });
  const response = await h.request(null, "?view=blocked"); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [{ memberId: "author", displayName: "Author" }]); h.complete();
});
await check("unexpected database errors return retryable status without leaking details", async () => {
  const h = harness({ steps: [{ error: new Error("postgres://secret-password/private") }] });
  const old = console.error; console.error = () => {};
  try {
    const response = await h.request(null); assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("secret-password"));
  } finally { console.error = old; }
});
await check("unsupported methods and unknown views or actions fail closed", async () => {
  assert.equal((await harness().request(null, "", { method: "DELETE" })).status, 405);
  assert.equal((await harness().request(null, "?view=private_assets")).status, 400);
  const h = harness(member); assert.equal((await h.request({ action: "raw_sql" })).status, 400); assert.equal(h.calls.length, 0);
});
await check("auth changes clear composer drafts and consent; old mutations cannot change the new session", async () => {
  const source = (await readFile(new URL("../signal-network/signal-feed.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
  class Element {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ""; this.checked = false; this.textContent = ""; this.hidden = false; this.disabled = false; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    replaceChildren(...children) { this.children = children; }
    focus() { this.focused = true; }
    get firstChild() { return this.children[0]; }
    reset() {
      this.resetCount = (this.resetCount || 0) + 1;
      for (const field of Object.values(this.elements || {})) { field.value = ""; field.checked = false; }
      if (this.elements?.kind) this.elements.kind.value = "TEXT";
    }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const form = get("feedPublishForm");
  form.elements = Object.fromEntries(["kind", "body", "releaseId", "linkUrl", "includePurchase", "publishPublic"].map(name => [name, new Element()]));
  elements.set("feedKind", form.elements.kind); elements.set("feedRelease", form.elements.releaseId);
  form.elements.kind.value = "TEXT";
  let authChanged, finishMutation, mutationBody, currentMember = "old-member";
  const context = {
    document: { getElementById: get, createElement: tag => new Element(tag), addEventListener() {}, hidden: false },
    window: { haloIdentity: { onAuthChange(callback) { authChanged = callback; } } },
    fetch: async (url, options) => {
      if (url === "/api/release-catalog") return { ok: true, json: async () => ({ releases: [
        { id: "public-release", title: "Public music", artist: "Actual Artist", status: "published", isLiveVisible: true },
        { id: "private-release", title: "Private music", artist: "Private Artist", status: "draft", isLiveVisible: false }
      ] }) };
      if (options.method === "POST") return new Promise(resolve => {
        mutationBody = JSON.parse(options.body);
        finishMutation = () => resolve({ ok: true, json: async () => ({ id: postId }) });
      });
      return { ok: true, json: async () => ({ items: [], memberId: currentMember, nextCursor: null }) };
    },
    AbortController, AbortSignal, URLSearchParams, setTimeout, clearTimeout, setInterval() {}, console, createSocialAvatar, relativeTime
  };
  runInNewContext(`${source}\nglobalThis.testState = feedState; globalThis.testMutate = mutate; globalThis.testRenderPost = renderPost;`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get("feedComposerAuthor").children[1].textContent, "Creator Pass member");
  const livePost = context.testRenderPost({
    id: postId, memberId: "other", authorName: "Réal Creator", kind: "TEXT", body: "Public body",
    createdAt: "2026-01-01T12:00:00.000Z", boosts: 0, saved: false, boosted: false
  });
  const header = livePost.children[0], metadata = header.children[1];
  assert.equal(header.children[0].textContent, "RC");
  assert.equal(metadata.children[0].textContent, "Réal Creator");
  assert.equal(metadata.children[1].textContent, "@real-creator");
  assert.match(metadata.children[1].title, /Non-unique display label.*not an account handle/);
  assert.equal(header.children[0].children.length, 0);
  assert.equal(metadata.children[3].tagName, "time");
  assert.equal(metadata.children[3].dateTime, "2026-01-01T12:00:00.000Z");
  assert.equal(metadata.children[3].title, new Date("2026-01-01T12:00:00.000Z").toLocaleString());
  assert.match(metadata.children[4].textContent, /not a unique account identity/);
  form.elements.body.value = "A public idea";
  form.elements.body.handlers.input();
  assert.equal(get("feedCharacterCount").textContent, "13 / 4000");
  get("feedQuickVideo").handlers.click();
  assert.equal(form.elements.kind.value, "VIDEO");
  assert.equal(get("feedLinkField").hidden, false);
  assert.equal(form.elements.linkUrl.required, true);
  assert.equal(form.elements.body.focused, true);
  get("feedQuickAudio").handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(form.elements.kind.value, "AUDIO");
  assert.equal(get("feedReleaseField").hidden, false);
  assert.equal(get("feedLinkField").hidden, true);
  assert.equal(form.elements.releaseId.required, true);
  assert.equal(get("feedRelease").children.length, 2);
  assert.equal(get("feedRelease").children[1].value, "public-release");
  get("feedQuickBrief").handlers.click();
  assert.equal(form.elements.kind.value, "BRIEF_LINK");
  assert.equal(get("feedReleaseField").hidden, true);
  form.elements.kind.value = "TEXT";
  form.elements.body.value = "Old account draft"; form.elements.linkUrl.value = "https://example.com/old-link";
  form.elements.publishPublic.checked = true; form.elements.includePurchase.checked = true;
  const pendingPublish = form.handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve)); assert.ok(finishMutation);
  currentMember = "new-member"; await authChanged();
  assert.equal(form.elements.body.value, ""); assert.equal(form.elements.linkUrl.value, "");
  assert.equal(form.elements.publishPublic.checked, false); assert.equal(form.elements.includePurchase.checked, false);
  assert.equal(form.elements.kind.value, "TEXT"); assert.equal(get("feedLinkField").hidden, true);
  assert.equal(get("feedCharacterCount").textContent, "0 / 4000");
  assert.equal(context.testState.memberId, "new-member");
  const resetCount = form.resetCount, currentStatus = get("feedStatus").textContent;
  form.elements.body.value = "New account draft"; form.elements.linkUrl.value = "https://example.com/new-link";
  finishMutation(); await pendingPublish;
  assert.equal(form.resetCount, resetCount); assert.equal(form.elements.body.value, "New account draft");
  assert.equal(form.elements.linkUrl.value, "https://example.com/new-link"); assert.equal(get("feedStatus").textContent, currentStatus);
  const pendingToggle = context.testMutate("save", { postId, active: true });
  await new Promise(resolve => setImmediate(resolve)); context.testState.generation++;
  finishMutation(); await assert.rejects(pendingToggle, error => error.name === "FeedSessionChanged");
  form.elements.body.value = "Published through Creator Pass";
  form.elements.publishPublic.checked = true;
  const currentPublish = form.handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mutationBody.action, "publish");
  assert.equal(mutationBody.body, "Published through Creator Pass");
  assert.equal(mutationBody.publishPublic, true);
  assert.equal(mutationBody.authorName, undefined);
  assert.equal(mutationBody.identity, undefined);
  finishMutation(); await currentPublish;
  assert.equal(form.elements.body.value, "");
  assert.equal(form.elements.publishPublic.checked, false);
  assert.equal(get("feedCharacterCount").textContent, "0 / 4000");
  assert.equal(get("feedStatus").textContent, "Signal deliberately published to the public feed.");
});
await check("public page uses safe DOM, native audio, honest waveform, polling and existing Identity", async () => {
  const root = new URL("../", import.meta.url);
  const [page, script, migration] = await Promise.all([
    readFile(new URL("signal-network/index.html", root), "utf8"),
    readFile(new URL("signal-network/signal-feed.js", root), "utf8"),
    readFile(new URL("netlify/database/migrations/20261003160000_create_signal_public_feed.sql", root), "utf8")
  ]);
  assert.match(page, /id="feed"/); assert.match(page, /\/signal-network\/#feed/); assert.match(page, /\/creator-network\/#aiTitle/);
  assert.match(page, /id="command-center"/); assert.match(script, /window.haloIdentity.onAuthChange/);
  assert.ok(!/innerHTML|insertAdjacentHTML|localStorage/.test(script));
  assert.match(script, /textContent/); assert.match(script, /audio.controls = true/);
  assert.match(script, /Curated visual waveform — decorative, not analyzed audio/); assert.match(script, /30000/);
  assert.match(script, /post.media.bpm.*BPM/); assert.match(script, /post.media.musicalKey/);
  assert.match(script, /signal-feed__music-metadata/);
  assert.match(page, /Polling, not realtime push/); assert.match(migration, /FOREIGN KEY \(post_id, parent_id\)/);
  assert.match(page, /name="body" maxlength="4000"/); assert.match(migration, /body TEXT NOT NULL CHECK \(char_length\(body\) BETWEEN 1 AND 1000\)/);
  assert.match(page, /id="feedCharacterCount"[^>]*>0 \/ 4000/);
  assert.match(page, /data-halo-social-welcome/);
  assert.match(page, /No photo uploads here/);
  assert.match(script, /Display-only handle from author name; not a unique account identity/);
  assert.match(script, /time\.title = displayDate\(post\.createdAt\)/);
  assert.match(script, /relativeTime\(post\.createdAt\)/);
  assert.ok(!/getLocalIdentity/.test(script));
  assert.match(migration, /parent_id IS NULL/); assert.match(migration, /ON DELETE CASCADE/);
});
console.log(`Signal feed contracts: ${passed}/${passed} checks passed.`);
