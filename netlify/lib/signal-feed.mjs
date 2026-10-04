import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 18_000;
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
});
class FeedError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function text(value, max, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new FeedError(`Use ${required ? "1–" : "up to "}${max} characters`);
  }
  return value.trim();
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new FeedError("Invalid identifier");
  }
  return value;
}
export function publicLink(value) {
  try {
    const raw = text(value, 1200, true);
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost"
      || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")
      || /\.(local|internal|localhost)$/i.test(url.hostname)
      || /(?:token|signature|credential|x-amz-|x-goog-)/i.test(url.search)
      || /\/(?:api\/(?:song-catalog|stem-vault)|private)(?:\/|$)/i.test(url.pathname)) return "";
    return url.href;
  } catch { return ""; }
}
export function postInput(body) {
  if (!["TEXT", "AUDIO", "VIDEO", "BRIEF_LINK"].includes(body.kind)) throw new FeedError("Choose a post type");
  if (body.publishPublic !== true) throw new FeedError("Confirm deliberate public publication");
  const result = {
    kind: body.kind, body: text(body.body, 1000, true),
    releaseId: body.kind === "AUDIO" ? text(body.releaseId, 100, true) : null,
    linkUrl: ["VIDEO", "BRIEF_LINK"].includes(body.kind) ? publicLink(body.linkUrl) : "",
    includePurchase: body.includePurchase === true
  };
  if (body.includePurchase != null && typeof body.includePurchase !== "boolean") throw new FeedError("Invalid purchase setting");
  if (result.includePurchase && body.kind !== "AUDIO") throw new FeedError("Only published releases can link to commerce");
  if (["VIDEO", "BRIEF_LINK"].includes(body.kind) && !result.linkUrl) throw new FeedError("Use a public HTTPS link without credentials");
  if (body.audioUrl != null || body.assetUrl != null || body.purchaseUrl != null) throw new FeedError("Select a published release; do not submit asset or purchase URLs");
  return result;
}
function timestamp(value) {
  if (value == null || value === "") return null;
  if (!Number.isInteger(value) || value < 0 || value > 86400) throw new FeedError("Timestamp must be 0–86400 whole seconds");
  return value;
}
export function pageInput(url) {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit == null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new FeedError("Page size must be 1–40");
  let cursor = null;
  const raw = url.searchParams.get("cursor");
  if (raw) {
    try {
      if (raw.length > 240) throw new Error();
      const value = JSON.parse(Buffer.from(raw, "base64url").toString());
      if (typeof value.at !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.at)
        || !Number.isFinite(Date.parse(value.at))) throw new Error();
      cursor = { at: value.at, id: uuid(value.id) };
    } catch { throw new FeedError("Invalid pagination cursor"); }
  }
  return { limit, cursor };
}
const iso = value => new Date(value).toISOString();
const cursorFor = row => Buffer.from(JSON.stringify({ at: row.cursor_at || iso(row.created_at), id: row.id })).toString("base64url");
function paginated(rows, limit, serialize) {
  const items = rows.slice(0, limit);
  return { items: items.map(serialize), nextCursor: rows.length > limit ? cursorFor(items.at(-1)) : null };
}
async function readBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new FeedError("Use application/json", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new FeedError("Request body too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new FeedError("JSON body required");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new FeedError("Request body too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new FeedError("Request body must be a JSON object"); }
}
async function blocked(db, memberId, otherId) {
  if (!memberId) return false;
  const rows = await db.sql`SELECT 1 FROM halo_signal_blocks
    WHERE (member_id = ${memberId} AND target_member_id = ${otherId})
       OR (member_id = ${otherId} AND target_member_id = ${memberId}) LIMIT 1`;
  return rows.length > 0;
}
async function rateLimit(db, memberId, bucket) {
  const seconds = bucket === "publish" ? 3600 : 60;
  const max = bucket === "publish" ? 10 : 30;
  const rows = await db.sql`
    INSERT INTO halo_signal_feed_rate_limits (member_id, bucket) VALUES (${memberId}, ${bucket})
    ON CONFLICT (member_id, bucket) DO UPDATE SET
      attempts = CASE WHEN halo_signal_feed_rate_limits.window_start <= NOW() - ${seconds} * INTERVAL '1 second'
        THEN 1 ELSE halo_signal_feed_rate_limits.attempts + 1 END,
      window_start = CASE WHEN halo_signal_feed_rate_limits.window_start <= NOW() - ${seconds} * INTERVAL '1 second'
        THEN NOW() ELSE halo_signal_feed_rate_limits.window_start END
    WHERE halo_signal_feed_rate_limits.attempts < ${max}
       OR halo_signal_feed_rate_limits.window_start <= NOW() - ${seconds} * INTERVAL '1 second'
    RETURNING attempts`;
  if (!rows.length) throw new FeedError("Signal feed rate limit reached; try again later", 429);
}

export function releaseMusicMetadata(release) {
  const bpm = typeof release.bpm === "number" || (typeof release.bpm === "string" && /^\d+$/.test(release.bpm))
    ? Number(release.bpm) : null;
  const rawKey = typeof release.musical_key === "string" ? release.musical_key.trim() : "";
  const validKey = /^(?:[A-G](?:#|b|♯|♭)?(?: *(?:major|minor|maj|min|m|ionian|dorian|phrygian|lydian|mixolydian|aeolian|locrian))?|(?:[1-9]|1[0-2])[AB])$/i;
  const genres = Array.isArray(release.genres)
    ? [...new Set(release.genres.filter(value => typeof value === "string")
      .map(value => value.trim())
      .filter(value => value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f<>]/.test(value)))].slice(0, 12) : [];
  return {
    bpm: Number.isInteger(bpm) && bpm >= 20 && bpm <= 300 ? bpm : null,
    musicalKey: rawKey.length <= 40 && validKey.test(rawKey) ? rawKey : "",
    genres
  };
}
// Resolve only the public release stream, never a version's owner-only audio_url.
export async function releaseMedia(db, releaseId) {
  const rows = await db.sql`SELECT id, title, artist, stream_url, purchase_url, bpm, musical_key, genres
    FROM halo_release_campaigns WHERE id = ${releaseId} AND status = 'published'
      AND COALESCE(visibility, 'public') = 'public' LIMIT 1`;
  const release = rows[0];
  if (!release) return null;
  let audioUrl = "";
  const raw = release.stream_url || "";
  try {
    const url = new URL(raw, "https://halo.invalid");
    if (raw.startsWith("/api/mixes/audio?") && url.pathname === "/api/mixes/audio"
      && [...url.searchParams.keys()].every(key => key === "id")) {
      const mixes = await db.sql`SELECT id FROM halo_mixes WHERE id = ${url.searchParams.get("id")}
        AND visibility = 'public' LIMIT 1`;
      if (mixes.length) audioUrl = `/api/mixes/audio?id=${encodeURIComponent(mixes[0].id)}`;
    } else if (raw.startsWith("/api/radio/audio?") && url.pathname === "/api/radio/audio"
      && [...url.searchParams.keys()].every(key => key === "id")) {
      const tracks = await db.sql`SELECT id FROM halo_radio_tracks WHERE id = ${url.searchParams.get("id")}
        AND status = 'rotation' LIMIT 1`;
      if (tracks.length) audioUrl = `/api/radio/audio?id=${encodeURIComponent(tracks[0].id)}`;
    } else {
      const safe = publicLink(raw);
      if (safe && !url.search && /\.(mp3|m4a|aac|ogg|oga|wav|flac|webm)$/i.test(url.pathname)) audioUrl = safe;
    }
  } catch {}
  return {
    id: release.id, title: release.title, artist: release.artist, audioUrl,
    purchaseUrl: publicLink(release.purchase_url), ...releaseMusicMetadata(release)
  };
}
async function visiblePost(db, postId, memberId) {
  const rows = await db.sql`SELECT id, member_id, kind FROM halo_signal_feed_posts WHERE id = ${postId} LIMIT 1`;
  if (!rows[0] || await blocked(db, memberId, rows[0].member_id)) throw new FeedError("Post not found", 404);
  return rows[0];
}
async function feed(db, memberId, url) {
  const { limit, cursor } = pageInput(url);
  const saved = url.searchParams.get("view") === "saved";
  if (saved && !memberId) throw new FeedError("Sign in with your Creator Pass", 401);
  const rows = await db.sql`
    SELECT p.*, p.created_at::text AS cursor_at,
      (SELECT COUNT(*)::int FROM halo_signal_feed_reactions r WHERE r.post_id = p.id AND r.kind = 'boost') AS boosts,
      EXISTS (SELECT 1 FROM halo_signal_feed_reactions r WHERE r.post_id = p.id AND r.member_id = ${memberId} AND r.kind = 'boost') AS boosted,
      EXISTS (SELECT 1 FROM halo_signal_feed_reactions r WHERE r.post_id = p.id AND r.member_id = ${memberId} AND r.kind = 'save') AS saved
    FROM halo_signal_feed_posts p
    WHERE (${cursor?.at || null}::timestamptz IS NULL OR (p.created_at, p.id) < (${cursor?.at || null}::timestamptz, ${cursor?.id || null}::uuid))
      AND (NOT ${saved} OR EXISTS (SELECT 1 FROM halo_signal_feed_reactions r WHERE r.post_id = p.id AND r.member_id = ${memberId} AND r.kind = 'save'))
      AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
        WHERE (b.member_id = ${memberId} AND b.target_member_id = p.member_id)
          OR (b.target_member_id = ${memberId} AND b.member_id = p.member_id))
    ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit + 1}`;
  const media = new Map();
  await Promise.all([...new Set(rows.slice(0, limit).map(row => row.release_id).filter(Boolean))].map(async id => {
    media.set(id, await releaseMedia(db, id));
  }));
  return paginated(rows, limit, row => {
    const release = media.get(row.release_id);
    return {
      id: row.id, memberId: row.member_id, authorName: row.author_name, kind: row.kind,
      body: row.body, linkUrl: publicLink(row.link_url), createdAt: iso(row.created_at),
      boosts: Number(row.boosts), boosted: Boolean(row.boosted), saved: Boolean(row.saved),
      media: release ? { ...release, purchaseUrl: row.include_purchase ? release.purchaseUrl : "" } : null
    };
  });
}
async function comments(db, memberId, url) {
  const postId = uuid(url.searchParams.get("postId"));
  await visiblePost(db, postId, memberId);
  const { limit, cursor } = pageInput(url);
  const rows = await db.sql`
    SELECT c.*, c.created_at::text AS cursor_at FROM halo_signal_feed_comments c
    WHERE c.post_id = ${postId}
      AND (${cursor?.at || null}::timestamptz IS NULL OR (c.created_at, c.id) > (${cursor?.at || null}::timestamptz, ${cursor?.id || null}::uuid))
      AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
        WHERE (b.member_id = ${memberId} AND b.target_member_id = c.member_id)
          OR (b.target_member_id = ${memberId} AND b.member_id = c.member_id))
      AND (c.parent_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM halo_signal_feed_comments parent JOIN halo_signal_blocks b
          ON (b.member_id = ${memberId} AND b.target_member_id = parent.member_id)
          OR (b.target_member_id = ${memberId} AND b.member_id = parent.member_id)
        WHERE parent.id = c.parent_id))
    ORDER BY c.created_at, c.id LIMIT ${limit + 1}`;
  return paginated(rows, limit, row => ({
    id: row.id, parentId: row.parent_id, memberId: row.member_id, authorName: row.author_name,
    body: row.body, timestampSeconds: row.timestamp_seconds, createdAt: iso(row.created_at)
  }));
}
async function notifications(db, memberId, url) {
  if (!memberId) throw new FeedError("Sign in with your Creator Pass", 401);
  const { limit, cursor } = pageInput(url);
  const rows = await db.sql`
    SELECT n.*, n.created_at::text AS cursor_at FROM halo_signal_feed_notifications n
    JOIN halo_signal_feed_posts p ON p.id = n.post_id
    WHERE n.recipient_member_id = ${memberId}
      AND (${cursor?.at || null}::timestamptz IS NULL OR (n.created_at, n.id) < (${cursor?.at || null}::timestamptz, ${cursor?.id || null}::uuid))
      AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b WHERE
        (b.member_id = ${memberId} AND b.target_member_id IN (n.actor_member_id, p.member_id))
        OR (b.target_member_id = ${memberId} AND b.member_id IN (n.actor_member_id, p.member_id)))
    ORDER BY n.created_at DESC, n.id DESC LIMIT ${limit + 1}`;
  return paginated(rows, limit, row => ({
    id: row.id, postId: row.post_id, actorName: row.actor_name, kind: row.kind,
    readAt: row.read_at ? iso(row.read_at) : null, createdAt: iso(row.created_at)
  }));
}
export function createSignalFeedHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      if (request.method === "POST") {
        let valid = false;
        try { valid = (await verifyRequestOrigin(request)) !== false; } catch {}
        if (!valid) throw new FeedError("Cross-origin action rejected", 403);
      }
      const user = await getUser();
      const db = await getDatabase();
      const membership = user?.id ? await ensureMembership(db, user) : null;
      const memberId = membership?.member_id || "";
      const url = new URL(request.url);
      if (request.method === "GET") {
        const view = url.searchParams.get("view") || "feed";
        if (view === "comments") return json(await comments(db, memberId, url));
        if (view === "notifications") return json(await notifications(db, memberId, url));
        if (view === "blocked") {
          if (!memberId) throw new FeedError("Sign in with your Creator Pass", 401);
          const rows = await db.sql`SELECT b.target_member_id, m.display_name
            FROM halo_signal_blocks b JOIN halo_memberships m ON m.member_id = b.target_member_id
            WHERE b.member_id = ${memberId} ORDER BY b.created_at DESC, b.target_member_id LIMIT 101`;
          return json({ items: rows.slice(0, 100).map(row => ({ memberId: row.target_member_id, displayName: row.display_name })), hasMore: rows.length > 100 });
        }
        if (view === "feed" || view === "saved") return json({ ...await feed(db, memberId, url), memberId });
        throw new FeedError("Unknown feed view");
      }
      if (!memberId) throw new FeedError("Sign in with your Creator Pass to participate", 401);
      const body = await readBody(request);
      if (!["publish", "comment", "boost", "save", "read_notification", "delete_post", "delete_comment", "block", "unblock", "report"].includes(body.action)) throw new FeedError("Unknown action");
      await rateLimit(db, memberId, "write");
      const authorName = text(membership.display_name || "Creator", 100, true);
      if (body.action === "publish") {
        const input = postInput(body);
        await rateLimit(db, memberId, "publish");
        if (input.kind === "AUDIO") {
          const media = await releaseMedia(db, input.releaseId);
          if (!media?.audioUrl) throw new FeedError("Choose a published release with verified public audio");
          if (input.includePurchase && !media.purchaseUrl) throw new FeedError("This published release has no public purchase link");
        }
        const id = randomUUID();
        await db.sql`INSERT INTO halo_signal_feed_posts (id, member_id, author_name, kind, body, release_id, link_url, include_purchase)
          VALUES (${id}, ${memberId}, ${authorName}, ${input.kind}, ${input.body}, ${input.releaseId}, ${input.linkUrl}, ${input.includePurchase})`;
        return json({ id }, 201);
      }
      if (body.action === "read_notification") {
        const id = uuid(body.notificationId);
        await db.sql`UPDATE halo_signal_feed_notifications SET read_at = COALESCE(read_at, NOW())
          WHERE id = ${id} AND recipient_member_id = ${memberId}`;
        return json({ ok: true });
      }
      if (["block", "unblock", "report"].includes(body.action)) {
        const target = text(body.memberId, 100, true);
        if (target === memberId) throw new FeedError("Choose another member");
        const members = await db.sql`SELECT member_id FROM halo_memberships WHERE member_id = ${target} LIMIT 1`;
        if (!members.length) throw new FeedError("Member not found", 404);
        if (body.action === "block") await db.sql`INSERT INTO halo_signal_blocks (member_id, target_member_id)
          VALUES (${memberId}, ${target}) ON CONFLICT DO NOTHING`;
        if (body.action === "unblock") await db.sql`DELETE FROM halo_signal_blocks WHERE member_id = ${memberId} AND target_member_id = ${target}`;
        if (body.action === "report") {
          const reason = text(body.reason, 800, true);
          if (reason.length < 3) throw new FeedError("Describe the safety concern");
          await db.sql`INSERT INTO halo_signal_reports (reporter_member_id, target_member_id, reason)
            VALUES (${memberId}, ${target}, ${reason})`;
        }
        return json({ ok: true });
      }
      const postId = uuid(body.postId);
      if (body.action === "delete_comment") {
        const commentId = uuid(body.commentId);
        const rows = await db.sql`DELETE FROM halo_signal_feed_comments
          WHERE id = ${commentId} AND post_id = ${postId} AND member_id = ${memberId} RETURNING id`;
        if (!rows.length) throw new FeedError("Comment not found or not yours", 404);
        return json({ ok: true });
      }
      const post = await visiblePost(db, postId, memberId);
      if (body.action === "delete_post") {
        if (post.member_id !== memberId) throw new FeedError("Only the author can remove this post", 403);
        await db.sql`DELETE FROM halo_signal_feed_posts WHERE id = ${postId} AND member_id = ${memberId}`;
        return json({ ok: true });
      }
      if (body.action === "comment") {
        if (body.publishPublic !== true) throw new FeedError("Confirm deliberate public publication");
        const content = text(body.body, 1200, true);
        const parentId = body.parentId ? uuid(body.parentId) : null;
        const seconds = timestamp(body.timestampSeconds);
        if (seconds !== null && post.kind !== "AUDIO" && post.kind !== "VIDEO") throw new FeedError("Timestamps need an audio or video post");
        let recipient = post.member_id;
        if (parentId) {
          const parents = await db.sql`SELECT member_id, parent_id FROM halo_signal_feed_comments
            WHERE id = ${parentId} AND post_id = ${postId} LIMIT 1`;
          if (!parents.length || parents[0].parent_id || await blocked(db, memberId, parents[0].member_id)) throw new FeedError("Reply to an available root comment on this post");
          recipient = parents[0].member_id;
        }
        const id = randomUUID();
        await db.sql`WITH inserted AS (
          INSERT INTO halo_signal_feed_comments (id, post_id, member_id, author_name, body, parent_id, timestamp_seconds)
          VALUES (${id}, ${postId}, ${memberId}, ${authorName}, ${content}, ${parentId}, ${seconds}) RETURNING id
        ) INSERT INTO halo_signal_feed_notifications (recipient_member_id, actor_member_id, actor_name, post_id, comment_id, kind)
          SELECT ${recipient}, ${memberId}, ${authorName}, ${postId}, id, ${parentId ? "reply" : "comment"} FROM inserted
          WHERE ${recipient} <> ${memberId}`;
        return json({ id }, 201);
      }
      if (typeof body.active !== "boolean") throw new FeedError("Use an explicit active state");
      if (body.active) {
        await db.sql`WITH inserted AS (
          INSERT INTO halo_signal_feed_reactions (post_id, member_id, kind) VALUES (${postId}, ${memberId}, ${body.action})
          ON CONFLICT DO NOTHING RETURNING post_id
        ) INSERT INTO halo_signal_feed_notifications (recipient_member_id, actor_member_id, actor_name, post_id, kind)
          SELECT ${post.member_id}, ${memberId}, ${authorName}, post_id, 'boost' FROM inserted
          WHERE ${body.action} = 'boost' AND ${post.member_id} <> ${memberId}`;
      } else {
        await db.sql`DELETE FROM halo_signal_feed_reactions WHERE post_id = ${postId} AND member_id = ${memberId} AND kind = ${body.action}`;
      }
      return json({ ok: true, active: body.active });
    } catch (error) {
      if (error instanceof FeedError) return json({ message: error.message }, error.status);
      console.error("Signal feed request failed", error?.name || "UnknownError");
      return json({ message: "Signal feed is unavailable. Please try again later." }, 503);
    }
  };
}
