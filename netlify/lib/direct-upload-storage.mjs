// Direct-to-storage uploads for large master audio files.
// The browser PUTs the file straight to S3-compatible object storage (AWS S3, Cloudflare R2,
// Backblaze B2, MinIO, Supabase Storage S3) using a short-lived presigned URL, so 50MB+ WAV/M4A
// masters never pass through Netlify function request payloads. Signing uses AWS SigV4 query
// authentication implemented with node:crypto, so no storage SDK dependency is required.
import { createHash, createHmac } from "node:crypto";

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
export function presignObjectUrl({ config, method = "GET", key, contentType = "", queryParams = {}, expiresIn = MASTER_UPLOAD_URL_TTL_SECONDS, now = new Date() }) {
  if (!config) throw new Error("Direct storage is not configured");
  const verb = String(method).toUpperCase();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const { origin, host, path } = objectLocation(config, key);
  const headers = { host };
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

export const STORAGE_REQUEST_TIMEOUT_MS = 15_000;

export async function boundedStorageRequest(url, options, fetchImpl = fetch, consume = response => response, timeoutMs = STORAGE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => consume(await fetchImpl(url, { ...options, signal: controller.signal })))(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error("Master storage request timed out. Please retry."), { status: 503, storageCode: "Timeout" }));
        }, Math.min(STORAGE_REQUEST_TIMEOUT_MS, Math.max(1, timeoutMs)));
      }),
    ]);
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("Master storage could not be reached. Please retry."),
      { status: 503, storageCode: "NetworkError", cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** Only a 404 means absence; authorization and service failures must not reset uploads. */
export async function headStoredObject(config, key, fetchImpl = fetch) {
  const response = await boundedStorageRequest(presignObjectUrl({ config, method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" }, fetchImpl);
  if (response.status === 404) return 0;
  if (!response.ok) {
    throw Object.assign(new Error(`Master storage HEAD failed (${response.status}). Please retry.`),
      { status: 503, storageStatus: response.status, storageCode: response.status === 403 ? "AccessDenied" : response.status === 429 ? "SlowDown" : "StorageUnavailable" });
  }
  const length = response.headers.get("content-length");
  const byteSize = Number(length);
  if (!length || !/^\d+$/.test(length) || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw Object.assign(new Error("Master storage returned an invalid object size."), { status: 503, storageCode: "InvalidResponse" });
  }
  return byteSize;
}

export async function deleteStoredObject(config, key, fetchImpl = fetch) {
  if (!config || !key) return;
  await boundedStorageRequest(presignObjectUrl({ config, method: "DELETE", key, expiresIn: 60 }), { method: "DELETE" }, fetchImpl);
}
