import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";
import { loadOwnerOutcomes } from "../lib/owner-outcomes.mjs";

// Owner-only, 7-day aggregate of consented first-party listening sessions.
// Returns counts only: no member IDs, emails, releases or timestamps per listener.
// These are opt-in client reports, not authenticated platform plays.
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export default async function listenerAggregateHandler(request) {
  if (request.method !== "GET") return Response.json({ message: "Method not allowed" }, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in required" }, 401);
    if (!isOwner(user)) return json({ message: "Listener evidence is limited to the owner team" }, 403);
    const outcomes = await loadOwnerOutcomes(getDatabase(), user);
    const listeners = outcomes?.sources?.listeners;
    if (listeners?.status !== "available") return json({ message: "Listener evidence is unavailable" }, 503);
    return json({
      window: "7d",
      source: "first-party-consented",
      verifiedPlays: false,
      currentListeners: listeners.metrics.currentListeners,
      previousListeners: listeners.metrics.previousListeners,
      returningListeners: listeners.metrics.returningListeners,
      returnRate: listeners.metrics.returnRate
    });
  } catch {
    console.error("HALO listener aggregate unavailable");
    return json({ message: "Listener evidence is unavailable" }, 503);
  }
}

export const config = { path: "/api/telemetry/listeners-7d" };
