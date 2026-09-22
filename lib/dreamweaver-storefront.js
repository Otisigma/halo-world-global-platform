export const DREAMWEAVER_STOREFRONT_MIX_ID = "a1aefa12-2369-48cc-bf3f-3d3a99bcf982";

export function cleanDreamweaverSongId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

export function cleanDreamweaverMixId(value) {
  const mixId = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{12,80}$/.test(mixId) ? mixId : "";
}

export function buildDreamweaverStorefrontPath(songId, {
  mixId = "",
  includeSatelliteFlag = true,
  searchParams = "",
} = {}) {
  const params = searchParams instanceof URLSearchParams
    ? new URLSearchParams(searchParams)
    : new URLSearchParams(searchParams);
  params.set("mix", cleanDreamweaverMixId(mixId || params.get("mix")) || DREAMWEAVER_STOREFRONT_MIX_ID);
  const id = cleanDreamweaverSongId(songId || params.get("song"));
  if (id) params.set("song", id);
  else params.delete("song");
  if (includeSatelliteFlag) params.set("satellite", "dreamweaver");
  else params.delete("satellite");
  const query = params.toString();
  return query ? `/dreamweaver/?${query}` : "/dreamweaver/";
}

export function buildDreamweaverSatellitePath(songId) {
  const id = cleanDreamweaverSongId(songId);
  return id ? `/dreamweaver/satellite/${id}/` : "";
}
