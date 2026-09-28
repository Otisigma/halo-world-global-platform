export const CANONICAL_HOME_ROUTE = "/halo";
export const DREAMWEAVER_CANONICAL_ROUTE = "/dreamweaver/";
export const DREAMWEAVER_SATELLITE_REFRESH_MS = 45_000;

const CANONICAL_ROUTE_ALIASES = new Map([
  ["/", CANONICAL_HOME_ROUTE],
  ["/halo/", CANONICAL_HOME_ROUTE],
]);

const fileRoute = (name, route, file, options = {}) => {
  const routePath = String(route || "").trim();
  const filePath = String(file || "").trim();
  if (!routePath || !filePath) return null;
  return {
    name,
    route: routePath,
    file: filePath,
    cacheControl: options.cacheControl || "public, max-age=0, must-revalidate",
  };
};

export const PUBLIC_ROUTE_REGISTRY = Object.freeze([
  fileRoute("home", CANONICAL_HOME_ROUTE, "index.html"),
  fileRoute("dreamweaver", DREAMWEAVER_CANONICAL_ROUTE, "dreamweaver/index.html"),
]);

export function canonicalizeRoutePath(rawPathname = "/") {
  const pathname = String(rawPathname || "/").trim() || "/";
  return CANONICAL_ROUTE_ALIASES.get(pathname) || pathname;
}

export function buildDreamweaverSatellite(songId) {
  const id = String(songId || "").trim();
  if (!/^[A-Za-z0-9-]{1,120}$/.test(id)) return null;
  const route = `${DREAMWEAVER_CANONICAL_ROUTE}satellite/${id}/`;
  return {
    route,
    experienceUrl: route,
    launchUrl: route,
    fallbackUrl: `${DREAMWEAVER_CANONICAL_ROUTE}?satellite=dreamweaver&song=${encodeURIComponent(id)}`,
    canonicalUrl: DREAMWEAVER_CANONICAL_ROUTE,
    agentLoop: {
      id: `dreamweaver-satellite-${id}`,
      updatePath: "/api/release-catalog",
      intervalMs: DREAMWEAVER_SATELLITE_REFRESH_MS,
      channels: ["metadata", "artwork", "playback_state", "refinements"],
    },
  };
}
