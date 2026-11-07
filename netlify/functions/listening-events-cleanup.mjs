import { getDatabase } from "@netlify/database";

export default async function listeningEventsCleanup() {
  const db = await getDatabase();
  await db.sql`DELETE FROM halo_listening_sessions WHERE started_at < NOW() - INTERVAL '30 days'`;
}

export const config = { schedule: "0 * * * *" };
