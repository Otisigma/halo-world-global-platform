const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function catalogVersionPlaybackSource(version) {
  const id = String(version?.id || "");
  const expected = `/api/song-catalog/audio?versionId=${encodeURIComponent(id)}`;
  return version?.playableAudio === true && VERSION_ID.test(id) && version.playbackUrl === expected ? expected : "";
}

export function initializeCatalogPlayback({
  audio, status, title, artist, window = globalThis.window, resolveLocalAudio,
  urlApi = URL, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (!audio || !status || !title || !artist || !window) return null;
  let activeSource = "";
  let activeVersionId = "";
  let selection = null;
  let localUrl = "";
  let watchdog;
  const clearWatchdog = () => { clearTimer(watchdog); watchdog = undefined; };
  const releaseLocalUrl = () => {
    if (localUrl) urlApi.revokeObjectURL(localUrl);
    localUrl = "";
  };
  const audioLabel = () => localUrl ? "LOCAL PREVIEW · this browser only; catalog master unchanged" : "canonical catalog audio";
  const report = (state, message, ready = false) => {
    status.dataset.state = state;
    status.textContent = message;
    window.HALO_STREAM_READY = Boolean(ready && audio.readyState >= 3 && !audio.error);
    window.HaloDreamweaverReadiness = Object.freeze({
      state,
      label: message,
      ready: window.HALO_STREAM_READY,
      readyState: Number(audio.readyState) || 0,
      versionId: activeVersionId,
    });
  };
  const current = () => Boolean(activeSource) && audio.getAttribute("src") === activeSource;
  const recover = async (target = selection) => {
    if (!target || target !== selection || target.attempted) return false;
    clearWatchdog();
    target.attempted = true;
    if (!resolveLocalAudio || target.song.sourceUploadSurface !== "dreamweaver_lab"
      || target.song.id !== target.version.id || !target.version.isCanonicalMaster) {
      report("fault", "STREAM FAULT · audio could not be loaded", false);
      return false;
    }
    report("loading", "Stream unavailable · checking this song's saved local audio...", false);
    try {
      const file = await resolveLocalAudio(target.song.id);
      if (target !== selection) return false;
      if (!(file instanceof Blob) || !file.size || !/^audio\//.test(file.type)) {
        throw new Error("No supported saved audio was found for this song.");
      }
      if (file.size !== Number(target.version.audioByteSize) || file.name !== target.version.audioFilename) {
        throw new Error("The saved project file does not match this catalog version. Preview it explicitly in Song Lab.");
      }
      localUrl = urlApi.createObjectURL(file);
      activeSource = localUrl;
      audio.pause();
      audio.src = localUrl;
      audio.load();
      report("loading", "LOADING · local preview; catalog master unchanged", false);
      await audio.play();
      return target === selection;
    } catch (error) {
      if (target !== selection) return false;
      report(error?.name === "NotAllowedError" ? "blocked" : "fault",
        error?.name === "NotAllowedError"
          ? "Local preview loaded. Press Play in the audio controls."
          : `Audio unavailable. Local recovery failed: ${error.message || "saved audio could not be opened"}`, false);
      return false;
    }
  };
  const armWatchdog = () => {
    clearWatchdog();
    if (!selection || selection.attempted || !resolveLocalAudio) return;
    const target = selection;
    watchdog = setTimer(() => {
      if (target === selection && current() && audio.readyState < 3) void recover(target);
    }, 8000);
  };
  const onCanPlay = () => {
    if (current() && audio.readyState >= 3) {
      clearWatchdog();
      report("ready", `READY · ${audioLabel()}`, true);
    }
  };
  const onPlaying = () => {
    if (current()) {
      clearWatchdog();
      report("playing", `PLAYING · ${audioLabel()}`, true);
    }
  };
  const onWaiting = () => {
    if (current()) {
      report("buffering", `BUFFERING · ${audioLabel()}`, false);
      armWatchdog();
    }
  };
  const onError = () => {
    if (current()) {
      if (!selection?.attempted) void recover();
      else report("fault", "STREAM FAULT · audio could not be loaded", false);
    }
  };
  const onLoadStart = () => {
    if (current()) report("loading", `LOADING · ${audioLabel()}`, false);
  };
  audio.addEventListener("loadstart", onLoadStart);
  audio.addEventListener("canplay", onCanPlay);
  audio.addEventListener("playing", onPlaying);
  audio.addEventListener("waiting", onWaiting);
  audio.addEventListener("stalled", onWaiting);
  audio.addEventListener("error", onError);
  report("standby", "Choose Play on a stored catalog version.", false);

  return {
    select(song, version) {
      clearWatchdog();
      selection = null;
      releaseLocalUrl();
      const source = catalogVersionPlaybackSource(version);
      if (!source) {
        activeSource = "";
        activeVersionId = "";
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        report("unavailable", "This catalog version has no verified stored audio.", false);
        return Promise.resolve(false);
      }
      activeSource = source;
      activeVersionId = version.id;
      const target = selection = { song, version, attempted: false };
      title.textContent = String(version.label || version.versionType || song.title || "Catalog audio");
      artist.textContent = `${String(song.title || "Song")} · ${String(song.artistName || "Artist")}`;
      audio.pause();
      audio.preload = "auto";
      audio.src = source;
      audio.load();
      report("loading", "LOADING · verified catalog audio", false);
      armWatchdog();
      let playback;
      try {
        playback = audio.play();
      } catch (error) {
        clearWatchdog();
        if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") return recover(target);
        report("blocked", error?.name === "NotAllowedError"
          ? "Playback needs a browser gesture. Press Play in the audio controls."
          : "Playback could not start. Press Play in the audio controls.", false);
        return Promise.resolve(false);
      }
      return Promise.resolve(playback).then(() => target === selection, error => {
        if (target !== selection) return false;
        if (target.attempted) return false;
        if (error?.name === "NotAllowedError") {
          clearWatchdog();
          report("blocked", "Playback needs a browser gesture. Press Play in the audio controls.", false);
        } else if (error?.name !== "AbortError") {
          return recover(target);
        } else {
          clearWatchdog();
        }
        return false;
      });
    },
    dispose() {
      clearWatchdog();
      selection = null;
      if (localUrl) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        releaseLocalUrl();
      }
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onWaiting);
      audio.removeEventListener("error", onError);
      activeSource = "";
      activeVersionId = "";
      report("standby", "Choose Play on a stored catalog version.", false);
    },
  };
}
