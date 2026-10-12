// Living Industry Wire: internal, members-only industry news + the artist's take.
// Posts persist as JSON documents in the "halo-industry-wire" Netlify Blobs store.
// Members read published posts through GET /api/industry-wire; operators
// (authorized with the STATS_ADMIN_TOKEN bearer header) create posts or publish queued drafts:
//   POST { "action": "create", "title", "summary", "artist_perspective", "on_rotation"?, "status"? }
//   POST { "action": "publish", "id", "artist_perspective"? }
// The weekly scheduled generator only queues drafts; nothing auto-publishes.

export const WIRE_VISIBILITY = "internal_community";
export const WIRE_VISIBILITY_LABEL = "Internal · HALO community only";
export const WIRE_AUTHOR = "HALO Network Core";
export const WIRE_STATUSES = Object.freeze(["draft", "published"]);
export const WIRE_POST_PREFIX = "posts/";
export const WIRE_DRAFT_PREFIX = "drafts/";
export const WIRE_FEED_LIMIT = 30;
const MAX_BODY_BYTES = 16_000;
const MAX_STORED_POSTS = WIRE_FEED_LIMIT * 3;
const limits = { title: 140, summary: 1200, artist_perspective: 1600, author: 80, on_rotation: 160 };

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, maxLength) : "";
}

export function slugifyWireTitle(value) {
  return cleanText(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "wire-post";
}

function isoOrNull(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function normalizeWirePost(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = cleanText(raw.title, limits.title);
  const summary = cleanText(raw.summary, limits.summary);
  const createdAt = isoOrNull(raw.created_at);
  const id = cleanText(raw.id, 120);
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !title || !summary || !createdAt) return null;
  return {
    id,
    slug: slugifyWireTitle(raw.slug || title),
    title,
    summary,
    artist_perspective: cleanText(raw.artist_perspective, limits.artist_perspective),
    on_rotation: cleanText(raw.on_rotation, limits.on_rotation),
    author: cleanText(raw.author, limits.author) || WIRE_AUTHOR,
    visibility: cleanText(raw.visibility, 40),
    status: WIRE_STATUSES.includes(raw.status) ? raw.status : "draft",
    created_at: createdAt
  };
}

export function createWirePost({ title, summary, artist_perspective = "", on_rotation = "", author = WIRE_AUTHOR, status = "published", now = new Date(), id } = {}) {
  const createdAt = isoOrNull(now);
  const slug = slugifyWireTitle(title);
  const post = normalizeWirePost({
    id: id || `wire-${new Date(createdAt || Date.now()).getTime().toString(36)}-${slug.slice(0, 48)}`,
    slug,
    title,
    summary,
    artist_perspective,
    on_rotation,
    author,
    visibility: WIRE_VISIBILITY,
    status,
    created_at: createdAt
  });
  if (!post) return { error: "A wire post needs a title, a summary and a valid timestamp" };
  if (post.status === "published" && !post.artist_perspective) return { error: "Add the artist's take before publishing to the Wire" };
  return { post };
}

export function sortWirePostsNewestFirst(posts) {
  return [...posts].sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at) || String(right.id).localeCompare(String(left.id))
  );
}

// Only published, internal-community posts ever reach the member feed.
export function visibleWirePosts(posts, { includeDrafts = false, limit = WIRE_FEED_LIMIT } = {}) {
  const byId = new Map();
  for (const raw of posts) {
    const post = normalizeWirePost(raw);
    if (!post || post.visibility !== WIRE_VISIBILITY) continue;
    if (post.status !== "published" && !includeDrafts) continue;
    if (!byId.has(post.id)) byId.set(post.id, post);
  }
  return sortWirePostsNewestFirst([...byId.values()]).slice(0, limit);
}

export const SEED_WIRE_POSTS = Object.freeze([
  Object.freeze({
    id: "wire-seed-independence-only-real-asset",
    slug: "why-independence-is-the-only-real-asset-left",
    title: "The Wire: Why Independence is the Only Real Asset Left",
    summary: "Another week, another round of platform updates, algorithm tweaks, and shifting royalty thresholds from streaming giants like Spotify. The traditional gatekeepers are doubling down on metrics that favor hyper-saturation over human connection.",
    artist_perspective: "This is exactly why we built HALO. When you leave your art entirely at the mercy of algorithms you don't own, you're renting space on someone else's land. True creative freedom means knowing who is listening, owning your direct relationship with the community, and keeping the ecosystem transparent.",
    on_rotation: "Read The Room (DJ Mix) — in the private vault for the network to test drive.",
    author: WIRE_AUTHOR,
    visibility: WIRE_VISIBILITY,
    status: "published",
    created_at: "2026-10-12T09:00:00.000Z"
  })
]);

export const WEEKLY_WIRE_TOPICS = Object.freeze([
  { title: "Streaming payout watch", summary: "Where streaming payout thresholds, royalty pools and minimum-play rules moved this week, and what it means for independent catalogs." },
  { title: "Distribution shifts", summary: "Changes across distributors and DSP delivery rules: fees, takedown policy, metadata requirements and release timing." },
  { title: "AI licensing & rights", summary: "The latest on AI training licences, voice-model policy and how rights holders are protecting masters and stems." },
  { title: "Music tech on the floor", summary: "New tools for DJs and producers: decks, stem separation, live-set software and what is worth testing in the network." },
  { title: "Direct-to-fan economics", summary: "Membership, vault drops and direct sales: what is working for artists who own the relationship with their listeners." }
]);

export function isoWeek(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { year: date.getUTCFullYear(), week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7) };
}

// Deterministic for a given date: one draft per ISO week, never auto-published.
export function weeklyWireDraft(now = new Date()) {
  const { year, week } = isoWeek(now);
  const topic = WEEKLY_WIRE_TOPICS[(year * 53 + week) % WEEKLY_WIRE_TOPICS.length];
  const weekLabel = `${year}-w${String(week).padStart(2, "0")}`;
  return createWirePost({
    id: `wire-draft-${weekLabel}`,
    title: `The Wire (${weekLabel.toUpperCase()}): ${topic.title}`,
    summary: `${topic.summary} Internal community brief queued for the artist's review.`,
    status: "draft",
    now
  });
}

// Published posts and drafts live under separate prefixes so drafts never crowd the
// feed's read window. Keys start with a compact created_at stamp so lexical order is chronological.
export function wirePostKey(post) {
  const prefix = post.status === "published" ? WIRE_POST_PREFIX : WIRE_DRAFT_PREFIX;
  return `${prefix}${post.created_at.replace(/[^0-9]/g, "")}_${post.id}`;
}

async function listWireKeys(store, prefix) {
  const { blobs = [] } = await store.list({ prefix });
  return blobs.map(blob => blob.key).sort().reverse();
}

export async function findWirePostKey(store, id) {
  for (const prefix of [WIRE_DRAFT_PREFIX, WIRE_POST_PREFIX]) {
    const key = (await listWireKeys(store, prefix)).find(candidate => candidate.endsWith(`_${id}`));
    if (key) return key;
  }
  return null;
}

export async function listStoredWirePosts(store, prefix = WIRE_POST_PREFIX) {
  if (!store) return [];
  const keys = (await listWireKeys(store, prefix)).slice(0, MAX_STORED_POSTS);
  const posts = await Promise.all(keys.map(key => store.get(key, { type: "json" }).catch(() => null)));
  return posts.filter(Boolean);
}

export async function saveWirePost(store, post, key = wirePostKey(post)) {
  await store.setJSON(key, post);
  return post;
}

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...headers } });
}

export function createIndustryWireHandler({ getDatabase, getUser, ensureMembership, authorizeOperator, getStore, now = () => new Date() }) {
  async function readPosts(store, includeDrafts) {
    let stored = [];
    try {
      stored = await listStoredWirePosts(store);
      if (includeDrafts) stored.push(...await listStoredWirePosts(store, WIRE_DRAFT_PREFIX));
    }
    catch (error) { console.error("Industry Wire store read failed", error instanceof Error ? error.message : "unknown error"); }
    return visibleWirePosts([...stored, ...SEED_WIRE_POSTS], { includeDrafts });
  }

  return async function industryWireHandler(request) {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
    const operator = Boolean(authorizeOperator?.(request));
    try {
      if (request.method === "GET") {
        if (!operator) {
          const user = await getUser();
          if (!user?.id) return json({ message: "Sign in to read the Industry Wire" }, 401);
          await ensureMembership(await getDatabase(), user);
        }
        const includeDrafts = operator && new URL(request.url).searchParams.get("drafts") === "1";
        return json({
          visibility: WIRE_VISIBILITY,
          visibilityLabel: WIRE_VISIBILITY_LABEL,
          posts: await readPosts(getStore(), includeDrafts)
        });
      }

      if (!operator) return json({ message: "Only HALO operators can publish to the Industry Wire" }, 403);
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "Wire post is too large" }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ message: "Wire post is too large" }, 413);
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ message: "Request body must be valid JSON" }, 400);
      const store = getStore();

      if (body.action === "create") {
        const result = createWirePost({
          title: body.title,
          summary: body.summary,
          artist_perspective: body.artist_perspective,
          on_rotation: body.on_rotation,
          author: body.author,
          status: body.status === "draft" ? "draft" : "published",
          now: now()
        });
        if (result.error) return json({ message: result.error }, 422);
        return json({ post: await saveWirePost(store, result.post) }, 201);
      }

      if (body.action === "publish") {
        const id = cleanText(body.id, 120);
        const key = /^[a-z0-9][a-z0-9-]*$/.test(id) ? await findWirePostKey(store, id) : null;
        const existing = normalizeWirePost(key ? await store.get(key, { type: "json" }) : null);
        if (!existing) return json({ message: "Wire draft not found" }, 404);
        if (existing.status === "published") return json({ message: "That wire post is already published" }, 409);
        const artistPerspective = cleanText(body.artist_perspective, limits.artist_perspective) || existing.artist_perspective;
        if (!artistPerspective) return json({ message: "Add the artist's take before publishing to the Wire" }, 422);
        // Publishing stamps the post with its publish time so the feed stays newest-first.
        const post = { ...existing, artist_perspective: artistPerspective, visibility: WIRE_VISIBILITY, status: "published", created_at: isoOrNull(now()) };
        const nextKey = wirePostKey(post);
        await saveWirePost(store, post, nextKey);
        if (nextKey !== key) await store.delete(key);
        return json({ post });
      }

      return json({ message: "Choose a supported Industry Wire action" }, 400);
    } catch (error) {
      console.error("Industry Wire request failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "The Industry Wire is temporarily unavailable" }, 500);
    }
  };
}

export async function queueWeeklyWireDraft(store, now = new Date()) {
  const result = weeklyWireDraft(now);
  if (result.error) throw new Error(result.error);
  const existingKey = await findWirePostKey(store, result.post.id);
  const existing = existingKey ? await store.get(existingKey, { type: "json" }) : null;
  if (existing) return { queued: false, post: normalizeWirePost(existing) };
  return { queued: true, post: await saveWirePost(store, result.post) };
}
