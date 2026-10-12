import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SEED_WIRE_POSTS, WIRE_VISIBILITY, createIndustryWireHandler, createWirePost, isoWeek, normalizeWirePost,
  queueWeeklyWireDraft, slugifyWireTitle, sortWirePostsNewestFirst, visibleWirePosts, weeklyWireDraft
} from "../netlify/lib/industry-wire.mjs";
import { feedPosts, pickCommunityPulse, renderPulse, renderWireFeed, renderWirePost } from "../signal-network/industry-wire.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS: ${name}`); }

function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async list({ prefix = "" } = {}) { return { blobs: [...data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value) { data.set(key, structuredClone(value)); }
  };
}

function post(overrides) {
  return { id: "wire-a", title: "A", summary: "Summary", artist_perspective: "Take", author: "HALO Network Core", visibility: WIRE_VISIBILITY, status: "published", created_at: "2026-10-01T00:00:00.000Z", ...overrides };
}

function harness({ user = null, operator = false, store = memoryStore(), now = new Date("2026-10-12T12:00:00.000Z") } = {}) {
  let membershipCalls = 0;
  const handler = createIndustryWireHandler({
    getDatabase: () => ({}),
    getUser: () => user,
    ensureMembership: () => { membershipCalls++; return { member_id: "member" }; },
    authorizeOperator: () => operator,
    getStore: () => store,
    now: () => now
  });
  return {
    store,
    get membershipCalls() { return membershipCalls; },
    request: (body, params = "", options = {}) => handler(new Request(`https://halo.example/api/industry-wire${params}`, {
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), ...options
    }))
  };
}

await check("wire posts carry the full internal schema", async () => {
  const { post: created } = createWirePost({ title: "Spotify payout shift!", summary: "Thresholds moved.", artist_perspective: "Own the room.", now: new Date("2026-10-12T10:00:00.000Z") });
  assert.deepEqual(Object.keys(created).sort(), ["artist_perspective", "author", "created_at", "id", "on_rotation", "slug", "status", "summary", "title", "visibility"]);
  assert.equal(created.slug, "spotify-payout-shift");
  assert.equal(created.visibility, WIRE_VISIBILITY);
  assert.equal(created.author, "HALO Network Core");
  assert.equal(created.created_at, "2026-10-12T10:00:00.000Z");
  assert.match(created.id, /^wire-[a-z0-9]+-spotify-payout-shift$/);
  assert.equal(slugifyWireTitle("  ##  "), "wire-post");
});

await check("publishing requires the artist's take and valid fields", async () => {
  assert.ok(createWirePost({ title: "No take", summary: "x" }).error);
  assert.ok(createWirePost({ title: "", summary: "x", artist_perspective: "y" }).error);
  assert.equal(createWirePost({ title: "Draft", summary: "x", status: "draft" }).post.status, "draft");
  assert.equal(normalizeWirePost(post({ id: "../escape" })), null);
});

await check("posts are ordered newest-first with stable ties", async () => {
  const sorted = sortWirePostsNewestFirst([
    post({ id: "wire-old", created_at: "2026-09-01T00:00:00Z" }),
    post({ id: "wire-new", created_at: "2026-10-10T00:00:00Z" }),
    post({ id: "wire-mid-a", created_at: "2026-10-01T00:00:00Z" }),
    post({ id: "wire-mid-b", created_at: "2026-10-01T00:00:00Z" })
  ]);
  assert.deepEqual(sorted.map(item => item.id), ["wire-new", "wire-mid-b", "wire-mid-a", "wire-old"]);
});

await check("member feed only shows published internal-community posts", async () => {
  const visible = visibleWirePosts([
    post({ id: "wire-public", visibility: "public" }),
    post({ id: "wire-draft", status: "draft" }),
    post({ id: "wire-ok" }),
    post({ id: "wire-ok", title: "Duplicate" }),
    { junk: true }
  ]);
  assert.deepEqual(visible.map(item => item.id), ["wire-ok"]);
  assert.deepEqual(visibleWirePosts([post({ id: "wire-draft", status: "draft" })], { includeDrafts: true }).map(item => item.id), ["wire-draft"]);
});

await check("seed post is the internal Draft #1 brief", async () => {
  assert.equal(SEED_WIRE_POSTS.length, 1);
  const [seed] = SEED_WIRE_POSTS;
  assert.equal(seed.visibility, WIRE_VISIBILITY);
  assert.equal(seed.status, "published");
  assert.match(seed.title, /Independence is the Only Real Asset Left/);
  assert.match(seed.artist_perspective, /This is exactly why we built HALO/);
  assert.match(seed.on_rotation, /Read The Room \(DJ Mix\)/);
  assert.ok(normalizeWirePost(seed));
});

await check("anonymous readers are rejected; members read the wire", async () => {
  const anonymous = harness();
  assert.equal((await anonymous.request()).status, 401);
  const store = memoryStore({ "posts/20261012110000_wire-new": post({ id: "wire-new", created_at: "2026-10-12T11:00:00Z" }), "posts/20261001000000_wire-hidden": post({ id: "wire-hidden", visibility: "public" }) });
  const member = harness({ user: { id: "identity" }, store });
  const response = await member.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  const payload = await response.json();
  assert.equal(member.membershipCalls, 1);
  assert.equal(payload.visibility, WIRE_VISIBILITY);
  assert.deepEqual(payload.posts.map(item => item.id), ["wire-new", SEED_WIRE_POSTS[0].id]);
  assert.equal((await member.request(null, "", { method: "DELETE" })).status, 405);
});

await check("members cannot publish; operators create and publish drafts", async () => {
  const member = harness({ user: { id: "identity" } });
  assert.equal((await member.request({ action: "create", title: "x", summary: "y", artist_perspective: "z" })).status, 403);

  const store = memoryStore();
  const operator = harness({ operator: true, store });
  assert.equal((await operator.request({ action: "create", title: "x", summary: "y" })).status, 422);
  const created = await operator.request({ action: "create", title: "AI licensing", summary: "Deals moved.", artist_perspective: "Protect the masters.", visibility: "public" });
  assert.equal(created.status, 201);
  const { post: createdPost } = await created.json();
  assert.equal(createdPost.visibility, WIRE_VISIBILITY, "operators cannot override internal visibility");
  assert.ok(store.data.has(`posts/20261012120000000_${createdPost.id}`), "keys sort chronologically");
  const oversized = await operator.request(null, "", { method: "POST", body: JSON.stringify({ action: "create", title: "x", summary: "y".repeat(20_000), artist_perspective: "z" }) });
  assert.equal(oversized.status, 413, "body size is enforced without relying on Content-Length");

  const draft = await (await operator.request({ action: "create", title: "Draft brief", summary: "Pending.", status: "draft" })).json();
  const memberView = await (await harness({ user: { id: "identity" }, store }).request()).json();
  assert.ok(!memberView.posts.some(item => item.id === draft.post.id), "drafts stay out of the member feed");
  const operatorDrafts = await (await operator.request(null, "?drafts=1")).json();
  assert.ok(operatorDrafts.posts.some(item => item.id === draft.post.id));

  assert.equal((await operator.request({ action: "publish", id: draft.post.id })).status, 422);
  assert.equal((await operator.request({ action: "publish", id: "wire-missing", artist_perspective: "x" })).status, 404);
  const published = await (await operator.request({ action: "publish", id: draft.post.id, artist_perspective: "My take." })).json();
  assert.equal(published.post.status, "published");
  assert.equal((await operator.request({ action: "unknown" })).status, 400);
});

await check("weekly generator queues one deterministic internal draft per ISO week", async () => {
  const monday = new Date("2026-10-12T09:00:00.000Z");
  assert.deepEqual(isoWeek(monday), { year: 2026, week: 42 });
  assert.deepEqual(weeklyWireDraft(monday), weeklyWireDraft(monday));
  const store = memoryStore();
  const first = await queueWeeklyWireDraft(store, monday);
  assert.equal(first.queued, true);
  assert.equal(first.post.id, "wire-draft-2026-w42");
  assert.equal(first.post.status, "draft");
  assert.equal(first.post.visibility, WIRE_VISIBILITY);
  assert.match(first.post.summary, /Internal community brief/);
  const again = await queueWeeklyWireDraft(store, new Date("2026-10-14T09:00:00.000Z"));
  assert.equal(again.queued, false);
  assert.equal(store.data.size, 1);
});

await check("wire cards render escaped, labelled internal and newest-first", async () => {
  const html = renderWireFeed([
    post({ id: "wire-old", title: "Old", created_at: "2026-09-01T00:00:00Z" }),
    post({ id: "wire-new", title: "<script>alert(1)</script>", created_at: "2026-10-10T00:00:00Z", on_rotation: "Read The Room" }),
    post({ id: "wire-public", title: "Public leak", visibility: "public" }),
    post({ id: "wire-draft", title: "Draft", status: "draft" })
  ]);
  assert.ok(html.indexOf('data-wire-post="wire-new"') < html.indexOf('data-wire-post="wire-old"'));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("Public leak") && !html.includes(">Draft<"));
  assert.match(html, /Internal · HALO community only/);
  assert.match(html, /The Artist's Take/);
  assert.match(html, /On rotation/);
  assert.match(renderWireFeed([]), /The wire is quiet/);
  assert.deepEqual(feedPosts(null), []);
  assert.match(renderWirePost(post({ artist_perspective: "" })), /The Industry Shift/);
});

await check("community pulse highlights the busiest live room", async () => {
  const pulse = pickCommunityPulse({ service: "azuracast", rooms: [
    { name: "Chill", listeners: 2, nowPlaying: { title: "Slow", artist: "A" } },
    { name: "Club", listeners: 9, isLive: true, liveName: "DJ Nova", nowPlaying: { title: "Read The Room", artist: "HALO" } },
    { name: "Empty", listeners: 50, nowPlaying: {} }
  ] });
  assert.deepEqual(pulse, { roomName: "Club", title: "Read The Room", artist: "Live with DJ Nova", listeners: 9, isLive: true, preview: false });
  const html = renderPulse(pulse);
  assert.match(html, /Uniting the room/);
  assert.match(html, /9 members listening/);
  assert.match(html, /Live now/);
  assert.equal(pickCommunityPulse({ rooms: [] }), null);
  assert.match(renderPulse(null), /room is quiet/);
  assert.match(renderPulse(pickCommunityPulse({ service: "demo", rooms: [{ name: "Club", demo: true, listeners: 0, nowPlaying: { title: "Demo" } }] })), /preview rotation/);
});

await check("Wire lives only inside the members-only Signal workspace", async () => {
  const [page, api, weekly, styles, netlifyConfig] = await Promise.all([
    read("signal-network/index.html"), read("netlify/functions/industry-wire.mjs"), read("netlify/functions/industry-wire-weekly.mjs"),
    read("signal-network/industry-wire.css"), read("netlify.toml")
  ]);
  const workspace = page.slice(page.indexOf('id="signalWorkspace"'), page.indexOf("<!-- ── Core Pillars"));
  assert.ok(workspace.includes('data-signal-tab="wire"'));
  assert.ok(workspace.includes('data-signal-panel="wire"') && workspace.includes("data-industry-wire hidden"));
  assert.ok(workspace.includes('id="industryWirePulse"') && workspace.includes("Community Pulse"));
  assert.ok(workspace.includes("Members Only") && workspace.includes("Never published to the public site"));
  assert.equal((page.match(/data-industry-wire/g) || []).length, 1, "the wire panel must not appear outside the workspace");
  assert.ok(page.includes('src="/signal-network/industry-wire.js"') && page.includes('href="/signal-network/industry-wire.css"'));
  assert.ok(api.includes('path: "/api/industry-wire"') && api.includes("ensureMembership") && api.includes("authorizeStatsAdmin"));
  assert.ok(weekly.includes("schedule:") && weekly.includes("queueWeeklyWireDraft") && !weekly.includes('"published"'));
  assert.ok(styles.includes("prefers-reduced-motion") && styles.includes("@media (max-width: 760px)"));
  assert.ok(!/from\s*=\s*"\/(industry-wire|wire|blog)/.test(netlifyConfig), "no public blog route is exposed");
});

console.log(`Industry Wire contracts: ${passed}/${passed} checks passed.`);
