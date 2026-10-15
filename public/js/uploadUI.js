/*
 * Wires #masterUploadForm to window.HaloMasterUploader (/public/js/chunkedUploader.js).
 * Streams the selected WAV master to Google Drive, drives #masterProgressBar and
 * #masterStatusLabel, then stores the Drive master reference via /api/catalog/tracks.
 * Load after chunkedUploader.js; the uploader is resolved at submit time so a late or
 * missing script degrades to a clear status message instead of a broken form.
 */
(function () {
  "use strict";

  var CATALOG_ENDPOINT = "/api/catalog/tracks";

  function byId(id) { return document.getElementById(id); }

  function fieldValue(form, name, fallbackId) {
    var field = form.elements.namedItem(name);
    var value = field && typeof field.value === "string" ? field.value : "";
    if (!value && fallbackId) {
      var fallback = byId(fallbackId);
      value = fallback && typeof fallback.value === "string" ? fallback.value : "";
    }
    return value.trim();
  }

  function setStatus(text, state) {
    var label = byId("masterStatusLabel");
    if (label) {
      label.textContent = text;
      if (state) label.dataset.state = state;
    }
    var form = byId("masterUploadForm");
    if (form && state) form.dataset.uploadState = state;
  }

  function setProgress(percent) {
    var bar = byId("masterProgressBar");
    if (!bar) return;
    var value = Math.max(0, Math.min(100, Math.round(percent)));
    if ("value" in bar && bar.tagName === "PROGRESS") bar.value = value;
    else bar.style.width = value + "%";
    bar.setAttribute("aria-valuenow", String(value));
  }

  function formatMb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  async function storeMasterReference(payload) {
    var uploader = window.HaloMasterUploader;
    if (typeof uploader.requestJson === "function") return uploader.requestJson(CATALOG_ENDPOINT, payload, {
      requestTimeoutMs: 30000,
      onState: function () { setStatus("Reconnecting to save the master… The uploaded file is preserved.", "reconnecting"); },
    });
    // Legacy embedders without the shared request helper still get a bounded request.
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var buildRevision = window.HaloUploadBuild && window.HaloUploadBuild.revision || "";
    var timer;
    try {
      return await Promise.race([(async function () {
        var response = await fetch(CATALOG_ENDPOINT, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-Upload-Protocol": "2", ...(buildRevision ? { "X-Upload-Revision": buildRevision } : {}) },
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined,
        });
        var text = await response.text().catch(function () { return ""; });
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_error) { data = {}; }
        if (buildRevision && data.revision !== buildRevision) {
          var mismatch = new Error("Upload build/runtime revision mismatch. Refresh after deployment completes, then retry catalog registration; the uploaded file is preserved.");
          mismatch.status = 409;
          throw mismatch;
        }
        if (!response.ok) {
          var error = new Error(data.message || "The master uploaded but could not be saved to the catalog (HTTP " + response.status + ").");
          error.status = response.status;
          error.phase = data.phase;
          throw error;
        }
        return data;
      })(), new Promise(function (_resolve, reject) {
        timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error("Saving the master timed out. Retry; the uploaded file is preserved.")); }, 30000);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    if (form.dataset.busy === "true") return;
    var uploader = window.HaloMasterUploader;
    if (!uploader || typeof uploader.upload !== "function") {
      setStatus("The master uploader did not load. Refresh the page and try again.", "error");
      return;
    }
    var input = form.querySelector('input[type="file"]');
    var file = input && input.files && input.files[0];
    var pending = form.masterUploadReference;
    if (!file && !pending) {
      setStatus("Choose a WAV master file first.", "error");
      return;
    }
    var songId = fieldValue(form, "songId", "songId");
    if (pending && (pending.songId !== songId || (file && form.masterUploadFile !== file))) {
      pending = null;
      form.masterUploadReference = null;
    }
    if (!file && !pending) {
      setStatus("Choose the same master file to reconnect to its saved upload.", "paused");
      return;
    }
    if (!songId) {
      setStatus("Open a song in the catalog before uploading its master.", "error");
      return;
    }
    var submit = form.querySelector('button[type="submit"]');
    form.dataset.busy = "true";
    if (submit) submit.disabled = true;
    setProgress(0);
    setStatus(pending ? "Retrying catalog save · the master is already uploaded." : "Opening a secure Google Drive upload · " + file.name, "uploading");
    try {
      var transferState = "transferring";
      var uploaded = pending || await uploader.upload(file, {
        songId: songId,
        title: fieldValue(form, "title", "title"),
        artist: fieldValue(form, "artist", "artistName"),
        onState: function (state) {
          transferState = state;
          if (state === "reconnecting") setStatus("Reconnecting to Google Drive… Confirmed bytes are preserved.", "reconnecting");
          else if (state === "completing") setStatus("Verifying the uploaded master…", "completing");
        },
        onProgress: function (ratio, detail) {
          setProgress(ratio * 100);
          if (transferState === "transferring") setStatus("Google Drive confirmed " + Math.round(ratio * 100) + "% · " + formatMb(detail.confirmed == null ? detail.uploaded : detail.confirmed) + " of " + formatMb(detail.total) + (detail.sent != null ? " · sent " + formatMb(detail.sent) : ""), "uploading");
        },
      });
      form.masterUploadReference = uploaded;
      form.masterUploadFile = file;
      setProgress(100);
      setStatus("Upload complete. Saving the master to the catalog…", "uploading");
      if (uploaded.phase === "review_pending") {
        var reviewError = new Error(uploaded.registeredResult && uploaded.registeredResult.message || "The master is preserved for review because its target version changed.");
        reviewError.phase = "review_pending";
        throw reviewError;
      }
      var saved = uploaded.phase === "registered" ? uploaded.registeredResult : await storeMasterReference({
        songId: uploaded.songId || songId,
        masterFileId: uploaded.fileId,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        ...(uploaded.uploadId ? { uploadId: uploaded.uploadId, versionId: uploaded.versionId, protocolVersion: 2 } : {}),
      });
      setStatus(saved.message || "Master saved to the catalog.", "success");
      if (input) input.value = "";
      form.masterUploadReference = null;
      form.masterUploadFile = null;
      if (submit) submit.textContent = "Upload master";
      document.dispatchEvent(new CustomEvent("halo:master-uploaded", { detail: saved }));
    } catch (error) {
      var state = error && error.phase === "review_pending" ? "review_pending" : error && (error.retryable === false || (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429)) ? "error" : "paused";
      setStatus(((error && error.message) || "The master upload failed.") + (state === "paused" ? " Retry to reconnect to the saved upload." : ""), state);
      if (submit) submit.textContent = form.masterUploadReference ? "Retry catalog save" : "Retry upload";
    } finally {
      form.dataset.busy = "false";
      if (submit) submit.disabled = false;
    }
  }

  function init() {
    var form = byId("masterUploadForm");
    if (!form || form.dataset.masterUploadReady === "true") return;
    form.dataset.masterUploadReady = "true";
    form.addEventListener("submit", handleSubmit);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
