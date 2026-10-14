import { createHash, randomUUID } from "node:crypto";
import { campaignInput } from "../../services/growth-engine/engine.mjs";

export async function loadGrowthSource(db, ownerMemberId, songId) {
  const rows = await db.sql`
    SELECT song.id, song.owner_member_id, song.title, song.artist_name, song.genre, song.rights_status,
      COALESCE(NULLIF(version.artwork_url, ''), song.artwork_url) AS artwork_url,
      CASE WHEN NULLIF(version.artwork_url, '') IS NOT NULL
        THEN version.artwork_blob_prefix ELSE song.artwork_blob_prefix END AS artwork_blob_prefix,
      CASE WHEN NULLIF(version.artwork_url, '') IS NOT NULL
        THEN version.artwork_uploaded_at ELSE song.artwork_uploaded_at END AS artwork_uploaded_at,
      version.id AS master_version_id, version.audio_url, version.audio_storage_key,
      version.audio_blob_prefix, version.audio_chunk_count, version.drive_file_id,
      version.video_url, version.duration_seconds,
      version.updated_at AS master_updated_at
    FROM halo_song_catalog song
    JOIN halo_song_versions version ON version.song_id = song.id
      AND version.version_type = 'sale_master' AND version.status = 'active'
    WHERE song.id = ${songId} AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
  `;
  if (rows.length !== 1) return null;
  const song = rows[0];
  return { ...song, source_fingerprint: createHash("sha256").update(JSON.stringify(song)).digest("hex") };
}

export function createGrowthStore(db) {
  return {
    async ingest(ownerMemberId, songId, input) {
      const source = await loadGrowthSource(db, ownerMemberId, songId);
      if (!source) return null;
      const campaign = campaignInput(source, input);
      // Creation and the first queue entry commit together. Repeated requests reuse the original campaign.
      const rows = await db.sql`
        WITH campaign AS (
          INSERT INTO halo_growth_campaigns (id, song_id, owner_member_id, request_key, snapshot, settings, rights)
          VALUES (${campaign.id}, ${songId}, ${ownerMemberId}, ${campaign.requestKey},
            ${JSON.stringify(campaign.snapshot)}::jsonb, ${JSON.stringify(campaign.settings)}::jsonb, ${JSON.stringify(campaign.rights)}::jsonb)
          ON CONFLICT (owner_member_id, song_id, request_key) DO UPDATE SET request_key = EXCLUDED.request_key
          RETURNING *
        ), first_job AS (
          INSERT INTO halo_growth_jobs (id, campaign_id, kind, job_key, payload)
          SELECT ${randomUUID()}, id, 'ingest', 'ingest', '{}'::jsonb FROM campaign
          ON CONFLICT (campaign_id, job_key) DO NOTHING
        )
        SELECT * FROM campaign
      `;
      return rows[0];
    },

    async get(ownerMemberId, campaignId) {
      const campaigns = await db.sql`
        SELECT * FROM halo_growth_campaigns WHERE id = ${campaignId} AND owner_member_id = ${ownerMemberId}
      `;
      if (!campaigns[0]) return null;
      const jobs = await db.sql`
        SELECT job.id, job.kind, job.job_key, job.payload, job.status, job.attempts, job.result,
          job.last_error, job.audit, job.available_at, job.created_at, job.updated_at
        FROM halo_growth_jobs job JOIN halo_growth_campaigns campaign ON campaign.id = job.campaign_id
        WHERE job.campaign_id = ${campaignId} AND campaign.owner_member_id = ${ownerMemberId}
        ORDER BY job.created_at, job.id
      `;
      return { campaign: campaigns[0], jobs };
    },

    async claim(ownerMemberId, campaignId, kind = null) {
      const token = randomUUID();
      const rows = await db.sql`
        WITH candidate AS (
          SELECT job.id FROM halo_growth_jobs job
          JOIN halo_growth_campaigns campaign ON campaign.id = job.campaign_id
          WHERE campaign.id = ${campaignId} AND campaign.owner_member_id = ${ownerMemberId}
            AND (${kind}::text IS NULL OR job.kind = ${kind})
            AND job.attempts < 3 AND job.available_at <= NOW()
            AND (job.status = 'queued' OR (job.status = 'running' AND job.locked_until < NOW()))
          ORDER BY job.created_at, job.id
          FOR UPDATE OF job SKIP LOCKED LIMIT 1
        )
        UPDATE halo_growth_jobs job SET status = 'running', lease_token = ${token},
          locked_until = NOW() + INTERVAL '10 minutes', attempts = attempts + 1, updated_at = NOW(),
          audit = audit || jsonb_build_array(jsonb_build_object('event', 'claimed', 'at', NOW(), 'attempt', attempts + 1))
        FROM candidate WHERE job.id = candidate.id RETURNING job.*
      `;
      // A crashed final attempt must become visible as a terminal failure rather than remain running forever.
      await db.sql`
        UPDATE halo_growth_jobs job SET status = 'failed', lease_token = NULL, locked_until = NULL,
          last_error = 'Worker lease expired after final attempt', updated_at = NOW(),
          audit = audit || jsonb_build_array(jsonb_build_object('event', 'exhausted', 'at', NOW()))
        FROM halo_growth_campaigns campaign
        WHERE campaign.id = job.campaign_id AND campaign.id = ${campaignId}
          AND campaign.owner_member_id = ${ownerMemberId} AND job.status = 'running'
          AND job.locked_until < NOW() AND job.attempts >= 3
      `;
      return rows[0] ? { ...rows[0], key: rows[0].job_key } : null;
    },

    async loadAuthorizedCampaign(ownerMemberId, campaignId) {
      const rows = await db.sql`
        SELECT * FROM halo_growth_campaigns WHERE id = ${campaignId} AND owner_member_id = ${ownerMemberId}
      `;
      if (!rows[0]) return null;
      const row = rows[0];
      const source = await loadGrowthSource(db, ownerMemberId, row.song_id);
      if (!source || source.rights_status !== "cleared" ||
          source.source_fingerprint !== row.snapshot.sourceFingerprint ||
          !row.rights.master || !row.rights.visual || !row.rights.promotion) return null;
      return { id: row.id, ownerMemberId, songId: row.song_id, snapshot: row.snapshot, settings: row.settings, source };
    },

    async complete(job, { result, next }) {
      const rows = await db.sql`
        WITH finished AS (
          UPDATE halo_growth_jobs SET status = 'succeeded', result = ${JSON.stringify(result)}::jsonb,
            lease_token = NULL, locked_until = NULL, last_error = '', updated_at = NOW(),
            audit = audit || jsonb_build_array(jsonb_build_object('event', 'succeeded', 'at', NOW()))
          WHERE id = ${job.id} AND lease_token = ${job.lease_token} AND status = 'running' AND locked_until > NOW()
          RETURNING campaign_id
        ), followups AS (
          INSERT INTO halo_growth_jobs (id, campaign_id, kind, job_key, payload)
          SELECT item.id, finished.campaign_id, item.kind, item.key, item.payload
          FROM finished CROSS JOIN jsonb_to_recordset(${JSON.stringify(next)}::jsonb)
            AS item(id text, kind text, key text, payload jsonb)
          ON CONFLICT (campaign_id, job_key) DO NOTHING
        )
        SELECT campaign_id FROM finished
      `;
      return rows.length > 0;
    },

    async fail(job, status, message) {
      const rows = await db.sql`
        UPDATE halo_growth_jobs SET status = ${status}, last_error = ${message}, lease_token = NULL,
          locked_until = NULL, updated_at = NOW(),
          audit = audit || jsonb_build_array(jsonb_build_object('event', ${status}::text, 'at', NOW(), 'reason', ${message}::text))
        WHERE id = ${job.id} AND lease_token = ${job.lease_token} AND status = 'running' AND locked_until > NOW()
        RETURNING id
      `;
      return rows.length > 0;
    },

    async retry(ownerMemberId, campaignId, jobId) {
      const rows = await db.sql`
        UPDATE halo_growth_jobs job SET status = 'queued', available_at = NOW() + INTERVAL '30 seconds',
          updated_at = NOW(), audit = audit || jsonb_build_array(jsonb_build_object('event', 'retry_requested', 'at', NOW()))
        FROM halo_growth_campaigns campaign WHERE campaign.id = job.campaign_id
          AND campaign.id = ${campaignId} AND campaign.owner_member_id = ${ownerMemberId}
          AND job.id = ${jobId} AND job.status IN ('failed', 'blocked') AND job.attempts < 3
        RETURNING job.id
      `;
      return rows.length > 0;
    },
  };
}
