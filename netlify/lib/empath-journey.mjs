import { createHmac, randomUUID } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const releaseId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers }
});
class JourneyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = () => { throw new JourneyError(400, "Invalid journey request."); };
const validRelease = id => typeof id === "string" && id.length >= 2 && id.length <= 96 && releaseId.test(id);
const hash = (secret, domain, value) => createHmac("sha256", secret).update(`${domain}:${value}`).digest("hex");

export function journeyPreviewUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\\]/.test(value)) return "";
  try {
    const pathname = new URL(value, "https://halo.local").pathname;
    if (pathname !== "/api/radio/audio" && !/\.(mp3|m4a|aac|ogg|oga|wav|flac|webm)$/i.test(pathname)) return "";
  } catch { return ""; }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function albumPayload(row) {
  return { id: row.id, name: row.name, tracks: row.tracks, shared: row.shared,
    shareRoute: row.shared ? `/empath-journey/?album=${row.id}` : "", updatedAt: row.updated_at };
}
function trackPayload(row) {
  const count = value => Math.max(0, Number(value) || 0);
  return { id: row.id, title: row.title, artist: row.artist,
    lyricsText: typeof row.lyrics_text === "string" ? row.lyrics_text : "",
    previewUrl: journeyPreviewUrl(Object.hasOwn(row, "preview_url") ? row.preview_url : row.stream_url),
    votes: { track: count(row.track_votes), remix: count(row.remix_votes), priority: count(row.priority_votes) },
    momentum: row.gathering === true ? "gathering" : "quiet" };
}

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new JourneyError(415, "JSON is required.");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 16384)) {
    throw new JourneyError(413, "Request body is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new JourneyError(413, "Request body is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
    return body;
  } catch { invalid(); }
}

function validate(body) {
  const keys = { vote: ["action", "releaseId", "kind"], lyric: ["action", "releaseId", "seconds"],
    album: ["action", "id", "name", "tracks", "shared"] }[body.action];
  if (!keys || Object.keys(body).some(key => !keys.includes(key))) invalid();
  if (body.action !== "album") {
    if (!validRelease(body.releaseId)) invalid();
    if (body.action === "vote" && !["track", "remix", "priority"].includes(body.kind)) invalid();
    if (body.action === "lyric" && (!Number.isFinite(body.seconds) || body.seconds < 0 || body.seconds > 86400)) invalid();
    return body;
  }
  if (body.id !== undefined && (typeof body.id !== "string" || !uuid.test(body.id))) invalid();
  if (typeof body.name !== "string" || !body.name.trim() || [...body.name.trim()].length > 100 ||
      typeof body.shared !== "boolean" || !Array.isArray(body.tracks) || body.tracks.length < 1 || body.tracks.length > 12) invalid();
  const ids = new Set();
  for (const track of body.tracks) {
    if (!track || typeof track !== "object" || Object.keys(track).some(key => !["releaseId", "transitionSeconds"].includes(key)) ||
        !validRelease(track.releaseId) || ids.has(track.releaseId) ||
        !Number.isInteger(track.transitionSeconds) || track.transitionSeconds < 0 || track.transitionSeconds > 12) invalid();
    ids.add(track.releaseId);
  }
  return { ...body, name: body.name.trim() };
}

async function catalog(db) {
  return db.sql`
    SELECT catalog.*, tally.track_votes, tally.remix_votes, tally.priority_votes,
      COALESCE(tally.gathering, FALSE) AS gathering
    FROM halo_journey_catalog catalog
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE kind = 'track') AS track_votes,
        COUNT(*) FILTER (WHERE kind = 'remix') AS remix_votes,
        COUNT(*) FILTER (WHERE kind = 'priority') AS priority_votes,
        COUNT(DISTINCT identity_hash) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') >= 3 AS gathering
      FROM halo_journey_votes WHERE release_id = catalog.id
    ) tally ON TRUE ORDER BY catalog.id
  `;
}

export function createEmpathJourneyHandler({ getDatabase, getUser, verifyRequestOrigin, env = process.env }) {
  return async function empathJourney(request, context = {}) {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405, { Allow: "GET, POST" });
    try {
      const url = new URL(request.url);
      if (request.method === "GET") {
        const mine = url.searchParams.get("mine") === "1";
        const id = url.searchParams.get("album");
        if (mine && id) invalid();
        if (id !== null && !uuid.test(id)) invalid();
        const user = mine || id ? await getUser() : null;
        if (mine && !user?.id) throw new JourneyError(401, "Sign in to continue.");
        const db = await getDatabase();
        if (mine) {
          const rows = await db.sql`SELECT id, name, tracks, shared, updated_at FROM halo_journey_albums
            WHERE owner_id = ${user.id} ORDER BY updated_at DESC LIMIT 50`;
          return json({ albums: rows.map(albumPayload) });
        }
        if (id) {
          const rows = await db.sql`SELECT id, name, tracks, shared, updated_at FROM halo_journey_albums
            WHERE id = ${id}::uuid AND (shared = TRUE OR owner_id = ${user?.id || ""}) LIMIT 1`;
          if (!rows.length) throw new JourneyError(404, "Album not found.");
          const album = albumPayload(rows[0]);
          const tracks = new Map((await catalog(db)).map(row => [row.id, trackPayload(row)]));
          return json({ album, tracks: album.tracks.map(item => tracks.get(item.releaseId)).filter(Boolean) });
        }
        const tracks = (await catalog(db)).map(trackPayload);
        const presence = await db.sql`SELECT COUNT(DISTINCT vote.identity_hash) >= 3 AS gathering
          FROM halo_journey_votes vote JOIN halo_journey_catalog catalog ON catalog.id = vote.release_id
          WHERE vote.created_at > NOW() - INTERVAL '1 hour'`;
        return json({ tracks, presence: presence[0]?.gathering === true ? "gathering" : "quiet" });
      }
      if (env.JOURNEY_WRITES_DISABLED === "true") throw new JourneyError(503, "Journey writes are paused.");
      const user = await getUser();
      if (typeof user?.id !== "string" || !user.id) throw new JourneyError(401, "Sign in to continue.");
      if (request.headers.get("origin") !== url.origin) throw new JourneyError(403, "Same-origin request required.");
      let origin = false;
      try { origin = (await verifyRequestOrigin(request)) !== false; } catch {}
      if (!origin) throw new JourneyError(403, "Same-origin request required.");
      const secret = env.JOURNEY_IDENTITY_SECRET || env.JWT_SECRET;
      if (typeof secret !== "string" || !secret.trim()) throw new JourneyError(503, "Journey writes are unavailable.");
      const body = validate(await readBody(request));
      const identity = hash(secret, "account", user.id);
      // Netlify's server-provided context is authoritative; forwarded headers are never consulted.
      const ip = typeof context.ip === "string" && context.ip ? hash(secret, "ip", context.ip) : null;
      const db = await getDatabase();
      const rate = await db.sql`SELECT halo_journey_allow(${identity}, 'write', 30, 60) AS allowed`;
      if (rate[0]?.allowed !== true) throw new JourneyError(429, "Journey limit reached.");
      if (body.action === "vote") {
        const rows = await db.sql`
          WITH eligible AS MATERIALIZED (SELECT id FROM halo_journey_catalog WHERE id = ${body.releaseId}),
          duplicate AS MATERIALIZED (
            SELECT 1 FROM halo_journey_votes WHERE identity_hash = ${identity}
              AND release_id = ${body.releaseId} AND kind = ${body.kind}
          ), quota AS MATERIALIZED (
            SELECT halo_journey_allow(${identity}, 'vote', 10, 3600)
              AND (${ip}::text IS NULL OR halo_journey_allow(${ip}, 'ip_vote', 60, 3600)) AS allowed
            WHERE EXISTS (SELECT 1 FROM eligible) AND NOT EXISTS (SELECT 1 FROM duplicate)
          ), changed AS (
            INSERT INTO halo_journey_votes (identity_hash, release_id, kind)
            SELECT ${identity}, id, ${body.kind} FROM eligible WHERE (SELECT allowed FROM quota)
            ON CONFLICT DO NOTHING RETURNING release_id
          ), ledger AS (
            INSERT INTO halo_ledger (id, actor_id, actor_type, event_category, ref_release_id, summary, details)
            SELECT ${randomUUID()}, ${identity}, 'system', 'system_event', release_id,
              'Journey vote recorded', jsonb_build_object('type', 'journey_vote', 'kind', ${body.kind}::text)
            FROM changed RETURNING id
          )
          SELECT EXISTS (SELECT 1 FROM eligible) AS eligible,
            EXISTS (SELECT 1 FROM duplicate) AS duplicate,
            COALESCE((SELECT allowed FROM quota), TRUE) AS allowed,
            EXISTS (SELECT 1 FROM changed) AS changed, (SELECT COUNT(*) FROM ledger) AS logged
        `;
        const row = rows[0];
        if (!row?.eligible) throw new JourneyError(400, "Release unavailable.");
        if (!row.allowed) throw new JourneyError(429, "Journey vote limit reached.");
        return json({ ok: true, duplicate: !row.changed });
      }
      if (body.action === "lyric") {
        const rows = await db.sql`
          WITH changed AS (
            INSERT INTO halo_journey_lyric_sessions (id, identity_hash, release_id, seconds)
            SELECT ${randomUUID()}::uuid, ${identity}, id, ${body.seconds}
            FROM halo_journey_catalog WHERE id = ${body.releaseId} RETURNING release_id, seconds
          ), ledger AS (
            INSERT INTO halo_ledger (id, actor_id, actor_type, event_category, ref_release_id, summary, details)
            SELECT ${randomUUID()}, ${identity}, 'system', 'system_event', release_id,
              'Journey lyric focus recorded', jsonb_build_object('type', 'journey_lyric', 'seconds', seconds)
            FROM changed RETURNING id
          ) SELECT (SELECT COUNT(*) FROM changed) AS changed, (SELECT COUNT(*) FROM ledger) AS logged
        `;
        if (!Number(rows[0]?.changed)) throw new JourneyError(400, "Release unavailable.");
        return json({ ok: true });
      }
      const id = body.id || randomUUID();
      const rows = await db.sql`
        WITH eligible AS MATERIALIZED (
          SELECT COUNT(*) = ${body.tracks.length} AS valid FROM halo_journey_catalog
          WHERE id IN (SELECT item->>'releaseId' FROM jsonb_array_elements(${JSON.stringify(body.tracks)}::jsonb) item)
        ), ownership AS MATERIALIZED (
          SELECT ${body.id === undefined} OR EXISTS (
            SELECT 1 FROM halo_journey_albums WHERE id = ${id}::uuid AND owner_id = ${user.id}
          ) AS allowed
        ), slots AS (
          INSERT INTO halo_journey_album_owners AS owners (owner_id, album_count)
          SELECT ${user.id}, 1 WHERE ${body.id === undefined}
            AND (SELECT valid FROM eligible) AND (SELECT allowed FROM ownership)
          ON CONFLICT (owner_id) DO UPDATE SET album_count = owners.album_count + 1
          WHERE owners.album_count < 50 RETURNING owner_id
        ), changed AS (
          INSERT INTO halo_journey_albums AS albums (id, owner_id, name, tracks, shared)
          SELECT ${id}::uuid, ${user.id}, ${body.name}, ${JSON.stringify(body.tracks)}::jsonb, ${body.shared}
          WHERE (SELECT valid FROM eligible) AND (SELECT allowed FROM ownership)
            AND (${body.id !== undefined} OR EXISTS (SELECT 1 FROM slots))
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tracks = EXCLUDED.tracks,
            shared = EXCLUDED.shared, updated_at = NOW() WHERE albums.owner_id = EXCLUDED.owner_id
          RETURNING id, name, tracks, shared, updated_at
        ), ledger AS (
          INSERT INTO halo_ledger (id, actor_id, actor_type, event_category, summary, details)
          SELECT ${randomUUID()}, ${identity}, 'system', 'system_event', 'Journey album saved',
            jsonb_build_object('type', 'journey_album') FROM changed RETURNING id
        ) SELECT (SELECT valid FROM eligible) AS eligible, (SELECT allowed FROM ownership) AS allowed,
          (SELECT row_to_json(changed) FROM changed) AS album, (SELECT COUNT(*) FROM ledger) AS logged
      `;
      const row = rows[0];
      if (!row?.eligible) throw new JourneyError(400, "Release unavailable.");
      if (!row.allowed) throw new JourneyError(403, "Album access denied.");
      if (!row.album) throw new JourneyError(429, "Album limit reached.");
      return json({ album: albumPayload(row.album) });
    } catch (error) {
      if (error instanceof JourneyError) return json({ message: error.message }, error.status,
        error.status === 429 ? { "Retry-After": "60" } : {});
      return json({ message: "Journey unavailable. Please try again later." }, 503);
    }
  };
}
