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

  function uploadError(message, status) {
    var error = new Error(message);
    if (status) error.status = status;
    return error;
  }

  function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (_error) { return null; }
  }

  // Google reports persisted bytes as "bytes=0-N"; no Range header means nothing was stored yet.
  function nextOffsetFromRange(range) {
    var match = /bytes=(\d+)-(\d+)/i.exec(String(range || ""));
    return match ? Number(match[2]) + 1 : 0;
  }

  function wait(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(uploadError("Upload cancelled"));
      var timer = setTimeout(resolve, ms);
      if (signal) signal.addEventListener("abort", function () { clearTimeout(timer); reject(uploadError("Upload cancelled")); }, { once: true });
    });
  }

  async function requestSession(file, options) {
    options = options || {};
    var response = await root.fetch(options.sessionEndpoint || SESSION_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || "",
        fileSize: file.size,
        songId: options.songId || "",
        title: options.title || "",
        artist: options.artist || "",
      }),
      signal: options.signal,
    });
    var data = parseJson(await response.text().catch(function () { return ""; })) || {};
    if (!response.ok) throw uploadError(data.message || "The upload session could not be created (HTTP " + response.status + ").", response.status);
    if (!data.uploadUrl) throw uploadError("The upload session response did not include an upload URL.");
    return data;
  }

  // PUT one byte range (or a status query when `blob` is null) and report status + Range.
  function sendRange(uploadUrl, blob, contentRange, onChunkProgress, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(uploadError("Upload cancelled"));
      var xhr = new root.XMLHttpRequest();
      var onAbort = function () { xhr.abort(); };
      var cleanup = function () { if (signal) signal.removeEventListener("abort", onAbort); };
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Range", contentRange);
      if (xhr.upload && onChunkProgress) {
        xhr.upload.onprogress = function (event) { if (event.lengthComputable) onChunkProgress(event.loaded); };
      }
      xhr.onload = function () {
        cleanup();
        resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText || "" });
      };
      xhr.onerror = xhr.ontimeout = function () {
        cleanup();
        resolve({ status: 0, range: null, body: "" });
      };
      xhr.onabort = function () { cleanup(); reject(uploadError("Upload cancelled")); };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
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
    var maxRetries = options.maxRetries == null ? MAX_RETRIES : Number(options.maxRetries);
    var retryDelayMs = options.retryDelayMs == null ? 500 : Number(options.retryDelayMs);
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : function () {};
    var total = file.size;
    var session = await requestSession(file, options);
    var offset = 0;
    var retries = 0;
    var recovering = false;
    var result = null;

    function report(bytes) {
      var uploaded = Math.min(total, Math.max(0, bytes));
      onProgress(uploaded / total, { uploaded: uploaded, total: total });
    }

    report(0);
    while (!result) {
      var response;
      var start = offset;
      if (!recovering && offset < total) {
        var end = Math.min(offset + chunkSize, total);
        response = await sendRange(session.uploadUrl, file.slice(start, end), "bytes " + start + "-" + (end - 1) + "/" + total, function (loaded) { report(start + loaded); }, options.signal);
      } else {
        // Status query: ask Drive how many bytes it persisted before sending anything else.
        response = await sendRange(session.uploadUrl, null, "bytes */" + total, null, options.signal);
      }

      if (response.status === 200 || response.status === 201) {
        result = parseJson(response.body) || {};
        break;
      }
      if (response.status === 308) {
        var next = nextOffsetFromRange(response.range);
        if (next > offset) retries = 0;
        else if (!recovering && ++retries > maxRetries) throw uploadError("Google Drive stopped accepting chunks. Try the upload again.");
        recovering = false;
        offset = Math.min(next, total);
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
      report(offset);
      await wait(Math.min(30000, retryDelayMs * Math.pow(2, retries - 1)), options.signal);
    }

    report(total);
    return {
      fileId: result.id || session.fileId || "",
      fileName: result.name || session.fileName || file.name,
      fileSize: Number(result.size) || total,
      contentType: result.mimeType || session.contentType || file.type || "",
      songId: session.songId || options.songId || "",
      versionId: session.versionId || "",
      driveResponse: result,
    };
  }

  root.HaloMasterUploader = {
    CHUNK_SIZE: CHUNK_SIZE,
    upload: upload,
    requestSession: requestSession,
    nextOffsetFromRange: nextOffsetFromRange,
  };
})(typeof window !== "undefined" ? window : globalThis);
