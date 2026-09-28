(() => {
  const DEFAULT_RELEASE_ARTWORK = "/assets/releases/halo-premium-placeholder.svg";
  const DEFAULT_RELEASE_ARTWORK_BADGE = "HALO placeholder cover";
  const AUDIO_PATH_MATCHERS = [
    /^\/api\/song-catalog\/audio$/i,
    /^\/api\/mixes\/audio$/i,
    /^\/api\/radio\/audio$/i,
    /^\/api\/stem-vault\/audio$/i,
  ];

  function safeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function safeUrl(value, fallback = "") {
    const raw = safeText(value);
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

  function isSameOriginUrl(value) {
    const url = safeUrl(value);
    if (!url) return false;
    try {
      return new URL(url).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function candidateEntries(values, source) {
    return values
      .map(value => safeUrl(value))
      .filter(Boolean)
      .map(url => ({ url, source }));
  }

  function pickPreferredCandidate(entries) {
    const candidates = Array.isArray(entries) ? entries.filter(entry => entry?.url) : [];
    return candidates.find(entry => isSameOriginUrl(entry.url)) || candidates[0] || null;
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
    if (!image.dataset.originalAlt) image.dataset.originalAlt = image.getAttribute("alt") || "";
    const badge = ensureBadge(frame);
    const isFallback = state === "fallback"
      || (state !== "missing" && (image.dataset.artworkSource === "fallback" || sameUrl(image.currentSrc || image.getAttribute("src"), fallback)));
    const isMissing = state === "missing";
    const originalAlt = image.dataset.originalAlt || "";
    frame.classList.toggle("artwork-fallback", isFallback || isMissing);
    frame.classList.toggle("artwork-live", !isFallback && !isMissing);
    frame.classList.toggle("artwork-missing", isMissing);
    frame.dataset.artworkState = isMissing ? "missing" : (isFallback ? "fallback" : "live");
    image.setAttribute("alt", isFallback || isMissing
      ? `${originalAlt}${originalAlt ? ". " : ""}${DEFAULT_RELEASE_ARTWORK_BADGE}.`
      : originalAlt);
    if (!badge) return;
    badge.textContent = image.dataset.artworkBadge || DEFAULT_RELEASE_ARTWORK_BADGE;
    badge.hidden = !isFallback && !isMissing;
    badge.setAttribute("aria-hidden", "true");
  }

  function resolve(release = {}, fallbackArtwork = DEFAULT_RELEASE_ARTWORK) {
    const fallback = safeUrl(fallbackArtwork, DEFAULT_RELEASE_ARTWORK);
    const artworkOverrideCandidates = candidateEntries([
      release.artworkOverride,
      release.artworkOverrideUrl,
      release.artwork_override_url,
    ], "manual");
    const importedArtworkCandidates = candidateEntries([
      release.importedArtwork,
      release.importedArtworkUrl,
      release.imported_artwork_url,
    ], "imported");
    const legacyArtworkCandidates = candidateEntries([
      release.artwork,
      release.artworkUrl,
      release.artwork_url,
      release.catalog?.artworkUrl,
      release.catalog?.artwork_url,
    ], "legacy");
    const artworkOverride = pickPreferredCandidate(artworkOverrideCandidates)?.url || "";
    const importedArtwork = pickPreferredCandidate(importedArtworkCandidates)?.url || "";
    const preferredArtwork = pickPreferredCandidate([
      ...artworkOverrideCandidates,
      ...importedArtworkCandidates,
      ...legacyArtworkCandidates,
    ]);
    const src = preferredArtwork?.url || fallback;
    const source = preferredArtwork?.source || "fallback";
    return { src, source, artworkOverride, importedArtwork, fallback };
  }

  function isLikelyAudioUrl(value) {
    const url = safeUrl(value);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return /\.(mp3|m4a|aac|ogg|oga|wav|flac|webm)(?:$|[?#])/i.test(`${parsed.pathname}${parsed.search}`)
        || AUDIO_PATH_MATCHERS.some(pattern => pattern.test(parsed.pathname));
    } catch {
      return false;
    }
  }

  function resolveAudio(track = {}, options = {}) {
    const { preferPreview = false, requirePlayable = false } = options;
    const previewCandidates = candidateEntries([
      track.previewAudio,
      track.preview_audio,
    ], "preview");
    const primaryCandidates = candidateEntries([
      track.audioUrl,
      track.audio_url,
      track.sourceUrl,
    ], "primary");
    const streamCandidates = candidateEntries([
      track.streamUrl,
    ], "stream");
    const orderedCandidates = preferPreview
      ? [...previewCandidates, ...primaryCandidates, ...streamCandidates]
      : [...primaryCandidates, ...previewCandidates, ...streamCandidates];
    const filteredCandidates = requirePlayable
      ? orderedCandidates.filter(candidate => isLikelyAudioUrl(candidate.url))
      : orderedCandidates;
    const selected = pickPreferredCandidate(filteredCandidates);
    return {
      src: selected?.url || "",
      source: selected?.source || "",
      isPlayable: Boolean(selected?.url && isLikelyAudioUrl(selected.url)),
      candidates: filteredCandidates.map(candidate => candidate.url),
    };
  }

  function resolvePreviewAudio(track = {}, options = {}) {
    return resolveAudio(track, { ...options, preferPreview: true, requirePlayable: true });
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
      if (image.dataset.releaseArtworkReady === "true") {
        syncFrameState(image, frame, fallback);
        if (image.complete && image.naturalWidth === 0) recover();
        return;
      }
      image.dataset.releaseArtworkReady = "true";
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
    DEFAULT_RELEASE_ARTWORK_BADGE,
    isLikelyAudioUrl,
    resolve,
    resolveAudio,
    resolvePreviewAudio,
    wire
  };
})();
