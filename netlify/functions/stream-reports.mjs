import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { MAX_REPORT_BYTES, PLATFORM_LABELS, REPORT_SOURCES, parseStreamReport } from "../lib/stream-reports.mjs";

// Artist stream reports: artists upload the CSV/TSV statements their distributor or the
// Spotify for Artists / Apple Music for Artists dashboards give them, and HALO turns them into
// real per-track, per-platform play counts. Every number comes from a file the artist supplied;
// nothing is crawled or estimated. Each artist only ever sees their own reports.
const DISTRIBUTOR_SOURCES = Object.keys(REPORT_SOURCES).filter(key => !REPORT_SOURCES[key].defaultPlatform);
const REPORT_ID = /^[0-9a-f-]{36}$/;
const HOURLY_UPLOAD_LIMIT = 30;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

const number = value => Number(value || 0);
const isoDate = value => (value ? new Date(value).toISOString().slice(0, 10) : null);

function serialiseReport(row) {
  return {
    id: row.id,
    source: row.source,
    sourceLabel: REPORT_SOURCES[row.source]?.label || row.source,
    fileName: row.file_name,
    rowsRead: number(row.rows_read),
    rowsSkipped: number(row.rows_skipped),
    totalStreams: number(row.total_streams),
    totalDownloads: number(row.total_downloads),
    totalEarnings: row.total_earnings === null ? null : number(row.total_earnings),
    currency: row.currency,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    matchedLines: number(row.matched_lines),
    lineCount: number(row.line_count),
    uploadedAt: new Date(row.created_at).toISOString()
  };
}

async function loadSummary(db, memberId) {
  const [reports, byPlatform, byMonth, topTracks, dashboards] = await Promise.all([
    db.sql`
      SELECT r.*, (SELECT COUNT(*) FROM halo_stream_report_lines l WHERE l.report_id = r.id AND l.song_id IS NOT NULL) AS matched_lines
      FROM halo_stream_reports r
      WHERE r.member_id = ${memberId}
      ORDER BY r.period_end DESC NULLS LAST, r.created_at DESC
      LIMIT 200
    `,
    db.sql`
      SELECT l.platform, SUM(l.streams) AS streams, SUM(l.downloads) AS downloads, SUM(l.earnings) AS earnings
      FROM halo_stream_report_lines l JOIN halo_stream_reports r ON r.id = l.report_id
      WHERE l.member_id = ${memberId} AND r.source NOT IN ('spotify_for_artists', 'apple_music_for_artists')
      GROUP BY l.platform
      ORDER BY SUM(l.streams) DESC
    `,
    db.sql`
      SELECT l.period_month, SUM(l.streams) AS streams
      FROM halo_stream_report_lines l JOIN halo_stream_reports r ON r.id = l.report_id
      WHERE l.member_id = ${memberId} AND r.source NOT IN ('spotify_for_artists', 'apple_music_for_artists') AND l.period_month IS NOT NULL
      GROUP BY l.period_month
      ORDER BY l.period_month DESC
      LIMIT 24
    `,
    db.sql`
      SELECT COALESCE(NULLIF(l.isrc, ''), LOWER(l.track_title)) AS track_key,
        MAX(l.track_title) AS title, MAX(l.artist_name) AS artist, MAX(l.isrc) AS isrc, MAX(l.song_id) AS song_id,
        SUM(l.streams) AS streams, SUM(l.downloads) AS downloads, SUM(l.earnings) AS earnings,
        STRING_AGG(DISTINCT l.platform, ',') AS platforms
      FROM halo_stream_report_lines l JOIN halo_stream_reports r ON r.id = l.report_id
      WHERE l.member_id = ${memberId} AND r.source NOT IN ('spotify_for_artists', 'apple_music_for_artists')
      GROUP BY 1
      ORDER BY SUM(l.streams) DESC
      LIMIT 50
    `,
    db.sql`
      -- Dashboard exports usually cover rolling date ranges, so only the latest export per platform is shown.
      SELECT l.platform, MAX(r.file_name) AS file_name, MAX(r.created_at) AS uploaded_at, COUNT(DISTINCT COALESCE(NULLIF(l.isrc, ''), LOWER(l.track_title))) AS tracks, SUM(l.streams) AS streams,
        MIN(r.period_start) AS period_start, MAX(r.period_end) AS period_end
      FROM halo_stream_report_lines l JOIN halo_stream_reports r ON r.id = l.report_id
      WHERE l.member_id = ${memberId} AND r.id IN (
        SELECT DISTINCT ON (source) id FROM halo_stream_reports
        WHERE member_id = ${memberId} AND source IN ('spotify_for_artists', 'apple_music_for_artists')
        ORDER BY source, created_at DESC
      )
      GROUP BY l.platform
    `
  ]);

  const distributorCurrencies = new Set(reports.filter(row => DISTRIBUTOR_SOURCES.includes(row.source) && row.currency).map(row => row.currency));
  const currency = distributorCurrencies.size === 1 ? [...distributorCurrencies][0] : "";
  return {
    reports: reports.map(serialiseReport),
    distributor: {
      // Earnings are only totalled when every distributor report uses the same currency.
      currency,
      byPlatform: byPlatform.map(row => ({
        platform: row.platform,
        label: PLATFORM_LABELS[row.platform] || row.platform,
        streams: number(row.streams),
        downloads: number(row.downloads),
        earnings: currency ? Math.round(number(row.earnings) * 100) / 100 : null
      })),
      byMonth: byMonth.map(row => ({ month: isoDate(row.period_month).slice(0, 7), streams: number(row.streams) })).reverse(),
      topTracks: topTracks.map(row => ({
        title: row.title,
        artist: row.artist,
        isrc: row.isrc,
        songId: row.song_id,
        streams: number(row.streams),
        downloads: number(row.downloads),
        earnings: currency ? Math.round(number(row.earnings) * 100) / 100 : null,
        platforms: String(row.platforms || "").split(",").filter(Boolean).map(platform => PLATFORM_LABELS[platform] || platform)
      }))
    },
    dashboards: dashboards.map(row => ({
      platform: row.platform,
      label: PLATFORM_LABELS[row.platform] || row.platform,
      tracks: number(row.tracks),
      streams: number(row.streams),
      periodStart: isoDate(row.period_start),
      periodEnd: isoDate(row.period_end),
      fileName: row.file_name,
      uploadedAt: new Date(row.uploaded_at).toISOString()
    })),
    sources: Object.entries(REPORT_SOURCES).map(([value, info]) => ({ value, label: info.label, dashboard: Boolean(info.defaultPlatform) }))
  };
}

// Links report lines to the artist's own HALO Song Catalog entries: by ISRC first, then by exact title.
async function matchSongs(db, reportId, memberId) {
  await db.sql`
    UPDATE halo_stream_report_lines l SET song_id = s.id
    FROM halo_song_catalog s
    WHERE l.report_id = ${reportId} AND l.isrc <> '' AND s.owner_member_id = ${memberId} AND UPPER(s.isrc) = l.isrc
  `;
  await db.sql`
    UPDATE halo_stream_report_lines l SET song_id = (
      SELECT s.id FROM halo_song_catalog s
      WHERE s.owner_member_id = ${memberId} AND LOWER(s.title) = LOWER(l.track_title)
      ORDER BY s.updated_at DESC LIMIT 1
    )
    WHERE l.report_id = ${reportId} AND l.song_id IS NULL AND l.track_title <> ''
  `;
}

async function handleUpload(db, memberId, request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_REPORT_BYTES + 64 * 1024) return json({ message: "Reports must be 5 MB or smaller. Split the export by month and upload each part." }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("report");
  if (!file || typeof file === "string") return json({ message: "Choose a CSV or TSV report to upload" }, 400);
  if (file.size > MAX_REPORT_BYTES) return json({ message: "Reports must be 5 MB or smaller. Split the export by month and upload each part." }, 413);
  const source = cleanText(form.get("source"), 40);
  if (!REPORT_SOURCES[source]) return json({ message: "Choose where this report came from" }, 422);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return json({ message: "This looks like an Excel or ZIP file. Export or save it as CSV first." }, 422);
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return json({ message: "PDF statements can't be read. Download the CSV or TSV version of the report." }, 422);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.sql`SELECT id FROM halo_stream_reports WHERE member_id = ${memberId} AND file_sha256 = ${sha256} LIMIT 1`;
  if (existing.length) return json({ message: "This exact file has already been imported, so it wasn't counted again." }, 409);

  const recent = await db.sql`SELECT COUNT(*) AS total FROM halo_stream_reports WHERE member_id = ${memberId} AND created_at >= NOW() - INTERVAL '1 hour'`;
  if (number(recent[0]?.total) >= HOURLY_UPLOAD_LIMIT) return json({ message: "You've uploaded a lot of reports this hour. Try again later." }, 429);

  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = parseStreamReport(text, { source, fallbackMonth: cleanText(form.get("periodMonth"), 20) });
  if (parsed.error) return json({ message: parsed.error }, 422);
  const { lines, stats } = parsed;

  // A second report from the same source covering the same months would double count plays.
  if (stats.periodStart && stats.periodEnd) {
    const overlapping = await db.sql`
      SELECT file_name, period_start, period_end FROM halo_stream_reports
      WHERE member_id = ${memberId} AND source = ${source}
        AND period_start <= ${stats.periodEnd}::date AND period_end >= ${stats.periodStart}::date
      ORDER BY created_at DESC LIMIT 1
    `;
    if (overlapping.length) {
      const other = overlapping[0];
      return json({
        message: `You already imported a ${REPORT_SOURCES[source].label} report covering ${isoDate(other.period_start).slice(0, 7)} to ${isoDate(other.period_end).slice(0, 7)} ("${other.file_name}"). Delete it first if this file replaces it, so plays aren't counted twice.`
      }, 409);
    }
  }

  const reportId = randomUUID();
  const fileName = cleanText(file.name, 200) || "report.csv";
  const payload = JSON.stringify(lines.map(line => ({
    platform: line.platform,
    store_name: line.storeName.slice(0, 120),
    isrc: line.isrc,
    track_title: line.trackTitle.slice(0, 200),
    artist_name: line.artistName.slice(0, 200),
    country: line.country,
    period_month: line.periodMonth,
    streams: line.streams,
    downloads: line.downloads,
    earnings: line.earnings
  })));

  // One statement, so a report is never saved without its lines.
  await db.sql`
    WITH report AS (
      INSERT INTO halo_stream_reports (
        id, member_id, source, file_name, file_sha256, rows_read, rows_skipped, line_count,
        total_streams, total_downloads, total_earnings, currency, period_start, period_end
      ) VALUES (
        ${reportId}, ${memberId}, ${source}, ${fileName}, ${sha256}, ${stats.rowsRead}, ${stats.rowsSkipped}, ${lines.length},
        ${stats.totalStreams}, ${stats.totalDownloads}, ${stats.hasEarnings ? stats.totalEarnings : null}, ${stats.currency === "MIXED" ? "" : stats.currency},
        ${stats.periodStart}::date, ${stats.periodEnd}::date
      )
      RETURNING id
    )
    INSERT INTO halo_stream_report_lines (
      report_id, member_id, platform, store_name, isrc, track_title, artist_name, country, period_month, streams, downloads, earnings
    )
    SELECT report.id, ${memberId}, x.platform, x.store_name, x.isrc, x.track_title, x.artist_name, x.country,
      x.period_month, x.streams, x.downloads, x.earnings
    FROM report, jsonb_to_recordset(${payload}::jsonb) AS x(
      platform text, store_name text, isrc text, track_title text, artist_name text, country text,
      period_month date, streams bigint, downloads bigint, earnings numeric
    )
  `;

  try {
    await matchSongs(db, reportId, memberId);
  } catch (error) {
    console.error("Stream report song matching failed", error instanceof Error ? error.message : "unknown error");
  }

  return json({
    imported: {
      reportId,
      rowsRead: stats.rowsRead,
      rowsSkipped: stats.rowsSkipped,
      rowsWithoutMonth: stats.rowsWithoutMonth,
      totalStreams: stats.totalStreams,
      totalDownloads: stats.totalDownloads,
      platforms: stats.platforms.map(platform => PLATFORM_LABELS[platform] || platform),
      periodStart: stats.periodStart,
      periodEnd: stats.periodEnd,
      mixedCurrencies: stats.currency === "MIXED"
    },
    ...(await loadSummary(db, memberId))
  }, 201);
}

export default async function streamReports(request) {
  if (!["GET", "POST", "DELETE"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in to see your stream reports" }, 401);
    const membership = await ensureMembership(db, user);
    const memberId = membership.member_id;

    if (request.method === "GET") return json(await loadSummary(db, memberId));

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin requests are not accepted" }, 403);
    }

    if (request.method === "DELETE") {
      const id = cleanText(new URL(request.url).searchParams.get("id"), 40);
      if (!REPORT_ID.test(id)) return json({ message: "Report not found" }, 404);
      const rows = await db.sql`DELETE FROM halo_stream_reports WHERE id = ${id} AND member_id = ${memberId} RETURNING id`;
      if (!rows.length) return json({ message: "Report not found" }, 404);
      return json(await loadSummary(db, memberId));
    }

    if (!(request.headers.get("content-type") || "").includes("multipart/form-data")) return json({ message: "Upload the report as a file" }, 415);
    return await handleUpload(db, memberId, request);
  } catch (error) {
    console.error("HALO stream report request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Stream reports aren't available right now. Try again shortly." }, 500);
  }
}

export const config = { path: "/api/stream-reports" };
