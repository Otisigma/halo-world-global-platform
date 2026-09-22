import { isHyperFollowUrl } from "./hyperfollow.mjs";

const DEFAULT_UPDATE_PATH = "/api/release-catalog";
const DEFAULT_INTERVAL_MS = 45_000;

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

function cleanAudience(value) {
  const audience = cleanText(value, 40).toLowerCase();
  return audience;
}

function cleanLinkList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(item => cleanText(item, 1200)).filter(Boolean))];
}

function isLegacySongCatalogAudioUrl(value) {
  const url = cleanText(value, 1200);
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://halo.world");
    return /^\/api\/song-catalog\/audio$/i.test(parsed.pathname) && Boolean(cleanId(parsed.searchParams.get("versionId")));
  } catch {
    return false;
  }
}

function linkedSongUrl(songId) {
  const id = cleanId(songId);
  return id ? `/music/?song=${encodeURIComponent(id)}` : "";
}

function normalizeComparableDestination(value) {
  const url = cleanText(value, 1200);
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://halo.world");
    const pathname = parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
    return parsed.origin === "https://halo.world"
      ? `${pathname}${parsed.search}`
      : parsed.toString();
  } catch {
    return url;
  }
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
  const releaseUrl = hyperfollowUrl ? "" : publicUrl;
  const linkedPages = [...new Set(
    [...managedLinks, releaseUrl, resolvedLaunchUrl, hyperfollowUrl, ...relatedPages, ...promoPages]
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
  const updatePath = cleanText(options.updatePath || DEFAULT_UPDATE_PATH, 200);
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS;
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

export function buildDreamweaverSongPage(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const route = dreamweaverSatellitePath(id);
  const mixId = cleanMixId(options.mixId);
  const hubUrl = dreamweaverHubPath(mixId);
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const audience = cleanAudience(options.audience);
  const query = new URLSearchParams();
  if (options.includeAudienceParam && audience) query.set("audience", audience);
  const experienceUrl = query.size ? `${route}?${query.toString()}` : route;
  const manager = dreamweaverPageManager(id, options);
  const page = {
    route,
    experienceUrl,
    launchUrl: experienceUrl,
    satelliteLaunchUrl: route,
    mixId,
    hubUrl,
    fallbackUrl: storefrontUrl,
    storefrontUrl,
    linkedSongUrl: linkedSongUrl(id),
    loop: manager?.loop || null,
    manager,
    pageAgent: manager,
  };
  if (options.includeAgentLoop === false) return page;
  return {
    ...page,
    agentLoop: {
      id: manager?.id || `dreamweaver-page-manager-${id}`,
      updatePath: manager?.updatePath || DEFAULT_UPDATE_PATH,
      intervalMs: manager?.intervalMs || DEFAULT_INTERVAL_MS,
      channels: ["metadata", "artwork", "playback_state", "linked_song_pages", "hub_loop", "routing"],
    },
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
      destinationUrl: "",
      routeMode: "",
      loop: null,
      page: null,
      manager: null,
      dreamweaverPage: null,
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
  const normalizedOfficialUrl = normalizeComparableDestination(officialUrl);
  const managedDestinations = new Set(
    [publicUrl, streamUrl, route, hubUrl, storefrontUrl]
      .map(normalizeComparableDestination)
      .filter(Boolean)
  );
  const existingDestination = normalizedOfficialUrl
    && !managedDestinations.has(normalizedOfficialUrl)
    && !isLegacySongCatalogAudioUrl(officialUrl);
  const managed = Boolean(route) && !hyperfollowUrl && !existingDestination;
  const manager = dreamweaverPageManager(id, {
    ...options,
    mixId,
    includeManagedLinks: managed,
  });
  const page = buildDreamweaverSongPage(id, {
    ...options,
    mixId,
    includeManagedLinks: managed,
  });
  const managedLaunchUrl = managed ? (hubUrl || page?.experienceUrl || route) : (route || publicUrl);
  const launchUrl = hyperfollowUrl || managedLaunchUrl;
  const loop = dreamweaverLoopMetadata({
    hubUrl,
    launchUrl,
    route,
    storefrontUrl,
    publicUrl,
    hyperfollowUrl,
    includeManagedLinks: managed,
    relatedUrls: options.relatedUrls,
    promoUrls: options.promoUrls,
  });
  const resolvedPage = page ? {
    ...page,
    launchUrl,
    loop,
    manager,
    pageAgent: manager,
  } : null;
  const destinationUrl = hyperfollowUrl
    || (managed ? resolvedPage?.experienceUrl || resolvedPage?.route || route || officialUrl : officialUrl)
    || publicUrl
    || resolvedPage?.experienceUrl
    || route
    || "";
  const routeMode = hyperfollowUrl
    ? "hyperfollow"
    : managed
      ? "dreamweaver_page"
      : officialUrl
        ? "existing_destination"
        : "";

  return {
    songId: id,
    hasHyperfollow: Boolean(hyperfollowUrl),
    hyperfollowUrl,
    managed,
    mixId,
    hubUrl,
    launchUrl,
    destinationUrl,
    routeMode,
    publicUrl,
    loop,
    page: resolvedPage,
    manager,
    dreamweaverPage: resolvedPage,
  };
}
