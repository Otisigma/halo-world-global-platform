/*
 * HALO master uploader: streams large WAV masters straight to Google Drive.
 * 1. POST /api/upload/drive-session opens a resumable session (server-side service account).
 * 2. The file is sliced into 5 MB chunks and PUT to the session URL with Content-Range.
 * 3. HTTP 308 (resume incomplete) advances to the byte after the reported Range; network
 *    errors and 5xx/429 query the session status and resume with backoff.
 * 4. Completion never depends on the final response body: the Drive file id is issued
 *    with the session, so empty or non-JSON final responses still resolve safely.
 */
(function (root) {
  "use strict";

  var CHUNK_SIZE = 5 * 1024 * 1024;
  var SESSION_ENDPOINT = "/api/upload/drive-session";
  var MAX_RETRIES = 5;
  var ALIGNMENT = 256 * 1024;
  var REQUEST_TIMEOUT = 30000;

  function uploadError(message, status) {
    var error = new Error(message);
    if (status) error.status = status;
    return error;
  }

  function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (_error) { return null; }
  }

  function nextOffsetFromRange(range, total, previous, upperBound) {
    previous = previous || 0;
    if (!range) {
      if (previous) throw uploadError("Google Drive checkpoint Range is missing. Check CORS exposes the Range header; confirmed bytes will not be resent.");
      return 0;
    }
    var match = /^bytes=0-(\d+)$/i.exec(String(range).trim());
    var last = match ? Number(match[1]) : NaN;
    var next = last + 1;
    if (!Number.isSafeInteger(last) || !Number.isSafeInteger(next) || next < previous || (total != null && next > total) || (upperBound != null && next > upperBound)) throw uploadError("Google Drive returned an invalid or impossible upload checkpoint.");
    return next;
  }

  function wait(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(uploadError("Upload cancelled"));
      function cleanup() { if (signal) signal.removeEventListener("abort", abort); }
      function abort() { clearTimeout(timer); cleanup(); reject(uploadError("Upload cancelled")); }
      var timer = setTimeout(function () { cleanup(); resolve(); }, ms);
      if (signal) signal.addEventListener("abort", abort, { once: true });
    });
  }

  function retryAfterMs(value) {
    if (!value) return 0;
    var seconds = Number(value);
    var delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Math.max(0, Math.min(60000, delay || 0));
  }

  function backoff(attempt, base, retryAfter) {
    return Math.max(retryAfterMs(retryAfter), Math.min(30000, base * Math.pow(2, attempt - 1)) * (0.5 + Math.random() * 0.5));
  }

  async function requestJson(url, payload, options) {
    options = options || {};
    var maxRetries = options.maxRetries == null ? MAX_RETRIES : options.maxRetries;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw uploadError("Invalid upload retry limit.");
    for (var attempt = 0; ; attempt++) {
      let controller = root.AbortController ? new root.AbortController() : null;
      let timer;
      let abort = function () { if (controller) controller.abort(); };
      if (options.signal && options.signal.aborted) throw uploadError("Upload cancelled");
      if (options.signal) options.signal.addEventListener("abort", abort, { once: true });
      let response, data, error;
      try {
        data = await Promise.race([
          (async function () {
            response = await root.fetch(url, {
              method: "POST", credentials: "same-origin",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(payload), signal: controller ? controller.signal : options.signal,
            });
            return parseJson(await response.text()) || {};
          })(),
          new Promise(function (_resolve, reject) {
            timer = setTimeout(function () { abort(); reject(uploadError("The request timed out. Retry the saved upload.", 0)); }, options.requestTimeoutMs || REQUEST_TIMEOUT);
          }),
        ]);
        if (response.ok) return data;
        error = uploadError(data.message || "The upload request failed (HTTP " + response.status + ").", response.status);
        error.phase = data.phase;
        if (!isRetryable(response.status)) throw error;
      } catch (caught) {
        error = caught;
        if (options.signal && options.signal.aborted) throw uploadError("Upload cancelled");
        if (error.status && !isRetryable(error.status)) throw error;
      } finally {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener("abort", abort);
      }
      if (attempt >= maxRetries) throw error;
      if (options.onState) options.onState("reconnecting");
      await wait(backoff(attempt + 1, options.retryDelayMs == null ? 500 : options.retryDelayMs, response && response.headers.get("Retry-After")), options.signal);
    }
  }

  async function contentIdentity(file, songId, options) {
    if (!root.crypto || !root.crypto.subtle || !file.arrayBuffer) return "";
    var hashes = [];
    // Hash every byte in bounded slices; metadata-only fingerprints can alias changed masters.
    for (var offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      if (options.signal && options.signal.aborted) throw uploadError("Upload cancelled");
      var hash = await root.crypto.subtle.digest("SHA-256", await file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE)).arrayBuffer());
      hashes.push(Array.from(new Uint8Array(hash)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join(""));
    }
    var digest = await root.crypto.subtle.digest("SHA-256", new root.TextEncoder().encode(JSON.stringify([songId, file.name, file.type, file.size, hashes])));
    return Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }

  async function requestSession(file, options) {
    options = options || {};
    var data = await requestJson(options.sessionEndpoint || SESSION_ENDPOINT, {
        fileName: file.name,
        fileType: file.type || "",
        fileSize: file.size,
        songId: options.songId || "",
        title: options.title || "",
        artist: options.artist || "",
        ...(options.uploadId ? { protocolVersion: 2, uploadId: options.uploadId, versionId: options.versionId || "", ...(options.action ? { action: options.action, confirmedOffset: options.confirmedOffset } : {}) } : {}),
      }, options);
    if (options.uploadId && data.protocolVersion !== 2) throw uploadError("The Drive upload server protocol is out of date. Reload after deployment (revision " + (data.revision || "unknown") + ").");
    if (!data.uploadUrl) throw uploadError("The upload session response did not include an upload URL.");
    return data;
  }

  // PUT one byte range (or a status query when `blob` is null) and report status + Range.
  function sendRange(uploadUrl, blob, contentRange, onChunkProgress, signal, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(uploadError("Upload cancelled"));
      var xhr = new root.XMLHttpRequest();
      var onAbort = function () { xhr.abort(); };
      var timer;
      var settled = false;
      var cleanup = function () { settled = true; clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); };
      xhr.open("PUT", uploadUrl, true);
      xhr.timeout = timeoutMs || REQUEST_TIMEOUT;
      xhr.setRequestHeader("Content-Range", contentRange);
      if (xhr.upload && onChunkProgress) {
        xhr.upload.onprogress = function (event) { if (event.lengthComputable) onChunkProgress(event.loaded); };
      }
      xhr.onload = function () {
        if (settled) return;
        cleanup();
        resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), retryAfter: xhr.getResponseHeader("Retry-After"), body: xhr.responseText || "" });
      };
      xhr.onerror = xhr.ontimeout = function () {
        if (settled) return;
        cleanup();
        resolve({ status: 0, range: null, body: "" });
      };
      xhr.onabort = function () { if (!settled) { cleanup(); reject(uploadError("Upload cancelled")); } };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(function () {
        if (settled) return;
        cleanup(); xhr.abort(); resolve({ status: 0, range: null, body: "" });
      }, xhr.timeout);
      xhr.send(blob);
    });
  }

  function isRetryable(status) {
    return status === 0 || status === 429 || status >= 500;
  }

  async function upload(file, options) {
    options = options || {};
    if (!file || typeof file.slice !== "function" || !file.size) throw uploadError("Choose a master file to upload.");
    var chunkSize = Number(options.chunkSize) || CHUNK_SIZE;
    if (!Number.isSafeInteger(file.size) || !Number.isSafeInteger(chunkSize) || chunkSize < ALIGNMENT || chunkSize % ALIGNMENT) throw uploadError("The Drive file/chunk size is invalid.");
    var maxRetries = options.maxRetries == null ? MAX_RETRIES : Number(options.maxRetries);
    var retryDelayMs = options.retryDelayMs == null ? 500 : Number(options.retryDelayMs);
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10 || !Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw uploadError("Invalid upload retry settings.");
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : function () {};
    var total = file.size;
    options = Object.assign({}, options);
    options.uploadId = await contentIdentity(file, options.songId || "", options);
    var storageKey = options.uploadId ? "halo-drive-target:" + options.uploadId : "";
    if (storageKey && root.localStorage) {
      try { var target = parseJson(root.localStorage.getItem(storageKey)); if (target && target.songId === options.songId) options.versionId = target.versionId; } catch (_error) {}
    }
    var session = await requestSession(file, options);
    options.versionId = session.versionId;
    if (storageKey && root.localStorage) {
      try { root.localStorage.setItem(storageKey, JSON.stringify({ uploadId: options.uploadId, songId: session.songId, versionId: session.versionId })); } catch (_error) {}
    }
    var offset = session.confirmedOffset == null ? 0 : session.confirmedOffset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > total) throw uploadError("The saved Drive checkpoint is invalid.");
    var retries = 0;
    var recovering = !!session.resumed;
    var result = /^(completing|registered|review_pending)$/.test(session.phase || "") ? {} : null;
    var attemptedEnd = session.resumed ? total : offset;
    var missingRanges = 0;
    var sent = offset;
    var onState = typeof options.onState === "function" ? options.onState : function () {};

    function report(bytes) {
      var uploaded = Math.min(total, Math.max(0, bytes));
      sent = Math.max(sent, uploaded);
      onProgress(offset / total, { uploaded: offset, confirmed: offset, sent: sent, total: total });
    }

    report(0);
    while (!result) {
      var response;
      var start = offset;
      if (!recovering && offset < total) {
        var end = Math.min(offset + chunkSize, total);
        if (end < total) end -= end % ALIGNMENT;
        attemptedEnd = Math.max(attemptedEnd, end);
        onState("transferring");
        response = await sendRange(session.uploadUrl, file.slice(start, end), "bytes " + start + "-" + (end - 1) + "/" + total, function (loaded) { report(start + loaded); }, options.signal, options.requestTimeoutMs);
      } else {
        // Status query: ask Drive how many bytes it persisted before sending anything else.
        onState("reconnecting");
        response = await sendRange(session.uploadUrl, null, "bytes */" + total, null, options.signal, options.statusTimeoutMs || options.requestTimeoutMs);
      }

      if (response.status === 200 || response.status === 201) {
        if (attemptedEnd < total) throw uploadError("Google Drive reported completion before the entire file was sent.");
        result = parseJson(response.body) || {};
        break;
      }
      if (response.status === 308) {
        if (!response.range && offset > 0) {
          if (++missingRanges > maxRetries) throw uploadError("Google Drive checkpoint Range is missing after recovery. Check CORS exposes Range; confirmed bytes were preserved. Retry this saved upload.");
          recovering = true;
          onState("reconnecting");
          await wait(backoff(missingRanges, retryDelayMs, response.retryAfter), options.signal);
          continue;
        }
        missingRanges = 0;
        var next = nextOffsetFromRange(response.range, total, offset, attemptedEnd);
        if (next > offset) retries = 0;
        else {
          if (++retries > maxRetries) throw uploadError("Google Drive stopped accepting chunks. Retry the saved upload.");
          await wait(backoff(retries, retryDelayMs, response.retryAfter), options.signal);
        }
        recovering = false;
        offset = Math.min(next, total);
        if (options.uploadId) {
          session = await requestSession(file, Object.assign({}, options, { action: "checkpoint", confirmedOffset: offset }));
          if (/^(completing|registered|review_pending)$/.test(session.phase || "")) result = {};
        }
        report(offset);
        continue;
      }
      if (response.status === 404 || response.status === 410) throw uploadError("The upload session expired. Start the upload again.", response.status);
      if (!isRetryable(response.status)) {
        var data = parseJson(response.body);
        throw uploadError((data && data.error && data.error.message) || "Google Drive rejected the upload (HTTP " + response.status + ").", response.status);
      }
      if (++retries > maxRetries) throw uploadError("The upload kept failing. Check your connection and try again.", response.status);
      recovering = true;
      onState("reconnecting");
      report(offset);
      await wait(backoff(retries, retryDelayMs, response.retryAfter), options.signal);
    }

    offset = total;
    report(total);
    onState("completing");
    if (options.uploadId && session.phase !== "registered" && session.phase !== "review_pending") session = await requestSession(file, Object.assign({}, options, { action: "checkpoint", confirmedOffset: total }));
    if (options.uploadId && result.id && result.id !== session.fileId) throw uploadError("Google Drive returned a file outside the saved upload session.");
    return {
      fileId: result.id || session.fileId || "",
      fileName: result.name || session.fileName || file.name,
      fileSize: Number(result.size) || total,
      contentType: result.mimeType || session.contentType || file.type || "",
      songId: session.songId || options.songId || "",
      versionId: session.versionId || "",
      driveResponse: result,
      ...(options.uploadId ? { uploadId: options.uploadId, protocolVersion: 2, phase: session.phase, registeredResult: session.registeredResult } : {}),
    };
  }

  root.HaloMasterUploader = {
    CHUNK_SIZE: CHUNK_SIZE,
    upload: upload,
    requestSession: requestSession,
    nextOffsetFromRange: nextOffsetFromRange,
    requestJson: requestJson,
  };
})(typeof window !== "undefined" ? window : globalThis);
