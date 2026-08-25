import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const stemStore = getStore({ name: "halo-stem-vault", consistency: "strong" });
const stemTypes = new Set(["full", "drums", "bass", "music", "vocals", "fx"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export default async function stemVaultAudioHandler(request) {
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to play private stems" }, 401);
    const membership = await ensureMembership(db, user);
    const url = new URL(request.url);
    const packId = cleanText(url.searchParams.get("pack"), 50).toLowerCase();
    const stemType = cleanText(url.searchParams.get("stem"), 20).toLowerCase();
    if (!stemTypes.has(stemType)) return json({ message: "Stem type is invalid" }, 400);
    const rows = await db.sql`
      SELECT file.blob_key, file.chunk_count, file.content_type, file.byte_size, file.original_filename
      FROM halo_stem_files file
      JOIN halo_stem_packs pack ON pack.id = file.pack_id
      WHERE file.pack_id = ${packId} AND file.stem_type = ${stemType}
        AND pack.member_id = ${membership.member_id} AND pack.status = 'private'
      LIMIT 1
    `;
    const stem = rows[0];
    if (!stem) return json({ message: "Private stem not found" }, 404);
    const headers = {
      "Content-Type": stem.content_type,
      "Content-Length": String(stem.byte_size),
      "Content-Disposition": `inline; filename="${stem.original_filename.replace(/["\\]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    };
    if (request.method === "HEAD") return new Response(null, { headers });
    const audio = new ReadableStream({
      async start(controller) {
        try {
          for (let index = 0; index < Number(stem.chunk_count); index += 1) {
            const part = await stemStore.get(`${stem.blob_key}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" });
            if (!part) throw new Error("Stem chunk is missing");
            controller.enqueue(new Uint8Array(part));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    return new Response(audio, { headers });
  } catch (error) {
    console.error("HALO private stem playback failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This private stem could not be played" }, 500);
  }
}

export const config = { path: "/api/stem-vault/audio" };
