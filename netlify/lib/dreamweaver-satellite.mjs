import {
  buildDreamweaverStorefrontPath,
  cleanDreamweaverMixId,
  cleanDreamweaverSongId,
} from "../../lib/dreamweaver-storefront.js";
import { resolveDreamweaverPageFlow } from "./dreamweaver-page-manager.mjs";

function cleanId(value) {
  return cleanDreamweaverSongId(value);
}

function cleanMixId(value) {
  return cleanDreamweaverMixId(value);
}

export function dreamweaverSatellitePath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}

export function dreamweaverStorefrontPath(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return "";
  return buildDreamweaverStorefrontPath(id, {
    mixId: cleanMixId(options.mixId),
    includeSatelliteFlag: options.includeSatelliteFlag !== false,
  });
}

export function dreamweaverSatellite(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const flow = resolveDreamweaverPageFlow(id, options);
  const route = dreamweaverStorefrontPath(id, options);
  const satelliteRoute = dreamweaverSatellitePath(id);
  const metadata = {
    ...flow.page,
    route,
    experienceUrl: route,
    launchUrl: route,
    satelliteRoute,
    fallbackUrl: route,
    pageAgent: flow.manager || flow.page?.pageAgent || null,
  };
  if (!options.includeAgentLoop) return metadata;
  return {
    ...metadata,
    agentLoop: {
      id: flow.manager?.id || `dreamweaver-satellite-${id}`,
      updatePath: flow.manager?.updatePath || options.updatePath || "/api/release-catalog",
      intervalMs: flow.manager?.intervalMs || (Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 45_000),
      channels: ["metadata", "artwork", "playback_state", "linked_song_pages", "hub_loop", "routing"],
    },
  };
}
