import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { runCatalogProducer } from "../lib/catalog-producer.mjs";

export default async function songCatalogProducer(request) {
  if (request.method !== "POST") return;
  const database = getDatabase();
  let jobId = "";
  let ownerMemberId = "";
  try {
    verifyRequestOrigin(request);
    const user = await getUser();
    if (!user?.id) return;
    const membership = await ensureMembership(database, user);
    ownerMemberId = membership.member_id;
    const payload = await request.json().catch(() => ({}));
    jobId = cleanText(payload.jobId, 80).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(jobId)) return;
    const jobs = await database.sql`SELECT id FROM halo_catalog_producer_jobs WHERE id = ${jobId} AND owner_member_id = ${membership.member_id} AND status = 'queued' LIMIT 1`;
    if (!jobs.length) return;
    await runCatalogProducer(database, membership.member_id, jobId);
  } catch (error) {
    console.error("Catalog producer failed", error instanceof Error ? error.message : "unknown error");
    try {
      if (/^[0-9a-f-]{36}$/.test(jobId) && ownerMemberId) {
        await database.sql`UPDATE halo_catalog_producer_jobs SET status = 'failed', stage = 'failed', error_message = 'The producer could not complete this run.', updated_at = NOW(), completed_at = NOW() WHERE id = ${jobId} AND owner_member_id = ${ownerMemberId}`;
      }
    } catch {}
  }
}

export const config = { path: "/api/song-catalog/producer", background: true };
