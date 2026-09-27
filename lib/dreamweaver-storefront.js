export const DREAMWEAVER_STOREFRONT_MIX_ID = "a1aefa12-2369-48cc-bf3f-3d3a99bcf982";
export const DREAMWEAVER_CANONICAL_PATH = "/dreamweaver/";
export const DREAMWEAVER_DEFAULT_AGENT_LOOP_UPDATE_PATH = "/api/release-catalog";
export const DREAMWEAVER_DEFAULT_AGENT_LOOP_INTERVAL_MS = 45_000;
export const DREAMWEAVER_AGENT_LOOP_CHANNELS = Object.freeze([
  "metadata",
  "artwork",
  "playback_state",
  "linked_song_pages",
  "hub_loop",
  "routing",
]);

export function cleanDreamweaverSongId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

export function cleanDreamweaverMixId(value) {
  const mixId = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{12,80}$/.test(mixId) ? mixId : "";
}

export function buildDreamweaverStorefrontPath(songId, {
  mixId = "",
  includeSatelliteFlag = true,
  searchParams = "",
} = {}) {
  const params = searchParams instanceof URLSearchParams
    ? new URLSearchParams(searchParams)
    : new URLSearchParams(searchParams);
  params.set("mix", cleanDreamweaverMixId(mixId || params.get("mix")) || DREAMWEAVER_STOREFRONT_MIX_ID);
  const id = cleanDreamweaverSongId(songId || params.get("song"));
  if (id) params.set("song", id);
  else params.delete("song");
  if (includeSatelliteFlag) params.set("satellite", "dreamweaver");
  else params.delete("satellite");
  const query = params.toString();
  return query ? `/dreamweaver/?${query}` : "/dreamweaver/";
}

export function buildDreamweaverSatellitePath(songId) {
  const id = cleanDreamweaverSongId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}

export function buildDreamweaverSatelliteContract(songId, options = {}) {
  const id = cleanDreamweaverSongId(songId);
  if (!id) return null;
  const route = buildDreamweaverStorefrontPath(id, {
    mixId: options.mixId,
    includeSatelliteFlag: options.includeSatelliteFlag !== false,
  });
  const contract = {
    songId: id,
    route,
    experienceUrl: route,
    launchUrl: route,
    canonicalDreamweaverUrl: buildDreamweaverStorefrontPath(id, {
      mixId: options.mixId,
      includeSatelliteFlag: false,
    }),
    satelliteRoute: buildDreamweaverSatellitePath(id),
    fallbackUrl: route,
  };
  const includeAgentLoop = options.includeAgentLoop !== false || Boolean(options.agentLoop);
  if (!includeAgentLoop) return contract;
  return {
    ...contract,
    agentLoop: options.agentLoop || {
      id: `dreamweaver-satellite-${id}`,
      updatePath: options.updatePath || DREAMWEAVER_DEFAULT_AGENT_LOOP_UPDATE_PATH,
      intervalMs: Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DREAMWEAVER_DEFAULT_AGENT_LOOP_INTERVAL_MS,
      channels: [...DREAMWEAVER_AGENT_LOOP_CHANNELS],
    },
  };
}

export function sanitizeDreamweaverAssignedRoute(value, options = {}) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || /^\/api\/song-catalog\/audio\?versionId=/i.test(text)) return "";
  const origin = typeof options.origin === "string" && options.origin
    ? options.origin
    : "https://halo.world";
  try {
    const url = new URL(text, origin);
    if (url.origin !== origin) return "";
    const satelliteMatch = /^\/dreamweaver\/satellite\/([0-9a-f-]+)\/$/i.exec(url.pathname);
    if (satelliteMatch) {
      return buildDreamweaverSatellitePath(satelliteMatch[1]);
    }
    if (!/^\/dreamweaver\/?$/i.test(url.pathname)) return "";
    const songId = cleanDreamweaverSongId(url.searchParams.get("song"));
    if (!songId) return "";
    return buildDreamweaverStorefrontPath(songId, {
      mixId: url.searchParams.get("mix"),
      includeSatelliteFlag: url.searchParams.get("satellite") === "dreamweaver",
    });
  } catch {
    return "";
  }
}
