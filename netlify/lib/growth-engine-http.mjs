import { createGrowthStore } from "./growth-engine-store.mjs";
import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";
import { GrowthInputError } from "../../services/growth-engine/engine.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function createGrowthHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to manage growth campaigns" }, 401);
      let input;
      if (request.method === "POST") {
        try {
          if ((await verifyRequestOrigin(request)) === false) throw new Error("Invalid origin");
        } catch { return json({ message: "Cross-origin actions are not accepted" }, 403); }
        if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ message: "Send JSON" }, 415);
        if (Number(request.headers.get("content-length")) > 16000) return json({ message: "Request too large" }, 413);
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > 16000) return json({ message: "Request too large" }, 413);
        try { input = JSON.parse(body); } catch { return json({ message: "Invalid JSON" }, 400); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return json({ message: "Send a campaign object" }, 400);
      }
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const store = createGrowthStore(db);
      if (request.method === "GET") {
        const id = cleanDreamweaverSongId(new URL(request.url).searchParams.get("campaignId"));
        if (!id) return json({ message: "A valid campaignId is required" }, 400);
        const result = await store.get(membership.member_id, id);
        return result ? json(result) : json({ message: "Campaign not found" }, 404);
      }
      const songId = cleanDreamweaverSongId(input.songId);
      if (!songId) return json({ message: "A valid catalog songId is required" }, 400);
      const result = await store.ingest(membership.member_id, songId, input);
      return result ? json({ campaign: result }, 202) : json({ message: "Completed master not found in your catalog" }, 404);
    } catch (error) {
      if (error instanceof GrowthInputError) return json({ message: error.message }, 400);
      return json({ message: "Growth service unavailable; no publication was requested" }, 503);
    }
  };
}
