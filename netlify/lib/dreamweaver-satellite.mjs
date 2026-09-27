import {
  buildDreamweaverSatelliteContract,
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
  return buildDreamweaverSatelliteContract(cleanId(songId), { includeAgentLoop: false })?.satelliteRoute || "";
}

export function dreamweaverStorefrontPath(songId, options = {}) {
  return buildDreamweaverSatelliteContract(cleanId(songId), {
    mixId: cleanMixId(options.mixId),
    includeSatelliteFlag: options.includeSatelliteFlag !== false,
    includeAgentLoop: false,
  })?.route || "";
}

export function dreamweaverSatellite(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const flow = resolveDreamweaverPageFlow(id, options);
  const metadataContract = buildDreamweaverSatelliteContract(id, {
    mixId: cleanMixId(options.mixId),
    includeSatelliteFlag: options.includeSatelliteFlag !== false,
    includeAgentLoop: options.includeAgentLoop !== false,
    updatePath: flow.manager?.updatePath || options.updatePath,
    intervalMs: flow.manager?.intervalMs || options.intervalMs,
  });
  if (!metadataContract) return null;
  const metadata = {
    ...flow.page,
    songId: id,
    ...metadataContract,
    pageAgent: flow.manager || flow.page?.pageAgent || null,
  };
  if (metadata.agentLoop && flow.manager) {
    metadata.agentLoop = {
      ...metadata.agentLoop,
      id: flow.manager.id || metadata.agentLoop.id,
      updatePath: flow.manager.updatePath || metadata.agentLoop.updatePath,
      intervalMs: flow.manager.intervalMs || metadata.agentLoop.intervalMs,
    };
  }
  return metadata;
}

export function buildDreamweaverSatellite(songId, options = {}) {
  const metadata = dreamweaverSatellite(songId, {
    ...options,
    includeAgentLoop: options.includeAgentLoop !== false,
  });
  if (!metadata || !options.agentLoop) return metadata;
  return {
    ...metadata,
    agentLoop: options.agentLoop,
  };
}
