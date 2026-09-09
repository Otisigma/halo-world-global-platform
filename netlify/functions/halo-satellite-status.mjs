import { getDatabase } from "@netlify/database";
import { buildFallbackSatelliteStatuses, loadMaintenanceSweeps } from "../lib/maintenance-sweep.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function haloSatelliteStatusHandler(request) {
  if (request.method !== "GET") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const db = await getDatabase();
    const maintenance = await loadMaintenanceSweeps(db);
    return json({
      latest: maintenance.latest,
      satelliteStatuses: Array.isArray(maintenance.latest?.satelliteStatuses) ? maintenance.latest.satelliteStatuses : []
    });
  } catch (error) {
    console.error("HALO satellite status request failed", error instanceof Error ? error.message : "unknown error");
    return json({
      message: "Satellite status is temporarily unavailable; serving the public fallback route map.",
      latest: null,
      satelliteStatuses: buildFallbackSatelliteStatuses(),
      fallback: true
    });
  }
}

export const config = {
  path: "/api/halo-satellite-status"
};
