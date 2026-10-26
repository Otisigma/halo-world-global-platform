import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { cleanText } from "../lib/halo-x.mjs";

const audioStore = getStore({ name: "halo-radio-submissions", consistency: "strong" });
const catalogAudioStore = getStore({ name: "halo-song-catalog-audio", consistency: "strong" });
const uploadChunkBytes = 3 * 1024 * 1024;
const MEDIA_CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type"
});

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...MEDIA_CORS_HEADERS, "Cache-Control": "no-store", ...headers } });
}

function requestedByteRange(value, byteSize) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, byteSize - suffixLength);
    end = byteSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteSize - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= byteSize || end < start) return false;
  return { start, end: Math.min(end, byteSize - 1) };
}

function verifiedCatalogAudio(track) {
  const { release_audio: audio, catalog_release: release, catalog_song: song,
    catalog_version: version, owner_membership: membership } = track;
  if (!audio || !release || !song || !version || !membership) return false;
  const byteSize = Number(version.audio_byte_size);
  const chunkCount = Number(version.audio_chunk_count);
  const duration = Number(version.duration_seconds);
  const prefix = version.audio_blob_prefix || "";
  return track.audio_version_id === audio.id && track.release_id === release.id
    && audio.release_id === release.id && track.master_song_id === song.id && version.song_id === song.id
    && track.member_id === song.owner_member_id && audio.owner_member_id === song.owner_member_id
    && release.owner_member_id === song.owner_member_id && membership.member_id === song.owner_member_id
    && Boolean(membership.actor_id) && track.actor_id === membership.actor_id
    && (track.status !== "rotation" || Boolean(track.reviewed_at && track.reviewed_by_member_id))
    && song.status === "active" && song.pipeline_status === "published" && song.broadcast_requested === true
    && song.rights_status === "cleared" && track.rights_confirmed === true && audio.rights_confirmed === true
    && release.status === "published" && audio.status === "active" && version.status === "active"
    && version.mastering_status === "approved" && ["radio_edit", "clean"].includes(version.version_type)
    && audio.version_type === version.version_type
    && (song.explicit_lyrics === false || version.clean_lyrics === true)
    && prefix.startsWith(`${song.owner_member_id}/${version.id}/`) && prefix.endsWith("/parts/") && !prefix.includes("..")
    && track.blob_key === prefix && audio.blob_key === prefix
    && /^audio\/[a-z0-9.+-]+$/i.test(version.audio_content_type || "")
    && track.content_type === version.audio_content_type && audio.content_type === version.audio_content_type
    && Number.isSafeInteger(byteSize) && byteSize > 0 && byteSize <= 134217728
    && Number(track.byte_size) === byteSize && Number(audio.byte_size) === byteSize
    && Number.isSafeInteger(chunkCount) && chunkCount > 0 && chunkCount <= 64
    && chunkCount <= byteSize
    && Number(track.chunk_count) === chunkCount && Number(audio.chunk_count) === chunkCount
    && Number.isFinite(duration) && duration > 0 && duration <= 7200
    && Number(track.duration_seconds) === duration && Number(audio.duration_seconds) === duration;
}

function manualRadioUpload(track) {
  const prefix = `${track.member_id}/`;
  return Boolean(track.member_id) && typeof track.blob_key === "string" && track.blob_key.startsWith(prefix)
    && /^[a-z0-9-]{12,80}\/parts\/$/i.test(track.blob_key.slice(prefix.length));
}

async function readAudioRange(track, range, store, catalogOrigin) {
  // Catalog uploads have used different part sizes; the stored first part is authoritative.
  const firstPart = catalogOrigin ? await store.get(`${track.blob_key}000`, { type: "arrayBuffer" }) : null;
  const chunkBytes = catalogOrigin ? firstPart?.byteLength : uploadChunkBytes;
  if (!chunkBytes || (catalogOrigin && Math.ceil(Number(track.byte_size) / chunkBytes) !== Number(track.chunk_count))) {
    throw new Error("Radio track chunk layout is invalid");
  }
  const firstChunk = Math.floor(range.start / chunkBytes);
  const lastChunk = Math.floor(range.end / chunkBytes);
  if (firstChunk >= Number(track.chunk_count) || lastChunk >= Number(track.chunk_count)) throw new Error("Radio track range exceeds stored chunks");

  const chunks = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const key = `${track.blob_key}${String(index).padStart(3, "0")}`;
    const part = index === 0 && firstPart ? firstPart : await store.get(key, { type: "arrayBuffer" });
    if (!part) throw new Error("Radio track chunk is missing");
    chunks.push(new Uint8Array(part));
  }

  const rangeLength = range.end - range.start + 1;
  const audio = new Uint8Array(rangeLength);
  let written = 0;
  for (let index = 0; index < chunks.length && written < rangeLength; index += 1) {
    const chunkNumber = firstChunk + index;
    const chunkStart = chunkNumber * chunkBytes;
    const sourceStart = Math.max(0, range.start - chunkStart);
    const sourceEnd = Math.min(chunks[index].byteLength, range.end - chunkStart + 1);
    const slice = chunks[index].subarray(sourceStart, sourceEnd);
    audio.set(slice, written);
    written += slice.byteLength;
  }
  if (written !== rangeLength) throw new Error("Radio track range is incomplete");
  return audio;
}

export default async function radioAudioHandler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MEDIA_CORS_HEADERS });
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser().catch(() => null)]);
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    const memberId = user?.id || "";
    const rows = await db.sql`
      SELECT track.blob_key, track.chunk_count, track.content_type, track.byte_size, track.status,
        track.member_id, track.actor_id, track.release_id, track.master_song_id, track.audio_version_id,
        track.rights_confirmed, track.duration_seconds, track.reviewed_at, track.reviewed_by_member_id,
        to_jsonb(audio) AS release_audio, to_jsonb(release) AS catalog_release,
        to_jsonb(song) AS catalog_song, to_jsonb(version) AS catalog_version,
        to_jsonb(membership) AS owner_membership
      FROM halo_radio_tracks track
      LEFT JOIN halo_release_audio_versions audio ON audio.id = track.audio_version_id
      LEFT JOIN halo_release_campaigns release ON release.id = track.release_id
      LEFT JOIN halo_song_catalog song ON song.id = track.master_song_id
      LEFT JOIN halo_song_versions version
        ON version.song_id = track.master_song_id
        AND version.audio_blob_prefix = track.blob_key
        AND version.version_type = audio.version_type
      LEFT JOIN halo_memberships membership ON membership.member_id = song.owner_member_id
      WHERE track.id = ${id} AND (track.status IN ('preview', 'rotation') OR track.member_id = ${memberId})
      LIMIT 1
    `;
    const track = rows[0];
    if (!track) return json({ message: "Radio track not found" }, 404);
    // Linking a manual upload to a song does not move its owned radio-store chunks.
    // Other namespaces must verify catalog provenance completely, without a store fallback.
    const catalogOrigin = Boolean(track.catalog_version) || !manualRadioUpload(track);
    if (catalogOrigin && !verifiedCatalogAudio(track)) return json({ message: "Radio track not found" }, 404);
    const store = catalogOrigin ? catalogAudioStore : audioStore;

    const byteSize = Number(track.byte_size);
    const range = requestedByteRange(request.headers.get("range"), byteSize);
    if (range === false) {
      return new Response(null, {
        status: 416,
        headers: {
          ...MEDIA_CORS_HEADERS,
          "Accept-Ranges": "bytes",
          "Vary": "Range",
          "Content-Range": `bytes */${byteSize}`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const cacheable = track.status === "rotation";
    const headers = {
      ...MEDIA_CORS_HEADERS,
      "Content-Type": track.content_type,
      "Content-Length": String(range ? range.end - range.start + 1 : byteSize),
      "Cache-Control": cacheable ? "public, max-age=3600" : "private, no-store",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "Vary": "Range",
      "X-Content-Type-Options": "nosniff"
    };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${byteSize}`;
    if (cacheable) {
      headers["Netlify-CDN-Cache-Control"] = "public, durable, max-age=3600, stale-while-revalidate=600";
    }
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });

    if (range) {
      const audio = await readAudioRange(track, range, store, catalogOrigin);
      if (range.start === 0) await db.sql`UPDATE halo_radio_tracks SET play_count = play_count + 1 WHERE id = ${id}`;
      return new Response(audio, { status: 206, headers });
    }

    const audio = new ReadableStream({
      async start(controller) {
        try {
          for (let index = 0; index < Number(track.chunk_count || 1); index += 1) {
            const key = `${track.blob_key}${String(index).padStart(3, "0")}`;
            const part = await store.get(key, { type: "arrayBuffer" });
            if (!part) throw new Error("Radio track chunk is missing");
            controller.enqueue(new Uint8Array(part));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    await db.sql`UPDATE halo_radio_tracks SET play_count = play_count + 1 WHERE id = ${id}`;
    return new Response(audio, {
      headers
    });
  } catch (error) {
    console.error("HALO radio audio playback failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This radio preview could not be played right now" }, 500);
  }
}

export const config = {
  path: "/api/radio/audio"
};
