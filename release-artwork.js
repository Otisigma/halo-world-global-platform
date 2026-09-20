(() => {
  const DEFAULT_RELEASE_ARTWORK = "/assets/releases/halo-premium-placeholder.svg";

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

  function sameUrl(left, right) {
    return safeUrl(left) === safeUrl(right);
  }

  function ensureBadge(frame) {
    if (!frame) return null;
    let badge = frame.querySelector(".release-artwork-badge");
    if (badge) return badge;
    badge = document.createElement("span");
    badge.className = "release-artwork-badge";
    badge.hidden = true;
    badge.setAttribute("aria-hidden", "true");
    frame.append(badge);
    return badge;
  }

  function syncFrameState(image, frame, fallback, state = "auto") {
    if (!frame) return;
    const badge = ensureBadge(frame);
    const isFallback = state === "fallback"
      || (state !== "missing" && (image.dataset.artworkSource === "fallback" || sameUrl(image.currentSrc || image.getAttribute("src"), fallback)));
    const isMissing = state === "missing";
    frame.classList.toggle("artwork-fallback", isFallback || isMissing);
    frame.classList.toggle("artwork-live", !isFallback && !isMissing);
    frame.classList.toggle("artwork-missing", isMissing);
    frame.dataset.artworkState = isMissing ? "missing" : (isFallback ? "fallback" : "live");
    if (!badge) return;
    badge.textContent = image.dataset.artworkBadge || "HALO placeholder cover";
    badge.hidden = !isFallback && !isMissing;
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
        if (!sameUrl(image.currentSrc || image.getAttribute("src"), fallback)) {
          logArtworkIssue("music_artwork_error", image.getAttribute("src") || "(no src)", window.location.pathname);
          frame?.classList.add("artwork-recovered");
          image.dataset.artworkSource = "fallback";
          syncFrameState(image, frame, fallback, "fallback");
          image.src = fallback;
          return;
        }
        syncFrameState(image, frame, fallback, "missing");
        logArtworkIssue("music_artwork_missing", fallback, window.location.pathname);
      };
      image.addEventListener("load", () => {
        if (!sameUrl(image.currentSrc || image.getAttribute("src"), fallback)) frame?.classList.remove("artwork-recovered");
        syncFrameState(image, frame, fallback);
      });
      image.addEventListener("error", recover);
      syncFrameState(image, frame, fallback);
      if (image.complete && image.naturalWidth === 0) recover();
    });
  }

  window.HaloReleaseArtwork = {
    DEFAULT_RELEASE_ARTWORK,
    resolve,
    wire
  };
})();
