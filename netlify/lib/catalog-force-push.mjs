import { appendLedgerEntry } from "./halo-ledger.mjs";
import { reconcilePublishedSong } from "./song-publication.mjs";

// Forced "Push to Shop & Charts" publication. The canonical catalog is halo_song_catalog;
// the live storefront/chart record is the halo_release_campaigns row that the shared
// song-publication pipeline upserts (status = 'published', is_chart_eligible = TRUE).
export const FORCE_PUSH_DEFAULT_PRICE = "US$1.29";
export const FORCE_PUSH_DEFAULT_PRICE_CENTS = 129;
export const FORCE_PUSH_LIVE_FLAGS = Object.freeze({
  releaseStatus: "PUBLISHED",
  status: "PUBLISHED",
  inChart: true,
  isLiveVisible: true
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICE_PATTERN = /^(?:US\$|\$)?\s*(\d+(?:\.\d{1,2})?)$/i;
const MAX_TITLE_LENGTH = 300;
const MAX_PRICE_CENTS = 10_000_000;

export class ForcePushError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Converts a submitted price ("US$1.29", "$1.29", "1.29" or 1.29) to cents; placeholders return null. */
export function priceCentsFromInput(value) {
  let amount = NaN;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string") {
    const match = value.trim().match(PRICE_PATTERN);
    if (match) amount = Number(match[1]);
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

export function formatUsdPrice(cents) {
  return `US$${(Number(cents) / 100).toFixed(2)}`;
}

/** Validates the force-push payload. At least a song id (UUID) or a title is required. */
export function normalizeForcePushPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ForcePushError("Send the track as a JSON object");
  }
  const rawId = typeof payload.id === "string" ? payload.id.trim() : "";
  if (rawId && !UUID_PATTERN.test(rawId)) throw new ForcePushError("Track id must be a valid catalog song id");
  const title = typeof payload.title === "string" ? payload.title.trim().replace(/\s+/g, " ") : "";
  if (title.length > MAX_TITLE_LENGTH) throw new ForcePushError("Track title is too long");
  if (!rawId && !title) throw new ForcePushError("A track id or title is required");
  return { id: rawId.toLowerCase(), title, priceCents: priceCentsFromInput(payload.price) };
}

async function findOwnedSong(db, ownerMemberId, { id, title }) {
  if (id) {
    const rows = await db.sql`
      SELECT id, title, rights_status, sale_price_cents, currency
      FROM halo_song_catalog
      WHERE id = ${id} AND owner_member_id = ${ownerMemberId} AND status = 'active'
      LIMIT 1
    `;
    return rows[0] || null;
  }
  if (!title) return null;
  const rows = await db.sql`
    SELECT id, title, rights_status, sale_price_cents, currency
    FROM halo_song_catalog
    WHERE LOWER(title) = LOWER(${title}) AND owner_member_id = ${ownerMemberId} AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 2
  `;
  if (rows.length > 1) throw new ForcePushError("More than one track has this title. Use its id.", 409);
  return rows[0] || null;
}

/**
 * Force-publishes one owned song to the HALO Shop and charts. Idempotent: the song row is
 * updated in place (only publication fields and a missing price change) and the live release
 * is upserted by id through the canonical publication pipeline, so no duplicates are created.
 */
export async function forcePushTrack(db, {
  ownerMemberId,
  actorId = "system",
  payload,
  reconcile = reconcilePublishedSong,
  now = () => new Date()
} = {}) {
  const track = normalizeForcePushPayload(payload);
  const song = await findOwnedSong(db, ownerMemberId, track);
  if (!song) throw new ForcePushError("Save the song in the catalog before pushing it to the shop", 404);
  if (song.rights_status === "disputed") {
    throw new ForcePushError("Resolve the rights dispute before pushing this song to the shop", 409);
  }

  const existingCents = Number(song.sale_price_cents);
  const hasPrice = Number.isFinite(existingCents) && existingCents > 0;
  const priceCents = hasPrice ? existingCents : track.priceCents || FORCE_PUSH_DEFAULT_PRICE_CENTS;
  const currency = hasPrice ? song.currency || "USD" : "USD";
  const forcePushedAt = now().toISOString();

  const updated = await db.sql`
    UPDATE halo_song_catalog
    SET pipeline_status = 'published',
      pipeline_updated_at = NOW(),
      sale_status = 'for_sale',
      sale_price_cents = ${priceCents},
      currency = ${currency},
      updated_at = NOW()
    WHERE id = ${song.id} AND owner_member_id = ${ownerMemberId} AND status = 'active'
    RETURNING id
  `;
  if (!updated.length) throw new ForcePushError("That song was not found", 404);

  const result = await reconcile(db, { songId: song.id, ownerMemberId, actorId, actorType: "member", preserveReleaseMetadata: true });
  if (!result?.ok) throw new ForcePushError("The song could not be published to the shop", 409);

  await appendLedgerEntry(db, {
    actorId,
    actorType: "member",
    eventCategory: "approval_event",
    refSongId: song.id,
    refReleaseId: result.releaseId || null,
    summary: `Forced push to HALO Shop & Charts for "${song.title}"`,
    details: { ...FORCE_PUSH_LIVE_FLAGS, priceCents, currency, forcePushedAt, defaultedPrice: !hasPrice },
    pipelineStage: "published",
    outcome: "success"
  });

  return {
    success: true,
    message: `"${song.title}" is live in the HALO Shop and charts.`,
    songId: song.id,
    releaseId: result.releaseId || "",
    canonicalUrl: result.canonicalUrl || "",
    track: {
      id: song.id,
      title: song.title,
      ...FORCE_PUSH_LIVE_FLAGS,
      price: currency === "USD" ? formatUsdPrice(priceCents) : `${currency} ${(priceCents / 100).toFixed(2)}`,
      priceCents,
      currency,
      forcePushedAt
    }
  };
}
