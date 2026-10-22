export const CATALOG_HISTORY_KEY = "halo:catalog-recently-played";

export function readRecentTrackIds(storage) {
  try {
    const entries = JSON.parse(storage.getItem(CATALOG_HISTORY_KEY) || "[]");
    return Array.isArray(entries) ? [...new Set(entries.filter(id => typeof id === "string"))].slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function recordPlayedTrack(id, storage) {
  if (typeof id !== "string" || !id) return;
  try {
    storage.setItem(CATALOG_HISTORY_KEY, JSON.stringify([id, ...readRecentTrackIds(storage).filter(value => value !== id)].slice(0, 100)));
  } catch {}
}
