import { randomUUID } from "node:crypto";

// DJ Mix ingest: selector/admin operators upload a finished mix in chunks, then publish it
// as a catalog record that the DJ Vault shop front and /mixes listing read from /api/mixes.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-wav"]);
const typeAliases = {
  "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "video/mp4": "audio/mp4",
  "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "application/ogg": "audio/ogg"
};
const extensionTypes = [[/\.mp3$/i, "audio/mpeg"], [/\.wav$/i, "audio/wav"], [/\.(?:m4a|mp4)$/i, "audio/mp4"],
  [/\.aac$/i, "audio/aac"], [/\.ogg$/i, "audio/ogg"], [/\.webm$/i, "audio/webm"]];
// Keep in sync with dj-vault/upload-mix.js (client chunk size must stay below MAX_CHUNK_BYTES).
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNKS = 64;
export const MAX_MIX_BYTES = 128 * 1024 * 1024;
export const DEFAULT_BPM = 122;
export const DEFAULT_GENRE = "Deep / Afro House";
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
});
const clean = (value, max) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

export function normalizeMixContentType(value, filename = "") {
  const type = clean(value, 80).split(";")[0].toLowerCase();
  if (typeAliases[type]) return typeAliases[type];
  if (allowedTypes.has(type)) return type === "audio/x-wav" ? "audio/wav" : type;
  const match = extensionTypes.find(([pattern]) => pattern.test(clean(filename, 200)));
  return match ? match[1] : "";
}

// The declared type is only a hint; the stored content type comes from the file signature.
export function sniffAudioType(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const ascii = (offset, text) => b.length >= offset + text.length && [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(4, "ftyp")) return "audio/mp4";
  if (ascii(0, "ID3")) return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  return "";
}

export function validateMixMetadata(body) {
  const title = clean(body?.title, 120);
  if (title.length < 2 || title.length > 100) return { error: "Add a mix title between 2 and 100 characters." };
  const rawBpm = body?.bpm === undefined || body?.bpm === null || body?.bpm === "" ? DEFAULT_BPM : Number(body.bpm);
  if (!Number.isInteger(rawBpm) || rawBpm < 60 || rawBpm > 200) return { error: "BPM must be a whole number from 60 to 200." };
  const genre = clean(body?.genre, 80) || DEFAULT_GENRE;
  if (genre.length > 60) return { error: "Keep the genre under 60 characters." };
  if (body?.rightsAttested !== true) return { error: "Confirm you hold the rights to publish this mix." };
  const durationSeconds = Number(body?.durationSeconds || 0);
  return {
    title, bpm: rawBpm, genre,
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, Math.min(43200, Math.round(durationSeconds))) : 0
  };
}

const blobPrefixFor = (memberId, uploadId) => `${memberId}/${uploadId}/master/parts/`;

export function createUploadMixHandler({ getDatabase, getUser, membershipFor, store }) {
  return async function uploadMix(request) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    const url = new URL(request.url);
    // Explicit origin validation also protects cookie sessions under the compat adapter.
    if (request.headers.get("origin") !== url.origin) return json({ message: "Cross-origin uploads are not accepted" }, 403);
    try {
      const user = await getUser(request);
      if (!user?.id) return json({ message: "Sign in to upload DJ mixes" }, 401);
      const db = await getDatabase();
      const roles = await db.sql`SELECT role FROM halo_dj_vault_roles WHERE member_id = ${user.id}`;
      if (!["selector", "admin"].includes(roles[0]?.role)) return json({ message: "Selector or admin DJ Vault access is required to publish mixes" }, 403);
      const contentType = request.headers.get("content-type") || "";
      if (contentType.startsWith("multipart/form-data")) return await uploadChunk(request, db, user);
      if (contentType.startsWith("application/json")) return await publish(request, db, user);
      return json({ message: "Send the mix as multipart chunks, then publish with JSON" }, 415);
    } catch (error) {
      console.error("HALO DJ mix ingest failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "The mix could not be saved right now. Your upload is safe to retry." }, 503);
    }
  };

  async function existingMix(db, id) {
    const rows = await db.sql`SELECT id, member_id, title FROM halo_mixes WHERE id = ${id}`;
    return rows[0] || null;
  }

  async function uploadChunk(request, db, user) {
    let form;
    try { form = await request.formData(); } catch { return json({ message: "The mix upload could not be read" }, 400); }
    const chunk = form.get("chunk");
    if (!(chunk instanceof Blob) || !chunk.size) return json({ message: "Attach an audio file before uploading" }, 400);
    if (chunk.size > MAX_CHUNK_BYTES) return json({ message: "That upload chunk is too large" }, 413);
    const uploadId = clean(form.get("uploadId"), 80);
    const chunkIndex = Number(form.get("chunkIndex"));
    const chunkCount = Number(form.get("chunkCount"));
    if (!uuid.test(uploadId) || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount)
      || chunkCount < 1 || chunkCount > MAX_CHUNKS || chunkIndex < 0 || chunkIndex >= chunkCount) {
      return json({ message: "The mix upload sequence is invalid" }, 400);
    }
    if (!normalizeMixContentType(form.get("contentType") || chunk.type, chunk.name)) {
      return json({ message: "Upload an MP3, WAV, M4A, AAC, OGG, or WebM audio file" }, 415);
    }
    if (chunkIndex === 0 && !sniffAudioType(new Uint8Array(await chunk.slice(0, 16).arrayBuffer()))) {
      return json({ message: "That file does not look like a supported audio recording" }, 415);
    }
    // Published audio is immutable; a retry after a lost publish response skips straight to publish.
    const existing = await existingMix(db, uploadId);
    if (existing) {
      return existing.member_id === user.id
        ? json({ message: "Mix already published", chunkIndex, alreadyPublished: true })
        : json({ message: "That upload belongs to another account" }, 409);
    }
    const prefix = blobPrefixFor(user.id, uploadId);
    // Later chunks only attach to an upload whose verified first chunk already exists.
    if (chunkIndex > 0) {
      const first = await store.getMetadata(`${prefix}000`);
      if (!first) return json({ message: "Upload the start of the mix first" }, 409);
      if (Number(first.metadata?.chunkCount) !== chunkCount) return json({ message: "This chunk belongs to a different upload; submit again to restart" }, 409);
    }
    // Keys are deterministic per member/upload/chunk, so retried chunks overwrite instead of duplicating.
    await store.set(`${prefix}${String(chunkIndex).padStart(3, "0")}`, chunk, { metadata: { size: chunk.size, chunkCount } });
    return json({ message: "Mix chunk uploaded", chunkIndex });
  }

  async function publish(request, db, user) {
    const raw = await request.text();
    if (raw.length > 8000) return json({ message: "Request too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ message: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ message: "Invalid body" }, 400);
    const metadata = validateMixMetadata(body);
    if (metadata.error) return json({ message: metadata.error }, 400);
    const uploadId = clean(body.uploadId, 80);
    const chunkCount = Number(body.chunkCount);
    const byteSize = Number(body.byteSize);
    if (!uuid.test(uploadId) || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS
      || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_MIX_BYTES || byteSize > chunkCount * MAX_CHUNK_BYTES) {
      return json({ message: "Attach an audio file under 128 MB before publishing" }, 400);
    }
    const id = uploadId;
    const blobPrefix = blobPrefixFor(user.id, uploadId);
    const salesPageUrl = `/mixes/?mix=${encodeURIComponent(id)}#editions`;
    const vaultUrl = `/dj-vault/?mix=${encodeURIComponent(id)}`;
    const published = mix => json({ message: `"${mix.title}" is already published in the DJ Vault.`, id, status: "published",
      alreadyPublished: true, vaultUrl, salesPageUrl });

    // Retrying a publish that already succeeded is safe and returns the existing record.
    const prior = await existingMix(db, id);
    if (prior) return prior.member_id === user.id ? published(prior) : json({ message: "That upload belongs to another account" }, 409);

    // Exactly parts 000..N-1 must exist, every part but the last must share one size (range reads
    // depend on it), and the stored total must match the declared size.
    const expected = Array.from({ length: chunkCount }, (_, index) => `${blobPrefix}${String(index).padStart(3, "0")}`);
    const stored = await store.list({ prefix: blobPrefix });
    const storedKeys = new Set(stored.blobs.map(blob => blob.key));
    if (!expected.every(key => storedKeys.has(key))) return json({ message: "The mix upload is incomplete. Submit again to resume." }, 409);
    const parts = await Promise.all(expected.map(async key => (await store.getMetadata(key))?.metadata || {}));
    const sizes = parts.map(part => Number(part.size));
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (storedKeys.size !== chunkCount || parts.some(part => Number(part.chunkCount) !== chunkCount)
      || sizes.some((size, index) => !Number.isSafeInteger(size) || size < 1 || (index < chunkCount - 1 && size !== sizes[0]))
      || total !== byteSize) {
      // Stale or mismatched parts are cleared so the client's retry re-uploads a clean set.
      await Promise.all([...storedKeys].map(key => store.delete(key))).catch(() => undefined);
      return json({ message: "The uploaded parts do not match this mix. Submit again to re-upload it." }, 409);
    }
    const first = await store.get(`${blobPrefix}000`, { type: "arrayBuffer" });
    const contentType = first ? sniffAudioType(new Uint8Array(first).subarray(0, 16)) : "";
    if (!contentType) return json({ message: "That file does not look like a supported audio recording" }, 415);

    const membership = await membershipFor(db, user);
    if (membership?.member_id !== user.id) return json({ message: "Membership required" }, 403);
    const description = `${metadata.genre} · ${metadata.bpm} BPM DJ mix`;
    const releaseMetadata = JSON.stringify({
      bpm: metadata.bpm, genre: metadata.genre, publicationStatus: "published", uploadSource: "dj_mix_ingest",
      salesPageUrl, vaultUrl, rightsAttested: true, clientSaleEnabled: false
    });
    // One statement: the mix row and its catalog release plan are written together or not at all.
    const rows = await db.sql`
      WITH mix AS (
        INSERT INTO halo_mixes (
          id, member_id, actor_id, title, description, blob_key, chunk_count, content_type, byte_size,
          duration_seconds, track_count, visibility, remixer_name, sales_status, upload_source,
          production_route, seller_mode, client_sale_enabled, mixing_fee_included, rights_attested,
          edition_format, price_minor, currency, product_info_complete, master_approved, rights_clearance_status
        ) VALUES (
          ${id}, ${membership.member_id}, ${membership.actor_id}, ${metadata.title}, ${description}, ${blobPrefix},
          ${chunkCount}, ${contentType}, ${byteSize}, ${metadata.durationSeconds}, 0, 'room',
          ${clean(membership.display_name, 100) || "DJ HALO X"}, 'stream_only', 'creator_desk',
          'self_mixed', 'halo_managed', FALSE, FALSE, TRUE,
          ${contentType === "audio/wav" ? "wav_bundle" : "mp3"}, 0, 'USD', FALSE, TRUE, 'confirmed'
        )
        ON CONFLICT DO NOTHING
        RETURNING id, title
      ), plan AS (
        INSERT INTO halo_mix_release_plans (
          id, member_id, mix_id, title, current_step, release_format, mastering_status,
          target_lufs, true_peak_dbtp, rights_confirmed, sale_ready, metadata, demand_brief
        )
        SELECT ${randomUUID()}, ${membership.member_id}, mix.id, mix.title, 5, 'free_stream', 'approved',
          -14.0, -1.0, TRUE, FALSE, ${releaseMetadata}::jsonb, '{}'::jsonb
        FROM mix
        RETURNING mix_id
      )
      SELECT mix.id, mix.title FROM mix JOIN plan ON plan.mix_id = mix.id
    `;
    if (!rows[0]) {
      const raced = await existingMix(db, id);
      if (raced?.member_id === user.id) return published(raced);
      return json({ message: "The mix could not be added to the catalog. Retry publishing." }, 409);
    }
    return json({ message: `"${metadata.title}" is published and live in the DJ Vault.`, id, status: "published",
      alreadyPublished: false, vaultUrl, salesPageUrl, bpm: metadata.bpm, genre: metadata.genre }, 201);
  }
}

export default async function handler(request) {
  const [{ getDatabase }, { getUser }, { getStore }, { ensureMembership }] = await Promise.all([
    import("@netlify/database"), import("@netlify/identity"), import("@netlify/blobs"), import("../lib/halo-x.mjs")
  ]);
  return createUploadMixHandler({ getDatabase, getUser, membershipFor: ensureMembership,
    store: getStore({ name: "halo-mixes", consistency: "strong" }) })(request);
}

export const config = { path: "/api/upload-mix" };
