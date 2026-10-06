import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { cleanupSignalMedia } from "../lib/signal-feed.mjs";

export default async function signalFeedMediaCleanup() {
  const summary = await cleanupSignalMedia(getDatabase(),
    getStore({ name: "halo-signal-feed-media", consistency: "strong" }));
  console.log("Signal Feed media cleanup", summary);
}

export const config = { schedule: "0 * * * *" };
