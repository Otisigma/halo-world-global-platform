import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createSignalFeedHandler } from "../lib/signal-feed.mjs";
import { getStore } from "@netlify/blobs";

export default createSignalFeedHandler({
  getDatabase, getUser, ensureMembership, verifyRequestOrigin,
  getMediaStore: () => getStore({ name: "halo-signal-feed-media", consistency: "strong" })
});
export const config = { path: "/api/signal-feed" };
