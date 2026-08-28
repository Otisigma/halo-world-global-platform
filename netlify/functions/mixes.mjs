import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const audioStore = getStore({ name: "halo-mixes", consistency: "strong" });
const allowedTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-wav"]);
const maxChunkBytes = 4 * 1024 * 1024;
const maxUploadBytes = 128 * 1024 * 1024;
const previewPoolMixSeconds = 60 * 60;
const hourSessionMinimumSeconds = 50 * 60;
const hourSessionMaximumSeconds = 70 * 60;

function normalizeAudioContentType(value, filename = "") {
  const contentType = cleanText(value, 80).split(";")[0].toLowerCase();
  const aliases = {
    "audio/mp3": "audio/mpeg",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "video/mp4": "audio/mp4",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "application/ogg": "audio/ogg"
  };
  if (aliases[contentType]) return aliases[contentType];
  if (allowedTypes.has(contentType)) return contentType;
  if (/\.wav$/i.test(filename)) return "audio/wav";
  if (/\.aac$/i.test(filename)) return "audio/aac";
  if (/\.ogg$/i.test(filename)) return "audio/ogg";
  if (/\.webm$/i.test(filename)) return "audio/webm";
  if (/\.(?:m4a|mp4)$/i.test(filename)) return "audio/mp4";
  if (/\.mp3$/i.test(filename)) return "audio/mpeg";
  return contentType;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function removeStoredUpload(prefix) {
  if (!prefix) return;
  const stored = await audioStore.list({ prefix });
  await Promise.all(stored.blobs.map(blob => audioStore.delete(blob.key)));
}

function mixPayload(row) {
  const priceMinor = Number(row.price_minor || 0);
  const readiness = {
    masterApproved: Boolean(row.master_approved),
    productInfoComplete: Boolean(row.product_info_complete),
    priceConfirmed: priceMinor > 0,
    rightsConfirmed: row.rights_clearance_status === "confirmed"
  };
  readiness.missing = Object.entries(readiness)
    .filter(([key, value]) => key !== "missing" && !value)
    .map(([key]) => key);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    durationSeconds: Number(row.duration_seconds || 0),
    trackCount: Number(row.track_count || 0),
    playCount: Number(row.play_count || 0),
    createdAt: new Date(row.created_at).toISOString(),
    creator: { name: row.display_name, avatar: row.avatar, badge: row.badge },
    artworkUrl: row.artwork_url || "/assets/releases/salty.jpg",
    credits: { originalArtist: row.original_artist || "Owen Anthony", remixer: row.remixer_name || "DJ HALO X" },
    salesStatus: row.sales_status || "mastering",
    commerce: {
      productionRoute: row.production_route || "halo_mixed",
      sellerMode: row.seller_mode || "creator",
      clientSaleEnabled: Boolean(row.client_sale_enabled),
      mixingFeeIncluded: Boolean(row.mixing_fee_included),
      editionFormat: row.edition_format || "mp3",
      priceMinor,
      currency: row.currency || "USD"
    },
    readiness,
    salesPageUrl: `/mixes/?mix=${encodeURIComponent(row.id)}#editions`,
    audioUrl: `/api/mixes/audio?id=${encodeURIComponent(row.id)}`,
    originalAudioUrl: row.original_blob_key ? `/api/mixes/audio?id=${encodeURIComponent(row.id)}&version=original` : "",
    hasOriginalComparison: Boolean(row.original_blob_key),
    inPlaylist: Boolean(row.in_playlist),
    isOwner: Boolean(row.is_owner)
  };
}

function longPlayPayload(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    durationSeconds: 0,
    trackCount: 1,
    playCount: 0,
    createdAt: new Date(row.created_at).toISOString(),
    creator: { name: row.artist_name, avatar: row.thumbnail_url, badge: "YouTube Long Play" },
    artworkUrl: row.thumbnail_url || "/assets/releases/salty.jpg",
    credits: { originalArtist: row.artist_name || "Owen Anthony", remixer: "DJ HALO X" },
    salesStatus: "stream_only",
    salesPageUrl: "",
    videoId: row.video_id,
    videoUrl: row.video_url,
    source: "youtube",
    inPlaylist: false,
    isOwner: false
  };
}

function alternateLongPlays(audioMixes, videoMixes) {
  if (!videoMixes.length) return audioMixes;
  const queue = [];
  const length = Math.max(audioMixes.length, videoMixes.length);
  for (let index = 0; index < length; index += 1) {
    if (audioMixes[index]) queue.push(audioMixes[index]);
    if (videoMixes[index]) queue.push(videoMixes[index]);
  }
  return queue;
}

function prioritizeLatestHourSession(mixes, previewPoolMix) {
  const latestHourSession = mixes.find(mix => (
    mix.durationSeconds >= hourSessionMinimumSeconds
    && mix.durationSeconds <= hourSessionMaximumSeconds
  ));
  const remainingMixes = latestHourSession
    ? mixes.filter(mix => mix.id !== latestHourSession.id)
    : mixes;
  return [
    ...(latestHourSession ? [latestHourSession] : []),
    ...(previewPoolMix ? [previewPoolMix] : []),
    ...remainingMixes
  ];
}

async function listMixes(db, user, limit = 18) {
  if (!user?.id) {
    const rows = await db.sql`
      SELECT m.id, m.title, m.description, m.duration_seconds, m.track_count, m.play_count, m.created_at,
        m.artwork_url, m.original_artist, m.remixer_name, m.sales_status, m.production_route,
        m.seller_mode, m.client_sale_enabled, m.mixing_fee_included, m.edition_format,
        m.price_minor, m.currency, m.product_info_complete, m.master_approved, m.rights_clearance_status, m.original_blob_key,
        p.display_name, p.avatar, p.badge, FALSE AS in_playlist, FALSE AS is_owner
      FROM halo_mixes m
      JOIN community_profiles p ON p.actor_id = m.actor_id
      WHERE m.visibility = 'room'
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mixPayload);
  }
  const memberId = user.id;
  const rows = await db.sql`
    SELECT m.id, m.title, m.description, m.duration_seconds, m.track_count, m.play_count, m.created_at,
      m.artwork_url, m.original_artist, m.remixer_name, m.sales_status, m.production_route,
      m.seller_mode, m.client_sale_enabled, m.mixing_fee_included, m.edition_format,
      m.price_minor, m.currency, m.product_info_complete, m.master_approved, m.rights_clearance_status, m.original_blob_key,
      p.display_name, p.avatar, p.badge,
      EXISTS (
        SELECT 1 FROM halo_mix_playlist_items i
        WHERE i.mix_id = m.id AND i.member_id = ${memberId}
      ) AS in_playlist,
      (m.member_id = ${memberId}) AS is_owner
    FROM halo_mixes m
    JOIN community_profiles p ON p.actor_id = m.actor_id
    WHERE m.visibility = 'room' OR m.member_id = ${memberId}
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mixPayload);
}

function previewPoolMixPayload(rows) {
  const candidates = rows.map(row => ({
    id: row.id,
    title: row.title,
    artist: row.artist_name,
    durationSeconds: Number(row.duration_seconds || 0),
    audioUrl: `/api/radio/audio?id=${encodeURIComponent(row.id)}`
  })).filter(track => track.durationSeconds > 0);
  if (!candidates.length) return null;

  const playlist = [];
  let remainingSeconds = previewPoolMixSeconds;
  while (remainingSeconds > 0 && playlist.length < 100) {
    let addedSeconds = 0;
    for (const track of candidates) {
      if (remainingSeconds <= 0 || playlist.length >= 100) break;
      const playSeconds = Math.min(track.durationSeconds, remainingSeconds);
      playlist.push({ ...track, playSeconds });
      remainingSeconds -= playSeconds;
      addedSeconds += playSeconds;
    }
    if (!addedSeconds) break;
  }

  const durationSeconds = previewPoolMixSeconds - remainingSeconds;
  return {
    id: "preview-pool-60-minute-mix",
    title: "DJ HALO X 60 MIN TAKEOVER MIX",
    description: "A one-hour station fallback assembled from the newest approved room uploads. The latest genuine hour-long DJ session leads Long Play when available.",
    durationSeconds,
    trackCount: candidates.length,
    playCount: rows.reduce((total, row) => total + Number(row.play_count || 0), 0),
    createdAt: new Date(rows[0].created_at).toISOString(),
    creator: { name: "DJ HALO X", avatar: "/assets/halo-logo-mark.webp", badge: "Station takeover" },
    audioUrl: playlist[0].audioUrl,
    playlist,
    source: "preview-pool",
    stationFallback: true,
    inPlaylist: false,
    isOwner: false
  };
}

async function loadPreviewPoolMix(db) {
  const rows = await db.sql`
    SELECT id, title, artist_name, duration_seconds, play_count, created_at
    FROM halo_radio_tracks
    WHERE status IN ('preview', 'rotation')
      AND duration_seconds > 0
      AND (status = 'rotation' OR votes_up > votes_down OR ai_score >= 60)
    ORDER BY created_at DESC,
      (status = 'rotation') DESC,
      (votes_up - votes_down) DESC,
      ai_score DESC NULLS LAST
    LIMIT 100
  `;
  return previewPoolMixPayload(rows);
}

async function loadCuratedLongPlays(db) {
  const rows = await db.sql`
    SELECT id, title, artist_name, description, video_id, video_url, thumbnail_url, created_at
    FROM halo_radio_long_plays
    WHERE active = TRUE
    ORDER BY rotation_position, created_at
  `;
  return rows.map(longPlayPayload);
}

function cleanUploadId(value) {
  const id = cleanText(value, 80);
  return /^[a-z0-9-]{12,80}$/i.test(id) ? id : "";
}

function cleanArtworkUrl(value) {
  const raw = cleanText(value, 500);
  if (/^\/assets\/[a-z0-9/_-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "/assets/releases/salty.jpg";
  } catch {
    return "/assets/releases/salty.jpg";
  }
}

function hasValidArtworkUrl(value) {
  const raw = cleanText(value, 500);
  if (/^\/assets\/[a-z0-9/_-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function uploadMixChunk(request, db, user) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "The finished mix could not be read" }, 400);
  }
  const chunk = form.get("chunk");
  if (!(chunk instanceof Blob) || !chunk.size) return json({ message: "Attach a recording chunk before posting" }, 400);
  const contentType = normalizeAudioContentType(form.get("contentType") || chunk.type, chunk.name);
  if (!allowedTypes.has(contentType)) return json({ message: "That recording format is not supported" }, 415);
  if (chunk.size > maxChunkBytes) return json({ message: "That upload chunk is too large" }, 413);

  const membership = await ensureMembership(db, user);
  const uploadId = cleanUploadId(form.get("uploadId"));
  const assetRole = form.get("assetRole") === "original" ? "original" : "master";
  const chunkIndex = Number.parseInt(form.get("chunkIndex"), 10);
  const chunkCount = Number.parseInt(form.get("chunkCount"), 10);
  if (!uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 0 || chunkIndex >= chunkCount || chunkCount < 1 || chunkCount > 64) {
    return json({ message: "The mix upload sequence is invalid" }, 400);
  }
  const blobKey = `${membership.member_id}/${uploadId}/${assetRole}/parts/${String(chunkIndex).padStart(3, "0")}`;
  await audioStore.set(blobKey, chunk);
  return json({ message: `${assetRole === "original" ? "Original" : "Master"} chunk uploaded`, chunkIndex });
}

async function finalizeMix(payload, db, user) {
  const membership = await ensureMembership(db, user);
  const uploadId = cleanUploadId(payload.uploadId);
  const chunkCount = Math.max(1, Math.min(64, Number.parseInt(payload.chunkCount, 10) || 0));
  const byteSize = Math.max(0, Math.min(maxUploadBytes, Number.parseInt(payload.byteSize, 10) || 0));
  const contentType = normalizeAudioContentType(payload.contentType);
  if (!uploadId || !allowedTypes.has(contentType) || !byteSize || !chunkCount) return json({ message: "The finished mix details are incomplete" }, 400);
  const blobPrefix = `${membership.member_id}/${uploadId}/master/parts/`;
  const stored = await audioStore.list({ prefix: blobPrefix });
  if (stored.blobs.length !== chunkCount) return json({ message: "The mix upload is incomplete. Try posting it again." }, 409);
  const originalUploadId = cleanUploadId(payload.originalUploadId);
  const originalChunkCount = originalUploadId ? Math.max(1, Math.min(64, Number.parseInt(payload.originalChunkCount, 10) || 0)) : 0;
  const originalByteSize = originalUploadId ? Math.max(0, Math.min(maxUploadBytes, Number.parseInt(payload.originalByteSize, 10) || 0)) : 0;
  const originalContentType = originalUploadId ? normalizeAudioContentType(payload.originalContentType) : "";
  const originalDurationSeconds = originalUploadId ? Math.max(0, Math.min(43200, Number.parseInt(payload.originalDurationSeconds, 10) || 0)) : 0;
  if (originalUploadId && (!allowedTypes.has(originalContentType) || !originalByteSize || !originalChunkCount)) {
    return json({ message: "The original comparison details are incomplete" }, 400);
  }
  const originalBlobPrefix = originalUploadId ? `${membership.member_id}/${originalUploadId}/original/parts/` : "";
  if (originalUploadId) {
    const storedOriginal = await audioStore.list({ prefix: originalBlobPrefix });
    if (storedOriginal.blobs.length !== originalChunkCount) return json({ message: "The original comparison upload is incomplete. Try posting it again." }, 409);
  }

  const id = randomUUID();
  const title = cleanText(payload.title, 100) || `${membership.display_name}'s HALO mix`;
  const description = cleanText(payload.description, 320);
  const durationSeconds = Math.max(0, Math.min(43200, Number.parseInt(payload.durationSeconds, 10) || 0));
  const trackCount = Math.max(0, Math.min(500, Number.parseInt(payload.trackCount, 10) || 0));
  const visibility = payload.visibility === "private" ? "private" : "room";
  const artworkUrl = cleanArtworkUrl(payload.artworkUrl);
  const uploadSource = payload.uploadSource === "creator_desk" ? "creator_desk" : "halo_deck";
  const productionRoute = payload.productionRoute === "self_mixed" ? "self_mixed" : "halo_mixed";
  const sellerMode = payload.sellerMode === "halo_managed" ? "halo_managed" : "creator";
  const clientSaleEnabled = visibility === "room" && payload.clientSaleEnabled === true;
  const rightsAttested = uploadSource === "halo_deck" || payload.rightsAttested === true;
  if (uploadSource === "creator_desk" && !rightsAttested) return json({ message: "Confirm the recording and remix rights before posting" }, 400);
  const originalArtist = cleanText(payload.originalArtist, 100) || "Independent artist";
  const remixerName = cleanText(payload.remixerName, 100) || membership.display_name;
  const editionFormat = payload.editionFormat === "wav_bundle" ? "wav_bundle" : "mp3";
  const priceMinor = Math.round(Number(payload.price || 0) * 100);
  const productInfoComplete = Boolean(
    cleanText(payload.title, 100)
    && cleanText(payload.originalArtist, 100)
    && cleanText(payload.remixerName, 100)
    && description.length >= 20
    && hasValidArtworkUrl(payload.artworkUrl)
  );
  if (clientSaleEnabled && (!productInfoComplete || !Number.isInteger(priceMinor) || priceMinor < 100 || priceMinor > 50000)) {
    return json({ message: "Paid mixes need artwork, a complete edition story, and a price from $1.00 to $500.00" }, 400);
  }
  const reviewIntent = cleanText(payload.reviewIntent, 1000);
  const reviewContext = cleanText(payload.reviewContext, 1000);
  const protectedMoments = cleanText(payload.protectedMoments, 1000);
  const salesStatus = visibility !== "room" || !clientSaleEnabled
    ? "stream_only"
    : productionRoute === "halo_mixed" ? "mastering" : "rights_review";
  const releasePlanId = randomUUID();
  const salesPageUrl = `/mixes/?mix=${encodeURIComponent(id)}#editions`;
  const releaseMetadata = JSON.stringify({
    originalArtist,
    remixerName,
    artworkUrl,
    artworkStatus: payload.artworkUrl ? "draft" : "needed",
    salesPageUrl,
    uploadSource,
    productionRoute,
    sellerMode,
    clientSaleEnabled,
    mixingFeeIncluded: productionRoute === "halo_mixed",
    rightsAttested,
    editionFormat,
    priceMinor,
    currency: "USD",
    productInfoComplete
  });

  await db.sql`
    INSERT INTO halo_mixes (
      id, member_id, actor_id, title, description, blob_key, chunk_count, content_type,
      byte_size, duration_seconds, track_count, visibility, artwork_url, original_artist,
      original_blob_key, original_chunk_count, original_content_type, original_byte_size, original_duration_seconds,
      remixer_name, sales_status, upload_source, production_route, seller_mode,
      client_sale_enabled, mixing_fee_included, rights_attested, edition_format,
      price_minor, currency, product_info_complete, master_approved, rights_clearance_status, review_intent,
      review_context, protected_moments
    ) VALUES (
      ${id}, ${membership.member_id}, ${membership.actor_id}, ${title}, ${description}, ${blobPrefix},
      ${chunkCount}, ${contentType}, ${byteSize}, ${durationSeconds}, ${trackCount}, ${visibility},
      ${artworkUrl}, ${originalArtist}, ${originalBlobPrefix}, ${originalChunkCount}, ${originalContentType}, ${originalByteSize},
      ${originalDurationSeconds}, ${remixerName}, ${salesStatus}, ${uploadSource},
      ${productionRoute}, ${sellerMode}, ${clientSaleEnabled}, ${productionRoute === "halo_mixed"}, ${rightsAttested},
      ${editionFormat}, ${clientSaleEnabled ? priceMinor : 0}, 'USD', ${clientSaleEnabled && productInfoComplete}, FALSE, 'pending',
      ${reviewIntent}, ${reviewContext}, ${protectedMoments}
    )
  `;

  await db.sql`
    INSERT INTO halo_mix_release_plans (
      id, member_id, mix_id, title, current_step, release_format, mastering_status,
      target_lufs, true_peak_dbtp, rights_confirmed, sale_ready, metadata, demand_brief
    ) VALUES (
      ${releasePlanId}, ${membership.member_id}, ${id}, ${title}, ${productionRoute === "halo_mixed" ? 2 : 3},
      ${clientSaleEnabled ? "paid_mix" : "free_stream"}, ${productionRoute === "halo_mixed" ? "mix_review" : "not_started"},
      -14.0, -1.0, FALSE, FALSE, ${releaseMetadata}::jsonb, '{}'::jsonb
    )
  `;

  await db.sql`
    INSERT INTO halo_mix_review_cycles (id, mix_id, cycle_number)
    VALUES (${`review-${id}`}, ${id}, 1)
    ON CONFLICT (mix_id, cycle_number) DO NOTHING
  `;

  return json({
    message: visibility === "room"
      ? productionRoute === "halo_mixed"
        ? "Mix received. HALO mixing and mastering are included in the package before rights review and sale."
        : clientSaleEnabled
          ? "Finished remix posted. Your creator sales page is queued for rights review."
          : "Finished remix posted as an authorized stream."
      : "Mix saved privately with a mastering brief.",
    id,
    salesPageUrl,
    salesStatus,
    productionRoute,
    clientSaleEnabled
  }, 201);
}

async function deleteMix(payload, db, user) {
  const membership = await ensureMembership(db, user);
  const mixId = cleanText(payload.mixId, 80);
  if (!mixId) return json({ message: "Choose a mix to delete" }, 400);

  const deleted = await db.sql`
    DELETE FROM halo_mixes
    WHERE id = ${mixId} AND member_id = ${membership.member_id}
    RETURNING blob_key, chunk_count
  `;
  if (!deleted.length) return json({ message: "That mix was not found or does not belong to you" }, 404);

  try {
    const { blob_key: blobPrefix } = deleted[0];
    const [masterBlobs, originalBlobs] = await Promise.all([
      audioStore.list({ prefix: blobPrefix }),
      audioStore.list({ prefix: blobPrefix.replace("/master/parts/", "/original/parts/") })
    ]);
    await Promise.all([
      ...masterBlobs.blobs.map(blob => audioStore.delete(blob.key)),
      ...originalBlobs.blobs.map(blob => audioStore.delete(blob.key))
    ]);
    const artworkKey = blobPrefix.replace("/master/parts/", "/artwork");
    await audioStore.delete(artworkKey).catch(() => {});
  } catch (error) {
    console.error("HALO mix audio cleanup failed", error instanceof Error ? error.message : "unknown error");
  }
  return json({ message: "Mix deleted" });
}

async function updatePlaylist(request, db, user) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }
  if (payload.action === "publish") return finalizeMix(payload, db, user);
  if (payload.action === "delete") return deleteMix(payload, db, user);
  const membership = await ensureMembership(db, user);
  if (payload.action === "delete") {
    const deleted = await db.sql`
      DELETE FROM halo_mixes
      WHERE id = ${cleanText(payload.mixId, 80)} AND member_id = ${membership.member_id}
      RETURNING id, blob_key, original_blob_key
    `;
    if (!deleted[0]) return json({ message: "That mix was not found or does not belong to you" }, 404);
    await db.sql`DELETE FROM halo_mix_release_plans WHERE mix_id = ${deleted[0].id} AND member_id = ${membership.member_id}`;
    await Promise.all([
      removeStoredUpload(deleted[0].blob_key).catch(() => undefined),
      removeStoredUpload(deleted[0].original_blob_key).catch(() => undefined)
    ]);
    return json({ message: "Mix deleted" });
  }
  const mixId = cleanText(payload.mixId, 80);
  if (!mixId) return json({ message: "Choose a mix first" }, 400);
  const mixRows = await db.sql`SELECT id FROM halo_mixes WHERE id = ${mixId} AND (visibility = 'room' OR member_id = ${membership.member_id})`;
  if (!mixRows[0]) return json({ message: "That mix is not available" }, 404);
  if (payload.enabled === false) {
    await db.sql`DELETE FROM halo_mix_playlist_items WHERE member_id = ${membership.member_id} AND mix_id = ${mixId}`;
  } else {
    await db.sql`INSERT INTO halo_mix_playlist_items (member_id, mix_id) VALUES (${membership.member_id}, ${mixId}) ON CONFLICT DO NOTHING`;
  }
  return json({ message: payload.enabled === false ? "Removed from your playlist" : "Added to your playlist" });
}

export default async function mixesHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const user = await getUser().catch(() => null);
    if (request.method === "GET") {
      const url = new URL(request.url);
      const requestedLimit = Number.parseInt(url.searchParams.get("limit"), 10);
      const limit = Math.max(1, Math.min(100, requestedLimit || 18));
      const includeLongPlayStation = url.searchParams.get("station") === "longplay";
      const [mixes, previewPoolMix, curatedLongPlays] = await Promise.all([
        listMixes(db, user, limit),
        includeLongPlayStation ? loadPreviewPoolMix(db) : null,
        includeLongPlayStation ? loadCuratedLongPlays(db) : []
      ]);
      const audioMixes = includeLongPlayStation
        ? prioritizeLatestHourSession(mixes, previewPoolMix)
        : mixes;
      return json({ mixes: alternateLongPlays(audioMixes, curatedLongPlays).slice(0, limit) });
    }
    if (!user?.id) return json({ message: "Sign in to post mixes and build playlists" }, 401);
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin mix updates are not accepted" }, 403);
    }
    const contentType = request.headers.get("content-type") || "";
    return contentType.includes("multipart/form-data") ? uploadMixChunk(request, db, user) : updatePlaylist(request, db, user);
  } catch (error) {
    console.error("HALO mixes request failed", error?.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : "unknown error");
    return json({ message: "The mix room could not be updated right now" }, 500);
  }
}

export const config = {
  path: "/api/mixes"
};
