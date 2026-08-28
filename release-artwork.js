(() => {
  const DEFAULT_RELEASE_ARTWORK = "/assets/halo-app-icon-512.png";

  function safeUrl(value, fallback = "") {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return fallback;
    try {
      const url = new URL(raw, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  function resolve(release = {}, fallbackArtwork = DEFAULT_RELEASE_ARTWORK) {
    const fallback = safeUrl(fallbackArtwork, DEFAULT_RELEASE_ARTWORK);
    const artworkOverride = safeUrl(release.artworkOverride || release.artworkOverrideUrl || release.artwork_override_url);
    const importedArtwork = safeUrl(release.importedArtwork || release.importedArtworkUrl || release.imported_artwork_url);
    const legacyArtwork = safeUrl(release.artwork || release.artworkUrl || release.artwork_url);
    const src = artworkOverride || importedArtwork || legacyArtwork || fallback;
    const source = artworkOverride ? "manual" : importedArtwork ? "imported" : legacyArtwork ? "legacy" : "fallback";
    return { src, source, artworkOverride, importedArtwork, fallback };
  }

  function logArtworkIssue(eventType, brokenUrl, page) {
    console.warn("[HALO Music] Release artwork issue:", eventType, brokenUrl);
    window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: {
        eventType,
        category: "problem",
        targetName: "Release artwork unavailable",
        details: { url: brokenUrl, page },
        immediate: true
      }
    }));
  }

  function wire(root = document, fallbackArtwork = DEFAULT_RELEASE_ARTWORK) {
    root.querySelectorAll("img[data-release-artwork]").forEach(image => {
      if (image.dataset.releaseArtworkReady === "true") return;
      image.dataset.releaseArtworkReady = "true";
      const frame = image.closest("[data-artwork-frame]");
      const fallback = safeUrl(image.dataset.artworkFallback || fallbackArtwork, DEFAULT_RELEASE_ARTWORK);
      const recover = () => {
        if (image.getAttribute("src") !== fallback) {
          logArtworkIssue("music_artwork_error", image.getAttribute("src") || "(no src)", window.location.pathname);
          frame?.classList.add("artwork-recovered");
          frame?.classList.remove("artwork-missing");
          image.src = fallback;
          return;
        }
        frame?.classList.add("artwork-missing");
        logArtworkIssue("music_artwork_missing", fallback, window.location.pathname);
      };
      image.addEventListener("load", () => frame?.classList.remove("artwork-missing"));
      image.addEventListener("error", recover);
      if (image.complete && image.naturalWidth === 0) recover();
    });
  }

  window.HaloReleaseArtwork = {
    DEFAULT_RELEASE_ARTWORK,
    resolve,
    wire
  };
})();
