const START = "<!-- halo-social-preview:start -->";
const END = "<!-- halo-social-preview:end -->";
const DEFAULT_TITLE = "Obsidian Gateway | HALO Music World";
const DEFAULT_DESCRIPTION = "Explore public HALO releases and listen to available previews.";

function text(value, limit = 120) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function artworkUrl(release, origin) {
  for (const candidate of [release.artworkOverride, release.importedArtwork, release.artwork, release.catalog?.artworkUrl]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(candidate, origin);
      if (url.protocol === "https:" && !url.username && !url.password && /\.(?:png|jpe?g)$/i.test(url.pathname)) return url.href;
    } catch {
      continue;
    }
  }
  return "";
}

export async function makePreview(request, context, fetcher = fetch) {
  const response = await context.next();
  if (request.method !== "GET" || !response.ok || !response.headers.get("content-type")?.includes("text/html")) return response;

  const requestUrl = new URL(request.url);
  const canonical = new URL("/obsidian/", requestUrl.origin);
  const song = requestUrl.searchParams.get("song") || "";
  const validSong = song.length > 0 && song.length <= 200 && !/[\u0000-\u001f\u007f]/.test(song);
  const moment = requestUrl.searchParams.get("t") || "";
  if (validSong) canonical.searchParams.set("song", song);
  if (validSong && /^\d{1,6}$/.test(moment)) canonical.searchParams.set("t", moment);
  let title = DEFAULT_TITLE;
  let description = DEFAULT_DESCRIPTION;
  const fallbackImage = new URL("/assets/obsidian-social-preview.png", requestUrl.origin).href;
  let image = fallbackImage;
  if (validSong) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const catalogResponse = await fetcher(new URL("/api/release-catalog", requestUrl.origin), {
        headers: { Accept: "application/json" }, signal: controller.signal
      });
      if (!catalogResponse.ok) throw new Error(`Catalog returned ${catalogResponse.status}`);
      const catalog = await catalogResponse.json();
      if (!Array.isArray(catalog?.releases)) throw new Error("Invalid catalog response");
      const release = catalog.releases.find(item => item && item.id === song && item.isLiveVisible !== false
        && ["published", "passed"].includes(String(item.status || "").trim().toLowerCase()));
      if (release) {
        const name = text(release.title);
        const artist = text(release.artist);
        if (name) {
          title = `${name}${artist ? ` — ${artist}` : ""} | HALO Music World`;
          description = `Listen to ${name}${artist ? ` by ${artist}` : ""} in the Obsidian Gateway.`;
        }
        image = artworkUrl(release, requestUrl.origin) || fallbackImage;
      }
    } catch (error) {
      console.error("Obsidian social preview catalog unavailable:", error);
    } finally {
      clearTimeout(timer);
    }
  }

  const meta = (attribute, key, value) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`;
  const tags = [
    meta("property", "og:type", "website"),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", canonical.href),
    meta("property", "og:image", image),
    meta("property", "og:image:alt", image === fallbackImage ? "HALO Music World Obsidian Gateway: enter the signal" : `Artwork for ${title}`),
    ...(image === fallbackImage ? [] : [meta("property", "og:image", fallbackImage),
      meta("property", "og:image:alt", "HALO Music World Obsidian Gateway: enter the signal")]),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image)
  ].join("\n  ");
  const html = await response.text();
  const start = html.indexOf(START), end = html.indexOf(END, start + START.length);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  if (start < 0 || end < 0) {
    console.error("Obsidian social preview markers missing");
    headers.set("Cache-Control", "no-store");
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
  headers.set("Cache-Control", "no-store");
  return new Response(`${html.slice(0, start)}${START}\n  ${tags}\n  ${html.slice(end)}`, {
    status: response.status, statusText: response.statusText, headers
  });
}

export default (request, context) => makePreview(request, context);
