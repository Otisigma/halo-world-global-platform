import { getDatabase } from "@netlify/database";
import { dispatchTrackDropEmails } from "../lib/track-drops.mjs";

export default async function trackDropEmailDispatchHandler() {
  try {
    const summary = await dispatchTrackDropEmails(await getDatabase());
    console.log("Track drop email dispatch completed", summary);
  } catch (error) {
    console.error("Track drop email dispatch failed", error instanceof Error ? error.message : "unknown error");
    throw error;
  }
}

export const config = {
  schedule: "*/10 * * * *"
};
