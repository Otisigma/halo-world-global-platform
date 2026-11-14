import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";
import { catalogMasterReadiness } from "./release-conveyor-audio.mjs";
import { releaseFingerprint, validateRelease } from "./release-conveyor.mjs";
import { loadConveyorState, loadReleaseSubmission } from "./release-conveyor-store.mjs";
import { isOwnedMasterObjectKey } from "./direct-upload-storage.mjs";

const MAX_BODY_BYTES = 2048;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
export const TEASER_SPEC = Object.freeze({
  durationSeconds: 15, width: 1080, height: 1920, format: "mp4",
  branding: "HALO", waveform: true, cta: "Vote on HALO Living Chart",
});
const renderer = Object.freeze({
  available: false,
  message: "Video rendering is not deployed. No teaser has been queued or generated. A bounded rendering runtime and private output storage must be deployed first.",
});
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

// Readiness only: no user media is fetched and no conveyor state is changed.
export function teaserReadiness(submission, stored, startSeconds = 0) {
  const { song, versions } = submission;
  const { master, issues: audioIssues } = catalogMasterReadiness(song, versions);
  const issues = [...validateRelease(song, versions).issues, ...audioIssues];
  const state = stored?.state;
  if (state?.status !== "ready" || !state?.receipt?.ready || !state?.package?.council?.passed
    || state.inputHash !== releaseFingerprint(song, versions, state.options)) {
    issues.push({ field: "conveyor", message: "Run the release conveyor and resolve the current Council receipt first." });
  }
  const duration = Number(master?.duration_seconds);
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(duration)
    || duration < startSeconds + TEASER_SPEC.durationSeconds) {
    issues.push({ field: "startSeconds", message: "Choose a non-negative start time with at least 15 seconds of approved audio remaining." });
  }
  const size = Number(master?.audio_byte_size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_AUDIO_BYTES
    || !["audio/wav", "audio/x-wav", "audio/mpeg"].includes(master?.audio_content_type)) {
    issues.push({ field: "audio", message: "Teasers require a stored WAV or MP3 master with a known size up to 128 MB." });
  }
  const ownedStorage = master?.audio_storage_key
    ? isOwnedMasterObjectKey(master.audio_storage_key, {
      ownerMemberId: song.owner_member_id, songId: song.id, versionId: master.id,
    })
    : typeof master?.audio_blob_prefix === "string"
      && master.audio_blob_prefix.startsWith(`${song.owner_member_id}/${master.id}/`)
      && master.audio_blob_prefix.endsWith("/parts/")
      && !master.audio_blob_prefix.includes("..")
      && Number.isInteger(Number(master.audio_chunk_count))
      && Number(master.audio_chunk_count) >= 1 && Number(master.audio_chunk_count) <= 32
      && Number(master.audio_chunk_count) === Math.ceil(size / (4 * 1024 * 1024));
  if (!ownedStorage) issues.push({ field: "storage", message: "Use an owned catalog audio upload, not a local path, external audio URL or Drive archive link." });
  const artwork = master?.artwork_url || song.artwork_url;
  let ownedArtwork = false;
  try {
    const url = new URL(artwork, "https://halo.invalid");
    ownedArtwork = String(artwork).startsWith("/api/song-catalog/artwork?")
      && url.pathname === "/api/song-catalog/artwork"
      && url.searchParams.get("songId") === song.id
      && (!url.searchParams.has("versionId") || url.searchParams.get("versionId") === master?.id);
  } catch {}
  if (!ownedArtwork) issues.push({ field: "artwork", message: "Upload final cover art to this catalog song or its sale master before preparing a teaser." });
  return {
    songId: song.id, status: issues.length ? "blocked" : "unavailable",
    eligible: issues.length === 0, canGenerate: false, renderer,
    spec: TEASER_SPEC, startSeconds, issues,
  };
}

async function readPayload(request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return { status: 413 };
  let size = 0;
  const chunks = [];
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return { status: 413 };
    chunks.push(Buffer.from(chunk));
  }
  try { return { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; }
  catch { return { status: 400 }; }
}

export function createReleaseTeaserHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405);
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to prepare a release teaser." }, 401);
      let payload;
      if (request.method === "POST") {
        try { verifyRequestOrigin(request); }
        catch { return json({ message: "Cross-origin teaser requests are not accepted." }, 403); }
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
          return json({ message: "Use an application/json request." }, 415);
        }
        const parsed = await readPayload(request);
        if (parsed.status) return json({ message: "Invalid or oversized teaser request." }, parsed.status);
        payload = parsed.payload;
        if (!payload || Array.isArray(payload) || typeof payload !== "object"
          || Object.keys(payload).some(key => !["songId", "startSeconds", "consent"].includes(key))
          || payload.consent !== true) {
          return json({ message: "Confirm permission to use this release audio and cover art for a promotional teaser. Only songId, startSeconds and consent are accepted." }, 400);
        }
      }
      const url = new URL(request.url);
      const songId = cleanDreamweaverSongId(payload?.songId || url.searchParams.get("songId"));
      const startSeconds = payload ? payload.startSeconds ?? 0 : Number(url.searchParams.get("startSeconds") ?? 0);
      if (!songId || typeof startSeconds !== "number" || !Number.isFinite(startSeconds)
        || startSeconds < 0 || startSeconds > 3600) {
        return json({ message: "Choose a valid catalog song and start time between 0 and 3600 seconds." }, 400);
      }
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const submission = await loadReleaseSubmission(db, membership.member_id, songId);
      if (!submission) return json({ message: "Song not found." }, 404);
      const stored = await loadConveyorState(db, membership.member_id, songId);
      const readiness = teaserReadiness(submission, stored, startSeconds);
      if (request.method === "GET") return json(readiness);
      if (!readiness.eligible) return json({ ...readiness, message: "Resolve the teaser requirements first." }, 409);
      // Fail closed until a real renderer, durable jobs and private downloads are deployed.
      return json({ ...readiness, message: renderer.message }, 503);
    } catch {
      return json({ message: "Teaser readiness is temporarily unavailable. Your release is unchanged; retry shortly.", retryable: true }, 503);
    }
  };
}
