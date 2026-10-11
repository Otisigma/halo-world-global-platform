import { randomUUID } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stems = new Set(["full", "drums", "bass", "music", "vocals", "fx"]);
const rarities = new Set(["white_label", "test_press", "promo_copy", "vault_only", "selector_exclusive"]);
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
});
const text = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.trim().length <= max;

function routingValid(body) {
  return body && uuid.test(body.trackId) && text(body.title, 2, 140) && text(body.artist, 1, 140)
    && (!body.songId || uuid.test(body.songId))
    && ["standard", "dj_vault"].includes(body.accessTier)
    && ["hidden", "public", "members"].includes(body.visibility)
    && Number.isInteger(body.bpm) && body.bpm >= 40 && body.bpm <= 240
    && text(body.musicalKey, 1, 12)
    && Number.isInteger(body.pricePence) && body.pricePence >= 100 && body.pricePence <= 100000
    && ["wav", "flac"].includes(body.deliveryFormat)
    && ["clip", "watermarked", "low_bitrate"].includes(body.previewType)
    && (body.rarity === undefined || rarities.has(body.rarity))
    && uuid.test(body.previewPackId) && uuid.test(body.deliveryPackId)
    && stems.has(body.previewStem) && stems.has(body.deliveryStem)
    && (body.previewPackId !== body.deliveryPackId || body.previewStem !== body.deliveryStem);
}

function catalogTrack(row) {
  return {
    id: row.id, title: row.title, artist: row.artist, bpm: row.bpm,
    musicalKey: row.musical_key, pricePence: row.price_pence,
    deliveryFormat: row.delivery_format, previewType: row.preview_type,
    rarity: rarities.has(row.rarity) ? row.rarity : "white_label",
    previewUrl: `/api/dj-vault/preview?trackId=${encodeURIComponent(row.id)}`,
    entitled: Boolean(row.entitled),
    votes: Number.isSafeInteger(Number(row.votes)) && Number(row.votes) >= 0 ? Number(row.votes) : 0,
    voted: Boolean(row.voted)
  };
}

async function purchasableTracks(db, memberId, authorized, trackId = null, offset = 0) {
  return db.sql`
    SELECT t.*,
      EXISTS (SELECT 1 FROM halo_dj_vault_entitlements e WHERE e.track_id = t.id
        AND e.member_id = ${memberId} AND e.revoked_at IS NULL) AS entitled,
      (SELECT COUNT(*)::INT FROM halo_dj_vault_votes v WHERE v.track_id = t.id) AS votes,
      EXISTS (SELECT 1 FROM halo_dj_vault_votes v WHERE v.track_id = t.id AND v.member_id = ${memberId}) AS voted
    FROM halo_dj_vault_tracks t
    JOIN halo_stem_files preview ON preview.pack_id = t.preview_pack_id AND preview.stem_type = t.preview_stem
    JOIN halo_stem_packs preview_pack ON preview_pack.id = preview.pack_id
    JOIN halo_stem_files delivery ON delivery.pack_id = t.delivery_pack_id AND delivery.stem_type = t.delivery_stem
    JOIN halo_stem_packs delivery_pack ON delivery_pack.id = delivery.pack_id
    WHERE t.access_tier = 'dj_vault' AND (t.visibility = 'public' OR (${authorized} AND t.visibility = 'members'))
      AND (${trackId}::TEXT IS NULL OR t.id = ${trackId})
      AND preview_pack.status = 'private' AND preview_pack.rights_attested = TRUE
      AND delivery_pack.status = 'private' AND delivery_pack.rights_attested = TRUE
      AND preview.blob_key <> '' AND preview.chunk_count > 0 AND preview.byte_size > 0
      AND delivery.blob_key <> '' AND delivery.chunk_count > 0 AND delivery.byte_size > 0
    ORDER BY t.created_at DESC, t.id LIMIT 25 OFFSET ${offset}
  `;
}

export function createDjVaultHandler({ getDatabase, getUser, membershipFor, store, stripeRequest, siteOrigin }) {
  return async function djVault(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/").pop();
    const methods = { tracks: "GET", session: "GET", routing: "PATCH", checkout: "POST",
      confirm: "POST", vote: "POST", entitlements: "POST", preview: "GET", download: "GET" };
    if (!methods[action]) return json({ message: "Not found" }, 404);
    if (request.method !== methods[action]) return json({ message: "Method not allowed" }, 405);
    try {
      const user = await getUser(request);
      const db = await getDatabase();
      const roles = user?.id ? await db.sql`SELECT role FROM halo_dj_vault_roles WHERE member_id = ${user.id}` : [];
      const role = roles[0]?.role;
      const authorized = ["dj", "selector", "admin"].includes(role);
      if (action === "session") return json({ authenticated: Boolean(user?.id), authorized, canRoute: ["selector", "admin"].includes(role) });
      if (!["tracks", "preview"].includes(action)) {
        if (!user?.id) return json({ message: "Sign in to access DJ Vault" }, 401);
        if (!authorized) return json({ message: "Verified DJ access required" }, 403);
      }
      const mutation = !["GET", "HEAD"].includes(request.method);
      if (mutation) {
        // Explicit origin validation also protects cookie sessions under the compat adapter.
        if (request.headers.get("origin") !== url.origin) return json({ message: "Cross-origin request denied" }, 403);
        if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ message: "JSON required" }, 415);
      }
      if (authorized && (mutation || ["preview", "download"].includes(action))) {
        const limited = await db.sql`SELECT halo_dj_vault_rate_limit(${user.id}) AS allowed`;
        if (!limited[0]?.allowed) return json({ message: "Too many requests. Try again shortly." }, 429);
      }
      if (action === "tracks") {
        const offset = Number(url.searchParams.get("offset") || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return json({ message: "Invalid offset" }, 400);
        const rows = await purchasableTracks(db, user?.id || "", authorized, null, offset);
        return json({ success: true, tracks: rows.map(catalogTrack), nextOffset: rows.length === 25 ? offset + 25 : null });
      }
      let body = null;
      if (mutation) {
        const reader = request.body?.getReader();
        if (!reader) return json({ message: "Invalid body" }, 400);
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8000) { await reader.cancel(); return json({ message: "Request too large" }, 413); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const raw = new TextDecoder().decode(bytes);
        try { body = JSON.parse(raw); } catch { return json({ message: "Invalid JSON" }, 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ message: "Invalid body" }, 400);
      }
      if (action === "routing") {
        if (!["selector", "admin"].includes(role)) return json({ message: "Selector access required" }, 403);
        if (!routingValid(body)) return json({ message: "Invalid routing metadata" }, 400);
        // Private assets must belong to the release owner (or the curator for standalone editions).
        const assets = await db.sql`
          SELECT p.id, f.stem_type, f.content_type, f.duration_seconds, f.blob_key
          FROM halo_stem_files f JOIN halo_stem_packs p ON p.id = f.pack_id
          WHERE p.status = 'private' AND p.rights_attested = TRUE
            AND p.member_id = COALESCE((SELECT owner_member_id FROM halo_song_catalog WHERE id = ${body.songId || ""}), ${user.id})
            AND ((f.pack_id = ${body.previewPackId} AND f.stem_type = ${body.previewStem})
              OR (f.pack_id = ${body.deliveryPackId} AND f.stem_type = ${body.deliveryStem}))
        `;
        const preview = assets.find(a => a.id === body.previewPackId && a.stem_type === body.previewStem);
        const delivery = assets.find(a => a.id === body.deliveryPackId && a.stem_type === body.deliveryStem);
        if (!preview || !delivery || preview.blob_key === delivery.blob_key
          || !(Number(preview.duration_seconds) > 0 && Number(preview.duration_seconds) <= 90)
          || ![`audio/${body.deliveryFormat}`, `audio/x-${body.deliveryFormat}`].includes(delivery.content_type)) {
          return json({ message: "Provide a separate preview of up to 90 seconds and a rights-attested private WAV/FLAC delivery file" }, 409);
        }
        const rows = await db.sql`
          WITH routed AS (
            INSERT INTO halo_dj_vault_tracks (id, song_id, title, artist, access_tier, visibility, bpm, musical_key,
              price_pence, delivery_format, preview_type, rarity, preview_pack_id, preview_stem, delivery_pack_id, delivery_stem, routed_by)
            VALUES (${body.trackId}, ${body.songId || null}, ${body.title.trim()}, ${body.artist.trim()}, ${body.accessTier},
              ${body.visibility}, ${body.bpm}, ${body.musicalKey.trim()}, ${body.pricePence}, ${body.deliveryFormat},
              ${body.previewType}, ${body.rarity || "white_label"}, ${body.previewPackId}, ${body.previewStem}, ${body.deliveryPackId}, ${body.deliveryStem}, ${user.id})
            ON CONFLICT (id) DO UPDATE SET access_tier = EXCLUDED.access_tier, visibility = EXCLUDED.visibility,
              title = EXCLUDED.title, artist = EXCLUDED.artist, bpm = EXCLUDED.bpm, musical_key = EXCLUDED.musical_key,
              price_pence = EXCLUDED.price_pence, rarity = COALESCE(${body.rarity || null}::TEXT, halo_dj_vault_tracks.rarity), routed_by = EXCLUDED.routed_by, updated_at = NOW()
            WHERE halo_dj_vault_tracks.song_id IS NOT DISTINCT FROM EXCLUDED.song_id
              AND halo_dj_vault_tracks.preview_pack_id = EXCLUDED.preview_pack_id
              AND halo_dj_vault_tracks.preview_stem = EXCLUDED.preview_stem
              AND halo_dj_vault_tracks.delivery_pack_id = EXCLUDED.delivery_pack_id
              AND halo_dj_vault_tracks.delivery_stem = EXCLUDED.delivery_stem
              AND halo_dj_vault_tracks.delivery_format = EXCLUDED.delivery_format
              AND halo_dj_vault_tracks.preview_type = EXCLUDED.preview_type
            RETURNING id
          ) INSERT INTO halo_dj_vault_access_logs (member_id, track_id, action)
            SELECT ${user.id}, id, 'route' FROM routed RETURNING track_id
        `;
        return rows.length ? json({ success: true }) : json({ message: "Edition assets are immutable; create a new edition" }, 409);
      }
      if (action === "entitlements") {
        if (role !== "admin") return json({ message: "Admin access required" }, 403);
        if (!uuid.test(body.trackId) || !text(body.memberId, 1, 160)) return json({ message: "Invalid grant" }, 400);
        const rows = await db.sql`
          WITH granted AS (
            INSERT INTO halo_dj_vault_entitlements (member_id, track_id, granted_by)
            SELECT r.member_id, t.id, ${user.id} FROM halo_dj_vault_roles r CROSS JOIN halo_dj_vault_tracks t
            WHERE r.member_id = ${body.memberId} AND t.id = ${body.trackId}
              AND t.access_tier = 'dj_vault' AND t.visibility <> 'hidden'
            ON CONFLICT (member_id, track_id) DO NOTHING RETURNING track_id
          ) INSERT INTO halo_dj_vault_access_logs (member_id, track_id, action)
            SELECT ${user.id}, track_id, 'grant' FROM granted RETURNING track_id
        `;
        return json({ granted: rows.length > 0 });
      }
      const trackId = mutation ? body.trackId : url.searchParams.get("trackId");
      if (!uuid.test(trackId || "")) return json({ message: "Invalid track" }, 400);
      const tracks = await db.sql`SELECT * FROM halo_dj_vault_tracks
        WHERE id = ${trackId} AND access_tier = 'dj_vault'
          AND (visibility = 'public' OR (${authorized} AND visibility = 'members'))`;
      const track = tracks[0];
      if (!track) return json({ message: "Track unavailable" }, 404);
      if (action === "vote") {
        if (typeof body.voted !== "boolean") return json({ message: "Invalid vote" }, 400);
        // Idempotent: the client sends the desired state, so retries and double-clicks never double count.
        if (body.voted) await db.sql`INSERT INTO halo_dj_vault_votes (member_id, track_id)
          VALUES (${user.id}, ${trackId}) ON CONFLICT (member_id, track_id) DO NOTHING`;
        else await db.sql`DELETE FROM halo_dj_vault_votes WHERE member_id = ${user.id} AND track_id = ${trackId}`;
        const counted = await db.sql`SELECT COUNT(*)::INT AS votes FROM halo_dj_vault_votes WHERE track_id = ${trackId}`;
        const votes = Number(counted[0]?.votes);
        return json({ success: true, trackId, voted: body.voted, votes: Number.isSafeInteger(votes) && votes >= 0 ? votes : 0 });
      }
      if (["checkout", "confirm"].includes(action)) {
        if (!siteOrigin || new URL(siteOrigin).origin !== url.origin) return json({ message: "Checkout is not configured" }, 503);
        const member = await membershipFor(db, user);
        if (member?.member_id !== user.id) return json({ message: "Membership required" }, 403);
        if (action === "checkout") {
          const existing = await db.sql`SELECT track_id FROM halo_dj_vault_entitlements
            WHERE member_id = ${user.id} AND track_id = ${trackId} AND revoked_at IS NULL`;
          if (existing.length) return json({ entitled: true });
          const available = await purchasableTracks(db, user.id, authorized, trackId);
          if (!available.length) return json({ message: "Edition source assets are unavailable for purchase" }, 409);
          const orderId = randomUUID();
          await db.sql`INSERT INTO halo_dj_vault_orders (id, member_id, track_id, price_pence)
            VALUES (${orderId}, ${user.id}, ${trackId}, ${track.price_pence})`;
          const session = await stripeRequest("checkout/sessions", new URLSearchParams({
            mode: "payment", client_reference_id: orderId,
            success_url: `${url.origin}/dj-vault/?session_id={CHECKOUT_SESSION_ID}&trackId=${trackId}`,
            cancel_url: `${url.origin}/dj-vault/`,
            "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "gbp",
            "line_items[0][price_data][unit_amount]": String(track.price_pence),
            "line_items[0][price_data][product_data][name]": `${track.title} — DJ Vault`,
            "metadata[order_id]": orderId
          }), orderId);
          if (!/^https:\/\/checkout\.stripe\.com\//.test(session.url || "") || !/^cs_[a-zA-Z0-9_]+$/.test(session.id || "")) throw new Error("Invalid checkout session");
          await db.sql`UPDATE halo_dj_vault_orders SET stripe_session_id = ${session.id} WHERE id = ${orderId}`;
          return json({ checkoutUrl: session.url });
        }
        if (!/^cs_[a-zA-Z0-9_]{1,200}$/.test(body.sessionId || "")) return json({ message: "Invalid session" }, 400);
        const orders = await db.sql`SELECT * FROM halo_dj_vault_orders
          WHERE stripe_session_id = ${body.sessionId} AND member_id = ${user.id} AND track_id = ${trackId}`;
        const order = orders[0];
        if (!order) return json({ message: "Order unavailable" }, 404);
        const session = await stripeRequest(`checkout/sessions/${body.sessionId}`);
        if (session.payment_status !== "paid" || session.status !== "complete" || session.mode !== "payment"
          || session.currency !== "gbp" || session.amount_total !== Number(order.price_pence)
          || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id) {
          return json({ message: "Payment is not verified" }, 409);
        }
        const revoked = await db.sql`SELECT revoked_at FROM halo_dj_vault_entitlements
          WHERE member_id = ${user.id} AND track_id = ${trackId} AND revoked_at IS NOT NULL`;
        if (revoked.length) return json({ message: "This entitlement has been revoked" }, 403);
        const available = await purchasableTracks(db, user.id, authorized, trackId);
        if (!available.length) return json({ message: "Edition source assets are unavailable for purchase" }, 409);
        await db.sql`
          WITH paid AS (
            UPDATE halo_dj_vault_orders SET status = 'paid'
            WHERE id = ${order.id} AND member_id = ${user.id} RETURNING id, track_id
          ), granted AS (
            INSERT INTO halo_dj_vault_entitlements (member_id, track_id, order_id)
            SELECT ${user.id}, track_id, id FROM paid
            ON CONFLICT (member_id, track_id) DO NOTHING RETURNING track_id
          ) INSERT INTO halo_dj_vault_access_logs (member_id, track_id, action)
            SELECT ${user.id}, track_id, 'purchase' FROM granted
        `;
        return json({ entitled: true });
      }
      if (action === "download") {
        const entitlements = await db.sql`SELECT track_id FROM halo_dj_vault_entitlements
          WHERE member_id = ${user.id} AND track_id = ${trackId} AND revoked_at IS NULL`;
        if (!entitlements.length) return json({ message: "Acquire this edition first" }, 403);
      }
      const preview = action === "preview";
      const files = await db.sql`
        SELECT f.* FROM halo_stem_files f JOIN halo_stem_packs p ON p.id = f.pack_id
        WHERE f.pack_id = ${preview ? track.preview_pack_id : track.delivery_pack_id}
          AND f.stem_type = ${preview ? track.preview_stem : track.delivery_stem}
          AND (p.status = 'private' OR (${!preview} AND p.status = 'archived')) AND p.rights_attested = TRUE
      `;
      const file = files[0];
      if (!file) return json({ message: "Audio unavailable" }, 404);
      const size = Number(file.byte_size);
      let start = 0, end = size - 1;
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "private, no-store" } });
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "private, no-store" } });
        }
      }
      if (user?.id && authorized) await db.sql`INSERT INTO halo_dj_vault_access_logs (member_id, track_id, action)
        VALUES (${user.id}, ${trackId}, ${preview ? "preview" : "download"})`;
      let chunkIndex = 0, byteOffset = 0, written = 0;
      const audio = new ReadableStream({
        async pull(controller) {
          try {
            while (chunkIndex < file.chunk_count && byteOffset <= end) {
              const part = await store.get(`${file.blob_key}${String(chunkIndex++).padStart(3, "0")}`, { type: "arrayBuffer" });
              if (!part) throw new Error("Missing audio chunk");
              const bytes = new Uint8Array(part);
              const slice = bytes.subarray(Math.max(0, start - byteOffset), Math.max(0, Math.min(bytes.length, end - byteOffset + 1)));
              byteOffset += bytes.length;
              if (slice.length) {
                written += slice.length;
                controller.enqueue(slice);
                if (written === end - start + 1) controller.close();
                return;
              }
            }
            if (written !== end - start + 1) throw new Error("Incomplete audio");
            controller.close();
          } catch (error) { controller.error(error); }
        }
      });
      return new Response(audio, { status: range ? 206 : 200, headers: {
        "Content-Type": file.content_type, "Content-Length": String(end - start + 1),
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="halo-${track.id}.${preview ? "preview" : track.delivery_format}"`,
        "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
      } });
    } catch {
      return json({ message: "DJ Vault is temporarily unavailable" }, 503);
    }
  };
}

export default async function handler(request) {
  const [{ getDatabase }, { getUser }, { getStore }, { ensureMembership }] = await Promise.all([
    import("@netlify/database"), import("@netlify/identity"), import("@netlify/blobs"), import("../lib/halo-x.mjs")
  ]);
  const stripeRequest = async (path, body, idempotencyKey) => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Payments unavailable");
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + key, ...(body ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey } : {}) },
      body, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("Payment provider unavailable");
    return response.json();
  };
  return createDjVaultHandler({ getDatabase, getUser, membershipFor: ensureMembership,
    store: getStore({ name: "halo-stem-vault", consistency: "strong" }), stripeRequest,
    siteOrigin: process.env.DJ_VAULT_SITE_ORIGIN })(request);
}

export const config = { path: ["/api/dj-vault/tracks", "/api/dj-vault/session", "/api/dj-vault/routing",
  "/api/dj-vault/checkout", "/api/dj-vault/confirm", "/api/dj-vault/vote", "/api/dj-vault/entitlements", "/api/dj-vault/preview", "/api/dj-vault/download"] };
