import { DREAMWEAVER_STOREFRONT_MIX_ID } from "../../lib/dreamweaver-storefront.js";

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanMixId(value) {
  const mixId = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{12,80}$/.test(mixId) ? mixId : "";
}

export function dreamweaverSatellitePath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}

export function dreamweaverStorefrontPath(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return "";
  const params = new URLSearchParams();
  params.set("mix", cleanMixId(options.mixId) || DREAMWEAVER_STOREFRONT_MIX_ID);
  params.set("song", id);
  if (options.includeSatelliteFlag !== false) params.set("satellite", "dreamweaver");
  return `/dreamweaver/?${params.toString()}`;
}

export function dreamweaverSatellite(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const route = dreamweaverStorefrontPath(id, options);
  const satelliteRoute = dreamweaverSatellitePath(id);
  const metadata = {
    route,
    experienceUrl: route,
    launchUrl: route,
    satelliteRoute,
    fallbackUrl: route,
  };
  if (!options.includeAgentLoop) return metadata;
  return {
    ...metadata,
    agentLoop: {
      id: `dreamweaver-satellite-${id}`,
      updatePath: options.updatePath || "/api/release-catalog",
      intervalMs: Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 45_000,
      channels: ["metadata", "artwork", "playback_state", "refinements"],
    },
  };
}
