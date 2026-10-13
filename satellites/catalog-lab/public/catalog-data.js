export const CATALOG_ENDPOINT = "https://halo-world-global-platform.netlify.app/api/release-catalog";

const text = value => typeof value === "string" ? value.trim().slice(0, 300) : "";

export function normalizeCatalog(payload) {
  if (!payload || !Array.isArray(payload.releases)) {
    throw new Error("Invalid public catalog response");
  }
  return Object.freeze(payload.releases
    .filter(row => row && typeof row === "object" && text(row.id)
      && row.status === "published" && row.isLiveVisible === true)
    .slice(0, 200)
    .map(row => Object.freeze({
      id: text(row.id),
      title: text(row.title) || "Untitled release",
      artist: text(row.artist) || "Unknown artist",
      genres: Object.freeze(Array.isArray(row.genres) ? row.genres.map(text).filter(Boolean).slice(0, 5) : []),
      isrc: text(row.isrc),
      releaseDate: text(row.releaseDate)
    })));
}

export async function fetchCatalog(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(CATALOG_ENDPOINT, {
    method: "GET",
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Public catalog unavailable");
  return normalizeCatalog(await response.json());
}
