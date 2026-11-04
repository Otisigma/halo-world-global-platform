// Reports what the <audio> element has actually observed; it never starts, mutes or rebinds playback.
const LABELS = Object.freeze({
  standby: "STANDBY",
  deferred: "STANDBY / LOADS ON PLAY",
  loading: "LOADING",
  buffering: "BUFFERING",
  ready: "READY & BUFFERED",
  loaded: "FULLY LOADED",
  playing: "PLAYING",
  stalled: "BUFFERING / STALLED",
  fault: "STREAM FAULT / OFFLINE",
});

export function bufferedPercent(audio) {
  const duration = Number(audio?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  try {
    const ranges = audio.buffered;
    if (!ranges?.length) return 0;
    // Only the range covering the playhead is usable buffer; later seeks can leave unrelated islands.
    const position = Number(audio.currentTime) || 0;
    let end = 0;
    for (let index = 0; index < ranges.length; index++) {
      if (ranges.start(index) <= position + 0.5) end = Math.max(end, ranges.end(index));
    }
    return Math.max(0, Math.min(100, Math.round((end / duration) * 100)));
  } catch {
    return null;
  }
}

export function createReadinessTelemetry({ audio, bar, track, status, percent, root, window }) {
  if (!audio || !bar || !status || !percent) return null;
  let state = "standby", value = 0;
  const cleanups = [];

  function hasSource() {
    return Boolean(audio.getAttribute("src") || audio.currentSrc);
  }

  function render(next, nextValue = value) {
    state = next;
    value = nextValue == null ? value : nextValue;
    bar.style.width = `${state === "fault" ? 100 : value}%`;
    percent.textContent = state === "fault" ? "ERR" : `${value}%`;
    status.textContent = `● AI TELEMETRY: ${state === "buffering" ? `${LABELS.buffering} (${value}%)` : LABELS[state]}`;
    if (root) root.dataset.state = state;
    if (track) {
      track.setAttribute("aria-valuenow", String(state === "fault" ? 0 : value));
      track.setAttribute("aria-valuetext", LABELS[state]);
    }
    const ready = ["ready", "loaded", "playing"].includes(state);
    window.HALO_STREAM_READY = ready;
    window.HaloDreamweaverReadiness = Object.freeze({
      state, label: LABELS[state], percent: value, ready,
      readyState: Number(audio.readyState) || 0,
      local: String(audio.currentSrc || audio.getAttribute("src") || "").startsWith("blob:"),
    });
  }

  function progress() {
    if (state === "fault" || !hasSource()) return;
    const measured = bufferedPercent(audio);
    if (measured == null) return;
    if (measured >= 100) return render(state === "playing" ? "playing" : "loaded", 100);
    if (["ready", "playing", "stalled"].includes(state)) return render(state, measured);
    render("buffering", measured);
  }

  function reset() {
    if (!hasSource()) return render("standby", 0);
    if (audio.preload === "none" && Number(audio.networkState) !== 2) return render("deferred", 0);
    render("loading", 0);
  }

  const handlers = {
    emptied: reset,
    loadstart: () => render("loading", 0),
    loadedmetadata: progress,
    progress,
    canplaythrough: () => {
      const measured = bufferedPercent(audio);
      render(!audio.paused ? "playing" : measured === 100 ? "loaded" : "ready", measured ?? value);
    },
    // Browsers suspend preload=none/metadata fetches before any data; that is a deliberate wait, not loading.
    suspend: () => { if (Number(audio.readyState) < 1 && state === "loading") render("deferred", 0); },
    playing: () => render("playing", bufferedPercent(audio) ?? value),
    waiting: () => render("stalled"),
    stalled: () => { if (Number(audio.readyState) < 3) render("stalled"); },
    pause: () => {
      if (!["playing", "stalled"].includes(state)) return;
      const measured = bufferedPercent(audio);
      if (measured === 100) render("loaded", 100);
      else if (Number(audio.readyState) >= 4) render("ready", measured ?? value);
      else render("buffering", measured ?? value);
    },
    error: () => { if (hasSource()) render("fault"); },
    "halo:release-state": event => {
      if (event.detail?.state === "unavailable") return render("fault");
      if (state === "fault" && !audio.error && event.detail?.mode !== "error") reset();
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    audio.addEventListener(name, handler);
    cleanups.push(() => audio.removeEventListener(name, handler));
  }

  if (audio.error && hasSource()) render("fault");
  else if (Number(audio.readyState) >= 4) handlers.canplaythrough();
  else if (Number(audio.readyState) >= 1) progress();
  else reset();

  return {
    snapshot: () => window.HaloDreamweaverReadiness,
    dispose() { cleanups.splice(0).forEach(cleanup => cleanup()); },
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const start = () => {
    window.haloTelemetry ||= createReadinessTelemetry({
      audio: document.getElementById("showAudio"),
      bar: document.getElementById("aiReadinessBar"),
      track: document.getElementById("aiReadinessTrack"),
      status: document.getElementById("aiReadinessStatus"),
      percent: document.getElementById("aiReadinessPercent"),
      root: document.getElementById("aiReadiness"),
      window,
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
