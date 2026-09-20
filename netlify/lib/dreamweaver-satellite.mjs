import { resolveDreamweaverPageFlow } from "./dreamweaver-page-manager.mjs";

export function dreamweaverSatellite(songId, options = {}) {
  const flow = resolveDreamweaverPageFlow(songId, options);
  if (!flow.page) return null;
  const metadata = {
    ...flow.page,
  };
  if (!options.includeAgentLoop) return metadata;
  return {
    ...metadata,
    agentLoop: {
      id: flow.manager?.id || "",
      updatePath: flow.manager?.updatePath || "/api/release-catalog",
      intervalMs: flow.manager?.intervalMs || 45_000,
      channels: ["metadata", "artwork", "playback_state", "linked_song_pages", "routing"],
    },
  };
}
