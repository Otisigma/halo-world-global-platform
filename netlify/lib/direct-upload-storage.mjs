// Direct-to-storage uploads for large master audio files.
// The browser PUTs the file straight to S3-compatible object storage (AWS S3, Cloudflare R2,
// Backblaze B2, MinIO, Supabase Storage S3) using a short-lived presigned URL, so 50MB+ WAV/M4A
// masters never pass through Netlify function request payloads. Signing uses AWS SigV4 query
// authentication implemented with node:crypto, so no storage SDK dependency is required.
import { createHash, createHmac, randomUUID } from "node:crypto";

export const MASTER_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const MASTER_UPLOAD_URL_TTL_SECONDS = 900;
export const MASTER_PLAYBACK_URL_TTL_SECONDS = 300;
export const MASTER_OBJECT_PREFIX = "masters";

const CONTENT_TYPE_ALIASES = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "video/mp4": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "application/ogg": "audio/ogg",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-flac": "audio/flac",
  "application/x-flac": "audio/flac",
};
const ALLOWED_MASTER_TYPES = new Set(["audio/wav", "audio/mp4", "audio/flac", "audio/aac", "audio/mpeg", "audio/ogg", "audio/webm"]);
const EXTENSION_TYPES = { wav: "audio/wav", m4a: "audio/mp4", mp4: "audio/mp4", flac: "audio/flac", aac: "audio/aac", mp3: "audio/mpeg", ogg: "audio/ogg", webm: "audio/webm" };

/** Reads S3-compatible storage settings; returns null when direct uploads are not configured. */
export function directUploadConfig(env = process.env) {
  const bucket = String(env.HALO_MASTER_STORAGE_BUCKET || "").trim();
  const region = String(env.HALO_MASTER_STORAGE_REGION || "").trim() || "us-east-1";
  const accessKeyId = String(env.HALO_MASTER_STORAGE_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.HALO_MASTER_STORAGE_SECRET_ACCESS_KEY || "").trim();
  const endpoint = String(env.HALO_MASTER_STORAGE_ENDPOINT || "").trim().replace(/\/+$/, "");
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  if (endpoint && !/^https:\/\//i.test(endpoint)) return null;
  const forcePathStyle = endpoint ? String(env.HALO_MASTER_STORAGE_FORCE_PATH_STYLE || "true").toLowerCase() !== "false" : false;
  return { bucket, region, accessKeyId, secretAccessKey, endpoint, forcePathStyle };
}

export function normalizeMasterContentType(value, filename = "") {
  const contentType = String(value || "").split(";")[0].trim().toLowerCase();
  const aliased = CONTENT_TYPE_ALIASES[contentType] || contentType;
  if (ALLOWED_MASTER_TYPES.has(aliased)) return aliased;
  const extension = String(filename || "").split(".").pop()?.toLowerCase() || "";
  return EXTENSION_TYPES[extension] || "";
}

export function safeMasterFilename(value) {
  const name = String(value || "").normalize("NFKD").replace(/[^\w. -]+/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 120);
  return name || "master-audio";
}

/** Validates master upload metadata before any URL is issued. */
export function validateMasterUpload({ filename, contentType, fileSize } = {}) {
  const byteSize = Number(fileSize);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) return { ok: false, status: 400, message: "The master file size is missing or invalid" };
  if (byteSize > MASTER_UPLOAD_MAX_BYTES) return { ok: false, status: 413, message: `Master copies are limited to ${MASTER_UPLOAD_MAX_BYTES / 1024 / 1024} MB` };
  const normalizedType = normalizeMasterContentType(contentType, filename);
  if (!normalizedType) return { ok: false, status: 415, message: "Upload a WAV, M4A, FLAC, AAC, MP3, OGG, or WebM master file" };
  return { ok: true, byteSize, contentType: normalizedType, filename: safeMasterFilename(filename) };
}

const keySegment = value => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80) || "unknown";

/** The private object prefix a version's master uploads must live under. */
export function masterObjectPrefix({ ownerMemberId, songId, versionId }) {
  return `${MASTER_OBJECT_PREFIX}/${keySegment(ownerMemberId)}/${keySegment(songId)}/${keySegment(versionId)}/`;
}

export function buildMasterObjectKey({ ownerMemberId, songId, versionId, uploadId, filename }) {
  return `${masterObjectPrefix({ ownerMemberId, songId, versionId })}${keySegment(uploadId)}/${safeMasterFilename(filename)}`;
}

export function isOwnedMasterObjectKey(fileKey, scope) {
  const key = String(fileKey || "");
  const prefix = masterObjectPrefix(scope);
  return key.startsWith(prefix) && !key.includes("..") && /^[\w./ -]+$/.test(key) && key.length <= 400;
}

const encodeRfc3986 = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256Hex = value => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

function objectLocation(config, key) {
  const encodedKey = key.split("/").map(encodeRfc3986).join("/");
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    const basePath = endpoint.pathname.replace(/\/+$/, "");
    if (config.forcePathStyle) {
      return { origin: endpoint.origin, host: endpoint.host, path: `${basePath}/${encodeRfc3986(config.bucket)}/${encodedKey}` };
    }
    const host = `${config.bucket}.${endpoint.host}`;
    return { origin: `${endpoint.protocol}//${host}`, host, path: `${basePath}/${encodedKey}` };
  }
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  return { origin: `https://${host}`, host, path: `/${encodedKey}` };
}

/**
 * Creates an AWS SigV4 presigned URL for an S3-compatible object.
 * PUT URLs also sign Content-Type so the browser must upload exactly the validated type.
 */
export function presignObjectUrl({ config, method = "GET", key, contentType = "", queryParams = {}, requestHeaders = {}, expiresIn = MASTER_UPLOAD_URL_TTL_SECONDS, now = new Date() }) {
  if (!config) throw new Error("Direct storage is not configured");
  const verb = String(method).toUpperCase();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const { origin, host, path } = objectLocation(config, key);
  const headers = { ...requestHeaders, host };
  if (["PUT", "POST"].includes(verb) && contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const query = {
    ...queryParams,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.round(expiresIn)))),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort().map(name => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`).join("&");
  const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${String(headers[name]).trim()}\n`).join("");
  const canonicalRequest = [verb, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Confirms the uploaded object exists server-side without downloading it. Returns its byte size or 0. */
export async function headStoredObject(config, key, fetchImpl = fetch) {
  const response = await fetchImpl(presignObjectUrl({ config, method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" });
  if (!response.ok) return 0;
  return Number(response.headers.get("content-length") || 0);
}

/** Multipart registration must distinguish missing objects from retryable storage failures. */
export async function headStoredObjectStrict(config, key, fetchImpl = fetch) {
  const response = await fetchImpl(presignObjectUrl({ config, method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" });
  if (response.status === 404) return 0;
  if (!response.ok) throw masterUploadError("Master storage could not verify registration. Please retry.", 503);
  const byteSize = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) throw masterUploadError("Master storage returned an invalid registration response. Please retry.", 503);
  return byteSize;
}

export async function deleteStoredObject(config, key, fetchImpl = fetch) {
  if (!config || !key) return;
  await fetchImpl(presignObjectUrl({ config, method: "DELETE", key, expiresIn: 60 }), { method: "DELETE" });
}

export const MASTER_MULTIPART_CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const masterUploadError = (message, status = 409) => Object.assign(new Error(message), { status });
const escapeXml = value => String(value).replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[char]));
const xmlValue = (xml, tag) => {
  const value = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] || "";
  return value.replace(/&(?:quot|apos|lt|gt|amp);/g, entity => ({ "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" }[entity]));
};

async function multipartRequest(storage, session, method, queryParams, { body, contentType = "", requestHeaders = {}, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(presignObjectUrl({ config: storage, key: session.key, method, queryParams, contentType, requestHeaders, expiresIn: 120 }), {
    method, headers: { ...requestHeaders, ...(contentType ? { "Content-Type": contentType } : {}) }, body,
  });
  const xml = await response.text();
  if (!response.ok || /<Error(?:\s|>)/.test(xml)) {
    throw Object.assign(masterUploadError("Master storage could not confirm the upload. Please retry.", 503), { storageCode: xmlValue(xml, "Code") });
  }
  return xml;
}

/** Stable, authenticated scope + content identity; no bearer storage URL is persisted in the browser. */
export function masterSessionKey(scope, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ""))) throw masterUploadError("A SHA-256 file fingerprint is required.", 400);
  return `sessions/${sha256Hex(JSON.stringify([scope.ownerMemberId, scope.songId, scope.versionId, fingerprint]))}`;
}

function assertSession(session, scope, fingerprint, upload) {
  if (!session || session.ownerMemberId !== scope.ownerMemberId || session.songId !== scope.songId || session.versionId !== scope.versionId
    || session.fingerprint !== fingerprint || session.byteSize !== upload.byteSize || session.filename !== upload.filename || session.contentType !== upload.contentType) {
    throw masterUploadError("The master upload metadata does not match this session.");
  }
  if (session.chunkSize !== MASTER_MULTIPART_CHUNK_BYTES || !isOwnedMasterObjectKey(session.key, scope)) throw masterUploadError("Invalid master upload session.");
}

/** Verify identity as well as length, including when CompleteMultipartUpload's response was lost. */
async function verifiedMultipartObject(storage, session, fetchImpl) {
  const response = await fetchImpl(presignObjectUrl({ config: storage, method: "HEAD", key: session.key, expiresIn: 60 }), { method: "HEAD" });
  if (response.status === 404) return false;
  if (!response.ok) throw masterUploadError("Master storage could not verify the completed object. Please retry.", 503);
  if (Number(response.headers.get("content-length")) !== session.byteSize
    || response.headers.get("content-type")?.split(";")[0] !== session.contentType
    || response.headers.get("x-amz-meta-halo-session") !== session.objectToken) {
    throw masterUploadError("The stored master object does not match this upload.");
  }
  return true;
}

export async function masterMultipartProgress(storage, session, fetchImpl = fetch, readSession) {
  if (await verifiedMultipartObject(storage, session, fetchImpl)) return { uploadedBytes: session.byteSize, complete: true, parts: [] };
  if (session.state === "completed") throw masterUploadError("The completed master object is no longer available.", 410);
  if (Date.parse(session.expiresAt) <= Date.now()) throw masterUploadError("This master upload session has expired.", 410);
  let xml;
  try {
    xml = await multipartRequest(storage, session, "GET", { uploadId: session.storageUploadId }, { fetchImpl });
  } catch (error) {
    if (error.storageCode !== "NoSuchUpload") throw error;
    // Completion may win between HEAD and ListParts.
    if (await verifiedMultipartObject(storage, session, fetchImpl)) return { uploadedBytes: session.byteSize, complete: true, parts: [] };
    throw masterUploadError("This master upload session has expired.", 410);
  }
  if (readSession) {
    const current = await readSession();
    if (current?.storageUploadId !== session.storageUploadId || current.objectToken !== session.objectToken) {
      throw masterUploadError("The master upload generation changed. Recheck its status.");
    }
    session = current;
  }
  if (xmlValue(xml, "IsTruncated") === "true") throw masterUploadError("Unexpected truncated master part list.");
  const parts = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(match => ({
    number: Number(xmlValue(match[1], "PartNumber")), size: Number(xmlValue(match[1], "Size")), etag: xmlValue(match[1], "ETag"),
    checksum: xmlValue(match[1], "ChecksumSHA256"),
  }));
  let uploadedBytes = 0;
  for (const [index, part] of parts.entries()) {
    if (part.number !== index + 1 || uploadedBytes >= session.byteSize
      || part.size !== Math.min(session.chunkSize, session.byteSize - uploadedBytes) || !part.etag
      || part.checksum !== session.partChecksums?.[part.number]) {
      throw masterUploadError("The stored master parts have invalid sizes or non-contiguous offsets.");
    }
    uploadedBytes += part.size;
  }
  return { uploadedBytes, complete: false, parts };
}

export async function ensureMasterMultipartSession({ store, storage, scope, fingerprint, upload, create = false, renew = false, renewUploadId = "", expectedStorageKey = null, expectedBlobPrefix = "", expectedRevision = "", fetchImpl = fetch }) {
  const sessionKey = masterSessionKey(scope, fingerprint);
  let saved = await store.getWithMetadata(sessionKey, { type: "json" });
  if (saved) assertSession(saved.data, scope, fingerprint, upload);
  if (saved && !saved.etag) throw masterUploadError("Master session conditional writes are unavailable.", 503);
  if (renew && saved?.data?.storageUploadId !== renewUploadId) return { sessionKey, session: saved.data, etag: saved.etag };
  if (!saved || renew) {
    if (!create) throw masterUploadError("Create a master upload session first.", 404);
    const previous = saved;
    if (previous) {
      await store.setJSON(`${sessionKey}/generations/${previous.data.objectToken}`, previous.data, { onlyIfNew: true });
    }
    const objectToken = randomUUID();
    const candidate = {
      ...scope, fingerprint, byteSize: upload.byteSize, filename: upload.filename, contentType: upload.contentType,
      chunkSize: MASTER_MULTIPART_CHUNK_BYTES, objectToken, state: "active", expectedStorageKey, expectedBlobPrefix, expectedRevision, partChecksums: {},
      key: buildMasterObjectKey({ ...scope, uploadId: objectToken, filename: upload.filename }),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
    };
    const xml = await multipartRequest(storage, candidate, "POST", { uploads: "" }, {
      contentType: candidate.contentType, requestHeaders: { "x-amz-meta-halo-session": objectToken, "x-amz-checksum-algorithm": "SHA256" }, fetchImpl,
    });
    candidate.storageUploadId = xmlValue(xml, "UploadId");
    if (!candidate.storageUploadId) throw masterUploadError("Master storage did not create a session.", 503);
    let writeError;
    try { await store.setJSON(sessionKey, candidate, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true }); } catch (error) { writeError = error; }
    // Reading back resolves both a concurrent create and an acknowledged write whose response was lost.
    saved = await store.getWithMetadata(sessionKey, { type: "json" });
    if (saved?.data?.storageUploadId !== candidate.storageUploadId) {
      await multipartRequest(storage, candidate, "DELETE", { uploadId: candidate.storageUploadId }, { fetchImpl }).catch(() => undefined);
    } else if (previous) {
      await multipartRequest(storage, previous.data, "DELETE", { uploadId: previous.data.storageUploadId }, { fetchImpl }).catch(() => undefined);
    }
    if (!saved) throw writeError || masterUploadError("The master upload session could not be saved.", 503);
  }
  assertSession(saved.data, scope, fingerprint, upload);
  return { sessionKey, session: saved.data, etag: saved.etag };
}

export async function masterMultipartAction({ action, store, storage, scope, fingerprint, upload, generationId, startByte, partChecksum, expectedStorageKey = null, expectedBlobPrefix = "", expectedRevision = "", fetchImpl = fetch }) {
  let saved = await ensureMasterMultipartSession({ store, storage, scope, fingerprint, upload, create: action === "create", expectedStorageKey, expectedBlobPrefix, expectedRevision, fetchImpl });
  if (action === "create" && saved.session.state === "completed"
    && (saved.session.registered || saved.session.expectedRevision !== expectedRevision)
    && (expectedStorageKey !== saved.session.key || expectedBlobPrefix)) {
    saved = await ensureMasterMultipartSession({ store, storage, scope, fingerprint, upload, create: true, renew: true,
      renewUploadId: saved.session.storageUploadId, expectedStorageKey, expectedBlobPrefix, expectedRevision, fetchImpl });
  }
  if (action !== "create" && generationId && generationId !== saved.session.objectToken) {
    if (!/^[0-9a-f-]{36}$/.test(String(generationId))) throw masterUploadError("Invalid master upload generation.", 400);
    const archiveKey = `${saved.sessionKey}/generations/${generationId}`;
    const archive = await store.getWithMetadata(archiveKey, { type: "json" });
    if (!archive) throw masterUploadError("This master upload generation is no longer available.", 410);
    assertSession(archive.data, scope, fingerprint, upload);
    throw masterUploadError("This master upload generation has been superseded.", 410);
  }
  if (["part", "complete"].includes(action) && generationId !== saved.session.objectToken) throw masterUploadError("A master upload generation is required.", 400);
  let progress;
  const readSession = () => store.get(saved.sessionKey, { type: "json" });
  try { progress = await masterMultipartProgress(storage, saved.session, fetchImpl, readSession); } catch (error) {
    if (action !== "create" || error.status !== 410) throw error;
    saved = await ensureMasterMultipartSession({ store, storage, scope, fingerprint, upload, create: true, renew: true, renewUploadId: saved.session.storageUploadId, expectedStorageKey, expectedBlobPrefix, expectedRevision, fetchImpl });
    progress = await masterMultipartProgress(storage, saved.session, fetchImpl, readSession);
  }
  const refreshed = await store.getWithMetadata(saved.sessionKey, { type: "json" });
  if (refreshed?.data?.storageUploadId !== saved.session.storageUploadId || refreshed.data.objectToken !== saved.session.objectToken) {
    throw masterUploadError("The master upload generation changed. Recheck its status.");
  }
  saved = { ...saved, session: refreshed.data, etag: refreshed.etag };
  const { session } = saved;
  const status = { directUpload: true, generationId: session.objectToken, uploadedBytes: progress.uploadedBytes, chunkSize: session.chunkSize, complete: progress.complete, expiresAt: session.expiresAt };
  if (action === "create" || action === "status") return { ...status, ...(progress.complete ? { fileKey: session.key } : {}) };
  if (action === "part") {
    if (!Number.isSafeInteger(startByte) || startByte !== progress.uploadedBytes || startByte >= session.byteSize || startByte % session.chunkSize || progress.complete) {
      throw masterUploadError("The master upload offset does not match storage.");
    }
    const partSize = Math.min(session.chunkSize, session.byteSize - startByte);
    const number = startByte / session.chunkSize + 1;
    if (!/^[A-Za-z0-9+/]{43}=$/.test(String(partChecksum || "")) || Buffer.from(partChecksum, "base64").toString("base64") !== partChecksum) {
      throw masterUploadError("A valid SHA-256 part checksum is required.", 400);
    }
    if (session.partChecksums?.[number] && session.partChecksums[number] !== partChecksum) throw masterUploadError("This master part is already bound to different file bytes.");
    if (!session.partChecksums?.[number]) {
      await store.setJSON(saved.sessionKey, { ...session, partChecksums: { ...session.partChecksums, [number]: partChecksum } }, { onlyIfMatch: saved.etag });
      const current = await store.get(saved.sessionKey, { type: "json" });
      if (current?.storageUploadId !== session.storageUploadId || current.partChecksums?.[number] !== partChecksum) {
        throw masterUploadError("The master part checksum conflicts with this session.");
      }
    }
    const headers = { "Content-Type": "application/octet-stream", "x-amz-checksum-sha256": partChecksum };
    return { ...status, partSize, headers,
      uploadUrl: presignObjectUrl({ config: storage, method: "PUT", key: session.key, contentType: "application/octet-stream",
        requestHeaders: { "x-amz-checksum-sha256": partChecksum },
        queryParams: { uploadId: session.storageUploadId, partNumber: String(number) } }) };
  }
  if (action !== "complete") throw masterUploadError("Unsupported master upload action.", 400);
  if (progress.uploadedBytes !== session.byteSize) throw masterUploadError("The master upload is incomplete.");
  if (!progress.complete) {
    const body = `<CompleteMultipartUpload>${progress.parts.map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>${escapeXml(part.etag)}</ETag><ChecksumSHA256>${escapeXml(part.checksum)}</ChecksumSHA256></Part>`).join("")}</CompleteMultipartUpload>`;
    try {
      await multipartRequest(storage, session, "POST", { uploadId: session.storageUploadId }, { contentType: "application/xml", body, fetchImpl });
    } catch (error) {
      if (!(await verifiedMultipartObject(storage, session, fetchImpl))) throw error;
    }
  }
  if (!(await verifiedMultipartObject(storage, session, fetchImpl))) throw masterUploadError("Master storage has not confirmed completion. Please retry.", 503);
  if (session.state !== "completed") {
    try {
      const result = await store.setJSON(saved.sessionKey, { ...session, state: "completed", completedAt: new Date().toISOString() }, { onlyIfMatch: saved.etag });
      if (!result.modified) {
        const current = await store.get(saved.sessionKey, { type: "json" });
        if (current?.state !== "completed" || current.storageUploadId !== session.storageUploadId) throw masterUploadError("Master completion changed. Please retry.");
      }
    } catch (error) {
      const current = await store.get(saved.sessionKey, { type: "json" });
      if (current?.state !== "completed" || current.storageUploadId !== session.storageUploadId) throw error;
    }
  }
  return { ...status, complete: true, fileKey: session.key, expectedStorageKey: session.expectedStorageKey, expectedBlobPrefix: session.expectedBlobPrefix, expectedRevision: session.expectedRevision };
}

export async function markMasterMultipartRegistered({ store, scope, fingerprint, generationId }) {
  const key = masterSessionKey(scope, fingerprint);
  const saved = await store.getWithMetadata(key, { type: "json" });
  if (!saved?.etag || saved.data.objectToken !== generationId || saved.data.state !== "completed") throw masterUploadError("The registered master generation changed. Please retry.");
  if (saved.data.registered) return;
  try {
    await store.setJSON(key, { ...saved.data, registered: true }, { onlyIfMatch: saved.etag });
  } catch (error) {
    const current = await store.get(key, { type: "json" });
    if (current?.objectToken !== generationId || !current.registered) throw error;
  }
  const current = await store.get(key, { type: "json" });
  if (current?.objectToken !== generationId || !current.registered) throw masterUploadError("The registered master generation changed. Please retry.");
}
