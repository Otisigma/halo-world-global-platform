import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import {
  analyzeFanPreferences,
  generateOptimizedVisualManifest,
  recordEngagementMetric,
  loadVisualManifests,
  getVisualManifestForRelease,
  DEFAULT_DESIGN_CUES
} from "../../lib/halo-creative-engine.js";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function createCreativeManifestHandler(deps = {}) {
  const getUserFn = deps.getUser !== undefined ? deps.getUser : getUser;
  const verifyRequestOriginFn = deps.verifyRequestOrigin !== undefined ? deps.verifyRequestOrigin : verifyRequestOrigin;
  const manifestPath = deps.manifestPath;
  const metricsPath = deps.metricsPath;

  return async function creativeManifestHandler(request) {
    if (!["GET", "POST"].includes(request.method)) {
      return json({ message: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      const action = url.searchParams.get("action");
      const trackId = url.searchParams.get("trackId") || url.searchParams.get("track_id");
      const trackTitle = url.searchParams.get("trackTitle") || url.searchParams.get("title");
      const artistName = url.searchParams.get("artistName") || url.searchParams.get("artist");
      const versionId = url.searchParams.get("versionId") || url.searchParams.get("version_id");
      const versionType = url.searchParams.get("versionType") || url.searchParams.get("version_type") || "canonical_release";

      if (action === "preferences" || url.searchParams.has("preferences")) {
        const preferences = analyzeFanPreferences({
          trackId,
          trackTitle,
          versionId,
          metricsPath
        });
        return json({
          success: true,
          trackId: trackId || null,
          trackTitle: trackTitle || null,
          preferences
        });
      }

      if (trackTitle || artistName) {
        const result = generateOptimizedVisualManifest({
          trackTitle: trackTitle || "Untitled Track",
          artistName: artistName || "Owen Anthony",
          trackId,
          versionId,
          versionType,
          manifestPath,
          metricsPath,
          persist: url.searchParams.get("persist") === "true"
        });
        return json(result);
      }

      if (trackId && action === "get") {
        const manifest = getVisualManifestForRelease(trackId, manifestPath);
        if (!manifest) return json({ message: "Visual manifest not found for track.", trackId }, 404);
        return json({ success: true, manifest });
      }

      const manifests = loadVisualManifests(manifestPath);
      const filtered = trackId
        ? manifests.filter(m => m.track_id === trackId || m.release_title?.toLowerCase() === trackTitle?.toLowerCase())
        : manifests;

      return json({
        success: true,
        count: filtered.length,
        manifests: filtered
      });
    }

    if (request.method === "POST") {
      if (verifyRequestOriginFn) {
        try {
          verifyRequestOriginFn(request);
        } catch {
          return json({ message: "Cross-origin requests are not accepted." }, 403);
        }
      }

      let payload = null;
      try {
        payload = await request.json();
      } catch {
        return json({ message: "Invalid JSON payload." }, 400);
      }

      if (!payload || typeof payload !== "object") {
        return json({ message: "Payload must be an object." }, 400);
      }

      const action = payload.action || (payload.trackTitle ? "generate_manifest" : null);

      if (action === "record_metric" || action === "record_engagement") {
        const trackTitle = payload.trackTitle || payload.release_title || payload.track_title;
        const result = recordEngagementMetric({
          trackId: payload.trackId || payload.track_id,
          trackTitle,
          versionId: payload.versionId || payload.version_id,
          listenDurationMs: payload.listenDurationMs || payload.listening_duration_ms || payload.duration_ms,
          replays: payload.replays || payload.replay_count,
          signalTag: payload.signalTag || payload.signal_tag || payload.tag,
          metricsPath
        });
        return json(result);
      }

      if (action === "analyze_preferences") {
        const preferences = analyzeFanPreferences({
          trackId: payload.trackId || payload.track_id,
          trackTitle: payload.trackTitle || payload.title,
          versionId: payload.versionId || payload.version_id,
          metricsPath,
          metricsData: payload.metricsData
        });
        return json({ success: true, preferences });
      }

      if (action === "generate_manifest" || payload.trackTitle) {
        const result = generateOptimizedVisualManifest({
          trackTitle: payload.trackTitle || payload.title || "Untitled Track",
          artistName: payload.artistName || payload.artist || "Owen Anthony",
          versionType: payload.versionType || payload.version_type || "canonical_release",
          versionId: payload.versionId || payload.version_id,
          trackId: payload.trackId || payload.track_id,
          designCues: payload.designCues || payload.design_cues,
          manifestPath,
          metricsPath,
          metricsData: payload.metricsData,
          persist: payload.persist !== false,
          createdAt: payload.createdAt || payload.created_at
        });
        return json(result);
      }

      return json({ message: "Unknown action. Choose generate_manifest, record_metric, or analyze_preferences." }, 400);
    }
  };
}

export default createCreativeManifestHandler();

export const config = { path: "/api/creative-manifest" };
