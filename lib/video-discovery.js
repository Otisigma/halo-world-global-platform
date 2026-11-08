import { buildDreamweaverStorefrontPath, cleanDreamweaverSongId } from "./dreamweaver-storefront.js";

export const DISCOVERY_THEMES = Object.freeze([
  { id: "cinematic", title: "Cinematic nights", words: ["cinematic", "ambient", "soundtrack"] },
  { id: "electronic", title: "Electronic energy", words: ["electronic", "house", "dance", "techno"] },
  { id: "soul", title: "Soul & reflection", words: ["soul", "r&b", "rnb"] },
  { id: "uplifting", title: "Uplifting signals", words: ["gospel", "inspirational", "worship"] },
]);

export function publishedDiscoveryReleases(releases) {
  return (Array.isArray(releases) ? releases : []).filter(release => release?.id
    && release.isLiveVisible !== false && ["passed", "published"].includes(String(release.status).toLowerCase()));
}

export function releasesForTheme(releases, themeId) {
  const theme = DISCOVERY_THEMES.find(item => item.id === themeId);
  const published = publishedDiscoveryReleases(releases);
  if (!theme) return published;
  return published.filter(release => {
    const genres = (Array.isArray(release.genres) ? release.genres : []).join(" ").toLowerCase();
    return theme.words.some(word => genres.includes(word));
  });
}

export function discoveryPlaylistPath(themeId, songId = "") {
  const params = new URLSearchParams();
  if (DISCOVERY_THEMES.some(theme => theme.id === themeId)) params.set("playlist", themeId);
  if (songId) params.set("song", songId);
  return `/music/?${params}#video-discovery`;
}

export function discoveryDreamweaverPath(release) {
  const songId = cleanDreamweaverSongId(release?.dreamweaverPayload?.songId)
    || cleanDreamweaverSongId(release?.catalog?.songId) || cleanDreamweaverSongId(release?.id);
  if (songId) return buildDreamweaverStorefrontPath(songId);
  const params = new URLSearchParams({ mix: String(release?.id || "") });
  return `/dreamweaver/?${params}`;
}

export function nativeDiscoveryVideo(release, origin) {
  for (const value of [release?.promoVideoUrl, release?.videoUrl, release?.catalog?.promoVideoUrl, release?.catalog?.videoUrl]) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const url = new URL(value, origin);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      if (/\.(mp4|webm)(?:$|[?#])/i.test(url.pathname + url.search)
        || (url.origin === origin && url.pathname === "/api/videos")) return url.href;
    } catch {
      continue;
    }
  }
  return "";
}
