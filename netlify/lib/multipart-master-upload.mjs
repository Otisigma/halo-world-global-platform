import { buildMasterObjectKey, headStoredObject, presignObjectUrl } from "./direct-upload-storage.mjs";
import { ensureUploadSession, MASTER_UPLOAD_CHUNK_BYTES, uploadError, uploadSessionKey } from "./resumable-upload.mjs";

const escapeXml = value => String(value).replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[char]));
const xmlValue = (xml, tag) => {
  const value = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] || "";
  return value.replace(/&(?:quot|apos|lt|gt|amp);/g, entity => ({ "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" }[entity]));
};

async function storageRequest(storage, key, method, queryParams, { contentType = "", body, fetchImpl = fetch } = {}) {
  const url = presignObjectUrl({ config: storage, key, method, queryParams, contentType, expiresIn: 120 });
  const response = await fetchImpl(url, { method, headers: contentType ? { "Content-Type": contentType } : {}, body });
  const xml = await response.text();
  if (!response.ok || /<Error>/.test(xml)) {
    throw Object.assign(uploadError("Master storage could not confirm the upload. Please retry.", 503), { storageCode: xmlValue(xml, "Code") });
  }
  return xml;
}

export async function masterUploadStatus({ store, prefix, storage, scope, uploadId, upload, fetchImpl = fetch }) {
  const details = { byteSize: upload.byteSize, chunkSize: MASTER_UPLOAD_CHUNK_BYTES, filename: upload.filename, contentType: upload.contentType };
  const key = buildMasterObjectKey({ ...scope, uploadId, filename: upload.filename });
  const create = async () => {
    const xml = await storageRequest(storage, key, "POST", { uploads: "" }, { contentType: upload.contentType, fetchImpl });
    const storageUploadId = xmlValue(xml, "UploadId");
    if (!storageUploadId) throw uploadError("Master storage did not create an upload session.", 503);
    return { key, storageUploadId };
  };
  const discard = async candidate => {
    await storageRequest(storage, candidate.key, "DELETE", { uploadId: candidate.storageUploadId }, { fetchImpl }).catch(() => undefined);
  };
  let session = await ensureUploadSession(store, prefix, details, create, discard);
  try {
    return { session, ...await masterUploadProgress(storage, session, fetchImpl) };
  } catch (error) {
    if (error.storageCode !== "NoSuchUpload") throw error;
    // Storage lifecycle rules or replacement may remove an old upload. Renew it atomically.
    const saved = await store.getWithMetadata(uploadSessionKey(prefix), { type: "json" });
    if (!saved?.etag) throw error;
    if (saved.data.storageUploadId === session.storageUploadId) {
      const candidate = { ...saved.data, ...await create(), createdAt: new Date().toISOString() };
      try {
        const result = await store.setJSON(uploadSessionKey(prefix), candidate, { onlyIfMatch: saved.etag });
        session = result.modified ? candidate : await store.get(uploadSessionKey(prefix), { type: "json" });
      } catch (writeError) {
        session = await store.get(uploadSessionKey(prefix), { type: "json" });
        if (session?.storageUploadId !== candidate.storageUploadId) {
          await discard(candidate);
          throw writeError;
        }
      }
      if (session.storageUploadId !== candidate.storageUploadId) await discard(candidate);
    } else {
      session = saved.data;
    }
  }
  return { session, ...await masterUploadProgress(storage, session, fetchImpl) };
}

export async function masterUploadProgress(storage, session, fetchImpl = fetch) {
  const storedBytes = await headStoredObject(storage, session.key, fetchImpl);
  if (storedBytes === session.byteSize) return { uploadedBytes: storedBytes, complete: true, parts: [] };
  const xml = await storageRequest(storage, session.key, "GET", { uploadId: session.storageUploadId }, { fetchImpl });
  if (xmlValue(xml, "IsTruncated") === "true") throw uploadError("The master upload has too many parts.");
  const parts = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(match => ({
    number: Number(xmlValue(match[1], "PartNumber")),
    size: Number(xmlValue(match[1], "Size")),
    etag: xmlValue(match[1], "ETag"),
  }));
  let uploadedBytes = 0;
  for (const [index, part] of parts.entries()) {
    if (part.number !== index + 1 || uploadedBytes >= session.byteSize
      || part.size !== Math.min(session.chunkSize, session.byteSize - uploadedBytes) || !part.etag) {
      throw uploadError("The stored master chunks are out of order or have an invalid size.");
    }
    uploadedBytes += part.size;
  }
  return { uploadedBytes, complete: false, parts };
}

export async function masterPartUrl({ store, prefix, storage, start, fetchImpl = fetch }) {
  const session = await store.get(uploadSessionKey(prefix), { type: "json" });
  if (!session) throw uploadError("Check master upload status before sending chunks.");
  const progress = await masterUploadProgress(storage, session, fetchImpl);
  if (!Number.isSafeInteger(start) || start !== progress.uploadedBytes || start >= session.byteSize || start % session.chunkSize) {
    throw uploadError("The master upload offset does not match storage.");
  }
  return {
    uploadUrl: presignObjectUrl({ config: storage, method: "PUT", key: session.key, contentType: "application/octet-stream",
      queryParams: { uploadId: session.storageUploadId, partNumber: String(start / session.chunkSize + 1) } }),
    uploadedBytes: progress.uploadedBytes,
  };
}

export async function completeMasterUpload({ store, prefix, storage, upload, fetchImpl = fetch }) {
  const session = await store.get(uploadSessionKey(prefix), { type: "json" });
  if (!session || session.byteSize !== upload.byteSize || session.filename !== upload.filename || session.contentType !== upload.contentType) {
    throw uploadError("The master upload metadata does not match this session.");
  }
  const progress = await masterUploadProgress(storage, session, fetchImpl);
  if (progress.uploadedBytes !== session.byteSize) throw uploadError("The master upload is incomplete.");
  if (!progress.complete) {
    const body = `<CompleteMultipartUpload>${progress.parts.map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    await storageRequest(storage, session.key, "POST", { uploadId: session.storageUploadId }, { contentType: "application/xml", body, fetchImpl });
  }
  return session.key;
}
