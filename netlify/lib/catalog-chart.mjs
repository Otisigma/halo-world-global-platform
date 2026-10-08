import { createHash } from "node:crypto";
import { resolveReleaseArtworkFields } from "./release-artwork.mjs";

// Shared, dependency-free chart logic behind /api/catalog/chart and /api/catalog/vote.

export const CHART_SORTS = Object.freeze(["signal", "votes", "newest"]);
export const APPROVED_RELEASE_STATUSES = Object.freeze(["passed", "published"]);
export const SIGNAL_WEIGHTS = Object.freeze({ votes: 5, listens: 8, opens: 3 });

const RELEASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUDIO_FILE_PATTERN = /\.(mp3|m4a|m4b|aac|ogg|oga|wav|flac|webm)(?:$|[?#])/i;
const AUDIO_API_PATHS = new Set(["/api/song-catalog/audio", "/api/mixes/audio", "/api/radio/audio", "/api/stem-vault/audio"]);
const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
// Pre-save and smart-link pages are HTML landing pages, never audio sources.
const LANDING_PAGE_HOSTS = ["distrokid.com", "hyperfollow.com", "linktr.ee", "ffm.to", "lnk.to", "found.ee"];
const PLACEHOLDER_PATTERN = /FILE_ID|PLACEHOLDER|REPLACE_ME/i;
const RELATIVE_BASE = "https://halo.invalid";

export function normalizeChartSort(value) {
  const sort = String(value || "").trim().toLowerCase();
  return CHART_SORTS.includes(sort) ? sort : "signal";
}

export function isApprovedChartStatus(value) {
  return APPROVED_RELEASE_STATUSES.includes(String(value || "").trim().toLowerCase());
}

export function isValidReleaseId(value) {
  const id = String(value || "").trim();
  return id.length >= 2 && id.length <= 96 && RELEASE_ID_PATTERN.test(id);
}

function isLandingPageHost(hostname) {
  const host = hostname.toLowerCase();
  return LANDING_PAGE_HOSTS.some(landing => host === landing || host.endsWith(`.${landing}`));
}

// Returns a URL the HTML audio element can stream directly, or "" when the value is a
// landing page, a placeholder, or otherwise not a direct media asset.
export function directStreamUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || PLACEHOLDER_PATTERN.test(raw)) return "";
  const isRelative = raw.startsWith("/") && !raw.startsWith("//");
  if (!isRelative && !/^https?:\/\//i.test(raw)) return "";
  let url;
  try {
    url = new URL(raw, RELATIVE_BASE);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
  if (!isRelative && isLandingPageHost(url.hostname)) return "";
  if (!isRelative && GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) {
    const fileId = url.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/)?.[1] || url.searchParams.get("id") || "";
    return /^[\w-]{10,}$/.test(fileId) ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : "";
  }
  const playable = AUDIO_FILE_PATTERN.test(`${url.pathname}${url.search}`) || AUDIO_API_PATHS.has(url.pathname);
  if (!playable) return "";
  return isRelative ? `${url.pathname}${url.search}` : url.href;
}

export function chartSignalScore({ votes = 0, recentListens = 0, recentOpens = 0 } = {}) {
  return Number(votes || 0) * SIGNAL_WEIGHTS.votes
    + Number(recentListens || 0) * SIGNAL_WEIGHTS.listens
    + Number(recentOpens || 0) * SIGNAL_WEIGHTS.opens;
}

// 7-day momentum: this week's listen/open activity against the previous 7 days,
// weighted the same way the Living Chart board weighs listens and opens.
export function chartMomentum({ recentListens = 0, recentOpens = 0, previousListens = 0, previousOpens = 0 } = {}) {
  const weigh = (listens, opens) => Number(listens || 0) * SIGNAL_WEIGHTS.listens + Number(opens || 0) * SIGNAL_WEIGHTS.opens;
  const delta = weigh(recentListens, recentOpens) - weigh(previousListens, previousOpens);
  if (delta > 0) return { delta, value: `+${delta}`, label: "Rising", direction: "up" };
  if (delta < 0) return { delta, value: String(delta), label: "Cooling", direction: "down" };
  return { delta: 0, value: "—", label: "Holding", direction: "steady" };
}

export function serializeChartRelease(row) {
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: row.artwork_url,
    importedArtworkUrl: row.imported_artwork_url,
    artworkOverrideUrl: row.artwork_override_url
  });
  const votes = Number(row.votes || 0);
  const recentListens = Number(row.recent_listens || 0);
  const recentOpens = Number(row.recent_opens || 0);
  const previousListens = Number(row.previous_listens || 0);
  const previousOpens = Number(row.previous_opens || 0);
  const audioUrl = directStreamUrl(row.stream_url);
  const id = String(row.id || "");
  return {
    id,
    title: row.title || "",
    artist: row.artist || "",
    status: String(row.status || "").trim().toLowerCase(),
    releaseDate: row.release_date ? String(row.release_date instanceof Date ? row.release_date.toISOString() : row.release_date).slice(0, 10) : "",
    genres: Array.isArray(row.genres) ? row.genres.map(value => String(value || "").trim()).filter(Boolean) : [],
    artwork: artwork.artwork,
    artworkSource: artwork.artworkSource,
    pitch: row.pitch || "",
    artistSlug: row.artist_slug || "",
    audioUrl,
    isPlayable: Boolean(audioUrl),
    votes,
    chartActivity: { recentListens, recentOpens, previousListens, previousOpens },
    momentum: chartMomentum({ recentListens, recentOpens, previousListens, previousOpens }),
    signalScore: chartSignalScore({ votes, recentListens, recentOpens }),
    shopUrl: `/music/?song=${encodeURIComponent(id)}`,
    listenUrl: `/api/release-link?slug=${encodeURIComponent(id)}&audience=fan`,
    kitUrl: `/release-kit.html?slug=${encodeURIComponent(id)}&audience=fan`
  };
}

function releaseTime(release) {
  const time = release.releaseDate ? new Date(`${release.releaseDate}T00:00:00Z`).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

// Deterministic ranking: the chosen metric first, then the other signals, then newest, then id.
export function rankChartReleases(releases, sort = "signal") {
  const mode = normalizeChartSort(sort);
  const byNewest = (a, b) => releaseTime(b) - releaseTime(a);
  const byVotes = (a, b) => b.votes - a.votes;
  const bySignal = (a, b) => b.signalScore - a.signalScore;
  const order = mode === "votes" ? [byVotes, bySignal, byNewest]
    : mode === "newest" ? [byNewest, bySignal, byVotes]
      : [bySignal, byVotes, byNewest];
  return releases
    .filter(release => isApprovedChartStatus(release.status))
    .slice()
    .sort((a, b) => {
      for (const compare of order) {
        const result = compare(a, b);
        if (result) return result;
      }
      return a.id.localeCompare(b.id);
    })
    .map((release, index) => ({ ...release, rank: index + 1 }));
}

export function chartVoterKey({ ip = "", userAgent = "" } = {}) {
  const source = `${String(ip || "").trim()}|${String(userAgent || "").trim().slice(0, 256)}`;
  return `anon-${createHash("sha256").update(source).digest("hex").slice(0, 40)}`;
}
