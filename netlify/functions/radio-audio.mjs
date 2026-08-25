import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { cleanText } from "../lib/halo-x.mjs";

const audioStore = getStore({ name: "halo-radio-submissions", consistency: "strong" });
const uploadChunkBytes = 3 * 1024 * 1024;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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

async function readAudioRange(track, range) {
  const firstChunk = Math.floor(range.start / uploadChunkBytes);
  const lastChunk = Math.floor(range.end / uploadChunkBytes);
  if (firstChunk >= Number(track.chunk_count) || lastChunk >= Number(track.chunk_count)) throw new Error("Radio track range exceeds stored chunks");

  const chunks = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const key = `${track.blob_key}${String(index).padStart(3, "0")}`;
    const part = await audioStore.get(key, { type: "arrayBuffer" });
    if (!part) throw new Error("Radio track chunk is missing");
    chunks.push(new Uint8Array(part));
  }

  const rangeLength = range.end - range.start + 1;
  const audio = new Uint8Array(rangeLength);
  let written = 0;
  for (let index = 0; index < chunks.length && written < rangeLength; index += 1) {
    const chunkNumber = firstChunk + index;
    const chunkStart = chunkNumber * uploadChunkBytes;
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
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    const memberId = user?.id || "";
    const rows = await db.sql`
      SELECT blob_key, chunk_count, content_type, byte_size, status
      FROM halo_radio_tracks
      WHERE id = ${id} AND (status IN ('preview', 'rotation') OR member_id = ${memberId})
      LIMIT 1
    `;
    const track = rows[0];
    if (!track) return json({ message: "Radio track not found" }, 404);

    const byteSize = Number(track.byte_size);
    const range = requestedByteRange(request.headers.get("range"), byteSize);
    if (range === false) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${byteSize}`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const cacheable = track.status === "rotation";
    const headers = {
      "Content-Type": track.content_type,
      "Content-Length": String(range ? range.end - range.start + 1 : byteSize),
      "Cache-Control": cacheable ? "public, max-age=3600" : "private, no-store",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff"
    };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${byteSize}`;
    if (cacheable) {
      headers["Netlify-CDN-Cache-Control"] = "public, durable, max-age=3600, stale-while-revalidate=600";
    }
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });

    if (range) {
      const audio = await readAudioRange(track, range);
      if (range.start === 0) await db.sql`UPDATE halo_radio_tracks SET play_count = play_count + 1 WHERE id = ${id}`;
      return new Response(audio, { status: 206, headers });
    }

    const audio = new ReadableStream({
      async start(controller) {
        try {
          for (let index = 0; index < Number(track.chunk_count || 1); index += 1) {
            const key = `${track.blob_key}${String(index).padStart(3, "0")}`;
            const part = await audioStore.get(key, { type: "arrayBuffer" });
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
