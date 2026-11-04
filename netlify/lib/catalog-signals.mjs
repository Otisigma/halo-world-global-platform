export async function loadCatalogSignals(db, ownerMemberId, now = new Date()) {
  const asOf = now.toISOString();
  const recentStart = new Date(now.getTime() - 7 * 86400000).toISOString();
  const previousStart = new Date(now.getTime() - 14 * 86400000).toISOString();
  try {
    const rows = await db.sql`
      SELECT song.id AS song_id,
        COUNT(event.id) FILTER (WHERE event.event_type = 'outbound_click' AND event.created_at >= ${recentStart})::int AS recent_clicks,
        COUNT(event.id) FILTER (WHERE event.event_type = 'outbound_click' AND event.created_at < ${recentStart})::int AS previous_clicks,
        COUNT(event.id) FILTER (WHERE event.event_type = 'kit_open' AND event.created_at >= ${recentStart})::int AS recent_opens,
        COUNT(event.id) FILTER (WHERE event.event_type = 'kit_open' AND event.created_at < ${recentStart})::int AS previous_opens
      FROM halo_song_catalog song
      JOIN halo_release_campaigns release ON release.id = song.source_release_id AND release.status = 'published'
      LEFT JOIN halo_release_campaign_events event ON event.release_id = release.id
        AND event.created_at >= ${previousStart} AND event.created_at < ${asOf}
        AND event.event_type IN ('outbound_click', 'kit_open')
      WHERE song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
        AND (release.owner_member_id = ${ownerMemberId} OR EXISTS (
          SELECT 1 FROM halo_artist_pages page
          WHERE page.slug = release.artist_slug AND page.owner_member_id = ${ownerMemberId}
        ))
      GROUP BY song.id
    `;
    return {
      status: "available", asOf, recentStart, previousStart,
      songs: rows.map(row => ({
        songId: row.song_id,
        recentClicks: Number(row.recent_clicks), previousClicks: Number(row.previous_clicks),
        recentOpens: Number(row.recent_opens), previousOpens: Number(row.previous_opens),
      })),
    };
  } catch {
    return { status: "unavailable", asOf, recentStart, previousStart, songs: [] };
  }
}
