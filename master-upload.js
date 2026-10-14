(function (root) {
  "use strict";
  const ENDPOINT = "/api/song-catalog/master-upload";
  const active = new Set();
  function abort(signal) {
    if (signal?.aborted) throw new DOMException("Master upload paused", "AbortError");
  }
  async function fingerprint(file, signal) {
    abort(signal);
    const digest = await root.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    abort(signal);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const transient = status => status === 408 || status === 429 || status >= 500;
  const retryable = (error, signal) => error.name !== "AbortError" && !signal?.aborted
    && (!error.status || transient(error.status)) && error.directUpload !== false;
  async function delay(ms, signal) {
    abort(signal);
    await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener("abort", paused); resolve(); };
      const timer = setTimeout(done, ms);
      const paused = () => { clearTimeout(timer); signal.removeEventListener("abort", paused); reject(new DOMException("Master upload paused", "AbortError")); };
      signal?.addEventListener("abort", paused, { once: true });
    });
  }
  async function upload(file, options = {}) {
    const { signal, songId, versionId, ownerMemberId = "", durationSeconds = 0 } = options;
    if (!songId || !versionId || !file?.size) throw new Error("Select a file and canonical sale master version.");
    const digest = options.fingerprint || await fingerprint(file, signal);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("A SHA-256 file fingerprint is required.");
    const id = JSON.stringify([ownerMemberId, songId, versionId, digest]);
    if (active.has(id)) throw new Error("This master upload is already running in this tab.");
    active.add(id);
    const metadata = { songId, versionId, fingerprint: digest, fileName: file.name, fileType: options.contentType || file.type, fileSize: file.size, durationSeconds };
    const cacheKey = `halo:master-resume:v1:${id}`;
    let progressStorage;
    try { progressStorage = options.progressStorage === false ? null : options.progressStorage || root.localStorage; } catch {}
    function cacheConfirmed(bytes, registered = false) {
      try {
        progressStorage?.setItem(cacheKey, JSON.stringify({
          songId, versionId, fingerprint: digest, fileSize: file.size, confirmedBytes: bytes,
          registered, updatedAt: new Date().toISOString(),
        }));
      } catch {}
    }
    const report = bytes => { cacheConfirmed(bytes); options.onProgress?.(bytes, file.size); };
    let generationId;
    async function request(url, init, consume = response => response) {
      abort(signal);
      const controller = new AbortController();
      let rejectStopped;
      const stopped = new Promise((_, reject) => { rejectStopped = reject; });
      const paused = () => { controller.abort(); rejectStopped(new DOMException("Master upload paused", "AbortError")); };
      let timedOut = false;
      const timeoutMs = Math.max(1, Math.min(600000, Number(options.requestTimeoutMs) || 180000));
      const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStopped(new Error("Request timed out")); }, timeoutMs);
      signal?.addEventListener("abort", paused, { once: true });
      try {
        return await Promise.race([root.fetch(url, { ...init, signal: controller.signal }).then(consume), stopped]);
      } catch (error) {
        abort(signal);
        if (timedOut) throw Object.assign(new Error("Master upload request timed out. Retrying from confirmed storage."), { name: "TimeoutError", status: 503 });
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", paused);
      }
    }
    async function api(action, extra = {}) {
      return request(ENDPOINT, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...metadata, generationId, ...extra, action }) }, async response => {
        let body;
        try { body = await response.json(); } catch {
          throw Object.assign(new Error("Master upload returned an unreadable response."), { status: response.ok ? 503 : response.status });
        }
        if (!response.ok) throw Object.assign(new Error(body?.message || "Master upload request failed."), { status: response.status, directUpload: body?.directUpload });
        if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Master upload returned an invalid response."), { status: 503 });
        if (action === "create" || action === "status") validateStatus(body);
        if (action !== "create" && body.generationId && generationId && body.generationId !== generationId) throw Object.assign(new Error("The master upload generation changed. Resume with the file again."), { status: 409 });
        if (action === "complete" && (!body.persisted || !body.lockedIn || typeof body.audioUrl !== "string")) throw Object.assign(new Error("Master registration confirmation is missing."), { status: 503 });
        return body;
      });
    }
    async function retry(operation, reconcile) {
      for (let attempt = 0; ; attempt++) {
        try { return await operation(); } catch (error) {
          if (!retryable(error, signal)) throw error;
          if (attempt >= 4) {
            if (reconcile) {
              const result = await reconcile(error);
              if (result) return result;
            }
            throw error;
          }
          await delay(Math.min(8000, 500 * 2 ** attempt), signal);
        }
      }
    }
    function validateStatus(status) {
      if (!Number.isSafeInteger(status.uploadedBytes) || status.uploadedBytes < 0 || status.uploadedBytes > file.size
        || !Number.isSafeInteger(status.chunkSize) || status.chunkSize < 5 * 1024 * 1024
        || (status.uploadedBytes !== file.size && status.uploadedBytes % status.chunkSize !== 0)) throw Object.assign(new Error("Invalid master upload status."), { status: 503 });
      report(status.uploadedBytes);
      return status;
    }
    try {
      // This credential-free hint is never used for offsets; storage status remains authoritative.
      try {
        const cached = JSON.parse(progressStorage?.getItem(cacheKey) || "null");
        if (cached?.fingerprint === digest && cached.fileSize === file.size && Number.isSafeInteger(cached.confirmedBytes)
          && cached.confirmedBytes >= 0 && cached.confirmedBytes <= file.size) options.onCachedProgress?.(cached);
      } catch {}
      let status = validateStatus(await retry(() => api("create"), () => api("status")));
      if (!/^[0-9a-f-]{36}$/.test(String(status.generationId || ""))) throw new Error("Invalid master upload generation.");
      generationId = status.generationId;
      while (status.uploadedBytes < file.size) {
        status = validateStatus(await retry(async () => {
          // Always reconcile before a retry: a lost PUT response may already have committed this part.
          const current = validateStatus(await api("status"));
          if (current.uploadedBytes >= file.size) return current;
          const end = Math.min(file.size, current.uploadedBytes + current.chunkSize);
          const chunk = file.slice(current.uploadedBytes, end);
          const bytes = new Uint8Array(await root.crypto.subtle.digest("SHA-256", await chunk.arrayBuffer()));
          const partChecksum = root.btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
          const part = await api("part", { startByte: current.uploadedBytes, partChecksum });
          if (part.partSize !== end - current.uploadedBytes || !/^https:\/\//i.test(part.uploadUrl || "")) throw new Error("Invalid master part upload URL.");
          const response = await request(part.uploadUrl, { method: "PUT", headers: part.headers, body: chunk, credentials: "omit" });
          if (!response.ok) throw Object.assign(new Error("Master part upload failed."), { status: response.status === 403 ? 503 : response.status });
          const acknowledged = validateStatus(await api("status"));
          if (acknowledged.uploadedBytes <= current.uploadedBytes) throw Object.assign(new Error("Master storage stopped acknowledging parts."), { status: 503 });
          return acknowledged;
        }, async () => {
          const current = validateStatus(await api("status"));
          return current.uploadedBytes > status.uploadedBytes ? current : null;
        }));
      }
      const result = await retry(() => api("complete"), async () => {
        const confirmed = validateStatus(await api("status"));
        if (confirmed.persisted && confirmed.lockedIn) return confirmed;
        return confirmed.complete ? api("complete") : null;
      });
      if (!result.persisted || !result.lockedIn) throw new Error("The master was not confirmed as registered.");
      report(file.size);
      cacheConfirmed(file.size, true);
      return result;
    } finally {
      active.delete(id);
    }
  }
  root.HaloMasterUpload = { upload, fingerprint };
})(typeof window === "undefined" ? globalThis : window);
