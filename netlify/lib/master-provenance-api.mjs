import { MASTER_UPLOAD_MAX_BYTES } from "./direct-upload-storage.mjs";
import { sealMasterBytes, verifyMasterBytes, verifyProvenanceRecord } from "./master-provenance.mjs";
import { describeMasterSource, readObservedMaster } from "./master-provenance-observation.mjs";

// Platform-independent handler; the Netlify adapter injects identity, database, storage and keys.
const limitation = "This is an observation of bytes read, not a certificate of the current master. Sources can change during or after reading; chunk observations can combine concurrent writes. No immutable copy is retained.";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const validId = (id) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

async function getVersion(db, owner, song, version) {
  const rows = await db.sql`
    SELECT v.audio_storage_key, v.audio_blob_prefix, v.audio_chunk_count, v.audio_byte_size
    FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
    WHERE s.id = ${song} AND v.id = ${version} AND s.owner_member_id = ${owner}
      AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master'
    LIMIT 1
  `;
  return rows[0] || null;
}

const HEX = /^[0-9a-f]{64}$/;
const LIST_DEFAULT = 20;
const LIST_MAX = 50;

function currentSourceId(row, owner, songId, versionId) {
  try { return describeMasterSource(row, owner, songId, versionId).id; } catch { return ""; }
}

// Exposes only public summary fields. Records are not HMAC-checked here, so they are labeled unverified.
function publicObservation(row, sourceId) {
  const record = row.record;
  const time = new Date(record?.createdAt);
  const createdAt = typeof record?.createdAt === "string" && !Number.isNaN(time.getTime())
    && time.toISOString() === record.createdAt ? record.createdAt : null;
  if (!record || typeof record.sha256 !== "string" || !HEX.test(record.sha256) || !Number.isSafeInteger(record.byteSize)
    || !["direct", "chunks"].includes(String(record.sourceType)) || !createdAt) {
    return { observationId: String(row.id), createdAt, malformed: true };
  }
  return {
    observationId: String(row.id),
    createdAt,
    sha256: record.sha256,
    byteSize: record.byteSize,
    sourceType: record.sourceType,
    matchesCurrentSource: Boolean(sourceId) && record.sourceId === sourceId,
    recordAuthenticated: "not_checked",
  };
}

async function listObservations(request, deps) {
  const params = new URL(request.url).searchParams;
  const songId = params.get("songId");
  const versionId = params.get("versionId");
  const limitText = params.get("limit");
  const limit = limitText === null ? LIST_DEFAULT : Number(limitText);
  if (!validId(songId) || !validId(versionId) || !Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) {
    return json({ message: "Invalid observation history request" }, 400);
  }
  const user = await deps.getUser();
  if (!user?.id) return json({ message: "Sign in required" }, 401);
  const db = await deps.getDatabase();
  const owner = (await deps.ensureMembership(db, user)).member_id;
  const version = await getVersion(db, owner, songId, versionId);
  if (!version) return json({ message: "Master not found" }, 404);
  const rows = await db.sql`
    SELECT id, record, created_at FROM halo_master_provenance_observations
    WHERE owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const sourceId = currentSourceId(version, owner, songId, versionId);
  return json({
    songId,
    versionId,
    observations: rows.slice(0, limit).map(row => publicObservation(row, sourceId)),
    hasMore: rows.length > limit,
    limitation,
  });
}

// Returns only fields covered by a successfully authenticated record for browser-local comparison.
async function observationManifest(request, deps) {
  const params = new URL(request.url).searchParams;
  const songId = params.get("songId");
  const versionId = params.get("versionId");
  const observationId = params.get("observationId");
  if (!validId(songId) || !validId(versionId) || !validId(observationId)) return json({ message: "Invalid observation manifest request" }, 400);
  const user = await deps.getUser();
  if (!user?.id) return json({ message: "Sign in required" }, 401);
  const db = await deps.getDatabase();
  const owner = (await deps.ensureMembership(db, user)).member_id;
  if (!(await getVersion(db, owner, songId, versionId))) return json({ message: "Master not found" }, 404);
  const rows = await db.sql`
    SELECT record, mac FROM halo_master_provenance_observations
    WHERE id = ${observationId} AND owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
    LIMIT 1
  `;
  if (!rows[0]) return json({ message: "Observation not found" }, 404);
  const seal = { record: rows[0].record, mac: rows[0].mac };
  let authentic;
  try {
    authentic = verifyProvenanceRecord(seal, deps.loadProvenanceKeys());
  } catch {
    // Missing configuration or a retired key makes the record unverifiable, not invalid.
    return json({ message: "Provenance verification key is unavailable" }, 503);
  }
  const record = seal.record;
  if (!authentic || record.ownerId !== owner || record.songId !== songId || record.versionId !== versionId) {
    return json({ message: "Observation record failed authentication" }, 409);
  }
  return json({ observationId, sha256: record.sha256, byteSize: record.byteSize, createdAt: record.createdAt, limitation });
}

export function createMasterProvenanceHandler(deps) {
  return async function handler(request) { {
  if (request.method === "GET") {
    const getAction = new URL(request.url).searchParams.get("action");
    if (getAction !== null && getAction !== "manifest") return json({ message: "Invalid observation request" }, 400);
    const logged = getAction === "manifest" ? "manifest" : "list";
    try { return getAction === "manifest" ? await observationManifest(request, deps) : await listObservations(request, deps); }
    catch { deps.logError(JSON.stringify({ event: "master_provenance_failed", action: logged })); return json({ message: "Provenance information is unavailable" }, 503); }
  }
  if (request.method !== "POST") return Response.json({ message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
  try { deps.verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin requests are not accepted" }, 403); }
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  const songId = params.get("songId");
  const versionId = params.get("versionId");
  const observationId = params.get("observationId");
  if (!validId(songId) || !validId(versionId) || !["observe", "verify"].includes(String(action)) || (action === "verify" && !validId(observationId))) {
    return json({ message: "Invalid observation request" }, 400);
  }
  try {
    const user = await deps.getUser();
    if (!user?.id) return json({ message: "Sign in required" }, 401);
    const db = await deps.getDatabase();
    const membership = await deps.ensureMembership(db, user);
    const owner = membership.member_id;
    const row = await getVersion(db, owner, songId, versionId);
    if (!row) return json({ message: "Master not found" }, 404);
    const keyring = deps.loadProvenanceKeys();
    let source;
    try { source = describeMasterSource(row, owner, songId, versionId); }
    catch { return json({ message: "No supported stored master is available" }, 409); }
    let seal;
    if (action === "verify") {
      const rows = await db.sql`
        SELECT record, mac FROM halo_master_provenance_observations
        WHERE id = ${observationId} AND owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
        LIMIT 1
      `;
      if (!rows[0]) return json({ message: "Observation not found" }, 404);
      seal = { record: rows[0].record, mac: rows[0].mac };
      if (!verifyProvenanceRecord(seal, keyring) || seal.record.ownerId !== owner || seal.record.songId !== songId || seal.record.versionId !== versionId) {
        return json({ message: "Observation authentication failed" }, 409);
      }
      if (seal.record.sourceId !== source.id || seal.record.sourceType !== source.type || seal.record.byteSize !== source.size) {
        return json({ result: "stale", limitation }, 409);
      }
    }
    // One expensive read per owner per minute, atomically shared between instances and actions.
    const permitted = await db.sql`
      INSERT INTO halo_master_provenance_read_limits (owner_member_id, last_started) VALUES (${owner}, NOW())
      ON CONFLICT (owner_member_id) DO UPDATE SET last_started = NOW()
      WHERE halo_master_provenance_read_limits.last_started <= NOW() - INTERVAL '1 minute'
      RETURNING owner_member_id
    `;
    if (!permitted.length) return json({ message: "Please wait before another observation or verification" }, 429);
    const bytes = readObservedMaster(source, { blobStore: deps.audioStore, storage: deps.storageConfig(), fetchImpl: deps.fetchImpl });
    if (action === "observe") {
      seal = await sealMasterBytes({ bytes, expectedBytes: source.size, maxBytes: MASTER_UPLOAD_MAX_BYTES,
        ownerId: owner, songId, versionId, sourceType: source.type, sourceId: source.id,
        createdAt: deps.now().toISOString(), keyring });
      const id = deps.randomUUID();
      // A single atomic INSERT checks ownership and that the registered source still matches.
      const inserted = await db.sql`
        INSERT INTO halo_master_provenance_observations (id, owner_member_id, song_id, version_id, record, mac)
        SELECT ${id}, ${owner}, ${songId}, ${versionId}, ${JSON.stringify(seal.record)}::jsonb, ${seal.mac}
        FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
        WHERE s.id = ${songId} AND v.id = ${versionId} AND s.owner_member_id = ${owner}
          AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master'
          AND COALESCE(v.audio_storage_key, '') = ${String(row.audio_storage_key || "")}
          AND COALESCE(v.audio_blob_prefix, '') = ${String(row.audio_blob_prefix || "")}
          AND COALESCE(v.audio_chunk_count, 0) = ${Number(row.audio_chunk_count || 0)}
          AND v.audio_byte_size = ${source.size}
        RETURNING id
      `;
      if (!inserted.length) return json({ result: "stale", limitation }, 409);
      return json({ observationId: id, result: "observed", sha256: seal.record.sha256, byteSize: source.size, createdAt: seal.record.createdAt, limitation }, 201);
    }
    const matches = await verifyMasterBytes(seal, bytes, { maxBytes: MASTER_UPLOAD_MAX_BYTES, keyring });
    const after = await getVersion(db, owner, songId, versionId);
    if (!after) return json({ result: "stale", limitation }, 409);
    let afterId;
    try { afterId = describeMasterSource(after, owner, songId, versionId).id; } catch { return json({ result: "stale", limitation }, 409); }
    if (afterId !== source.id) return json({ result: "stale", limitation }, 409);
    return json({ observationId, result: matches ? "observed_bytes_match" : "observed_bytes_differ", limitation });
  } catch {
    // Fixed event only: never log storage URLs, keys, user identifiers, or upstream error text.
    deps.logError(JSON.stringify({ event: "master_provenance_failed", action: action === "verify" ? "verify" : "observe" }));
    return json({ message: "Provenance observation is unavailable or the read was incomplete" }, 503);
  }
}
  };
}
