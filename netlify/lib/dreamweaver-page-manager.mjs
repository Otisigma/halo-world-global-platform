import { isHyperFollowUrl } from "./hyperfollow.mjs";

const DEFAULT_AUDIENCE = "fan";
const DEFAULT_UPDATE_PATH = "/api/release-catalog";
const DEFAULT_INTERVAL_MS = 45_000;

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanId(value) {
  const id = cleanText(value, 60).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanMixId(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function cleanSlug(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function cleanAudience(value) {
  const audience = cleanText(value, 40).toLowerCase();
  return audience || DEFAULT_AUDIENCE;
}

function cleanLinkList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(item => cleanText(item, 1200)).filter(Boolean))];
}

function isLegacyAudioEntry(value) {
  const destination = cleanText(value, 1200);
  if (!destination) return false;
  try {
    const url = new URL(destination, "https://halo.world");
    return /^\/api\/song-catalog\/audio$/i.test(url.pathname) && /^[0-9a-f-]{36}$/i.test(url.searchParams.get("versionId") || "");
  } catch {
    return false;
  }
}

export function linkedSongUrl(songId) {
  const id = cleanId(songId);
  return id ? `/music/?song=${encodeURIComponent(id)}` : "";
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
  return id ? `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}` : "/dreamweaver/";
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

export function buildDreamweaverPageAgent(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const mixId = cleanMixId(options.mixId || options.releaseId);
  const route = dreamweaverSatellitePath(id);
  const hubUrl = dreamweaverHubPath(mixId);
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const updatePath = cleanText(options.updatePath || DEFAULT_UPDATE_PATH, 200) || DEFAULT_UPDATE_PATH;
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS;
  const loop = dreamweaverLoopMetadata({
    hubUrl,
    launchUrl: cleanText(options.launchUrl, 1200) || hubUrl || route,
    route,
    storefrontUrl,
    publicUrl: cleanText(options.publicUrl, 1200),
    hyperfollowUrl: cleanText(options.hyperfollowUrl, 1200),
    includeManagedLinks: options.includeManagedLinks !== false,
    relatedUrls: options.relatedUrls,
    promoUrls: options.promoUrls,
  });
  return {
    id: `dreamweaver-page-manager-${id}`,
    songId: id,
    managedSongId: id,
    mixId,
    hubUrl,
    purpose: "manage_dreamweaver_song_page",
    managedRoute: route,
    storefrontUrl,
    linkedRoutes: [route, storefrontUrl, linkedSongUrl(id)].filter(Boolean),
    linkedSongPages: loop.linkedPages,
    loop,
    updatePath,
    intervalMs,
    responsibilities: ["page_generation", "page_routing", "hub_loop_routing", "linked_song_pages", "lifecycle_maintenance"],
  };
}

export function dreamweaverPageManager(songId, options = {}) {
  return buildDreamweaverPageAgent(songId, options);
}

export function buildDreamweaverSongPage(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const route = dreamweaverSatellitePath(id);
  const mixId = cleanMixId(options.mixId || options.releaseId);
  const hubUrl = dreamweaverHubPath(mixId);
  const storefrontUrl = dreamweaverStorefrontPath(id);
  const params = new URLSearchParams();
  const slug = cleanSlug(options.slug || `${cleanText(options.artistName, 80)} ${cleanText(options.title, 80)}` || mixId);
  const audience = cleanAudience(options.audience);
  if (slug) params.set("slug", slug);
  if (audience) params.set("audience", audience);
  const query = params.toString();
  const experienceUrl = query ? `${route}?${query}` : route;
  const launchUrl = cleanText(options.launchUrl, 1200) || hubUrl || experienceUrl;
  const pageAgent = buildDreamweaverPageAgent(id, {
    ...options,
    mixId,
    launchUrl,
  });
  const loop = pageAgent?.loop || dreamweaverLoopMetadata({
    hubUrl,
    launchUrl,
    route,
    storefrontUrl,
    publicUrl: cleanText(options.publicUrl, 1200),
    hyperfollowUrl: cleanText(options.hyperfollowUrl, 1200),
    includeManagedLinks: options.includeManagedLinks !== false,
    relatedUrls: options.relatedUrls,
    promoUrls: options.promoUrls,
  });
  const metadata = {
    route,
    experienceUrl,
    launchUrl,
    satelliteLaunchUrl: route,
    mixId,
    hubUrl,
    fallbackUrl: storefrontUrl,
    storefrontUrl,
    linkedSongUrl: linkedSongUrl(id),
    loop,
    pageAgent,
    manager: pageAgent,
  };
  if (options.includeAgentLoop === false) return metadata;
  return {
    ...metadata,
    agentLoop: {
      id: pageAgent?.id || `dreamweaver-page-manager-${id}`,
      updatePath: pageAgent?.updatePath || DEFAULT_UPDATE_PATH,
      intervalMs: pageAgent?.intervalMs || DEFAULT_INTERVAL_MS,
      channels: ["metadata", "artwork", "playback_state", "refinements", "linked_song_pages", "hub_loop", "routing"],
    },
  };
}

function normalizeResolveArgs(songIdOrOptions, options = {}) {
  if (songIdOrOptions && typeof songIdOrOptions === "object" && !Array.isArray(songIdOrOptions)) {
    return { ...songIdOrOptions };
  }
  return {
    songId: songIdOrOptions,
    ...options,
  };
}

export function resolveDreamweaverPageFlow(songIdOrOptions, options = {}) {
  const resolved = normalizeResolveArgs(songIdOrOptions, options);
  const songId = cleanId(resolved.songId);
  const releaseId = cleanMixId(resolved.releaseId || resolved.mixId);
  const artistName = cleanText(resolved.artistName, 160);
  const title = cleanText(resolved.title, 160);
  const publicUrl = cleanText(resolved.publicUrl, 1200);
  const officialUrl = cleanText(resolved.officialUrl, 1200);
  const streamUrl = cleanText(resolved.streamUrl, 1200);
  const audience = cleanAudience(resolved.audience);
  const hyperfollowUrl = [officialUrl, streamUrl].find(isHyperFollowUrl) || "";
  const managed = Boolean(songId) && !hyperfollowUrl;
  const dreamweaverPage = songId
    ? buildDreamweaverSongPage(songId, {
        ...resolved,
        mixId: releaseId,
        releaseId,
        artistName,
        title,
        publicUrl,
        audience,
        hyperfollowUrl,
        includeManagedLinks: managed,
        launchUrl: hyperfollowUrl ? "" : undefined,
      })
    : null;
  const destinationUrl = hyperfollowUrl
    || dreamweaverPage?.experienceUrl
    || officialUrl
    || streamUrl
    || dreamweaverPage?.linkedSongUrl
    || publicUrl
    || "";
  const launchUrl = hyperfollowUrl
    || dreamweaverPage?.hubUrl
    || dreamweaverPage?.experienceUrl
    || destinationUrl;
  const routeMode = hyperfollowUrl
    ? "hyperfollow"
    : dreamweaverPage
      ? "dreamweaver_page"
      : (officialUrl || streamUrl)
        ? "existing_destination"
        : "";
  const manager = dreamweaverPage?.manager || null;
  const loop = manager?.loop || dreamweaverPage?.loop || null;
  return {
    songId,
    releaseId,
    hasHyperFollow: Boolean(hyperfollowUrl),
    hasHyperfollow: Boolean(hyperfollowUrl),
    hyperfollowUrl,
    managed,
    mixId: releaseId,
    hubUrl: dreamweaverPage?.hubUrl || "",
    publicUrl,
    officialUrl,
    streamUrl,
    launchUrl,
    destinationUrl,
    routeMode,
    dreamweaverPage,
    page: dreamweaverPage,
    pageAgent: dreamweaverPage?.pageAgent || null,
    loop,
    manager,
    usesGeneratedDreamweaverPage: Boolean(dreamweaverPage) && !hyperfollowUrl && (!officialUrl || isLegacyAudioEntry(officialUrl) || isLegacyAudioEntry(streamUrl) || routeMode === "dreamweaver_page"),
  };
}
