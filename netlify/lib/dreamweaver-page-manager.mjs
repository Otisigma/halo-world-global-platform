import { isHyperFollowUrl } from "./hyperfollow.mjs";

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

export function dreamweaverSatellitePath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}

export function dreamweaverStorefrontPath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}` : "";
}

export function dreamweaverPageManager(songId, options = {}) {
  const id = cleanId(songId);
  const route = dreamweaverSatellitePath(id);
  if (!route) return null;
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const publicUrl = cleanText(options.publicUrl, 1200);
  const updatePath = cleanText(options.updatePath || "/api/release-catalog", 200);
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 45_000;
  return {
    id: `dreamweaver-page-manager-${id}`,
    songId: id,
    purpose: "manage_dreamweaver_song_page",
    managedRoute: route,
    storefrontUrl,
    linkedSongPages: [route, storefrontUrl, publicUrl].filter(Boolean),
    updatePath,
    intervalMs,
    responsibilities: ["page_generation", "page_routing", "linked_song_pages", "lifecycle_maintenance"],
  };
}

export function resolveDreamweaverPageFlow(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) {
    return {
      songId: "",
      hasHyperfollow: false,
      hyperfollowUrl: "",
      managed: false,
      launchUrl: "",
      page: null,
      manager: null,
    };
  }

  const publicUrl = cleanText(options.publicUrl, 1200);
  const officialUrl = cleanText(options.officialUrl, 1200);
  const streamUrl = cleanText(options.streamUrl, 1200);
  const hyperfollowUrl = [officialUrl, streamUrl].find(isHyperFollowUrl) || "";
  const route = dreamweaverSatellitePath(id);
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const manager = dreamweaverPageManager(id, options);
  const managed = Boolean(route) && !hyperfollowUrl;
  const launchUrl = hyperfollowUrl || route || publicUrl;
  const page = route ? {
    route,
    experienceUrl: route,
    launchUrl: route,
    fallbackUrl: storefrontUrl,
    storefrontUrl,
    manager,
  } : null;

  return {
    songId: id,
    hasHyperfollow: Boolean(hyperfollowUrl),
    hyperfollowUrl,
    managed,
    launchUrl,
    publicUrl,
    page,
    manager,
  };
}
