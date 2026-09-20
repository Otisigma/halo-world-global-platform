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

function cleanSlug(value) {
  const slug = cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 96);
}

function cleanAudience(value) {
  const audience = cleanText(value, 40).toLowerCase();
  return audience || DEFAULT_AUDIENCE;
}

function linkedSongUrl(songId) {
  const id = cleanId(songId);
  return id ? `/music/?song=${encodeURIComponent(id)}` : "";
}

function storefrontUrl(songId) {
  const id = cleanId(songId);
  return id ? `/dreamweaver/?satellite=dreamweaver&song=${encodeURIComponent(id)}` : "/dreamweaver/";
}

export function buildDreamweaverPageAgent(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  return {
    id: `dreamweaver-page-manager-${id}`,
    purpose: "Manage the Dreamweaver page lifecycle and linked song routes for this release.",
    updatePath: options.updatePath || DEFAULT_UPDATE_PATH,
    intervalMs: Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS,
    managedSongId: id,
    linkedRoutes: [
      `/dreamweaver/satellite/${id}/`,
      storefrontUrl(id),
      linkedSongUrl(id),
    ],
  };
}

export function buildDreamweaverSongPage(songId, options = {}) {
  const id = cleanId(songId);
  if (!id) return null;
  const route = `/dreamweaver/satellite/${id}/`;
  const params = new URLSearchParams();
  const slug = cleanSlug(options.slug || `${cleanText(options.artistName, 80)} ${cleanText(options.title, 80)}`);
  const audience = cleanAudience(options.audience);
  if (slug) params.set("slug", slug);
  if (audience) params.set("audience", audience);
  const query = params.toString();
  const experienceUrl = query ? `${route}?${query}` : route;
  const pageAgent = buildDreamweaverPageAgent(id, options);
  const metadata = {
    route,
    experienceUrl,
    launchUrl: experienceUrl,
    fallbackUrl: storefrontUrl(id),
    storefrontUrl: storefrontUrl(id),
    linkedSongUrl: linkedSongUrl(id),
    pageAgent,
  };
  if (!options.includeAgentLoop) return metadata;
  return {
    ...metadata,
    agentLoop: {
      id: `dreamweaver-satellite-${id}`,
      updatePath: options.updatePath || DEFAULT_UPDATE_PATH,
      intervalMs: Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS,
      channels: ["metadata", "artwork", "playback_state", "refinements", "linked_song_pages"],
    },
  };
}

export function resolveDreamweaverPageFlow({
  songId,
  releaseId = "",
  artistName = "",
  title = "",
  officialUrl = "",
  audience = DEFAULT_AUDIENCE,
  includeAgentLoop = true,
  updatePath = DEFAULT_UPDATE_PATH,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  const cleanedOfficialUrl = cleanText(officialUrl, 1200);
  const hyperfollowUrl = isHyperFollowUrl(cleanedOfficialUrl) ? cleanedOfficialUrl : "";
  const dreamweaverPage = buildDreamweaverSongPage(songId, {
    slug: cleanSlug(`${artistName}-${title}`) || cleanSlug(releaseId),
    audience,
    includeAgentLoop,
    updatePath,
    intervalMs,
  });
  const destinationUrl = hyperfollowUrl || dreamweaverPage?.experienceUrl || cleanedOfficialUrl || dreamweaverPage?.linkedSongUrl || "";
  return {
    hasHyperFollow: Boolean(hyperfollowUrl),
    hyperfollowUrl,
    dreamweaverPage,
    destinationUrl,
    routeMode: hyperfollowUrl ? "hyperfollow" : dreamweaverPage ? "dreamweaver_page" : cleanedOfficialUrl ? "existing_destination" : "",
  };
}
