const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300"
};

const MAX_BODY_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

const platformRules = [
  { name: "Spotify", hosts: ["open.spotify.com"], oembed: url => `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}` },
  { name: "Apple Music", hosts: ["music.apple.com"] },
  { name: "YouTube", hosts: ["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be"], oembed: url => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}` },
  { name: "SoundCloud", hosts: ["soundcloud.com", "www.soundcloud.com", "on.soundcloud.com"], oembed: url => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}` },
  { name: "TIDAL", hosts: ["tidal.com", "listen.tidal.com"] },
  { name: "Deezer", hosts: ["deezer.com", "www.deezer.com"] },
  { name: "Bandcamp", hosts: ["bandcamp.com"], subdomains: true },
  { name: "Amazon Music", hosts: ["music.amazon.com", "music.amazon.co.uk", "music.amazon.de", "music.amazon.ca"] },
  { name: "Audiomack", hosts: ["audiomack.com", "www.audiomack.com"] },
  { name: "DistroKid HyperFollow", hosts: ["distrokid.com", "www.distrokid.com"] }
];

function getPlatform(hostname) {
  return platformRules.find(rule => rule.hosts.includes(hostname) || (rule.subdomains && hostname.endsWith(`.${rule.hosts[0]}`)));
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
  ];
  return decodeEntities(patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean) || "").trim();
}

function cleanTitle(rawTitle, platformName) {
  return rawTitle
    .replace(new RegExp(`\\s*[|·-]\\s*${platformName}.*$`, "i"), "")
    .replace(/\s*on Spotify.*$/i, "")
    .replace(/\s*on SoundCloud.*$/i, "")
    .trim();
}

function splitCredit(rawTitle, authorName, platformName) {
  const title = cleanTitle(rawTitle, platformName);
  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i);
  const dashMatch = title.match(/^(.+?)\s+[–—-]\s+(.+)$/);
  if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
  if (dashMatch && !authorName) return { title: dashMatch[1].trim(), artist: dashMatch[2].trim() };
  return { title: title || "Imported track", artist: authorName || platformName };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "HALO-Music-Importer/1.0" },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("Music service did not return track details");
  return response.json();
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Music service response is too large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Music service response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchPage(url, platform) {
  let currentUrl = new URL(url);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 HALO-Music-Importer/1.0" },
      signal: AbortSignal.timeout(8_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Music service redirect was rejected");
      const nextUrl = new URL(location, currentUrl);
      const nextPlatform = nextUrl.protocol === "https:" ? getPlatform(nextUrl.hostname.toLowerCase()) : null;
      if (!nextPlatform || nextPlatform.name !== platform.name) throw new Error("Music service redirected outside its trusted host");
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error("Music service did not return track details");
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("Music service returned an unsupported response");
    return readLimitedText(response);
  }
  throw new Error("Music service redirect limit exceeded");
}

export default async function resolveTrackHandler(request) {
  if (request.method !== "POST") {
    return Response.json({ message: "Method not allowed" }, { status: 405, headers: { ...jsonHeaders, Allow: "POST" } });
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return Response.json({ message: "Cross-origin music imports are not accepted" }, { status: 403, headers: jsonHeaders });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ message: "Music import request is too large" }, { status: 413, headers: jsonHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "A valid music link is required" }, { status: 400, headers: jsonHeaders });
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(String(body.url || "").trim());
  } catch {
    return Response.json({ message: "Paste a complete link from a music service" }, { status: 422, headers: jsonHeaders });
  }

  if (sourceUrl.protocol !== "https:") {
    return Response.json({ message: "Music links must use HTTPS" }, { status: 422, headers: jsonHeaders });
  }

  const platform = getPlatform(sourceUrl.hostname.toLowerCase());
  if (!platform) {
    return Response.json(
      { message: "That service is not recognized yet. Try Spotify, Apple Music, YouTube, SoundCloud, TIDAL, Deezer, Bandcamp, Amazon Music, Audiomack, or DistroKid HyperFollow." },
      { status: 422, headers: jsonHeaders }
    );
  }

  try {
    let rawTitle = "";
    let artist = "";
    let artwork = "";

    if (platform.oembed) {
      const data = await fetchJson(platform.oembed(sourceUrl.href));
      rawTitle = String(data.title || "");
      artist = String(data.author_name || "");
      artwork = String(data.thumbnail_url || "");
    } else {
      const html = await fetchPage(sourceUrl.href, platform);
      rawTitle = readMeta(html, "og:title") || readMeta(html, "twitter:title");
      artist = readMeta(html, "music:musician") || readMeta(html, "og:description").split(/[·|]/)[0].trim();
      artwork = readMeta(html, "og:image") || readMeta(html, "twitter:image");
    }

    const credit = splitCredit(rawTitle, artist, platform.name);
    return Response.json(
      {
        title: credit.title.slice(0, 140),
        artist: credit.artist.slice(0, 140),
        artwork: artwork.startsWith("https://") ? artwork : "",
        platform: platform.name,
        sourceUrl: sourceUrl.href
      },
      { status: 200, headers: jsonHeaders }
    );
  } catch {
    return Response.json(
      { message: `HALO recognized ${platform.name}, but the track details could not be read. Check that the link is public and points to one song.` },
      { status: 502, headers: jsonHeaders }
    );
  }
}

export const config = {
  path: "/api/resolve-track"
};
