import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createSignalFeedHandler, cleanupSignalMedia, pageInput, postInput, publicLink, releaseMedia, releaseMusicMetadata } from "../netlify/lib/signal-feed.mjs";
import { createObjectUrlAttachment, validateSignalMedia, SIGNAL_MEDIA_MAX_BYTES } from "../lib/signal-media.js";
import { formatReleaseCaption, suggestSignal } from "../lib/signal-dreamweaver.js";
import { createSignalComposerController, readWebhookConfig, resolveWebhookUrl, saveSignalToFeed } from "../signal-network/signal-composer.js";

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
function harness({ user = null, memberId = "viewer", origin = true, steps = [], mediaStore } = {}) {
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
    verifyRequestOrigin: () => { if (origin instanceof Error) throw origin; return origin; },
    getMediaStore: () => mediaStore
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
const visible = { match: /SELECT id, member_id, kind, visibility, attachment FROM halo_signal_feed_posts/, rows: [{ id: postId, member_id: "author", kind: "AUDIO" }] };
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
  const source = await readFile(new URL("../signal-network/signal-feed.js", import.meta.url), "utf8");
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.value = ""; this.checked = false; this.textContent = ""; this.hidden = false; this.disabled = false; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll() { return this.players || []; }
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
  let authChanged, finishMutation, finishFeed, delayFeed = false, currentMember = "old-member";
  const context = {
    document: { getElementById: get, createElement: () => new Element(), addEventListener() {}, hidden: false },
    window: { haloIdentity: { onAuthChange(callback) { authChanged = callback; } } },
    fetch: async (_url, options) => {
      if (options.method === "POST") return new Promise(resolve => { finishMutation = () => resolve({ ok: true, json: async () => ({ id: postId }) }); });
      if (delayFeed && _url.includes("view=feed")) return new Promise(resolve => {
        finishFeed = () => resolve({ ok: true, json: async () => ({ items: [], memberId: currentMember, nextCursor: null }) });
      });
      return { ok: true, json: async () => ({ items: [], memberId: currentMember, nextCursor: null }) };
    },
    AbortController, URLSearchParams, setTimeout, clearTimeout, setInterval() {}, console
  };
  context.SIGNAL_VISIBILITY = { PUBLIC: "Public Frequency" };
  context.createSignalComposerController = createSignalComposerController;
  context.createSignalComposer = () => ({
    hasAttachment: false, reset() { context.testPostType?.(); }, lock() {},
    publishData: async () => ({
      kind: form.elements.kind.value, body: form.elements.body.value, linkUrl: form.elements.linkUrl.value,
      visibility: "PUBLIC", publishPublic: form.elements.publishPublic.checked
    })
  });
  runInNewContext(`${source.replace(/^import .*;\n/gm, "")}\nglobalThis.testState = feedState; globalThis.testMutate = mutate; globalThis.testPostType = postType;`, context);
  await new Promise(resolve => setImmediate(resolve));
  form.elements.body.value = "Old account draft"; form.elements.linkUrl.value = "https://example.com/old-link";
  form.elements.publishPublic.checked = true; form.elements.includePurchase.checked = true;
  const pendingPublish = form.handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve)); assert.ok(finishMutation);
  const oldPlayer = { pause() { this.paused = true; }, removeAttribute() { this.srcRemoved = true; }, load() { this.unloaded = true; } };
  get("feedPosts").players = [oldPlayer]; get("feedPosts").children = [new Element()];
  currentMember = "new-member"; delayFeed = true;
  const pendingAuth = authChanged();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(oldPlayer.paused && oldPlayer.srcRemoved && oldPlayer.unloaded);
  assert.equal(get("feedPosts").children.length, 0, "Private content cleared before the new feed responds");
  delayFeed = false; finishFeed(); await pendingAuth;
  assert.equal(form.elements.body.value, ""); assert.equal(form.elements.linkUrl.value, "");
  assert.equal(form.elements.publishPublic.checked, false); assert.equal(form.elements.includePurchase.checked, false);
  assert.equal(form.elements.kind.value, "TEXT"); assert.equal(get("feedLinkField").hidden, true);
  assert.equal(context.testState.memberId, "new-member");
  const resetCount = form.resetCount, currentStatus = get("feedStatus").textContent;
  form.elements.body.value = "New account draft"; form.elements.linkUrl.value = "https://example.com/new-link";
  finishMutation(); await pendingPublish;
  assert.equal(form.resetCount, resetCount); assert.equal(form.elements.body.value, "New account draft");
  assert.equal(form.elements.linkUrl.value, "https://example.com/new-link"); assert.equal(get("feedStatus").textContent, currentStatus);
  const pendingToggle = context.testMutate("save", { postId, active: true });
  await new Promise(resolve => setImmediate(resolve)); context.testState.generation++;
  finishMutation(); await assert.rejects(pendingToggle, error => error.name === "FeedSessionChanged");
});
await check("composer pairs required consent with a scoped, accessible publish CTA", async () => {
  const root = new URL("../signal-network/", import.meta.url);
  const [page, styles] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("signal-network.css", root), "utf8")
  ]);
  const form = page.match(/<form id="feedPublishForm">([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, "Existing publish form is present");
  assert.match(form, /<div class="publish-action-group">\s*<label class="signal-feed__consent checkbox-label"><input id="confirm-publish" name="publishPublic" type="checkbox" required>[\s\S]*?<\/label>\s*<button type="submit" class="btn-publish" id="btn-publish-signal" aria-busy="false" disabled>Publish to Public Frequency<\/button>\s*<\/div>/);
  assert.match(styles, /\.signal-feed__composer \.publish-action-group\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*align-items: center;/);
  assert.match(styles, /\.signal-feed__composer \.btn-publish\s*\{[^}]*min-height: 3rem;[^}]*background: var\(--signal-gold, #e7b34a\); color: #0f172a;[^}]*font-size: 1rem; font-weight: 700;/);
  assert.match(styles, /\.btn-publish:hover:not\(:disabled\)\s*\{[^}]*translateY\(-1px\)/);
  assert.match(styles, /\.btn-publish:active:not\(:disabled\)\s*\{[^}]*translateY\(0\)/);
  assert.match(styles, /\.btn-publish:focus-visible\s*\{[^}]*outline: 3px solid/);
  assert.match(styles, /\.btn-publish:disabled\s*\{[^}]*box-shadow: none/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\}[^}]*\.btn-publish:hover:not\(:disabled\)\s*\{ transform: none;/);
});
await check("public page uses safe DOM, native audio, honest waveform, polling and existing Identity", async () => {
  const root = new URL("../", import.meta.url);
  const [page, script, migration, components] = await Promise.all([
    readFile(new URL("signal-network/index.html", root), "utf8"),
    readFile(new URL("signal-network/signal-feed.js", root), "utf8"),
    readFile(new URL("netlify/database/migrations/20261003160000_create_signal_public_feed.sql", root), "utf8"),
    readFile(new URL("signal-network/signal-components.js", root), "utf8")
  ]);
  assert.match(page, /id="feed"/); assert.match(page, /\/signal-network\/#feed/); assert.match(page, /\/creator-network\/#aiTitle/);
  assert.match(page, /id="command-center"/); assert.match(script, /window.haloIdentity.onAuthChange/);
  assert.ok(!/innerHTML|insertAdjacentHTML|localStorage/.test(script));
  assert.match(script, /textContent/); assert.match(components, /player.controls = true/);
  assert.match(components, /Curated visual waveform — decorative, not analyzed audio/); assert.match(script, /30000/);
  assert.match(components, /next.media.bpm.*BPM/); assert.match(components, /next.media.musicalKey/);
  assert.match(components, /signal-feed__music-metadata/);
  assert.match(page, /Polling, not realtime push/); assert.match(migration, /FOREIGN KEY \(post_id, parent_id\)/);
  assert.match(page, /name="body" maxlength="1000"/); assert.match(migration, /body TEXT NOT NULL CHECK \(char_length\(body\) BETWEEN 1 AND 1000\)/);
  assert.match(migration, /parent_id IS NULL/); assert.match(migration, /ON DELETE CASCADE/);
});

const clipBytes = Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(20)]);
const clip = { name: "studio.wav", type: "audio/wav", size: clipBytes.length, data: clipBytes.toString("base64") };
await check("uploaded clips validate type, extension, size, encoding and file signatures", () => {
  const input = { kind: "AUDIO", body: "Studio clip", publishPublic: true, attachment: clip };
  assert.equal(postInput(input).attachment.type, "audio/wav");
  for (const attachment of [
    { ...clip, name: "bad.html" }, { ...clip, type: "text/html" }, { ...clip, size: SIGNAL_MEDIA_MAX_BYTES + 1 },
    { ...clip, size: 1 }, { ...clip, data: "not base64!" }, { ...clip, data: Buffer.alloc(clip.size).toString("base64") }
  ]) assert.throws(() => postInput({ ...input, attachment }));
  assert.throws(() => postInput({ ...input, kind: "VIDEO" }));
  assert.throws(() => postInput({ ...input, includePurchase: true }));
  assert.throws(() => validateSignalMedia({ name: "fake.mp4", type: "video/mp4", size: 20 }, new Uint8Array(20)));
  const max = Buffer.alloc(SIGNAL_MEDIA_MAX_BYTES); clipBytes.copy(max);
  assert.equal(postInput({ ...input, attachment: { ...clip, size: max.length, data: max.toString("base64") } }).attachment.size, max.length);
});
await check("object URLs are revoked on replacement and idempotent disposal; invalid files keep the old clip", () => {
  let count = 0; const revoked = [];
  const attachments = createObjectUrlAttachment({
    createObjectURL: () => `blob:clip-${++count}`, revokeObjectURL: url => revoked.push(url)
  });
  attachments.set(clip); assert.equal(attachments.current.url, "blob:clip-1");
  assert.throws(() => attachments.set({ ...clip, size: 0 }));
  assert.equal(attachments.current.url, "blob:clip-1"); assert.equal(revoked.length, 0);
  attachments.set(clip); attachments.clear(); attachments.clear();
  assert.deepEqual(revoked, ["blob:clip-1", "blob:clip-2"]); assert.equal(attachments.current, null);
});
await check("private layers require audience consent, bound member IDs and never retain public audiences", () => {
  for (const visibility of ["INNER_CIRCLE", "COLLABORATOR_VAULT"]) {
    const draft = { kind: "TEXT", body: "Private", visibility, audience: ["friend", "friend"] };
    assert.throws(() => postInput({ ...draft, publishPublic: true }));
    assert.deepEqual(postInput({ ...draft, confirmAudience: true }).audience, ["friend"]);
  }
  for (const fields of [{ visibility: "UNKNOWN" }, { audience: [""] }, { audience: Array(21).fill("member") }, { audience: "member" }]) {
    assert.throws(() => postInput({ kind: "TEXT", body: "Hi", publishPublic: true, ...fields }));
  }
  assert.deepEqual(postInput({ kind: "TEXT", body: "Hi", publishPublic: true, audience: ["friend"] }).audience, []);
});
await check("private publication checks audience membership and stores visibility with parameterized SQL", async () => {
  const body = { action: "publish", kind: "TEXT", body: "Private", visibility: "INNER_CIRCLE", audience: ["friend"], confirmAudience: true };
  const h = harness({ ...member, steps: [rate, rate, {
    match: /FROM halo_memberships.*ANY.*halo_signal_blocks/, rows: [{ member_id: "friend" }]
  }, { match: /INSERT INTO halo_signal_feed_posts/, inspect(sql, values) {
    assert.match(sql, /visibility, audience, attachment/); assert.ok(values.includes("INNER_CIRCLE"));
    assert.ok(values.some(value => Array.isArray(value) && value[0] === "friend"));
  } }] });
  assert.equal((await h.request(body)).status, 201); h.complete();
  const denied = harness({ ...member, steps: [rate, rate, { rows: [] }] });
  assert.equal((await denied.request(body)).status, 400); denied.complete();
});
await check("clip publication queues cleanup before writing media and preserves work after failed persistence", async () => {
  for (const fails of [false, true]) {
    const writes = [], deletes = [], queued = [];
    const mediaStore = {
      setJSON: async (key, value) => { queued.push(key); assert.ok(value.createdAt > 0); },
      set: async (id, bytes) => { assert.ok(queued[0].startsWith(`cleanup/${id}/`)); writes.push(id); assert.deepEqual(bytes, clipBytes); },
      delete: async id => { deletes.push(id); }
    };
    const h = harness({ ...member, mediaStore, steps: [rate, rate, {
      match: /INSERT INTO halo_signal_feed_posts/,
      ...(fails ? { error: new Error("Unavailable") } : {}),
      inspect(sql, values) { assert.ok(values.includes(JSON.stringify({ name: clip.name, type: clip.type, size: clip.size }))); }
    }] });
    const old = console.error; console.error = () => {};
    try {
      const response = await h.request({ action: "publish", kind: "AUDIO", body: "Clip", publishPublic: true, attachment: clip }, "?upload=clip");
      assert.equal(response.status, fails ? 503 : 201);
      assert.equal(writes.length, 1); assert.deepEqual(deletes, fails ? [] : queued); h.complete();
    } finally { console.error = old; }
  }
});
await check("cleanup retries failed deletions, preserves committed media and waits for in-flight publication", async () => {
  const keys = [postId, commentId, notificationId];
  const deleted = [];
  const store = {
    async *list() { yield { blobs: keys.map(id => ({ key: `cleanup/${id}` })) }; },
    get: async key => ({ createdAt: key.includes(notificationId) ? 3_500_000 : 0 }),
    delete: async key => { deleted.push(key); }
  };
  let checks = 0;
  const db = { sql: async (_sql, id) => { checks++; return id === commentId ? [{ id }] : []; } };
  const result = await cleanupSignalMedia(db, store, { now: 4_000_000 });
  assert.deepEqual(result, { scanned: 3, removed: 1, failed: 0 }); assert.equal(checks, 2);
  assert.deepEqual(deleted, [postId, `cleanup/${postId}`, `cleanup/${commentId}`]);
  deleted.length = 0;
  store.delete = async key => { if (key === postId) throw new Error("Transient storage failure"); deleted.push(key); };
  assert.equal((await cleanupSignalMedia(db, store, { now: 4_000_000 })).failed, 1);
  assert.ok(!deleted.includes(`cleanup/${postId}`));
  assert.equal((await cleanupSignalMedia(db, store, { now: 4_000_000, limit: 1 })).scanned, 1);
});
await check("post removal persists cleanup intent before deleting rows and survives transient blob deletion failures", async () => {
  let queued = false;
  const mediaStore = {
    setJSON: async key => { assert.ok(key.startsWith(`cleanup/${postId}/`)); queued = true; },
    delete: async () => { throw new Error("Transient storage failure"); }
  };
  const h = harness({ ...member, memberId: "author", mediaStore, steps: [rate,
    { ...visible, rows: [{ ...visible.rows[0], attachment: clip }] }, unblocked,
    { match: /DELETE FROM halo_signal_feed_posts/, inspect() { assert.ok(queued); } }
  ] });
  assert.equal((await h.request({ action: "delete_post", postId })).status, 200); h.complete();
});
await check("older cleanup cannot erase a concurrent deletion intent for the same post", async () => {
  const oldKey = `cleanup/${postId}/${commentId}`, newKey = `cleanup/${postId}/${notificationId}`;
  const pending = new Map([[oldKey, { createdAt: 0 }]]);
  const store = {
    async *list() { yield { blobs: [{ key: oldKey }] }; },
    get: async key => pending.get(key),
    delete: async key => { pending.delete(key); }
  };
  const db = { sql: async () => {
    pending.set(newKey, { createdAt: 4_000_000 });
    return [{ id: postId }];
  } };
  assert.deepEqual(await cleanupSignalMedia(db, store, { now: 4_000_000 }), { scanned: 1, removed: 0, failed: 0 });
  assert.ok(!pending.has(oldKey)); assert.ok(pending.has(newKey));
});
await check("feed, saved views, notifications and direct interactions enforce private visibility in SQL", async () => {
  for (const view of ["feed", "saved", "notifications"]) {
    const h = harness({ ...member, steps: [{ rows: [], inspect(sql, values) {
      assert.match(sql, /p.visibility = 'PUBLIC' OR p.member_id = \?.*ANY\(p.audience\)/);
      assert.ok(values.includes("viewer"));
    } }] });
    assert.equal((await h.request(null, `?view=${view}`)).status, 200); h.complete();
  }
  for (const action of ["comment", "boost", "save", "delete_post"]) {
    const h = harness({ ...member, steps: [rate, { rows: [], inspect(sql) { assert.match(sql, /visibility = 'PUBLIC'.*ANY\(audience\)/); } }] });
    assert.equal((await h.request({ action, postId, body: "Hi", publishPublic: true, active: true })).status, 404); h.complete();
  }
});
await check("media reads check audience and blocks before blob access and support native player ranges", async () => {
  for (const [range, expected, length] of [[null, 200, 32], ["bytes=0-11", 206, 12], ["bytes=-4", 206, 4], ["bytes=999-", 416, 0], ["bytes=0-1,3-4", 416, 0]]) {
    const h = harness({ ...member, mediaStore: { get: async () => clipBytes.buffer.slice(clipBytes.byteOffset, clipBytes.byteOffset + clipBytes.byteLength) },
      steps: [{ ...visible, rows: [{ ...visible.rows[0], attachment: clip, visibility: "INNER_CIRCLE" }] }, unblocked] });
    const response = await h.request(null, `?view=media&postId=${postId}`, { headers: range ? { Range: range } : {} });
    assert.equal(response.status, expected); assert.equal((await response.arrayBuffer()).byteLength, length);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "audio/wav"); h.complete();
  }
  for (const steps of [[{ ...visible, rows: [] }], [visible, { rows: [{ exists: 1 }] }]]) {
    const h = harness({ ...member, steps, mediaStore: { get: () => { assert.fail("Unauthorized blob read"); } } });
    assert.equal((await h.request(null, `?view=media&postId=${postId}`)).status, 404); h.complete();
  }
});
await check("private comments use audience consent rather than misleading public consent", async () => {
  const privatePost = { ...visible, rows: [{ ...visible.rows[0], visibility: "COLLABORATOR_VAULT" }] };
  const denied = harness({ ...member, steps: [rate, privatePost, unblocked] });
  assert.equal((await denied.request({ action: "comment", postId, body: "Private", publishPublic: true })).status, 400); denied.complete();
  const h = harness({ ...member, steps: [rate, privatePost, unblocked, { match: /INSERT INTO halo_signal_feed_comments/ }] });
  assert.equal((await h.request({ action: "comment", postId, body: "Private", confirmAudience: true })).status, 201); h.complete();
});
await check("Dreamweaver provides honest local suggestions without mutating or publishing the draft", async () => {
  const draft = { body: "  Ambient   studio\n\n\nidea #ambient  ", visibility: "PUBLIC", attachment: clip };
  const before = JSON.stringify(draft);
  assert.equal((await suggestSignal("caption", draft)).text, draft.body.trim());
  assert.deepEqual((await suggestSignal("tags", draft)).tags, ["#ambient", "#studio"]);
  assert.equal((await suggestSignal("polish", draft)).text, "Ambient studio\n\nidea #ambient");
  assert.match((await suggestSignal("breakdown", draft)).summary, /audio\/wav/);
  assert.match((await suggestSignal("breakdown", { body: "", visibility: "INNER_CIRCLE" })).summary, /only you and your selected members/);
  await assert.rejects(suggestSignal("polish", { body: "" }));
  assert.equal(JSON.stringify(draft), before);
});
await check("Dreamweaver release caption is polished, idempotent, bounded and built only from the creator's seed", () => {
  const caption = formatReleaseCaption("  Let It Ride - 122 BPM Afro House  ");
  assert.equal(caption, "🎵 Let It Ride\n\n🔥 122 BPM · Afro House\n\n🎧 Listen to full quality audio & release details on the HALO Signal Network.\n\n#LetItRide #AfroHouse #NewMusic");
  assert.equal(formatReleaseCaption(caption), caption);
  assert.match(formatReleaseCaption("Night drive\nRecorded at home #studio", { link: "https://halo.example/signal-network/" }), /Recorded at home #studio[\s\S]*details: https:\/\/halo\.example\/signal-network\/[\s\S]*#studio #NightDrive #NewMusic$/);
  assert.ok(!/saxophone|sub-bass/i.test(caption), "No musical claims are invented");
  assert.equal(formatReleaseCaption("   "), "");
  assert.ok(formatReleaseCaption(`Title\n${"long note ".repeat(200)}`).length <= 1000);
  assert.ok(formatReleaseCaption("x".repeat(2000), { maxLength: 120 }).length <= 120);
});
function composerHarness({ save, webhookUrl = "", channels = true, fetchImpl, missing = [] } = {}) {
  class Field {
    constructor() { this.value = ""; this.checked = false; this.disabled = false; this.hidden = false; this.textContent = ""; this.attributes = {}; this.handlers = {}; this.events = []; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    dispatchEvent(event) { this.events.push(event.type); }
    focus() { this.focused = true; }
  }
  const ids = ["btn-publish-signal", "confirm-publish", "signal-content", "btn-generate-caption", "signal-composer-status", "signal-broadcast-options",
    ...(channels ? ["share-twitter", "share-facebook", "share-discord"] : [])].filter(id => !missing.includes(id));
  const elements = new Map(ids.map(id => [id, new Field()]));
  if (elements.has("btn-publish-signal")) elements.get("btn-publish-signal").textContent = "🚀 Publish Signal & Broadcast";
  if (elements.has("signal-content")) elements.get("signal-content").maxLength = 1000;
  if (elements.has("signal-broadcast-options")) elements.get("signal-broadcast-options").hidden = true;
  const root = { getElementById: id => elements.get(id) || null };
  const controller = createSignalComposerController({ root, win: { location: { origin: "https://halo.example" } }, save, webhookUrl, fetchImpl });
  return { controller, get: id => elements.get(id) };
}
await check("Signal composer controller is null-safe when optional and required elements are absent", async () => {
  const empty = createSignalComposerController({ root: { getElementById: () => null }, win: {}, save: async () => assert.fail("never saves") });
  assert.equal(empty.generateCaption(), "");
  assert.equal((await empty.publish()).reason, "invalid");
  assert.doesNotThrow(() => createSignalComposerController({ root: null, win: null }));
  const partial = composerHarness({ channels: false, missing: ["btn-generate-caption", "signal-broadcast-options", "signal-composer-status"], save: async () => ({ id: postId }) });
  partial.get("confirm-publish").checked = true; partial.get("signal-content").value = "Hello";
  assert.equal((await partial.controller.publish()).ok, true);
});
await check("Signal composer requires confirmation and non-empty content before saving", async () => {
  let saves = 0;
  const h = composerHarness({ save: async () => { saves++; return {}; } });
  h.get("signal-content").value = "Ready";
  assert.equal((await h.controller.publish({ preventDefault() {} })).reason, "invalid");
  assert.match(h.get("signal-composer-status").textContent, /confirm the publication checkbox/);
  assert.equal(h.get("signal-composer-status").attributes["data-tone"], "error"); assert.ok(h.get("confirm-publish").focused);
  h.get("confirm-publish").checked = true; h.get("signal-content").value = "   ";
  assert.equal((await h.controller.publish()).reason, "invalid");
  assert.match(h.get("signal-composer-status").textContent, /enter signal content/); assert.ok(h.get("signal-content").focused);
  assert.equal(saves, 0);
});
await check("Generate caption fills the draft from raw input and reports empty input accessibly", () => {
  const h = composerHarness({ save: async () => ({}) });
  h.get("btn-generate-caption").handlers.click();
  assert.match(h.get("signal-composer-status").textContent, /Enter a track title/); assert.equal(h.get("signal-content").value, "");
  h.get("signal-content").value = "Let It Ride - 122 BPM Afro House";
  h.get("btn-generate-caption").handlers.click();
  assert.equal(h.get("signal-content").value, formatReleaseCaption("Let It Ride - 122 BPM Afro House"));
  assert.deepEqual(h.get("signal-content").events, ["input"]);
  assert.equal(h.get("signal-composer-status").attributes["data-tone"], "success");
});
await check("Publishing shows loading state, saves once, resets safely and restores the CTA", async () => {
  let finish, calls = 0;
  const h = composerHarness({ save: payload => { calls++; assert.deepEqual(payload.channels, { twitter: true, facebook: false, discord: false }); return new Promise(resolve => { finish = resolve; }); } });
  h.get("confirm-publish").checked = true; h.get("signal-content").value = "  Signal  "; h.get("share-twitter").checked = true;
  const pending = h.get("btn-publish-signal").handlers.click();
  assert.equal(h.get("btn-publish-signal").disabled, true); assert.equal(h.get("btn-publish-signal").attributes["aria-busy"], "true");
  assert.equal(h.get("btn-publish-signal").textContent, "Publishing…"); assert.equal(h.get("btn-generate-caption").disabled, true);
  assert.equal((await h.controller.publish()).reason, "busy"); assert.equal(calls, 1);
  finish({ id: postId, message: "Signal published to Public Frequency." });
  assert.equal((await pending).ok, true);
  assert.equal(h.get("signal-content").value, ""); assert.equal(h.get("confirm-publish").checked, false); assert.equal(h.get("share-twitter").checked, false);
  assert.equal(h.get("btn-publish-signal").disabled, false); assert.equal(h.get("btn-publish-signal").textContent, "🚀 Publish Signal & Broadcast");
  assert.equal(h.get("signal-composer-status").textContent, "Signal published to Public Frequency.");
  const failing = composerHarness({ save: async () => { throw new Error("Sign in with your Creator Pass to participate."); } });
  failing.get("confirm-publish").checked = true; failing.get("signal-content").value = "Keep me";
  assert.equal((await failing.controller.publish()).reason, "error");
  assert.equal(failing.get("signal-content").value, "Keep me", "Failed saves keep the draft");
  assert.equal(failing.get("signal-composer-status").textContent, "Sign in with your Creator Pass to participate.");
  assert.equal(failing.get("btn-publish-signal").disabled, false);
});
await check("Webhook broadcast is optional, never uses placeholders and only follows a successful public save", async () => {
  const credentialHook = new URL("https://hooks.example/a"); credentialHook.username = "fixture-user";
  for (const value of ["", "YOUR_AUTOMATION_WEBHOOK_URL_HERE", "http://hooks.example/a", "//evil.example/a", "javascript:alert(1)", credentialHook.href, null]) {
    assert.equal(resolveWebhookUrl(value), "");
  }
  assert.equal(resolveWebhookUrl("/api/signal-broadcast"), "/api/signal-broadcast");
  assert.equal(resolveWebhookUrl("https://hooks.example/catch"), "https://hooks.example/catch");
  assert.equal(readWebhookConfig({ querySelector: () => ({ getAttribute: () => "YOUR_AUTOMATION_WEBHOOK_URL_HERE" }) }, {}), "");
  assert.equal(readWebhookConfig(null, { HALO_SIGNAL_CONFIG: { broadcastWebhookUrl: "/api/broadcast" } }), "/api/broadcast");
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  const disabled = composerHarness({ webhookUrl: "YOUR_AUTOMATION_WEBHOOK_URL_HERE", fetchImpl, save: async () => ({ id: postId }) });
  assert.equal(disabled.get("signal-broadcast-options").hidden, true); assert.equal(disabled.controller.webhookUrl, "");
  disabled.get("confirm-publish").checked = true; disabled.get("signal-content").value = "Hi"; disabled.get("share-discord").checked = true;
  assert.equal((await disabled.controller.publish()).broadcast, ""); assert.equal(requests.length, 0);
  const enabled = () => { const h = composerHarness({ webhookUrl: "/api/broadcast", fetchImpl, save: async () => ({ id: postId, content: "Hi" }) });
    h.get("confirm-publish").checked = true; h.get("signal-content").value = "Hi"; return h; };
  const none = enabled(); assert.equal(none.get("signal-broadcast-options").hidden, false);
  assert.equal((await none.controller.publish()).broadcast, "", "No selected channel means no broadcast"); assert.equal(requests.length, 0);
  const h = enabled(); h.get("share-discord").checked = true;
  assert.equal((await h.controller.publish()).broadcast, "queued");
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/broadcast"); assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].body.permalink, `https://halo.example/signal-network/#feed-post-${postId}`);
  assert.deepEqual(requests[0].body.channels, { twitter: false, facebook: false, discord: true });
  assert.match(h.get("signal-composer-status").textContent, /Queued for social broadcasting/);
  const privatePost = composerHarness({ webhookUrl: "/api/broadcast", fetchImpl, save: async () => ({ id: postId, broadcast: false }) });
  privatePost.get("confirm-publish").checked = true; privatePost.get("signal-content").value = "Private"; privatePost.get("share-twitter").checked = true;
  await privatePost.controller.publish(); assert.equal(requests.length, 1, "Private signals are never broadcast");
  const failedSave = composerHarness({ webhookUrl: "/api/broadcast", fetchImpl, save: async () => { throw new Error("Save failed"); } });
  failedSave.get("confirm-publish").checked = true; failedSave.get("signal-content").value = "Hi"; failedSave.get("share-twitter").checked = true;
  await failedSave.controller.publish(); assert.equal(requests.length, 1, "Webhook never runs before a successful save");
  const broken = composerHarness({ webhookUrl: "/api/broadcast", fetchImpl: async () => ({ ok: false, json: async () => ({}) }), save: async () => ({ id: postId, message: "Signal published." }) });
  broken.get("confirm-publish").checked = true; broken.get("signal-content").value = "Hi"; broken.get("share-twitter").checked = true;
  const result = await broken.controller.publish();
  assert.equal(result.ok, true); assert.equal(result.broadcast, "failed");
  assert.equal(broken.get("signal-composer-status").attributes["data-tone"], "warning");
  assert.match(broken.get("signal-composer-status").textContent, /^Signal published\. Social broadcast could not be queued; your signal is saved\.$/);
});
await check("default save uses the existing same-origin Signal feed API and stale publishes are cancelled", async () => {
  let seen;
  const saved = await saveSignalToFeed({ content: "Hello" }, { fetchImpl: async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({ id: postId }) }; } });
  assert.equal(seen.url, "/api/signal-feed"); assert.equal(seen.options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(seen.options.body), { action: "publish", kind: "TEXT", body: "Hello", visibility: "PUBLIC", audience: [], publishPublic: true });
  assert.equal(saved.id, postId);
  await assert.rejects(saveSignalToFeed({ content: "x" }, { fetchImpl: async () => ({ ok: false, json: async () => ({ message: "Cross-origin Signal feed actions are not accepted" }) }) }), /Cross-origin/);
  let finish;
  const h = composerHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  h.get("confirm-publish").checked = true; h.get("signal-content").value = "Old session";
  const pending = h.controller.publish();
  h.controller.cancel();
  assert.equal(h.get("btn-publish-signal").disabled, false); assert.equal(h.get("signal-composer-status").textContent, "");
  h.get("signal-content").value = "New session draft"; finish({ id: postId });
  assert.equal((await pending).reason, "cancelled"); assert.equal(h.get("signal-content").value, "New session draft");
});
await check("composer markup exposes the Signal controller hooks without placeholder webhook configuration", async () => {
  const root = new URL("../signal-network/", import.meta.url);
  const [page, feed] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("signal-feed.js", root), "utf8")]);
  assert.match(page, /<textarea id="signal-content" name="body" maxlength="1000"/);
  assert.match(page, /<button type="button" id="btn-generate-caption" aria-controls="signal-content">Generate caption<\/button>/);
  assert.ok(!page.includes('data-dreamweaver-action="caption"'), "Caption is handled once by the controller");
  assert.match(page, /<fieldset class="social-share-options" id="signal-broadcast-options" hidden>/);
  for (const id of ["share-twitter", "share-facebook", "share-discord"]) assert.match(page, new RegExp(`type="checkbox" id="${id}"`));
  assert.match(page, /<p id="signal-composer-status" class="signal-composer__status" role="status" aria-live="polite"><\/p>/);
  assert.match(page, /<meta name="halo-signal-broadcast-webhook" content="">/);
  assert.ok(!/YOUR_AUTOMATION_WEBHOOK_URL_HERE/.test(page + feed));
  assert.match(feed, /createSignalComposerController\(/); assert.match(feed, /publishController\.cancel\(\)/);
});
console.log(`Signal feed contracts: ${passed}/${passed} checks passed.`);
