import { getStatsDatabase } from "../lib/stats.mjs";

export default async function statsEventHandler(request) {
  const db = await getStatsDatabase();
  return db ? new Response(JSON.stringify({ ok: true })) : new Response(JSON.stringify({ ok: false }));
}
