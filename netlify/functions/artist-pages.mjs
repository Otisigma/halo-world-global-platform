import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { resolveReleaseArtworkFields } from "../lib/release-artwork.mjs";

const allowedStatuses = new Set(["draft", "published"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanLongText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function cleanUrl(value, maxLength = 1000) {
  const raw = cleanText(value, maxLength);
  if (!raw) return "";
  try {
    let candidate = raw;
    if (raw.startsWith("//")) candidate = `https:${raw}`;
    else if (!raw.startsWith("/") && !/^https?:\/\//i.test(raw)) {
      if (!/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$)/i.test(raw)) return "";
      candidate = `https://${raw}`;
    }
    const parsed = new URL(candidate, "https://halo.world");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    if (raw.startsWith("/")) return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, maxLength);
    return parsed.toString().slice(0, maxLength);
  } catch {
    return "";
  }
}

function cleanDate(value) {
  const raw = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function slugify(value) {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function dateOnly(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function cleanColor(value) {
  const color = cleanText(value, 7);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#d5ff52";
}

function releaseCatalogId(artistName, releaseTitle) {
  return slugify(`${artistName}-${releaseTitle}`);
}

async function syncCatalogRelease(db, membership, artistSlug, artistName, values, urls, status) {
  if (status !== "published" || !values.releaseTitle) return null;
  const generatedId = releaseCatalogId(artistName, values.releaseTitle);
  if (generatedId.length < 2) return null;
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: urls.artworkUrl,
    importedArtworkUrl: urls.artworkUrl,
    fallbackArtwork: ""
  });
  const existingRows = await db.sql`
    SELECT id FROM halo_release_campaigns
    WHERE owner_member_id = ${membership.member_id}
      AND (id = ${generatedId} OR (${urls.releaseUrl} <> '' AND official_url = ${urls.releaseUrl}))
    ORDER BY CASE WHEN id = ${generatedId} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  const id = existingRows[0]?.id || generatedId;
  const today = new Date().toISOString().slice(0, 10);
  const releaseStage = urls.releaseUrl ? "released" : values.releaseDate && values.releaseDate > today ? "scheduled" : "unreleased";
  const defaultKitUrl = audience => `/release-kit.html?slug=${encodeURIComponent(id)}&audience=${audience}`;
  const artistRoomUrl = `/artists/${encodeURIComponent(artistSlug)}`;
  const rows = await db.sql`
    INSERT INTO halo_release_campaigns (
      id, owner_member_id, artist_slug, title, artist, release_date, artwork_url, imported_artwork_url, official_url,
      dj_url, radio_url, press_url, preview_url, pitch, press_description,
      available_versions, release_stage, visibility, status
    ) VALUES (
      ${id}, ${membership.member_id}, ${artistSlug}, ${values.releaseTitle}, ${artistName}, ${values.releaseDate},
      ${artwork.artwork}, ${artwork.importedArtwork}, ${urls.releaseUrl}, ${urls.djRoomUrl || defaultKitUrl("dj")},
      ${urls.radioRoomUrl || defaultKitUrl("radio")}, ${urls.pressRoomUrl || defaultKitUrl("press")},
      ${urls.videoUrl}, ${values.tagline || `Open ${values.releaseTitle} by ${artistName} across HALO.`},
      ${values.bio}, ${[urls.releaseUrl ? "Official listening link" : "Private HALO release", artistRoomUrl, "DJ, radio, and press rooms"]},
      ${releaseStage}, 'public', 'published'
    )
    ON CONFLICT (id) DO UPDATE SET
      artist_slug = EXCLUDED.artist_slug,
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      release_date = EXCLUDED.release_date,
      imported_artwork_url = COALESCE(NULLIF(EXCLUDED.imported_artwork_url, ''), halo_release_campaigns.imported_artwork_url),
      artwork_url = COALESCE(
        NULLIF(halo_release_campaigns.artwork_override_url, ''),
        NULLIF(EXCLUDED.imported_artwork_url, ''),
        NULLIF(halo_release_campaigns.imported_artwork_url, ''),
        EXCLUDED.artwork_url,
        halo_release_campaigns.artwork_url
      ),
      official_url = EXCLUDED.official_url,
      dj_url = EXCLUDED.dj_url,
      radio_url = EXCLUDED.radio_url,
      press_url = EXCLUDED.press_url,
      preview_url = EXCLUDED.preview_url,
      pitch = EXCLUDED.pitch,
      press_description = EXCLUDED.press_description,
      available_versions = EXCLUDED.available_versions,
      release_stage = EXCLUDED.release_stage,
      visibility = EXCLUDED.visibility,
      status = 'published',
      updated_at = NOW()
    WHERE halo_release_campaigns.owner_member_id = ${membership.member_id}
    RETURNING id
  `;
  return rows[0]?.id || null;
}

async function ensureStarterPlan(db, artistSlug, ownerMemberId, status) {
  if (status !== "published") return false;
  const rows = await db.sql`
    INSERT INTO halo_artist_agent_plans (
      artist_slug, plan_tier, status, enabled_agents, monthly_run_allowance, activated_by_member_id
    ) VALUES (
      ${artistSlug}, 'starter', 'active', '["scout", "circle"]'::jsonb, 4, ${ownerMemberId}
    )
    ON CONFLICT (artist_slug) DO NOTHING
    RETURNING artist_slug
  `;
  return Boolean(rows.length);
}

function serializePage(row, viewerCanEdit = false) {
  return {
    slug: row.slug,
    artistName: row.artist_name,
    tagline: row.tagline || "",
    bio: row.bio || "",
    location: row.location || "",
    accentColor: row.accent_color || "#d5ff52",
    artworkUrl: row.artwork_url || "",
    releaseTitle: row.release_title || "",
    releaseDate: dateOnly(row.release_date),
    releaseUrl: row.release_url || "",
    videoTitle: row.video_title || "",
    videoUrl: row.video_url || "",
    communityUrl: row.community_url || "",
    djRoomUrl: row.dj_room_url || "",
    radioRoomUrl: row.radio_room_url || "",
    pressRoomUrl: row.press_room_url || "",
    bookingUrl: row.booking_url || "",
    websiteUrl: row.website_url || "",
    status: viewerCanEdit ? row.status : "published",
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function viewerName(user) {
  return user?.name || user?.userMetadata?.full_name || "HALO artist";
}

async function loadPage(db, user, slug) {
  const rows = await db.sql`SELECT * FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  const membership = user?.id ? await ensureMembership(db, user) : null;
  const canEdit = Boolean(user?.id && (isOwner(user) || row.owner_member_id === membership?.member_id));
  if (row.status !== "published" && !canEdit) return null;
  const releaseId = row.current_release_id || "";
  const releaseRows = releaseId
    ? await db.sql`
        SELECT id, release_stage, visibility
        FROM halo_release_campaigns
        WHERE id = ${releaseId}
        LIMIT 1
      `
    : [];
  const audioRows = canEdit && releaseId
    ? await db.sql`
        SELECT id, version_type, version_label, source_filename, duration_seconds, content_type, created_at
        FROM halo_release_audio_versions
        WHERE release_id = ${releaseId} AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 24
      `
    : [];
  const radioRows = canEdit
    ? await db.sql`
        SELECT id, title, room, status, release_id, audio_version_id, artist_message,
          reviewed_at, artist_notified_at, artist_viewed_at, created_at
        FROM halo_radio_tracks
        WHERE artist_slug = ${slug} AND (${releaseId} = '' OR release_id = ${releaseId})
        ORDER BY created_at DESC
        LIMIT 1
      `
    : await db.sql`
        SELECT id, title, room, status, release_id, audio_version_id, artist_message,
          reviewed_at, artist_notified_at, artist_viewed_at, created_at
        FROM halo_radio_tracks
        WHERE artist_slug = ${slug} AND status = 'rotation' AND (${releaseId} = '' OR release_id = ${releaseId})
        ORDER BY created_at DESC
        LIMIT 1
      `;
  const radioSubmission = radioRows[0] ? {
    id: radioRows[0].id,
    title: radioRows[0].title,
    room: radioRows[0].room,
    status: radioRows[0].status,
    releaseId: radioRows[0].release_id || "",
    audioVersionId: radioRows[0].audio_version_id || "",
    artistMessage: canEdit ? radioRows[0].artist_message || "" : "",
    reviewedAt: radioRows[0].reviewed_at ? new Date(radioRows[0].reviewed_at).toISOString() : null,
    hasUnreadUpdate: Boolean(canEdit && radioRows[0].artist_notified_at && !radioRows[0].artist_viewed_at),
    createdAt: new Date(radioRows[0].created_at).toISOString()
  } : null;
  const releaseAudioVersions = audioRows.map(audio => ({
    id: audio.id,
    type: audio.version_type,
    label: audio.version_label,
    fileName: audio.source_filename || "",
    durationSeconds: Number(audio.duration_seconds || 0),
    contentType: audio.content_type,
    createdAt: new Date(audio.created_at).toISOString()
  }));
  const videoRows = await db.sql`
    SELECT id, title, description, source_type, source_url, youtube_id, thumbnail_url,
      gallery_visible, sofa_visible, featured, created_at
    FROM halo_videos
    WHERE artist_slug = ${slug} AND status = 'published'
    ORDER BY featured DESC, created_at DESC
    LIMIT 24
  `;
  const videos = videoRows.map(video => ({
    id: video.id,
    title: video.title,
    description: video.description || "",
    sourceType: video.source_type,
    sourceUrl: video.source_type === "upload" ? `/api/videos?media=${video.id}` : video.source_url,
    embedUrl: video.source_type === "youtube" ? `https://www.youtube.com/embed/${video.youtube_id}` : "",
    thumbnailUrl: video.thumbnail_url || (video.youtube_id ? `https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg` : ""),
    galleryVisible: Boolean(video.gallery_visible),
    sofaVisible: Boolean(video.sofa_visible),
    featured: Boolean(video.featured),
    createdAt: new Date(video.created_at).toISOString()
  }));
  const mixRows = row.owner_member_id ? await db.sql`
    SELECT id, title, artwork_url, original_artist, remixer_name, sales_status,
      client_sale_enabled, production_route, created_at
    FROM halo_mixes
    WHERE member_id = ${row.owner_member_id} AND visibility = 'room'
    ORDER BY created_at DESC
    LIMIT 12
  ` : [];
  const mixes = mixRows.map(mix => ({
    id: mix.id,
    title: mix.title,
    artworkUrl: mix.artwork_url || "/assets/releases/salty.jpg",
    originalArtist: mix.original_artist || row.artist_name,
    remixerName: mix.remixer_name || row.artist_name,
    salesStatus: mix.sales_status,
    clientSaleEnabled: Boolean(mix.client_sale_enabled),
    productionRoute: mix.production_route || "self_mixed",
    salesPageUrl: `/mixes/?mix=${encodeURIComponent(mix.id)}#editions`,
    createdAt: new Date(mix.created_at).toISOString()
  }));
  const page = serializePage(row, canEdit);
  page.releaseId = releaseRows[0]?.id || releaseId;
  page.releaseStage = releaseRows[0]?.release_stage || (page.releaseUrl ? "released" : page.releaseDate ? "scheduled" : "unreleased");
  return {
    page,
    canEdit,
    authenticated: Boolean(user),
    viewer: user ? { name: viewerName(user) } : null,
    radioSubmission,
    releaseAudioVersions,
    videos,
    mixes
  };
}

async function loadOwnedPages(db, user) {
  if (!user?.id) return json({ message: "Sign in to manage artist pages" }, 401);
  const membership = await ensureMembership(db, user);
  const rows = isOwner(user)
    ? await db.sql`SELECT * FROM halo_artist_pages ORDER BY updated_at DESC LIMIT 50`
    : await db.sql`SELECT * FROM halo_artist_pages WHERE owner_member_id = ${membership.member_id} ORDER BY updated_at DESC LIMIT 20`;
  return json({
    authenticated: true,
    viewer: { name: viewerName(user) },
    pages: rows.map(row => serializePage(row, true))
  });
}

async function savePage(request, db, user) {
  if (!user?.id) return json({ message: "Join or sign in to publish an artist page" }, 401);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin artist page updates are not accepted" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const artistName = cleanText(payload.artistName, 120);
  const slug = slugify(payload.slug || artistName);
  if (slug.length < 2 || !artistName) return json({ message: "Add an artist name and page handle" }, 400);

  const urls = {
    artworkUrl: cleanUrl(payload.artworkUrl),
    releaseUrl: cleanUrl(payload.releaseUrl),
    videoUrl: cleanUrl(payload.videoUrl),
    communityUrl: cleanUrl(payload.communityUrl),
    djRoomUrl: cleanUrl(payload.djRoomUrl),
    radioRoomUrl: cleanUrl(payload.radioRoomUrl),
    pressRoomUrl: cleanUrl(payload.pressRoomUrl),
    bookingUrl: cleanUrl(payload.bookingUrl),
    websiteUrl: cleanUrl(payload.websiteUrl)
  };
  const suppliedUrls = Object.keys(urls).map(key => payload[key]);
  if (suppliedUrls.some((value, index) => cleanText(value, 1000) && !Object.values(urls)[index])) {
    return json({ message: "Use valid HTTP, HTTPS, or HALO-relative links" }, 400);
  }

  const membership = await ensureMembership(db, user);
  const existingRows = await db.sql`SELECT owner_member_id FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1`;
  const existing = existingRows[0];
  if (existing && !isOwner(user) && existing.owner_member_id !== membership.member_id) {
    return json({ message: "That artist page handle is already owned" }, 409);
  }

  const status = allowedStatuses.has(payload.status) ? payload.status : "draft";
  const values = {
    tagline: cleanText(payload.tagline, 180),
    bio: cleanLongText(payload.bio, 1600),
    location: cleanText(payload.location, 100),
    accentColor: cleanColor(payload.accentColor),
    releaseTitle: cleanText(payload.releaseTitle, 160),
    releaseDate: cleanDate(payload.releaseDate),
    videoTitle: cleanText(payload.videoTitle, 160)
  };

  if (existing) {
    await db.sql`
      UPDATE halo_artist_pages SET
        artist_name = ${artistName}, tagline = ${values.tagline}, bio = ${values.bio},
        location = ${values.location}, accent_color = ${values.accentColor}, artwork_url = ${urls.artworkUrl},
        release_title = ${values.releaseTitle}, release_date = ${values.releaseDate}, release_url = ${urls.releaseUrl},
        video_title = ${values.videoTitle}, video_url = ${urls.videoUrl}, community_url = ${urls.communityUrl},
        dj_room_url = ${urls.djRoomUrl}, radio_room_url = ${urls.radioRoomUrl}, press_room_url = ${urls.pressRoomUrl},
        booking_url = ${urls.bookingUrl}, website_url = ${urls.websiteUrl}, status = ${status}, updated_at = NOW()
      WHERE slug = ${slug}
    `;
  } else {
    await db.sql`
      INSERT INTO halo_artist_pages (
        slug, owner_member_id, artist_name, tagline, bio, location, accent_color, artwork_url,
        release_title, release_date, release_url, video_title, video_url, community_url,
        dj_room_url, radio_room_url, press_room_url, booking_url, website_url, status
      ) VALUES (
        ${slug}, ${membership.member_id}, ${artistName}, ${values.tagline}, ${values.bio}, ${values.location},
        ${values.accentColor}, ${urls.artworkUrl}, ${values.releaseTitle}, ${values.releaseDate}, ${urls.releaseUrl},
        ${values.videoTitle}, ${urls.videoUrl}, ${urls.communityUrl}, ${urls.djRoomUrl}, ${urls.radioRoomUrl},
        ${urls.pressRoomUrl}, ${urls.bookingUrl}, ${urls.websiteUrl}, ${status}
      )
    `;
  }

  const ownerMemberId = existing?.owner_member_id || membership.member_id;
  const [releaseId, starterPlanActivated] = await Promise.all([
    syncCatalogRelease(db, membership, slug, artistName, values, urls, status),
    ensureStarterPlan(db, slug, ownerMemberId, status)
  ]);
  if (releaseId) {
    await db.sql`
      UPDATE halo_artist_pages
      SET current_release_id = ${releaseId}, updated_at = NOW()
      WHERE slug = ${slug}
    `;
  }
  const catalogSynced = Boolean(releaseId);

  const state = await loadPage(db, user, slug);
  const message = status === "published"
    ? starterPlanActivated
      ? catalogSynced
        ? "Artist page published, ALL RELEASES updated, and the free Starter team activated"
        : "Artist page published and the free Starter team activated"
      : catalogSynced ? "Artist page published and ALL RELEASES updated" : "Artist page published"
    : "Artist page saved as a draft";
  return json({ ...state, catalogSynced, starterPlanActivated, message });
}

export default async function artistPagesHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (request.method === "POST") return savePage(request, db, user);
    const slug = slugify(new URL(request.url).searchParams.get("slug") || "");
    if (!slug) return loadOwnedPages(db, user);
    const state = await loadPage(db, user, slug);
    return state ? json(state) : json({ message: "Artist page not found" }, 404);
  } catch (error) {
    console.error("HALO artist page request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The artist room could not be loaded right now" }, 500);
  }
}

export const config = { path: "/api/artist-pages" };
