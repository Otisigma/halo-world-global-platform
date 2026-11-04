import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { bindSongLabProject, SongLabBridgeError } from "../lib/song-lab-catalog-bridge.mjs";

export function createSongLabBridgeHandler({ getUser, verifyRequestOrigin, getDatabase, ensureMembership, sourceStore, audioStore }) {
  return async request => {
    const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
    if (request.method !== "POST") return json({ message: "Use POST to connect a private Song Lab project." }, 405);
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to connect your private project." }, 401);
      try {
        if ((await verifyRequestOrigin(request)) === false) return json({ message: "Cross-origin catalog connections are not accepted." }, 403);
      } catch {
        return json({ message: "Cross-origin catalog connections are not accepted." }, 403);
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 1024) return json({ message: "The connection request is too large." }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ message: "Send a valid project connection request." }, 400); }
      const db = getDatabase();
      const membership = await ensureMembership(db, user);
      const binding = await bindSongLabProject({ db, sourceStore, audioStore, ownerMemberId: membership.member_id, projectId: body?.projectId });
      return json(binding);
    } catch (error) {
      if (error instanceof SongLabBridgeError) return json({ message: error.message }, error.status);
      console.error("Song Lab catalog connection failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Catalog connection failed. Your saved private project is unchanged; retry the connection." }, 503);
    }
  };
}

export default createSongLabBridgeHandler({
  getUser, verifyRequestOrigin, getDatabase, ensureMembership,
  sourceStore: getStore({ name: "halo-dreamweaver-songs", consistency: "strong" }),
  audioStore: getStore({ name: "halo-song-catalog-audio", consistency: "strong" }),
});

export const config = { path: "/api/song-lab/catalog-bridge" };
