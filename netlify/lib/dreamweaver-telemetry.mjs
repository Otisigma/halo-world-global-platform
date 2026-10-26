import { buildPublicationHealth, PUBLICATION_ESCALATION_THRESHOLD } from "./song-publication-health.mjs";

const count = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
};

export async function loadOracleTelemetry(db) {
  async function source(note, read) {
    try {
      if (!db) throw new Error("unavailable");
      return { status: "available", metrics: await read(), note };
    } catch {
      return { status: "unavailable", metrics: null, note: `${note} Source could not be read; no zero or healthy status is implied.` };
    }
  }
  const [publication, radio, sharing, feedback, votes] = await Promise.all([
    source("All active, published catalog songs; shared publication-health rules applied to grouped readiness facts. Recorded state only, not an HTTP page probe. Stale means unchecked for over 30 minutes.", async () => {
      // Group only non-sensitive readiness facts; never read titles, URLs or error text.
      const rows = await db.sql`
        WITH facts AS (
          SELECT
            song.rights_status = 'cleared' AS rights_cleared,
            EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(song.metadata_issues) = 'array' THEN song.metadata_issues ELSE '[]'::jsonb END
            ) issue WHERE issue->>'level' = 'required') AS metadata_blocked,
            EXISTS (SELECT 1 FROM halo_song_versions v WHERE v.song_id = song.id AND v.status = 'active' AND v.version_type = 'sale_master' AND v.audio_url <> '') AS master_audio,
            EXISTS (SELECT 1 FROM halo_song_versions v WHERE v.song_id = song.id AND v.status = 'active' AND v.version_type IN ('radio_edit', 'clean') AND v.audio_url <> '') AS radio_audio,
            EXISTS (SELECT 1 FROM halo_song_versions v WHERE v.song_id = song.id AND v.status = 'active' AND v.version_type IN ('radio_edit', 'clean') AND v.audio_url <> '' AND v.mastering_status = 'approved') AS radio_approved,
            COALESCE(sync.release_id, song.source_release_id, '') <> '' AS release_linked,
            COALESCE(sync.canonical_url, '') <> '' AS canonical_linked,
            COALESCE(sync.radio_track_id, '') <> '' AS radio_linked,
            COALESCE(sync.release_status, 'pending') AS release_status,
            COALESCE(sync.radio_status, 'pending') AS radio_status,
            COALESCE(sync.dreamweaver_status, 'pending') AS dreamweaver_status,
            COALESCE(sync.last_error, '') <> '' AS has_error,
            (COALESCE(sync.details->>'escalatedAt', '') <> '' OR
              CASE WHEN sync.details->>'errorStreak' ~ '^[0-9]{1,8}$'
                THEN (sync.details->>'errorStreak')::int ELSE 0 END >= ${PUBLICATION_ESCALATION_THRESHOLD}) AS escalation_recorded,
            sync.song_id IS NULL AS missing_sync,
            (sync.last_reconciled_at IS NULL OR sync.last_reconciled_at < NOW() - INTERVAL '30 minutes') AS stale
          FROM halo_song_catalog song
          LEFT JOIN halo_song_publication_sync sync ON sync.song_id = song.id
          WHERE song.status = 'active' AND song.pipeline_status = 'published'
        )
        SELECT rights_cleared, metadata_blocked, master_audio, radio_audio, radio_approved,
          release_linked, canonical_linked, radio_linked, release_status, radio_status,
          dreamweaver_status, has_error, escalation_recorded, missing_sync, stale, COUNT(*)::int AS total
        FROM facts
        GROUP BY rights_cleared, metadata_blocked, master_audio, radio_audio, radio_approved,
          release_linked, canonical_linked, radio_linked, release_status, radio_status,
          dreamweaver_status, has_error, escalation_recorded, missing_sync, stale
      `;
      const metrics = { published: 0, incomplete: 0, escalated: 0, releaseReady: 0, radioReady: 0,
        shareReady: 0, missingSync: 0, stale: 0, states: {} };
      for (const row of rows) {
        const versions = [];
        if (row.master_audio) versions.push({ versionType: "sale_master", audioUrl: "present" });
        if (row.radio_audio) versions.push({ versionType: "radio_edit", audioUrl: "present",
          masteringStatus: row.radio_approved ? "approved" : "not_started" });
        const health = buildPublicationHealth({
          rightsStatus: row.rights_cleared ? "cleared" : "needs_review",
          metadataIssues: row.metadata_blocked ? [{ level: "required" }] : [], versions
        }, {
          releaseId: row.release_linked ? "present" : "",
          canonicalUrl: row.canonical_linked ? "present" : "",
          radioTrackId: row.radio_linked ? "present" : "",
          releaseStatus: row.release_status, radioStatus: row.radio_status,
          dreamweaverStatus: row.dreamweaver_status,
          lastError: row.has_error ? "Recorded error (redacted)" : "",
          details: row.escalation_recorded ? { errorStreak: PUBLICATION_ESCALATION_THRESHOLD } : {}
        });
        const total = count(row.total);
        metrics.published += total;
        metrics.states[health.state] = (metrics.states[health.state] || 0) + total;
        if (health.state !== "published_and_fully_distributed") metrics.incomplete += total;
        if (health.escalated) metrics.escalated += total;
        if (health.releaseReady) metrics.releaseReady += total;
        if (health.radioReady) metrics.radioReady += total;
        if (health.dreamweaverReady) metrics.shareReady += total;
        if (row.missing_sync) metrics.missingSync += total;
        if (row.stale) metrics.stale += total;
      }
      return metrics;
    }),
    source("All radio tracks grouped by recorded room/status. Rotation is playable routing; held is not rotation. No stream URLs are fetched and playback health is unverified.", async () => {
      const rows = await db.sql`SELECT room, status, COUNT(*)::int AS total FROM halo_radio_tracks GROUP BY room, status`;
      const rooms = Object.fromEntries(["club", "chill", "lounge"].map(room => [room, { total: 0, rotation: 0, preview: 0, held: 0, rejected: 0 }]));
      for (const row of rows) {
        if (!Object.hasOwn(rooms, row.room) || !["rotation", "preview", "held", "rejected"].includes(row.status)) continue;
        rooms[row.room].total += count(row.total);
        rooms[row.room][row.status] += count(row.total);
      }
      return { rooms, roomsWithoutRotation: Object.values(rooms).filter(room => !room.rotation).length };
    }),
    source("Dreamweaver campaign copy/download/publish-ready events over 30 days. These are preparation signals, not proof of external publication or delivery.", async () => {
      const rows = await db.sql`
        SELECT COUNT(*) FILTER (WHERE event_kind = 'copied')::int AS copied,
          COUNT(*) FILTER (WHERE event_kind = 'downloaded')::int AS downloaded,
          COUNT(*) FILTER (WHERE event_kind = 'publish_ready')::int AS publish_ready
        FROM halo_dreamweaver_campaign_events WHERE created_at >= NOW() - INTERVAL '30 days'
      `;
      return { copied: count(rows[0]?.copied), downloaded: count(rows[0]?.downloaded), publishReady: count(rows[0]?.publish_ready) };
    }),
    source("Social snippet feedback signals over 30 days from members; not verified subscribers, unique people, sentiment analysis, or raw comments.", async () => {
      const rows = await db.sql`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE signal = 'saved')::int AS saved,
          COUNT(*) FILTER (WHERE signal = 'reused')::int AS reused,
          COUNT(*) FILTER (WHERE signal = 'worked')::int AS worked,
          COUNT(*) FILTER (WHERE signal = 'needs_change')::int AS needs_change
        FROM halo_social_snippet_feedback WHERE created_at >= NOW() - INTERVAL '30 days'
      `;
      return { total: count(rows[0]?.total), saved: count(rows[0]?.saved), reused: count(rows[0]?.reused),
        worked: count(rows[0]?.worked), needsChange: count(rows[0]?.needs_change) };
    }),
    source("Chart vote rows over 30 days, including anonymous listeners. Repeat votes on different days are possible; not unique subscribers or people.", async () => {
      const rows = await db.sql`SELECT COUNT(*)::int AS total FROM halo_chart_votes WHERE created_at >= NOW() - INTERVAL '30 days'`;
      return { total: count(rows[0]?.total) };
    })
  ]);
  return { generatedAt: new Date().toISOString(), sources: { publication, radio, sharing, feedback, votes } };
}
