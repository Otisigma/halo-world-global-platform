function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

export function dreamweaverSatellite(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const route = `/dreamweaver/satellite/${id}/`;
  const metadata = {
    route,
    experienceUrl: route,
    launchUrl: route,
    fallbackUrl: `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}`,
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
