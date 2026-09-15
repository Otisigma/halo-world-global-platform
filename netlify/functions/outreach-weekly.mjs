import { getDatabase } from "@netlify/database";
import { runOutreachDesk } from "../lib/outreach.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

/**
 * The desk works the release window, not the whole catalogue. A record is worth approaching from a
 * few weeks before release until a few weeks after; outside that window a cold approach is a worse
 * use of a contact's attention and of their frequency cap.
 */
export default async function handler() {
  const db = getDatabase();
  try {
    const releases = await db.sql`
      SELECT id, title, artist
      FROM halo_release_campaigns
      WHERE status = 'published'
        AND release_date IS NOT NULL
        AND release_date BETWEEN CURRENT_DATE - INTERVAL '28 days' AND CURRENT_DATE + INTERVAL '35 days'
      ORDER BY release_date DESC
      LIMIT 6
    `;

    if (!releases.length) {
      await recordScheduledHeartbeat(db, "outreach-weekly", "success", { releases: 0, note: "no_releases_in_window" });
      console.log("HALO outreach desk weekly: no releases in the outreach window");
      return;
    }

    const results = [];
    for (const release of releases) {
      try {
        // A modest per-release cap. The constraint on outreach is the quality of the list, not the
        // volume of drafts, and a queue nobody reads is the same as no queue.
        const result = await runOutreachDesk(db, release.id, { triggerType: "scheduled", limit: 8 });
        results.push({
          release: release.title,
          kept: result.kept,
          dropped: result.dropped,
          blocked: result.blockedSuppressed + result.blockedFrequency,
          status: result.status
        });
      } catch (error) {
        console.error("HALO outreach weekly run failed", release.id, error instanceof Error ? error.message : "unknown error");
        results.push({ release: release.title, skipped: "run_failed" });
      }
    }

    const hadFailures = results.some(item => item?.skipped === "run_failed");
    await recordScheduledHeartbeat(db, "outreach-weekly", hadFailures ? "failure" : "success", { releases: releases.length, results });
    console.log("HALO outreach desk weekly queues prepared", { releases: releases.length, results });
  } catch (error) {
    await recordScheduledHeartbeat(db, "outreach-weekly", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    });
    throw error;
  }
}

export const config = {
  schedule: "40 9 * * 2"
};
