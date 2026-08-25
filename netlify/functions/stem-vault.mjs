import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const stemStore = getStore({ name: "halo-stem-vault", consistency: "strong" });
const stemTypes = new Set(["full", "drums", "bass", "music", "vocals", "fx"]);
const providers = new Set(["suno", "halo", "other"]);
const allowedTypes = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac"]);
const maxChunkBytes = 4 * 1024 * 1024;
const maxStemBytes = 512 * 1024 * 1024;
const uploadIdPattern = /^[0-9a-f-]{36}$/;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function stemPayload(row) {
  return {
    type: row.stem_type,
    filename: row.original_filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    durationSeconds: Number(row.duration_seconds || 0),
    audioUrl: `/api/stem-vault/audio?pack=${encodeURIComponent(row.pack_id)}&stem=${encodeURIComponent(row.stem_type)}`
  };
}

function packPayload(row, files = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    sourceProvider: row.source_provider,
    sourceProjectUrl: row.source_project_url || "",
    generationPrompt: row.generation_prompt || "",
    bpm: Number(row.bpm),
    key: row.musical_key || "--",
    genre: row.genre || "",
    mood: row.mood || "",
    rightsAttested: Boolean(row.rights_attested),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    stems: files.map(stemPayload)
  };
}

async function authenticatedContext() {
  const [db, user] = await Promise.all([getDatabase(), getUser()]);
  if (!user?.id) return { db, user: null, membership: null };
  const membership = await ensureMembership(db, user);
  return { db, user, membership };
}

async function listPacks(db, memberId) {
  const packs = await db.sql`
    SELECT * FROM halo_stem_packs
    WHERE member_id = ${memberId} AND status = 'private'
    ORDER BY updated_at DESC
    LIMIT 80
  `;
  if (!packs.length) return [];
  const files = await db.sql`
    SELECT file.* FROM halo_stem_files file
    JOIN halo_stem_packs pack ON pack.id = file.pack_id
    WHERE pack.member_id = ${memberId} AND pack.status = 'private'
    ORDER BY file.pack_id, file.stem_type
  `;
  return packs.map(pack => packPayload(pack, files.filter(file => file.pack_id === pack.id)));
}

async function uploadChunk(request, memberId) {
  const form = await request.formData();
  const uploadId = cleanText(form.get("uploadId"), 50).toLowerCase();
  const stemType = cleanText(form.get("stemType"), 20).toLowerCase();
  const chunkIndex = Number.parseInt(form.get("chunkIndex"), 10);
  const chunkCount = Number.parseInt(form.get("chunkCount"), 10);
  const chunk = form.get("chunk");
  if (!uploadIdPattern.test(uploadId) || !stemTypes.has(stemType)) return json({ message: "Stem upload identity is invalid" }, 400);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 0 || chunkCount < 1 || chunkCount > 128 || chunkIndex >= chunkCount) {
    return json({ message: "Stem chunk position is invalid" }, 400);
  }
  if (!(chunk instanceof File) || chunk.size < 1 || chunk.size > maxChunkBytes) return json({ message: "Stem chunk is missing or too large" }, 400);
  const key = `${memberId}/${uploadId}/${stemType}/${String(chunkIndex).padStart(3, "0")}`;
  await stemStore.set(key, chunk, { metadata: { memberId, uploadId, stemType, chunkIndex: String(chunkIndex) } });
  return json({ uploaded: true, chunkIndex });
}

function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(file => {
    const stemType = cleanText(file?.stemType, 20).toLowerCase();
    const contentType = cleanText(file?.contentType, 80).toLowerCase();
    const byteSize = Number(file?.byteSize);
    const chunkCount = Number(file?.chunkCount);
    const durationSeconds = Math.max(0, Math.min(43200, Number(file?.durationSeconds) || 0));
    if (!stemTypes.has(stemType) || seen.has(stemType) || !allowedTypes.has(contentType)) return null;
    if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > maxStemBytes) return null;
    if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 128) return null;
    seen.add(stemType);
    return {
      stemType,
      filename: cleanText(file?.filename, 240) || `${stemType}.wav`,
      contentType,
      byteSize,
      chunkCount,
      durationSeconds
    };
  }).filter(Boolean).slice(0, 6);
}

async function finalizePack(db, memberId, body) {
  const uploadId = cleanText(body.uploadId, 50).toLowerCase();
  const title = cleanText(body.title, 140);
  const sourceProvider = providers.has(body.sourceProvider) ? body.sourceProvider : "suno";
  const bpm = Math.max(40, Math.min(240, Number(body.bpm) || 124));
  const files = cleanFiles(body.files);
  if (!uploadIdPattern.test(uploadId) || title.length < 2) return json({ message: "Name this stem pack before saving it" }, 400);
  if (body.rightsAttested !== true) return json({ message: "Confirm that HALO owns or controls every uploaded stem" }, 400);
  if (files.length < 2) return json({ message: "Add at least two synchronized audio stems" }, 400);
  const measuredDurations = files.map(file => file.durationSeconds).filter(Boolean);
  if (measuredDurations.length > 1 && Math.max(...measuredDurations) - Math.min(...measuredDurations) > 0.25) {
    return json({ message: "Stem lengths must match within a quarter second" }, 400);
  }

  for (const file of files) {
    const prefix = `${memberId}/${uploadId}/${file.stemType}/`;
    const uploaded = await stemStore.list({ prefix });
    if (uploaded.blobs.length !== file.chunkCount) return json({ message: `The ${file.stemType} stem upload is incomplete` }, 409);
  }

  const existing = await db.sql`SELECT id FROM halo_stem_packs WHERE id = ${uploadId} LIMIT 1`;
  if (existing.length) return json({ message: "This stem pack was already saved" }, 409);

  const rows = await db.sql`
    INSERT INTO halo_stem_packs (
      id, member_id, title, description, source_provider, source_project_url,
      generation_prompt, bpm, musical_key, genre, mood, rights_attested, rights_attested_at
    ) VALUES (
      ${uploadId}, ${memberId}, ${title}, ${cleanText(body.description, 600)}, ${sourceProvider},
      ${cleanText(body.sourceProjectUrl, 500)}, ${cleanText(body.generationPrompt, 3000)}, ${bpm},
      ${cleanText(body.key, 12)}, ${cleanText(body.genre, 80)}, ${cleanText(body.mood, 120)}, TRUE, NOW()
    )
    RETURNING *
  `;

  for (const file of files) {
    const blobKey = `${memberId}/${uploadId}/${file.stemType}/`;
    await db.sql`
      INSERT INTO halo_stem_files (
        pack_id, stem_type, original_filename, blob_key, chunk_count, content_type, byte_size, duration_seconds
      ) VALUES (
        ${uploadId}, ${file.stemType}, ${file.filename}, ${blobKey}, ${file.chunkCount},
        ${file.contentType}, ${file.byteSize}, ${file.durationSeconds}
      )
    `;
  }
  const savedFiles = await db.sql`SELECT * FROM halo_stem_files WHERE pack_id = ${uploadId} ORDER BY stem_type`;
  return json({ pack: packPayload(rows[0], savedFiles), message: "Private HALO stem pack saved" }, 201);
}

async function archivePack(db, memberId, body) {
  const packId = cleanText(body.packId, 50).toLowerCase();
  const rows = await db.sql`
    UPDATE halo_stem_packs SET status = 'archived', updated_at = NOW()
    WHERE id = ${packId} AND member_id = ${memberId} AND status = 'private'
    RETURNING id
  `;
  return rows.length ? json({ archived: true }) : json({ message: "Stem pack not found" }, 404);
}

export default async function stemVaultHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const { db, user, membership } = await authenticatedContext();
    if (!user?.id || !membership?.member_id) return json({ authenticated: false, packs: [], message: "Sign in to open the private stem vault" }, 401);
    if (request.method === "GET") return json({ authenticated: true, packs: await listPacks(db, membership.member_id) });
    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) return uploadChunk(request, membership.member_id);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);
    if (body.action === "finalize") return finalizePack(db, membership.member_id, body);
    if (body.action === "archive") return archivePack(db, membership.member_id, body);
    return json({ message: "Choose a supported stem-vault action" }, 400);
  } catch (error) {
    console.error("HALO stem vault request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The private stem vault is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/stem-vault" };
