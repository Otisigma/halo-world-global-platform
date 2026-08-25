import { authorizeStatsAdmin, jsonResponse } from "../lib/stats.mjs";
import { readArtistProof, readRadioAudience } from "../lib/radio-audience.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

function requestedDays(url, fallback) {
  const raw = Number(url.searchParams.get("days") || fallback);
  return Number.isInteger(raw) ? Math.min(365, Math.max(1, raw)) : fallback;
}

export default async function radioAudienceHandler(request) {
  if (request.method !== "GET") {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  const url = new URL(request.url);
  const artistSlug = String(url.searchParams.get("artist") || "").trim().toLowerCase();

  try {
    // An artist's own proof card is aggregate-only and meant to be shared, so it stays public.
    if (artistSlug) {
      if (!SLUG_PATTERN.test(artistSlug)) {
        return jsonResponse({ message: "That artist reference is not valid" }, 422);
      }
      const proof = await readArtistProof(artistSlug, requestedDays(url, 30));
      return jsonResponse(proof, 200, { "Cache-Control": "public, max-age=300" });
    }

    // The full station picture is operator-only.
    if (!process.env.STATS_ADMIN_TOKEN) {
      return jsonResponse({ message: "Audience reporting is not configured" }, 503);
    }
    if (!authorizeStatsAdmin(request)) {
      return jsonResponse({ message: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    const audience = await readRadioAudience(requestedDays(url, 7));
    return jsonResponse(audience);
  } catch (error) {
    console.error("HALO radio audience read failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "The audience picture could not be read" }, 500);
  }
}

export const config = {
  path: "/api/radio/audience"
};
