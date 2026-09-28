export const allowedEvents = new Set([
  "creator_charter_affirmed",
  "creator_charter_response",
  "creator_charter_vote",
  "open_creator_charter",
  "open_song_catalog",
]);

export async function getStatsDatabase() {
  const { getDatabase } = await import("@netlify/database");
  return getDatabase();
}
