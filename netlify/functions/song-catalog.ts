import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { db } from "../../db/index.js";
import { dreamweaverSongReviews, songs, songVersions } from "../../db/schema.js";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 80_000;
const RIGHTS_STATUSES = new Set(["needs_review", "cleared", "disputed"]);
const SALE_STATUSES = new Set(["for_sale", "not_for_sale", "coming_soon"]);
const MASTERING_STATUSES = new Set(["not_started", "queued", "in_progress", "review", "approved"]);
const VERSION_ROUTES = {
  sale_master: { label: "Sale master", destination: "storefront", targetLufs: -14, saleEnabled: true },
  radio_edit: { label: "Radio edit", destination: "radio", targetLufs: -16, saleEnabled: false },
  clean: { label: "Clean radio edit", destination: "radio", targetLufs: -16, saleEnabled: false },
  instrumental: { label: "Instrumental", destination: "licensing", targetLufs: -14, saleEnabled: true },
  stems: { label: "Stems package", destination: "stem_vault", targetLufs: -14, saleEnabled: true },
  extended: { label: "Extended mix", destination: "dj_pool", targetLufs: -14, saleEnabled: true },
  demo: { label: "Demo", destination: "archive", targetLufs: -14, saleEnabled: false },
  alternate: { label: "Alternate version", destination: "storefront", targetLufs: -14, saleEnabled: true },
} as const;

type VersionType = keyof typeof VERSION_ROUTES;
type ReviewIssue = { field: string; level: "required" | "warning"; message: string };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value: unknown) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanEnum(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 1200);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanVersionType(value: unknown): VersionType {
  const type = String(value || "").trim().toLowerCase() as VersionType;
  return VERSION_ROUTES[type] ? type : "alternate";
}

function serializeSong(song: typeof songs.$inferSelect, versions: Array<typeof songVersions.$inferSelect>) {
  return {
    id: song.id,
    sourceReleaseId: song.sourceReleaseId || "",
    artistName: song.artistName,
    title: song.title,
    albumTitle: song.albumTitle,
    isrc: song.isrc,
    upc: song.upc,
    genre: song.genre,
    explicitLyrics: song.explicitLyrics,
    rightsStatus: song.rightsStatus,
    saleStatus: song.saleStatus,
    salePriceCents: song.salePriceCents,
    currency: song.currency,
    notes: song.notes,
    metadataStatus: song.metadataStatus,
    metadataScore: song.metadataScore,
    metadataIssues: Array.isArray(song.metadataIssues) ? song.metadataIssues : [],
    reviewedAt: song.reviewedAt?.toISOString() || "",
    artworkUrl: song.artworkUrl || "",
    artworkUploadedAt: song.artworkUploadedAt?.toISOString() || "",
    versions: versions.map(version => ({
      id: version.id,
      versionType: version.versionType,
      label: version.label,
      destination: version.destination,
      audioUrl: version.audioUrl,
      audioFilename: version.audioFilename,
      audioByteSize: version.audioByteSize,
      durationSeconds: version.durationSeconds,
      masteringStatus: version.masteringStatus,
      targetLufs: version.targetLufs,
      truePeakDbtp: version.truePeakDbtpTenths / 10,
      cleanLyrics: version.cleanLyrics,
      saleEnabled: version.saleEnabled,
      notes: version.notes,
      artworkUrl: version.artworkUrl || "",
      artworkUploadedAt: version.artworkUploadedAt?.toISOString() || "",
    })),
    updatedAt: song.updatedAt.toISOString(),
  };
}

async function loadCatalog(ownerMemberId: string) {
  const songRows = await db.select().from(songs)
    .where(and(eq(songs.ownerMemberId, ownerMemberId), eq(songs.status, "active")))
    .orderBy(desc(songs.updatedAt));
  const ids = songRows.map(song => song.id);
  const versionRows = ids.length
    ? await db.select().from(songVersions).where(and(inArray(songVersions.songId, ids), eq(songVersions.status, "active"))).orderBy(desc(songVersions.updatedAt))
    : [];
  const versionsBySong = new Map<string, Array<typeof songVersions.$inferSelect>>();
  versionRows.forEach(version => versionsBySong.set(version.songId, [...(versionsBySong.get(version.songId) || []), version]));
  return songRows.map(song => serializeSong(song, versionsBySong.get(song.id) || []));
}

async function loadProducer(nativeDb: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const [jobs, packageRows, trackRows] = await Promise.all([
    nativeDb.sql`
      SELECT id, status, stage, progress, package_count, error_message, created_at, completed_at
      FROM halo_catalog_producer_jobs
      WHERE owner_member_id = ${ownerMemberId}
      ORDER BY created_at DESC
      LIMIT 5
    `,
    nativeDb.sql`
      SELECT id, package_type, title, description, rationale, price_cents, currency,
        projected_monthly_net_cents, track_count, status, signals, created_at, updated_at
      FROM halo_catalog_packages
      WHERE owner_member_id = ${ownerMemberId} AND status <> 'archived'
      ORDER BY CASE status WHEN 'published' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, updated_at DESC
      LIMIT 24
    `,
    nativeDb.sql`
      SELECT package_track.package_id, package_track.position, package_track.engagement_score,
        song.id AS song_id, song.artist_name, song.title
      FROM halo_catalog_package_tracks package_track
      JOIN halo_catalog_packages package ON package.id = package_track.package_id
      JOIN halo_song_catalog song ON song.id = package_track.song_id
      WHERE package.owner_member_id = ${ownerMemberId} AND package.status <> 'archived'
      ORDER BY package_track.package_id, package_track.position
    `,
  ]);
  const tracksByPackage = new Map<string, Array<Record<string, unknown>>>();
  trackRows.forEach(row => tracksByPackage.set(row.package_id, [...(tracksByPackage.get(row.package_id) || []), {
    id: row.song_id, artistName: row.artist_name, title: row.title,
    position: Number(row.position), engagementScore: Number(row.engagement_score || 0),
  }]));
  return {
    jobs: jobs.map(job => ({
      id: job.id, status: job.status, stage: job.stage, progress: Number(job.progress || 0),
      packageCount: Number(job.package_count || 0), errorMessage: job.error_message || "",
      createdAt: new Date(job.created_at).toISOString(), completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : "",
    })),
    packages: packageRows.map(row => ({
      id: row.id, packageType: row.package_type, title: row.title, description: row.description,
      rationale: row.rationale, priceCents: Number(row.price_cents), currency: row.currency,
      projectedMonthlyNetCents: Number(row.projected_monthly_net_cents || 0), trackCount: Number(row.track_count || 0),
      status: row.status, signals: row.signals && typeof row.signals === "object" ? row.signals : {},
      tracks: tracksByPackage.get(row.id) || [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    })),
  };
}

async function queueProducer(nativeDb: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const active = await nativeDb.sql`
    SELECT id FROM halo_catalog_producer_jobs
    WHERE owner_member_id = ${ownerMemberId} AND status IN ('queued', 'working')
    ORDER BY created_at DESC LIMIT 1
  `;
  if (active.length) return json({ message: "Dreamweaver is already building catalog packages", jobId: active[0].id, queued: false });
  const jobId = randomUUID();
  await nativeDb.sql`INSERT INTO halo_catalog_producer_jobs (id, owner_member_id) VALUES (${jobId}, ${ownerMemberId})`;
  return json({ message: "Dreamweaver started a background catalog run", jobId, queued: true }, 202);
}

async function updatePackageStatus(nativeDb: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, payload: Record<string, unknown>) {
  const packageId = cleanId(payload.packageId);
  const status = cleanEnum(payload.status, new Set(["draft", "approved", "published", "archived"]), "draft");
  if (!packageId) return json({ message: "Choose a valid catalog package" }, 400);
  const rows = status === "approved"
    ? await nativeDb.sql`UPDATE halo_catalog_packages SET status = 'approved', updated_at = NOW() WHERE id = ${packageId} AND owner_member_id = ${ownerMemberId} AND status = 'draft' RETURNING id`
    : status === "published"
      ? await nativeDb.sql`UPDATE halo_catalog_packages SET status = 'published', updated_at = NOW() WHERE id = ${packageId} AND owner_member_id = ${ownerMemberId} AND status = 'approved' RETURNING id`
      : status === "archived"
        ? await nativeDb.sql`UPDATE halo_catalog_packages SET status = 'archived', updated_at = NOW() WHERE id = ${packageId} AND owner_member_id = ${ownerMemberId} RETURNING id`
        : await nativeDb.sql`UPDATE halo_catalog_packages SET status = 'draft', updated_at = NOW() WHERE id = ${packageId} AND owner_member_id = ${ownerMemberId} AND status = 'approved' RETURNING id`;
  if (!rows.length) return json({ message: "That package is missing or its approval step is out of order" }, 409);
  const label = status === "approved" ? "approved for storefront setup" : status === "published" ? "marked published" : status === "archived" ? "archived" : "returned to draft";
  return json({ message: `Catalog package ${label}`, packageId });
}

export async function runDreamweaverReview(songId: string, ownerMemberId: string) {
  const [song] = await db.select().from(songs).where(and(eq(songs.id, songId), eq(songs.ownerMemberId, ownerMemberId))).limit(1);
  if (!song) return;
  const versions = await db.select().from(songVersions).where(and(eq(songVersions.songId, songId), eq(songVersions.status, "active")));
  const issues: ReviewIssue[] = [];
  if (!song.genre) issues.push({ field: "genre", level: "warning", message: "Add the primary genre so stores and radio can route the song correctly." });
  if (!song.isrc) issues.push({ field: "isrc", level: "warning", message: "Add the ISRC before final distribution and reporting." });
  if (song.rightsStatus !== "cleared") issues.push({ field: "rightsStatus", level: "required", message: "Confirm ownership, samples, features, and splits before release." });
  if (song.saleStatus === "for_sale" && (!song.salePriceCents || song.salePriceCents < 1)) issues.push({ field: "salePriceCents", level: "required", message: "Set a sale price for this song." });

  const saleMaster = versions.find(version => version.versionType === "sale_master");
  if (!saleMaster) issues.push({ field: "sale_master", level: "required", message: "Add a sale master version." });
  else if (!saleMaster.audioUrl) issues.push({ field: "sale_master_audio", level: "required", message: "Connect the approved sale master audio source." });

  const radioVersions = versions.filter(version => ["radio_edit", "clean"].includes(version.versionType));
  if (!radioVersions.length) issues.push({ field: "radio_edit", level: "required", message: "Add a radio edit or clean radio version." });
  else {
    if (!radioVersions.some(version => version.audioUrl)) issues.push({ field: "radio_audio", level: "required", message: "Connect audio for at least one radio version." });
    if (!radioVersions.some(version => version.masteringStatus === "approved")) issues.push({ field: "radio_master", level: "required", message: "Queue and approve a dedicated radio master." });
  }

  if (!versions.some(version => version.versionType === "instrumental")) issues.push({ field: "instrumental", level: "warning", message: "Add an instrumental for licensing, performance, and broadcast flexibility." });
  if (!versions.some(version => version.versionType === "stems")) issues.push({ field: "stems", level: "warning", message: "Add a stems package for approved remix and production work." });

  const requiredCount = issues.filter(issue => issue.level === "required").length;
  const warningCount = issues.length - requiredCount;
  const score = Math.max(0, 100 - requiredCount * 16 - warningCount * 6);
  const metadataStatus = requiredCount ? "needs_attention" : warningCount ? "reviewed" : "ready";
  const summary = requiredCount
    ? `Dream Weaver found ${requiredCount} blocking item${requiredCount === 1 ? "" : "s"} and ${warningCount} recommendation${warningCount === 1 ? "" : "s"}.`
    : warningCount ? `Dream Weaver cleared the song with ${warningCount} recommendation${warningCount === 1 ? "" : "s"}.` : "Dream Weaver confirmed the song and every routed version are ready.";
  const now = new Date();

  await db.transaction(async transaction => {
    await transaction.update(songs).set({ metadataStatus, metadataScore: score, metadataIssues: issues, reviewedAt: now, updatedAt: now }).where(eq(songs.id, songId));
    await transaction.insert(dreamweaverSongReviews).values({
      id: randomUUID(), songId, ownerMemberId, status: "completed", score, issues, summary, completedAt: now,
    });
  });
}

async function createDefaultVersions(songId: string) {
  await db.insert(songVersions).values((Object.entries(VERSION_ROUTES) as Array<[VersionType, typeof VERSION_ROUTES[VersionType]]>).map(([versionType, route]) => ({
    id: randomUUID(), songId, versionType, label: route.label, destination: route.destination,
    targetLufs: route.targetLufs, saleEnabled: route.saleEnabled, cleanLyrics: versionType === "clean",
  })));
}

async function createSong(ownerMemberId: string, payload: Record<string, unknown>) {
  const artistName = cleanText(payload.artistName, 120);
  const title = cleanText(payload.title, 160);
  if (!artistName || !title) return json({ message: "Add the artist and song title" }, 400);
  const id = randomUUID();
  await db.insert(songs).values({
    id, ownerMemberId, artistName, title,
    albumTitle: cleanText(payload.albumTitle, 160), genre: cleanText(payload.genre, 80),
    isrc: cleanText(payload.isrc, 24).toUpperCase(), upc: cleanText(payload.upc, 24),
    rightsStatus: cleanEnum(payload.rightsStatus, RIGHTS_STATUSES, "needs_review"),
    saleStatus: cleanEnum(payload.saleStatus, SALE_STATUSES, "for_sale"),
    salePriceCents: Math.max(0, Math.min(10_000_000, Number.parseInt(String(payload.salePriceCents || "0"), 10) || 0)) || null,
    explicitLyrics: payload.explicitLyrics === true, notes: cleanText(payload.notes, 4000),
  });
  await createDefaultVersions(id);
  await runDreamweaverReview(id, ownerMemberId);
  return json({ message: "Song added with every standard version route", songId: id }, 201);
}

async function saveSong(ownerMemberId: string, payload: Record<string, unknown>) {
  const id = cleanId(payload.songId);
  const artistName = cleanText(payload.artistName, 120);
  const title = cleanText(payload.title, 160);
  if (!id || !artistName || !title) return json({ message: "Choose a valid song and add its artist and title" }, 400);
  const rows = await db.update(songs).set({
    artistName, title, albumTitle: cleanText(payload.albumTitle, 160), genre: cleanText(payload.genre, 80),
    isrc: cleanText(payload.isrc, 24).toUpperCase(), upc: cleanText(payload.upc, 24),
    rightsStatus: cleanEnum(payload.rightsStatus, RIGHTS_STATUSES, "needs_review"),
    saleStatus: cleanEnum(payload.saleStatus, SALE_STATUSES, "for_sale"),
    salePriceCents: Math.max(0, Math.min(10_000_000, Number.parseInt(String(payload.salePriceCents || "0"), 10) || 0)) || null,
    explicitLyrics: payload.explicitLyrics === true, notes: cleanText(payload.notes, 4000), updatedAt: new Date(),
  }).where(and(eq(songs.id, id), eq(songs.ownerMemberId, ownerMemberId), eq(songs.status, "active"))).returning({ id: songs.id });
  if (!rows.length) return json({ message: "That song was not found" }, 404);
  await runDreamweaverReview(id, ownerMemberId);
  return json({ message: "Song saved and Dream Weaver reviewed it", songId: id });
}

async function saveVersion(ownerMemberId: string, payload: Record<string, unknown>) {
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  const [ownedSong] = await db.select({ id: songs.id }).from(songs).where(and(eq(songs.id, songId), eq(songs.ownerMemberId, ownerMemberId))).limit(1);
  if (!ownedSong || !versionId) return json({ message: "Choose a valid song version" }, 400);
  const versionType = cleanVersionType(payload.versionType);
  const route = VERSION_ROUTES[versionType];
  const rows = await db.update(songVersions).set({
    versionType, label: cleanText(payload.label, 100) || route.label,
    destination: route.destination, audioUrl: cleanUrl(payload.audioUrl),
    durationSeconds: Math.max(0, Math.min(86_400, Number.parseInt(String(payload.durationSeconds || "0"), 10) || 0)),
    masteringStatus: cleanEnum(payload.masteringStatus, MASTERING_STATUSES, "not_started"),
    targetLufs: Math.max(-30, Math.min(-5, Number.parseInt(String(payload.targetLufs || route.targetLufs), 10) || route.targetLufs)),
    truePeakDbtpTenths: Math.max(-100, Math.min(0, Math.round(Number(payload.truePeakDbtp ?? -1) * 10))),
    cleanLyrics: payload.cleanLyrics === true, saleEnabled: payload.saleEnabled === true,
    notes: cleanText(payload.notes, 2000), updatedAt: new Date(),
  }).where(and(eq(songVersions.id, versionId), eq(songVersions.songId, songId))).returning({ id: songVersions.id });
  if (!rows.length) return json({ message: "That version was not found" }, 404);
  await runDreamweaverReview(songId, ownerMemberId);
  return json({ message: "Version routed and Dream Weaver reviewed the song", songId });
}

async function importExisting(nativeDb: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, includeLegacyReleases = false) {
  const releases = includeLegacyReleases
    ? await nativeDb.sql`
        SELECT id, title, artist, genres, content_rating
        FROM halo_release_campaigns
        WHERE (owner_member_id = ${ownerMemberId} OR owner_member_id IS NULL) AND status <> 'archived'
        ORDER BY updated_at DESC
        LIMIT 300
      `
    : await nativeDb.sql`
        SELECT id, title, artist, genres, content_rating
        FROM halo_release_campaigns
        WHERE owner_member_id = ${ownerMemberId} AND status <> 'archived'
        ORDER BY updated_at DESC
        LIMIT 300
      `;
  let imported = 0;
  for (const release of releases) {
    const existing = await db.select({ id: songs.id }).from(songs).where(and(eq(songs.ownerMemberId, ownerMemberId), eq(songs.sourceReleaseId, release.id))).limit(1);
    if (existing.length) continue;
    const id = randomUUID();
    await db.insert(songs).values({
      id, ownerMemberId, sourceReleaseId: release.id, artistName: release.artist, title: release.title,
      genre: Array.isArray(release.genres) ? release.genres[0] || "" : "",
      explicitLyrics: release.content_rating === "explicit", saleStatus: "for_sale",
    });
    await createDefaultVersions(id);
    await runDreamweaverReview(id, ownerMemberId);
    imported += 1;
  }
  const message = imported
    ? `${imported} existing song${imported === 1 ? "" : "s"} loaded into the catalog`
    : releases.length ? "Every existing song is already loaded" : "No HALO releases are available to load yet";
  return json({ message, imported });
}

export default async function songCatalogHandler(request: Request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [nativeDb, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return request.method === "GET" ? json({ authenticated: false, songs: [] }) : json({ message: "Join or sign in to manage the song catalog" }, 401);
    const membership = await ensureMembership(nativeDb, user);
    if (request.method === "GET") {
      const [catalog, producer] = await Promise.all([loadCatalog(membership.member_id), loadProducer(nativeDb, membership.member_id)]);
      return json({ authenticated: true, viewer: { name: membership.display_name }, songs: catalog, producer });
    }

    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin catalog actions are not accepted" }, 403); }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This catalog update is too large" }, 413);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);
    if (payload.action === "create_song") return createSong(membership.member_id, payload);
    if (payload.action === "save_song") return saveSong(membership.member_id, payload);
    if (payload.action === "save_version") return saveVersion(membership.member_id, payload);
    if (payload.action === "import_existing") {
      const includeLegacyReleases = membership.tier === "founder" || membership.source === "owner";
      return importExisting(nativeDb, membership.member_id, includeLegacyReleases);
    }
    if (payload.action === "queue_catalog_producer") return queueProducer(nativeDb, membership.member_id);
    if (payload.action === "set_package_status") return updatePackageStatus(nativeDb, membership.member_id, payload);
    if (payload.action === "review_song") {
      const songId = cleanId(payload.songId);
      if (!songId) return json({ message: "Choose a valid song" }, 400);
      await runDreamweaverReview(songId, membership.member_id);
      return json({ message: "Dream Weaver review completed", songId });
    }
    return json({ message: "Choose a supported catalog action" }, 400);
  } catch (error) {
    console.error("Song catalog request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The song catalog is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/song-catalog" };
