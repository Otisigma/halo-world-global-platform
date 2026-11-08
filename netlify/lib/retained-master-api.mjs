import { captureRegisteredMaster, ownedSnapshotVersion, authenticatedSnapshot, verifyRetainedRow } from "./retained-master-service.mjs";
import { verifySnapshot, SNAPSHOT_LIMITATION } from "./retained-master.mjs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (body, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
} });

export function createRetainedMasterHandler(deps) {
  return async request => {
    const params = new URL(request.url).searchParams;
    const action = params.get("action") || "history";
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      if (request.method === "GET" && action === "keys") {
        const keys = deps.publicKeys();
        return json({ algorithm: "Ed25519", keys: [...keys.publicKeys].map(([id, key]) => ({
          id, spki: key.export({ type: "spki", format: "der" }).toString("base64"),
        })), trust: "Trust these keys only through a trusted HALO domain or a separately retained key fingerprint." });
      }
      const recordId = params.get("recordId") || "";
      if (recordId && !ID.test(recordId)) return json({ message: "Invalid snapshot ID" }, 400);
      const db = await deps.database();
      if (request.method === "GET" && action === "public") {
        if (!recordId) return json({ message: "Snapshot ID required" }, 400);
        const rows = await db.sql`
          SELECT * FROM halo_retained_master_snapshots
          WHERE id = ${recordId} AND status = 'ready' AND published_at IS NOT NULL LIMIT 1
        `;
        if (!rows[0]) return json({ message: "Shared snapshot not found" }, 404);
        const row = rows[0];
        const envelope = { record: row.record, signature: row.signature };
        if (!verifySnapshot(envelope, deps.publicKeys()) || row.record.recordId !== row.id
          || row.record.songId !== row.song_id || row.record.versionId !== row.version_id) {
          return json({ message: "Shared snapshot record failed authentication" }, 409);
        }
        return json({ ...envelope, limitation: SNAPSHOT_LIMITATION });
      }
      const user = await deps.user();
      if (!user?.id) return json({ message: "Sign in required" }, 401);
      const owner = (await deps.membership(db, user)).member_id;
      if (request.method === "POST") {
        try { deps.origin(request); } catch { return json({ message: "Cross-origin requests are not accepted" }, 403); }
      }
      if (request.method === "GET" && action === "history") {
        const songId = params.get("songId") || "";
        const versionId = params.get("versionId") || "";
        if (!ID.test(songId) || !ID.test(versionId)) return json({ message: "Song and master IDs required" }, 400);
        if (!(await ownedSnapshotVersion(db, owner, songId, versionId))) return json({ message: "Master not found" }, 404);
        const rows = await db.sql`
          SELECT id, status, published_at, created_at FROM halo_retained_master_snapshots
          WHERE owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
          ORDER BY created_at DESC LIMIT 20
        `;
        return json({ records: rows.map(row => ({ recordId: row.id, state: row.status,
          shared: Boolean(row.published_at), createdAt: row.created_at })), limitation: SNAPSHOT_LIMITATION });
      }
      if (request.method === "POST" && action === "unshare") {
        if (!recordId) return json({ message: "Snapshot ID required" }, 400);
        const updated = await db.sql`UPDATE halo_retained_master_snapshots SET published_at = NULL, updated_at = NOW()
          WHERE id = ${recordId} AND owner_member_id = ${owner} RETURNING id`;
        if (!updated.length) return json({ message: "Snapshot not found" }, 404);
        return json({ shared: false, recordId });
      }
      const config = deps.config();
      if (!config) return json({ code: "retained_storage_unavailable",
        message: "Retained snapshot verification is currently unavailable. No retained stamp is confirmed. Your uploaded audio is unaffected; uploading again will not enable archival verification." }, 503);
      if (request.method === "POST" && action === "capture") {
        if (Number(request.headers.get("content-length")) > 4096) return json({ message: "Capture payload is too large" }, 413);
        const text = await request.text();
        if (text.length > 4096) return json({ message: "Capture payload is too large" }, 413);
        let payload;
        try { payload = JSON.parse(text); } catch { return json({ message: "Capture metadata must be valid JSON" }, 400); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ message: "Invalid capture metadata" }, 400);
        const { songId, versionId, parentRecordId = "", relationship = "original" } = payload;
        if (!ID.test(songId || "") || !ID.test(versionId || "") || (parentRecordId && !ID.test(parentRecordId))
          || !["original", "revision", "remix", "edit"].includes(relationship)
          || (parentRecordId === "") !== (relationship === "original")) return json({ message: "Invalid capture or lineage request" }, 400);
        const result = await captureRegisteredMaster({ db, owner, songId, versionId, parentRecordId, relationship,
          config, keys: deps.signingKeys(), blobStore: deps.blobStore(), sourceStorage: deps.sourceStorage(), fetchImpl: deps.fetch });
        return json(result, result.state === "rate_limited" ? 429 : result.state === "not_eligible" ? 404 : result.state === "pending" ? 202 : 200);
      }
      if (!recordId) return json({ message: "Snapshot ID required" }, 400);
      const rows = await db.sql`
        SELECT * FROM halo_retained_master_snapshots WHERE id = ${recordId} AND owner_member_id = ${owner} LIMIT 1
      `;
      if (!rows[0]) return json({ message: "Snapshot not found" }, 404);
      const row = rows[0];
      if (row.status !== "ready") return json({ message: "Snapshot is not ready for verification or sharing." }, 409);
      const keys = deps.publicKeys();
      const envelope = authenticatedSnapshot(row, keys, config);
      if (request.method === "GET" && action === "manifest") return json({ ...envelope, limitation: SNAPSHOT_LIMITATION });
      if (request.method === "POST" && action === "verify") {
        const permitted = await db.sql`
          INSERT INTO halo_master_provenance_read_limits (owner_member_id, last_started) VALUES (${owner}, NOW())
          ON CONFLICT (owner_member_id) DO UPDATE SET last_started = NOW()
          WHERE halo_master_provenance_read_limits.last_started <= NOW() - INTERVAL '1 minute' RETURNING owner_member_id
        `;
        if (!permitted.length) return json({ message: "Wait one minute before another master read." }, 429);
        return json(await verifyRetainedRow(row, config, keys, deps.fetch));
      }
      if (request.method === "POST" && ["share", "unshare"].includes(action)) {
        const rows = action === "share"
          ? await db.sql`UPDATE halo_retained_master_snapshots SET published_at = NOW(), updated_at = NOW()
              WHERE id = ${recordId} AND owner_member_id = ${owner} AND status = 'ready' RETURNING id`
          : await db.sql`UPDATE halo_retained_master_snapshots SET published_at = NULL, updated_at = NOW()
              WHERE id = ${recordId} AND owner_member_id = ${owner} RETURNING id`;
        if (!rows.length) return json({ message: "Snapshot sharing could not be updated." }, 409);
        return json({ shared: action === "share", recordId });
      }
      return json({ message: "Unsupported snapshot action" }, 400);
    } catch (error) {
      deps.log(JSON.stringify({ event: "retained_master_request_failed" }));
      if (error?.code === "record_invalid") return json({ message: "Retained snapshot record failed authentication." }, 409);
      return json({ message: "Retained snapshot operation failed or its configuration is unavailable. No verification was confirmed." }, 503);
    }
  };
}
