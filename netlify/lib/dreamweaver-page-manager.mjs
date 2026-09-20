import { isHyperFollowUrl } from "./hyperfollow.mjs";

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanMixId(value) {
  const mixId = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  return mixId;
}

function cleanLinkList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(item => cleanText(item, 1200)).filter(Boolean))];
}

function dreamweaverLoopMetadata({
  hubUrl,
  launchUrl,
  route,
  storefrontUrl,
  publicUrl,
  hyperfollowUrl,
  includeManagedLinks = true,
  relatedUrls = [],
  promoUrls = [],
} = {}) {
  const relatedPages = cleanLinkList(relatedUrls);
  const promoPages = cleanLinkList(promoUrls);
  const managedLinks = includeManagedLinks ? [hubUrl, route, storefrontUrl] : [];
  const resolvedLaunchUrl = hyperfollowUrl ? "" : launchUrl;
  const linkedPages = [...new Set(
    [...managedLinks, publicUrl, resolvedLaunchUrl, hyperfollowUrl, ...relatedPages, ...promoPages]
      .map(value => cleanText(value, 1200))
      .filter(Boolean)
  )];
  return {
    canonicalHubUrl: cleanText(hubUrl, 1200),
    salesReleaseUrl: cleanText(publicUrl, 1200),
    relatedPages,
    promoPages,
    linkedPages,
  };
}

export function dreamweaverSatellitePath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}

export function dreamweaverHubPath(mixId) {
  const id = cleanMixId(mixId);
  return id ? `/dreamweaver/?mix=${encodeURIComponent(id)}` : "";
}

export function dreamweaverStorefrontPath(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}` : "";
}

export function dreamweaverPageManager(songId, options = {}) {
  const id = cleanId(songId);
  const route = dreamweaverSatellitePath(id);
  const mixId = cleanMixId(options.mixId);
  const hubUrl = dreamweaverHubPath(mixId);
  if (!route) return null;
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const publicUrl = cleanText(options.publicUrl, 1200);
  const loop = dreamweaverLoopMetadata({
    hubUrl,
    launchUrl: hubUrl || route,
    route,
    storefrontUrl,
    publicUrl,
    includeManagedLinks: options.includeManagedLinks !== false,
    relatedUrls: options.relatedUrls,
    promoUrls: options.promoUrls,
  });
  const updatePath = cleanText(options.updatePath || "/api/release-catalog", 200);
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 45_000;
  return {
    id: `dreamweaver-page-manager-${id}`,
    songId: id,
    mixId,
    hubUrl,
    purpose: "manage_dreamweaver_song_page",
    managedRoute: route,
    storefrontUrl,
    linkedSongPages: loop.linkedPages,
    loop,
    updatePath,
    intervalMs,
    responsibilities: ["page_generation", "page_routing", "hub_loop_routing", "linked_song_pages", "lifecycle_maintenance"],
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
      mixId: "",
      hubUrl: "",
      launchUrl: "",
      loop: null,
      page: null,
      manager: null,
    };
  }

  const publicUrl = cleanText(options.publicUrl, 1200);
  const officialUrl = cleanText(options.officialUrl, 1200);
  const streamUrl = cleanText(options.streamUrl, 1200);
  const hyperfollowUrl = [officialUrl, streamUrl].find(isHyperFollowUrl) || "";
  const mixId = cleanMixId(options.mixId);
  const hubUrl = dreamweaverHubPath(mixId);
  const route = dreamweaverSatellitePath(id);
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const manager = dreamweaverPageManager(id, {
    ...options,
    mixId,
    includeManagedLinks: !hyperfollowUrl,
  });
  const managed = Boolean(route) && !hyperfollowUrl;
  const managedLaunchUrl = managed ? (hubUrl || route) : (route || publicUrl);
  const launchUrl = hyperfollowUrl || managedLaunchUrl;
  const loop = dreamweaverLoopMetadata({
    hubUrl,
    launchUrl,
    route,
    storefrontUrl,
    publicUrl,
    hyperfollowUrl,
    includeManagedLinks: !hyperfollowUrl,
    relatedUrls: options.relatedUrls,
    promoUrls: options.promoUrls,
  });
  const page = route ? {
    route,
    experienceUrl: route,
    launchUrl,
    satelliteLaunchUrl: route,
    mixId,
    hubUrl,
    fallbackUrl: storefrontUrl,
    storefrontUrl,
    loop,
    manager,
  } : null;

  return {
    songId: id,
    hasHyperfollow: Boolean(hyperfollowUrl),
    hyperfollowUrl,
    managed,
    mixId,
    hubUrl,
    launchUrl,
    publicUrl,
    loop,
    page,
    manager,
  };
}
