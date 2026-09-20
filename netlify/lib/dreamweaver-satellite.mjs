export function buildDreamweaverSatellite(songId, options = {}) {
  const id = cleanDreamweaverSongId(songId);
  if (!id) return null;
  const experienceUrl = `/dreamweaver/satellite/${id}/`;
  return {
    songId: id,
    route: experienceUrl,
    launchUrl: experienceUrl,
    experienceUrl,
    canonicalDreamweaverUrl: `/dreamweaver/?song=${encodeURIComponent(id)}`,
    fallbackUrl: `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}`,
    ...(options.agentLoop ? { agentLoop: options.agentLoop } : {}),
  };
}

function cleanDreamweaverSongId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}
