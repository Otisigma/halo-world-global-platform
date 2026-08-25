const MAX_HYPERFOLLOW_BYTES = 1_500_000;
const TRUSTED_CREW_PATTERNS = [
  /\bdj\s+halo(?:\s+x)?\b/i,
  /\bdj\s+butterfly\b/i,
  /\b(?:dj\s+)?the\s+scout\b/i
];

function decodeHtml(value = "") {
  return value.replace(/&#(x?[0-9a-f]+);|&(amp|quot|apos|lt|gt);/gi, (match, numeric, named) => {
    if (numeric) {
      const radix = numeric[0].toLowerCase() === "x" ? 16 : 10;
      return String.fromCodePoint(Number.parseInt(numeric.replace(/^x/i, ""), radix));
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[named.toLowerCase()] || match;
  });
}

function clean(value = "") {
  return decodeHtml(value).replace(/\\\//g, "/").replace(/\s+/g, " ").trim();
}

function cleanTitle(value = "") {
  return clean(value)
    .replace(/\s+([,.;:!?\)])/g, "$1")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ");
}

function matchValue(html, pattern) {
  return clean(html.match(pattern)?.[1] || "");
}

function toIsoDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(clean(value));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function storeLinks(html) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*data-hyperfollow-store=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = safeHttpsUrl(match[1]);
    const title = clean(match[2]);
    if (url && title) links.push({ url, title });
  }
  return links;
}

export function isHyperFollowUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && /(^|\.)distrokid\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/hyperfollow/");
  } catch {
    return false;
  }
}

export function isTrustedCrewCredit(value) {
  const credit = clean(value);
  return TRUSTED_CREW_PATTERNS.some(pattern => pattern.test(credit));
}

export function isTrustedCrewHyperFollow(value) {
  try {
    const parsed = new URL(value);
    const account = parsed.pathname.split("/").filter(Boolean)[1] || "";
    return isHyperFollowUrl(value) && /^djhalo\d*$/i.test(account);
  } catch {
    return false;
  }
}

export function parseHyperFollow(html, sourceUrl) {
  const credit = matchValue(html, /hyperAlbum\.artist\s*=\s*["']([^"']+)["']/i)
    || matchValue(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+?)(?:\s+-\s+DistroKid)?["']/i).replace(/^.+? by /i, "");
  const releaseTitle = cleanTitle(matchValue(html, /hyperAlbum\.albumTitle\s*=\s*["']([^"']+)["']/i)
    || matchValue(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+?)\s+by\s+/i));
  const releaseDate = toIsoDate(matchValue(html, /hyperAlbum\.releaseDate\s*=\s*["']([^"']+)["']/i));
  const artworkUrl = safeHttpsUrl(matchValue(html, /<meta\s+property=["']og:image:url["']\s+content=["']([^"']+)["']/i));
  const videoId = matchValue(html, /youtube\.com\/embed\/([\w-]{6,20})/i);
  const videoTitle = matchValue(html, /<iframe\b[^>]*youtube\.com\/embed\/[\w-]+[^>]*title=["']([^"']+)["']/i);
  const artistName = credit.split(/\s+mixed\s+by\s+/i)[0].trim();
  const mixer = credit.match(/\s+mixed\s+by\s+(.+)$/i)?.[1]?.trim() || "";
  const stores = storeLinks(html);
  const spotify = stores.find(link => /spotify/i.test(link.title));
  const sources = [{ url: sourceUrl, title: `${releaseTitle || "Release"} — HyperFollow` }];

  for (const link of stores) {
    if (!sources.some(source => source.url === link.url)) sources.push(link);
    if (sources.length === 7) break;
  }
  if (videoId) sources.push({ url: `https://www.youtube.com/watch?v=${videoId}`, title: videoTitle || `${releaseTitle} official video` });

  if (!artistName || !releaseTitle) return null;
  const collaboration = mixer ? `${artistName} and ${mixer}` : artistName;
  const trustedCrew = isTrustedCrewHyperFollow(sourceUrl) || isTrustedCrewCredit(credit) || isTrustedCrewCredit(releaseTitle);

  return {
    draft: {
      artistName,
      slug: artistName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80),
      tagline: mixer ? `${releaseTitle}, mixed by ${mixer}.` : `${releaseTitle}, available now.`,
      bio: `${artistName} is the primary artist credited on ${releaseTitle}${mixer ? `, with ${mixer} credited for the mix` : ""}. This room starts with the verified release and grows as more official music, visuals, press, and performance information becomes available.`,
      location: "",
      accentColor: "#d5ff52",
      artworkUrl,
      releaseTitle,
      releaseDate,
      releaseUrl: sourceUrl,
      videoTitle: videoTitle || (videoId ? `${releaseTitle} official video` : ""),
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      bookingUrl: "",
      websiteUrl: spotify?.url || sourceUrl,
      confidence: "high",
      reviewNote: trustedCrew
        ? `Verified as a HALO crew release from the supplied HyperFollow page. The public release credits ${collaboration}; review the remaining details before publishing.`
        : `Verified from the supplied HyperFollow page. The release credits ${collaboration}; add location, booking, and expanded biography details when official sources become available.`
    },
    sources
  };
}

async function readLimitedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_HYPERFOLLOW_BYTES) {
      await reader.cancel();
      throw new Error("HyperFollow response was too large");
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

export async function scoutHyperFollow(sourceUrl) {
  if (!isHyperFollowUrl(sourceUrl)) return null;
  const response = await fetch(sourceUrl, {
    headers: { Accept: "text/html", "User-Agent": "HALO-Artist-Scout/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`HyperFollow returned ${response.status}`);
  if (!isHyperFollowUrl(response.url || sourceUrl)) throw new Error("HyperFollow redirected outside DistroKid");
  return parseHyperFollow(await readLimitedBody(response), sourceUrl);
}
