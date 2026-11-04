const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function catalogVersionPlaybackSource(version) {
  const id = String(version?.id || "");
  const expected = `/api/song-catalog/audio?versionId=${encodeURIComponent(id)}`;
  return version?.persistedAudio === true && VERSION_ID.test(id) && version.audioUrl === expected ? expected : "";
}

export function initializeCatalogPlayback({ audio, status, title, artist, window = globalThis.window } = {}) {
  if (!audio || !status || !title || !artist || !window) return null;
  let activeSource = "";
  let activeVersionId = "";
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
  const onCanPlay = () => {
    if (current() && audio.readyState >= 3) {
      report("ready", "READY · canonical catalog audio can play", true);
    }
  };
  const onPlaying = () => {
    if (current()) report("playing", "PLAYING · canonical catalog audio", true);
  };
  const onWaiting = () => {
    if (current()) report("buffering", "BUFFERING · waiting for catalog audio", false);
  };
  const onError = () => {
    if (current()) report("fault", "STREAM FAULT · audio could not be loaded", false);
  };
  const onLoadStart = () => {
    if (current()) report("loading", "LOADING · verified catalog master", false);
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
      title.textContent = String(version.label || version.versionType || song.title || "Catalog audio");
      artist.textContent = `${String(song.title || "Song")} · ${String(song.artistName || "Artist")}`;
      audio.pause();
      audio.preload = "auto";
      audio.src = source;
      audio.load();
      report("loading", "LOADING · verified catalog master", false);
      let playback;
      try {
        playback = audio.play();
      } catch (error) {
        report("blocked", error?.name === "NotAllowedError"
          ? "Playback needs a browser gesture. Press Play in the audio controls."
          : "Playback could not start. Press Play in the audio controls.", false);
        return Promise.resolve(false);
      }
      return Promise.resolve(playback).then(() => true, error => {
        if (activeSource !== source) return false;
        if (error?.name === "NotAllowedError") {
          report("blocked", "Playback needs a browser gesture. Press Play in the audio controls.", false);
        } else if (error?.name !== "AbortError") {
          report("fault", "STREAM FAULT · audio could not be loaded", false);
        }
        return false;
      });
    },
    dispose() {
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
