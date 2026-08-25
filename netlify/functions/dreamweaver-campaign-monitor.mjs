import { getDatabase } from "@netlify/database";
import { reviewCampaignEvidence } from "../lib/dreamweaver-campaigns.mjs";

export default async function dreamweaverCampaignMonitor() {
  const db = getDatabase();
  const campaigns = await db.sql`
    SELECT campaign.*
    FROM halo_dreamweaver_campaigns AS campaign
    WHERE campaign.status IN ('ready', 'active')
      AND campaign.updated_at >= NOW() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1 FROM halo_dreamweaver_campaign_events AS event
        WHERE event.campaign_id = campaign.id
          AND (campaign.last_reviewed_at IS NULL OR event.created_at > campaign.last_reviewed_at)
      )
    ORDER BY campaign.updated_at DESC
    LIMIT 24
  `;
  const results = [];
  for (const campaign of campaigns) {
    const rows = await db.sql`
      SELECT event_kind, COUNT(*)::int AS count
      FROM halo_dreamweaver_campaign_events
      WHERE campaign_id = ${campaign.id}
      GROUP BY event_kind
    `;
    const metrics = Object.fromEntries(rows.map(row => [row.event_kind, Number(row.count || 0)]));
    const assessment = await reviewCampaignEvidence(metrics, campaign);
    await db.sql`
      UPDATE halo_dreamweaver_campaigns
      SET recommendations = ${JSON.stringify(assessment)}::jsonb,
        performance_score = ${assessment.score}, last_reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${campaign.id}
    `;
    results.push({ campaignId: campaign.id, score: assessment.score, grade: assessment.grade, model: assessment.model });
  }
  console.log("Dreamweaver campaign monitoring completed", { campaigns: campaigns.length, results });
}

export const config = { schedule: "30 7 * * *" };
