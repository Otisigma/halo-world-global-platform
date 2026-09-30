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
    var response = await fetch(CATALOG_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    var text = await response.text().catch(function () { return ""; });
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_error) { data = {}; }
    if (!response.ok) throw new Error(data.message || "The master uploaded but could not be saved to the catalog (HTTP " + response.status + ").");
    return data;
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
    if (!file) {
      setStatus("Choose a WAV master file first.", "error");
      return;
    }
    var songId = fieldValue(form, "songId", "songId");
    if (!songId) {
      setStatus("Open a song in the catalog before uploading its master.", "error");
      return;
    }
    var submit = form.querySelector('button[type="submit"]');
    form.dataset.busy = "true";
    if (submit) submit.disabled = true;
    setProgress(0);
    setStatus("Opening a secure Google Drive upload · " + file.name, "uploading");
    try {
      var uploaded = await uploader.upload(file, {
        songId: songId,
        title: fieldValue(form, "title", "title"),
        artist: fieldValue(form, "artist", "artistName"),
        onProgress: function (ratio, detail) {
          setProgress(ratio * 100);
          setStatus("Uploading to Google Drive " + Math.round(ratio * 100) + "% · " + formatMb(detail.uploaded) + " of " + formatMb(detail.total), "uploading");
        },
      });
      setProgress(100);
      setStatus("Upload complete. Saving the master to the catalog…", "uploading");
      var saved = await storeMasterReference({
        songId: uploaded.songId || songId,
        masterFileId: uploaded.fileId,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
      });
      setStatus(saved.message || "Master saved to the catalog.", "success");
      if (input) input.value = "";
      document.dispatchEvent(new CustomEvent("halo:master-uploaded", { detail: saved }));
    } catch (error) {
      setStatus((error && error.message) || "The master upload failed. Try again.", "error");
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
