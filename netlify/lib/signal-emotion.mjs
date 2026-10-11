import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { validSignalWord, validSignalTrack } from "../../lib/signal-emotion.js";

const blocked = new Set(["fuck", "shit", "bitch", "cunt", "nigger", "faggot", "kill", "die"]);
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers }
});
const hash = (secret, domain, value) => createHmac("sha256", secret).update(`${domain}:${value}`).digest("hex");
class EmotionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new EmotionError(status, message); };
const payload = row => ({ id: row.id, word: row.emotion_word, createdAt: row.created_at });

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) reject(415, "JSON is required.");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) reject(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) reject(400, "Invalid Signal request.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); reject(413, "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || typeof body !== "object" || Array.isArray(body)) reject(400, "Invalid Signal request.");
    return body;
  } catch { reject(400, "Invalid Signal request."); }
}

function session(request, secret) {
  const token = (request.headers.get("cookie") || "").split(";")
    .map(part => part.trim()).find(part => part.startsWith("__Host-halo_signal="))?.slice(19);
  const match = token?.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);
  if (match && timingSafeEqual(Buffer.from(match[2], "hex"), Buffer.from(hash(secret, "session", match[1]), "hex"))) {
    return { id: match[1], cookie: "" };
  }
  const id = randomUUID();
  return { id, cookie: `__Host-halo_signal=${id}.${hash(secret, "session", id)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` };
}

export function createSignalEmotionHandler({ getDatabase, getUser, verifyRequestOrigin, env = process.env }) {
  const moderated = word => {
    const normalized = word.normalize("NFKC").toLowerCase();
    return blocked.has(normalized) || String(env.SIGNAL_EMOTION_BLOCKED_WORDS || "")
      .split(",").some(item => item.trim().normalize("NFKC").toLowerCase() === normalized);
  };
  return async (request, context = {}) => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405, { Allow: "GET, POST" });
    try {
      const url = new URL(request.url);
      if (request.method === "GET") {
        const releaseId = url.searchParams.get("releaseId");
        if (!validSignalTrack(releaseId)) reject(400, "Choose a published track.");
        const db = await getDatabase();
        const rows = await db.sql`
          SELECT emotion.id, emotion.emotion_word, emotion.created_at
          FROM halo_signal_emotions emotion JOIN halo_release_campaigns release ON release.id = emotion.release_id
          WHERE emotion.release_id = ${releaseId} AND emotion.hidden = FALSE
            AND release.visibility = 'public' AND release.status = 'published'
          ORDER BY emotion.created_at DESC, emotion.id DESC LIMIT 24
        `;
        return json({ releaseId, words: rows.filter(row => validSignalWord(row.emotion_word) && !moderated(row.emotion_word)).map(payload) });
      }
      if (env.SIGNAL_EMOTION_WRITES_DISABLED === "true") reject(503, "The map is resting. Please try later.");
      if (request.headers.get("origin") !== url.origin) reject(403, "Same-origin request required.");
      let origin = false;
      try { origin = (await verifyRequestOrigin(request)) !== false; } catch {}
      if (!origin) reject(403, "Same-origin request required.");
      const secret = env.SIGNAL_EMOTION_IDENTITY_SECRET || env.JOURNEY_IDENTITY_SECRET || env.JWT_SECRET;
      if (typeof secret !== "string" || !secret.trim() || typeof context.ip !== "string" || !context.ip) {
        reject(503, "The map is resting. Please try later.");
      }
      const body = await readBody(request);
      if (Object.keys(body).some(key => !["releaseId", "word", "playbackSeconds"].includes(key)) ||
          !validSignalTrack(body.releaseId) || !validSignalWord(body.word) ||
          (body.playbackSeconds !== undefined && (!Number.isFinite(body.playbackSeconds) ||
            body.playbackSeconds < 0 || body.playbackSeconds > 86400))) {
        reject(400, "Leave exactly one word, letters only, up to 20 characters.");
      }
      if (moderated(body.word)) reject(422, "Please choose a gentler word for the map.");
      const user = await getUser();
      const anonymous = session(request, secret);
      const identity = hash(secret, user?.id ? "account" : "anonymous", user?.id || anonymous.id);
      const ip = hash(secret, "signal-ip", context.ip);
      const db = await getDatabase();
      const quota = await db.sql`SELECT halo_signal_emotion_allow(${ip}, 10) AS allowed`;
      if (!quota[0]?.allowed) reject(429, "Let the map breathe. Please try again in a minute.");
      const personal = await db.sql`SELECT halo_signal_emotion_allow(${identity}, 3) AS allowed`;
      if (!personal[0]?.allowed) reject(429, "Let the map breathe. Please try again in a minute.");
      const rows = await db.sql`
        WITH eligible AS (
          SELECT id, title FROM halo_release_campaigns
          WHERE id = ${body.releaseId} AND visibility = 'public' AND status = 'published'
        ), inserted AS (
          INSERT INTO halo_signal_emotions (id, release_id, track_name, emotion_word, identity_hash, playback_seconds)
          SELECT ${randomUUID()}::uuid, id, title, ${body.word}, ${identity}, ${body.playbackSeconds ?? null}
          FROM eligible RETURNING id, release_id, emotion_word, created_at
        ), ledger AS (
          INSERT INTO halo_ledger (id, actor_id, actor_type, event_category, ref_release_id, summary, details)
          SELECT ${randomUUID()}, 'listener', 'system', 'system_event', release_id,
            'Signal emotion recorded', jsonb_build_object('type', 'signal_emotion', 'emotionId', id)
          FROM inserted RETURNING id
        )
        SELECT id, emotion_word, created_at FROM inserted
      `;
      if (!rows.length) reject(404, "Choose a published track.");
      return json({ releaseId: body.releaseId, word: payload(rows[0]) }, 201,
        !user?.id && anonymous.cookie ? { "Set-Cookie": anonymous.cookie } : {});
    } catch (error) {
      const status = error instanceof EmotionError ? error.status : 503;
      return json({ message: error instanceof EmotionError ? error.message : "The map is resting. Please try later." },
        status, status === 429 ? { "Retry-After": "60" } : {});
    }
  };
}
