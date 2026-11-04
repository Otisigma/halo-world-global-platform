export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 128 * 1024 * 1024;
const ENDPOINT = "/api/dreamweaver-song-lab";
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isTransientUploadError(error) {
  return error?.name === "NetworkError" || error?.name === "TimeoutError"
    || error?.name === "TypeError" || error?.name === "AbortError" && error?.timedOut === true
    || TRANSIENT_STATUSES.has(Number(error?.status));
}

export async function runCheckpointedUpload(work, {
  session, checkpoint = async () => {}, onWaiting = () => {},
  canContinue = () => true, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  online = () => globalThis.navigator?.onLine !== false,
} = {}) {
  const assertContinuing = () => {
    if (!canContinue()) throw Object.assign(new Error("Upload paused. Your checkpoints are retained."), { name: "PausedUploadError" });
  };
  for (;;) {
    assertContinuing();
    try { return await work(assertContinuing); }
    catch (error) {
      if (!isTransientUploadError(error) || !session.autoResume || (session.autoRestarts || 0) >= 3) throw error;
      session.autoRestarts = (session.autoRestarts || 0) + 1;
      const delayMs = 2000 * 2 ** (session.autoRestarts - 1);
      await checkpoint();
      onWaiting({ attempt: session.autoRestarts, delayMs, error });
      await wait(delayMs);
      assertContinuing();
      if (!online()) throw Object.assign(new Error("Offline. Automatic recovery will continue when the connection returns."), { name: "OfflineUploadError" });
    }
  }
}

export function createLocalUploadVault(indexedDB = globalThis.indexedDB) {
  let database;
  async function open() {
    if (!indexedDB) throw new Error("This browser does not support local audio backups.");
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("halo-song-lab-uploads", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("files");
        request.result.createObjectStore("sessions");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other Song Lab tabs to unlock local backups."));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transact(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["files", "sessions"], mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Local audio backup was interrupted."));
      work(transaction, value => { result = value; });
    });
  }
  return {
    saveFile(session, file) {
      return transact("readwrite", transaction => {
        transaction.objectStore("files").put(file, session.id);
        transaction.objectStore("sessions").put(session, session.id);
      });
    },
    saveSession(session) {
      return transact("readwrite", transaction => transaction.objectStore("sessions").put(session, session.id));
    },
    read(id) {
      return transact("readonly", (transaction, result) => {
        const session = transaction.objectStore("sessions").get(id);
        const file = transaction.objectStore("files").get(id);
        file.onsuccess = () => result(session.result && file.result ? { session: session.result, file: file.result } : null);
      });
    },
    listSessions() {
      return transact("readonly", (transaction, result) => {
        const request = transaction.objectStore("sessions").getAll();
        request.onsuccess = () => result(request.result);
      });
    },
    remove(id) {
      return transact("readwrite", transaction => {
        transaction.objectStore("files").delete(id);
        transaction.objectStore("sessions").delete(id);
      });
    },
  };
}

export async function readSongLabJson(url, fetcher = globalThis.fetch) {
  return requestSongLab(url, { method: "GET", headers: { Accept: "application/json" } }, fetcher);
}

async function requestSongLab(url, options, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(url, { ...options, credentials: "same-origin", signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error(`Song Lab returned an unreadable response (HTTP ${response.status}). Your upload can be resumed.`), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(data.message || `Song Lab request failed (HTTP ${response.status}).`), { status: response.status, data });
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Song Lab request timed out. Your checkpoint is retained."), { name: "TimeoutError" });
    throw error;
  } finally { clearTimeout(timer); }
}

export async function requestUploadJson(body, headers = {}, fetcher = globalThis.fetch) {
  return requestSongLab(ENDPOINT, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }, fetcher);
}

export async function dispatchSongLabBuild(projectId, headers = {}, fetcher = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher("/api/dreamweaver-song-lab-background", {
      method: "POST", credentials: "same-origin", signal: controller.signal,
      headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
    });
    if (!response.ok) throw Object.assign(new Error(`The private worker request failed (HTTP ${response.status}).`), { status: response.status });
    // Netlify acknowledges background requests before execution; project polling is the result.
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Private worker dispatch timed out. The saved project is retained."), { name: "TimeoutError" });
    throw error;
  } finally { clearTimeout(timer); }
}

export async function resumeAudioUpload({
  file, session, headers = () => ({}), transport = globalThis.window?.HaloUploadProgress,
  request = requestUploadJson, checksum = async blob => {
    const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }, onProgress = () => {}, onRetry = () => {}, onAcknowledged = async () => {}, assertContinuing = () => {},
}) {
  assertContinuing();
  if (!file?.size || file.size > MAX_FILE_BYTES) throw new Error("Choose a non-empty audio file up to 128 MB.");
  if (!transport) throw new Error("The upload transport is unavailable. Reload Song Lab to retry.");
  const shape = { uploadId: session.id, ownerId: session.ownerId, chunkCount: Math.ceil(file.size / CHUNK_BYTES), byteSize: file.size, resumeVersion: 1 };
  const status = await request({ action: "upload_status", ...shape }, headers());
  if (status.project) return { ...shape, project: status.project };
  let acknowledgedBytes = 0;
  for (let chunkIndex = 0; chunkIndex < shape.chunkCount; chunkIndex++) {
    assertContinuing();
    const start = chunkIndex * CHUNK_BYTES;
    const chunk = file.slice(start, Math.min(file.size, start + CHUNK_BYTES), file.type);
    const digest = await checksum(chunk);
    if (status.chunkChecksums?.[chunkIndex] !== digest || status.invalidChunks?.includes(chunkIndex)) {
      const body = new FormData();
      body.append("chunk", chunk, file.name);
      for (const [key, value] of Object.entries({ ...shape, chunkIndex, checksum: digest })) body.append(key, String(value));
      const response = await transport.sendFormDataWithRetry(ENDPOINT, body, {
        headers: headers(), credentials: "same-origin", timeoutMs: 120000,
        retryDelays: [800, 2000, 4000], retryOnStatus: true,
        onRetry: info => onRetry({ ...info, chunkIndex, chunkCount: shape.chunkCount }),
        onProgress: ratio => onProgress((acknowledgedBytes + chunk.size * ratio) / file.size * 100),
      });
      if (!response.ok) throw Object.assign(new Error(response.data?.message || "The private audio upload stopped early."), { status: response.status, data: response.data });
      if (response.data?.sha256 !== digest) throw new Error("The server did not verify this audio chunk. Resume to retry it.");
    }
    assertContinuing();
    acknowledgedBytes += chunk.size;
    await onAcknowledged(chunkIndex);
    onProgress(acknowledgedBytes / file.size * 100);
  }
  const finalStatus = await request({ action: "upload_status", ...shape }, headers());
  if (!finalStatus.complete) throw new Error("The server has not verified every audio chunk. Resume to repair missing chunks.");
  return shape;
}
