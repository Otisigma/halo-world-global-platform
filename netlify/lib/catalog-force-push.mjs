import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";
import { isValidReleaseId } from "./catalog-chart.mjs";

// "Push to Shop & Charts": force a catalog song live on the HALO storefront and chart.
// The canonical catalog is halo_song_catalog -> halo_release_campaigns (via the song
// publication pipeline), so this never writes files and never creates new catalog rows
// from browser input — it only republishes an existing song and its release campaign.

export const FORCE_PUSH_PATH = "/api/catalog/force-push-track";
export const FALLBACK_PRICE_CENTS = 129;
export const FALLBACK_PRICE_LABEL = "US$1.29";
const MAX_TITLE_LENGTH = 160;

export function cleanForcePushTitle(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH) : "";
}

// Accepts a song UUID, a release slug, or a title. At least one is required.
export function parseForcePushPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Send the track as a JSON object" };
  }
  const rawId = typeof body.id === "string" ? body.id.trim() : "";
  const songId = cleanDreamweaverSongId(rawId);
  const releaseId = !songId && isValidReleaseId(rawId.toLowerCase()) ? rawId.toLowerCase() : "";
  const title = cleanForcePushTitle(body.title);
  if (rawId && !songId && !releaseId && !title) {
    return { ok: false, message: "The track id is not a recognised song or release id" };
  }
  if (!songId && !releaseId && !title) {
    return { ok: false, message: "A track id or title is required" };
  }
  return { ok: true, songId, releaseId, title };
}

export function hasRealPriceCents(value) {
  const cents = Number(value);
  return Number.isInteger(cents) && cents > 0;
}

export function formatPriceLabel(cents, currency = "USD") {
  const code = String(currency || "USD").toUpperCase();
  const amount = (Number(cents) / 100).toFixed(2);
  return code === "USD" ? `US$${amount}` : `${code} ${amount}`;
}

async function findSong(db, { songId, releaseId, title }, { memberId, isAdmin }) {
  const owner = isAdmin ? "" : memberId;
  if (songId) {
    const rows = await db.sql`
      SELECT id, owner_member_id, title, artist_name, source_release_id, sale_price_cents, currency, pipeline_status
      FROM halo_song_catalog
      WHERE id = ${songId}
        AND status = 'active'
        AND (${owner} = '' OR owner_member_id = ${owner})
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }
  if (releaseId) {
    const rows = await db.sql`
      SELECT id, owner_member_id, title, artist_name, source_release_id, sale_price_cents, currency, pipeline_status
      FROM halo_song_catalog
      WHERE source_release_id = ${releaseId}
        AND status = 'active'
        AND (${owner} = '' OR owner_member_id = ${owner})
      ORDER BY (owner_member_id = ${memberId}) DESC, updated_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }
  if (title) {
    const rows = await db.sql`
      SELECT id, owner_member_id, title, artist_name, source_release_id, sale_price_cents, currency, pipeline_status
      FROM halo_song_catalog
      WHERE LOWER(title) = LOWER(${title})
        AND status = 'active'
        AND (${owner} = '' OR owner_member_id = ${owner})
      ORDER BY (owner_member_id = ${memberId}) DESC, updated_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }
  return null;
}

// Idempotent: repeated pushes update the same song + release campaign rows in place.
export async function forcePushTrack(db, payload, { memberId, actorId, isAdmin = false, reconcile, now = () => new Date() }) {
  const parsed = parseForcePushPayload(payload);
  if (!parsed.ok) return { status: 400, body: { success: false, message: parsed.message } };
  if (!memberId) return { status: 401, body: { success: false, message: "Sign in to push tracks to the shop" } };

  const song = await findSong(db, parsed, { memberId, isAdmin });
  if (!song) return { status: 404, body: { success: false, message: "That track was not found in your song catalog" } };

  // Only live/publication fields change; a real price and every other song field are preserved.
  const updated = await db.sql`
    UPDATE halo_song_catalog
    SET pipeline_status = 'published',
        pipeline_updated_at = NOW(),
        sale_price_cents = CASE
          WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN ${FALLBACK_PRICE_CENTS}
          ELSE sale_price_cents
        END,
        currency = CASE
          WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 'USD'
          ELSE currency
        END,
        updated_at = NOW()
    WHERE id = ${song.id}
      AND status = 'active'
    RETURNING id, sale_price_cents, currency, pipeline_updated_at
  `;
  if (!updated[0]) return { status: 404, body: { success: false, message: "That track is no longer active" } };
  const priceFallbackApplied = !hasRealPriceCents(song.sale_price_cents)
    && Number(updated[0].sale_price_cents) === FALLBACK_PRICE_CENTS;
  const pushedAt = new Date(updated[0].pipeline_updated_at || now());
  const pushedToLiveAt = Number.isNaN(pushedAt.getTime()) ? now().toISOString() : pushedAt.toISOString();

  // The existing publication pipeline upserts the release campaign by id (status published,
  // visibility public, is_chart_eligible TRUE) and refreshes radio + publication sync.
  const result = await reconcile(db, {
    songId: song.id,
    ownerMemberId: song.owner_member_id,
    actorId,
    actorType: "member"
  });
  if (!result?.ok || !result.releaseId) {
    return { status: 409, body: { success: false, message: "The track could not be published to the shop" } };
  }

  await db.sql`
    UPDATE halo_release_campaigns
    SET status = 'published',
        visibility = 'public',
        is_chart_eligible = TRUE,
        updated_at = NOW()
    WHERE id = ${result.releaseId}
  `;

  const price = formatPriceLabel(updated[0].sale_price_cents, updated[0].currency);
  return {
    status: 200,
    body: {
      success: true,
      message: `"${song.title}" pushed to shop and charts!`,
      track: {
        id: song.id,
        releaseId: result.releaseId,
        title: song.title,
        artist: song.artist_name,
        releaseStatus: "PUBLISHED",
        status: "PUBLISHED",
        inChart: true,
        isLiveVisible: true,
        price,
        priceFallbackApplied,
        pushedToLiveAt,
        shopUrl: `/music/?song=${encodeURIComponent(result.releaseId)}`
      }
    }
  };
}
