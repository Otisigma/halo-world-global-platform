import { getDatabase } from "@netlify/database";
import { reconcilePublishedSongs } from "../lib/song-publication.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function runReconcile(limit = 50) {
  const db = getDatabase();
  const results = await reconcilePublishedSongs(db, {
    limit,
    actorId: "system",
    actorType: "system",
  });
  const repaired = results.filter(result => result?.ok).length;
  const failed = results.filter(result => result && result.ok === false).length;
  return { repaired, failed, scanned: results.length, results };
}

export default async function songPublicationReconcileHandler(request) {
  try {
    const url = new URL(request?.url || "https://halo.world/api/song-publication-reconcile");
    const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const summary = await runReconcile(limit);
    return json(summary);
  } catch (error) {
    console.error("Song publication reconcile failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Song publication reconcile failed" }, 500);
  }
}

export const config = {
  schedule: "*/15 * * * *"
};
