import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { cleanText } from "../lib/halo-x.mjs";
import { extractId3Artwork } from "../lib/audio-metadata.mjs";

const artworkStore = getStore({ name: "halo-radio-submissions", consistency: "strong" });
const allowedArtworkTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxArtworkBytes = 5 * 1024 * 1024;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function radioArtworkHandler(request) {
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    const memberId = user?.id || "";
    const rows = await db.sql`
      SELECT artwork_key, artwork_content_type, blob_key, status
      FROM halo_radio_tracks
      WHERE id = ${id} AND (status IN ('preview', 'rotation') OR member_id = ${memberId})
      LIMIT 1
    `;
    const track = rows[0];
    if (!track) return json({ message: "Radio artwork not found" }, 404);

    if (!track.artwork_key) {
      const firstChunk = await artworkStore.get(`${track.blob_key}000`, { type: "arrayBuffer" });
      const embeddedArtwork = firstChunk ? extractId3Artwork(firstChunk) : null;
      if (!allowedArtworkTypes.has(embeddedArtwork?.mime) || !embeddedArtwork.byteSize || embeddedArtwork.byteSize > maxArtworkBytes) {
        return json({ message: "Radio artwork not found" }, 404);
      }
      track.artwork_key = `${track.blob_key.replace(/parts\/$/, "")}artwork`;
      track.artwork_content_type = embeddedArtwork.mime;
      await artworkStore.set(track.artwork_key, embeddedArtwork.data, { metadata: { contentType: embeddedArtwork.mime } });
      await db.sql`
        UPDATE halo_radio_tracks
        SET artwork_key = ${track.artwork_key}, artwork_content_type = ${track.artwork_content_type}, updated_at = NOW()
        WHERE id = ${id} AND artwork_key = ''
      `;
    }

    const cacheable = track.status === "rotation";
    const headers = {
      "Content-Type": track.artwork_content_type,
      "Cache-Control": cacheable ? "public, max-age=86400" : "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff"
    };
    if (cacheable) headers["Netlify-CDN-Cache-Control"] = "public, durable, max-age=86400, stale-while-revalidate=3600";
    if (request.method === "HEAD") return new Response(null, { headers });

    const artwork = await artworkStore.get(track.artwork_key, { type: "arrayBuffer" });
    if (!artwork) return json({ message: "Radio artwork not found" }, 404);
    headers["Content-Length"] = String(artwork.byteLength);
    return new Response(artwork, { headers });
  } catch (error) {
    console.error("HALO radio artwork failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This cover image could not be loaded right now" }, 500);
  }
}

export const config = {
  path: "/api/radio/artwork"
};
