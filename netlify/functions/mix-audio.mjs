import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { cleanText, isOwner } from "../lib/halo-x.mjs";

const audioStore = getStore({ name: "halo-mixes", consistency: "strong" });

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

async function readMixRange(mix, range) {
  const chunkCount = Number(mix.chunk_count || 1);
  const firstKey = `${mix.blob_key}000`;
  const firstPart = await audioStore.get(firstKey, { type: "arrayBuffer" });
  if (!firstPart) throw new Error("Mix chunk is missing");

  const chunkBytes = firstPart.byteLength;
  if (!chunkBytes) throw new Error("Mix chunk is empty");
  const firstChunk = Math.floor(range.start / chunkBytes);
  const lastChunk = Math.floor(range.end / chunkBytes);
  if (firstChunk >= chunkCount || lastChunk >= chunkCount) throw new Error("Mix range exceeds stored chunks");

  const chunks = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    if (index === 0) {
      chunks.push(new Uint8Array(firstPart));
      continue;
    }
    const key = `${mix.blob_key}${String(index).padStart(3, "0")}`;
    const part = await audioStore.get(key, { type: "arrayBuffer" });
    if (!part) throw new Error("Mix chunk is missing");
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
  if (written !== rangeLength) throw new Error("Mix range is incomplete");
  return audio;
}

export default async function mixAudioHandler(request) {
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const user = await getUser().catch(() => null);
    const url = new URL(request.url);
    const id = cleanText(url.searchParams.get("id"), 80);
    const version = url.searchParams.get("version") === "original" ? "original" : "mastered";
    const rows = isOwner(user)
      ? await db.sql`
          SELECT blob_key, chunk_count, content_type, byte_size, visibility,
            original_blob_key, original_chunk_count, original_content_type, original_byte_size
          FROM halo_mixes
          WHERE id = ${id}
          LIMIT 1
        `
      : user?.id
        ? await db.sql`
          SELECT blob_key, chunk_count, content_type, byte_size, visibility,
            original_blob_key, original_chunk_count, original_content_type, original_byte_size
          FROM halo_mixes
          WHERE id = ${id} AND (visibility = 'room' OR member_id = ${user.id})
          LIMIT 1
        `
      : await db.sql`
          SELECT blob_key, chunk_count, content_type, byte_size, visibility,
            original_blob_key, original_chunk_count, original_content_type, original_byte_size
          FROM halo_mixes
          WHERE id = ${id} AND visibility = 'room'
          LIMIT 1
        `;
    const mix = rows[0];
    if (!mix) return json({ message: "Mix not found" }, 404);
    if (version === "original") {
      if (!mix.original_blob_key) return json({ message: "Original comparison not found" }, 404);
      mix.blob_key = mix.original_blob_key;
      mix.chunk_count = mix.original_chunk_count;
      mix.content_type = mix.original_content_type;
      mix.byte_size = mix.original_byte_size;
    }
    const byteSize = Math.max(0, Number(mix.byte_size || 0));
    const range = requestedByteRange(request.headers.get("range"), byteSize);
    if (range === false) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${byteSize}`, "Cache-Control": "no-store" }
      });
    }
    const cacheable = mix.visibility === "room";
    const headers = {
      "Content-Type": mix.content_type,
      "Content-Length": String(byteSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheable ? "public, max-age=3600" : "private, no-store",
      "Content-Disposition": "inline",
      "Vary": "Range"
    };
    if (cacheable) {
      headers["Netlify-CDN-Cache-Control"] = "public, durable, max-age=3600, stale-while-revalidate=600";
    }
    if (request.method === "HEAD") return new Response(null, { headers });
    if (range) {
      const audio = await readMixRange(mix, range);
      headers["Content-Length"] = String(audio.byteLength);
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${byteSize}`;
      if (range.start === 0 && version === "mastered") await db.sql`UPDATE halo_mixes SET play_count = play_count + 1 WHERE id = ${id}`;
      return new Response(audio, { status: 206, headers });
    }
    const chunkCount = Number(mix.chunk_count || 1);
    const audio = new ReadableStream({
      async start(controller) {
        try {
          for (let index = 0; index < chunkCount; index += 1) {
            const key = `${mix.blob_key}${String(index).padStart(3, "0")}`;
            const part = await audioStore.get(key, { type: "arrayBuffer" });
            if (!part) throw new Error("Mix chunk is missing");
            controller.enqueue(new Uint8Array(part));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    if (version === "mastered") await db.sql`UPDATE halo_mixes SET play_count = play_count + 1 WHERE id = ${id}`;
    return new Response(audio, { headers });
  } catch (error) {
    console.error("HALO mix playback failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This mix could not be played right now" }, 500);
  }
}

export const config = {
  path: "/api/mixes/audio"
};
