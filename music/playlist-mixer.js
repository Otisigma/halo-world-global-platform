export function tempoRate(previous, next) {
  const from = Number(previous?.bpm) * (previous?.rate || 1), to = Number(next?.bpm);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 40 || from > 240 || to < 40 || to > 240) return 1;
  const rate = from / to;
  return rate >= .96 && rate <= 1.04 ? rate : 1;
}

export function equalPowerCurve(incoming) {
  return Float32Array.from({ length: 64 }, (_, index) =>
    incoming ? Math.sin(index / 63 * Math.PI / 2) : Math.cos(index / 63 * Math.PI / 2));
}

export function reductionGain(samples) {
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  return rms > .14 ? Math.max(.25, .14 / rms) : 1;
}

export function createPlaylistMixer({ window, player, report, onTrack }) {
  let context, master, decks, tracks = [], current = 0, activeDeck = 0, generation = 0, running = false, transitioning = false, preferences, fallbackAllowed = false;
  const sourceAllowed = track => {
    try {
      const url = new URL(track.src, window.location.origin);
      return url.origin === window.location.origin && !url.username && !url.password;
    } catch { return false; }
  };
  function initialize() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio is unavailable in this browser.");
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = player.audio?.muted ? 0 : player.audio?.volume ?? 1;
    master.connect(context.destination);
    decks = [0, 1].map(index => {
      const audio = new window.Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "none";
      audio.preservesPitch = true;
      const source = context.createMediaElementSource(audio), analyser = context.createAnalyser();
      const level = context.createGain(), fade = context.createGain();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(level);
      level.connect(fade);
      fade.connect(master);
      fade.gain.value = 0;
      const deck = { audio, analyser, level, fade, samples: new Float32Array(512), version: 0, trackIndex: -1 };
      deck.telemetry = window.HaloListeningTelemetry?.bindAudio(audio, () => tracks[deck.trackIndex]?.id);
      audio.addEventListener("timeupdate", () => tick(index));
      audio.addEventListener("ended", () => {
        if (running && index === activeDeck && !transitioning) advance(false);
      });
      audio.addEventListener("error", () => {
        if (running) { stop(); report("Mix playback failed. No substitute track was started. Try original playback."); }
      });
      return deck;
    });
  }
  function stop() {
    generation++;
    running = false;
    transitioning = false;
    for (const deck of decks || []) {
      deck.version++;
      deck.telemetry?.reset();
      deck.audio.pause();
      deck.audio.removeAttribute("src");
      deck.audio.load();
      deck.fade.gain.cancelScheduledValues(context.currentTime);
      deck.fade.gain.value = 0;
    }
    if (context) context.suspend().catch(error => report(`The silent mix engine could not suspend (${error.name}).`));
  }
  function loadDeck(index, trackIndex) {
    const deck = decks[index], track = tracks[trackIndex];
    if (deck.trackIndex === trackIndex && deck.audio.getAttribute("src")) return deck;
    deck.version++;
    deck.telemetry?.reset();
    deck.trackIndex = trackIndex;
    deck.audio.src = track.src;
    deck.audio.preload = "auto";
    deck.audio.playbackRate = 1;
    deck.level.gain.value = 1;
    deck.fade.gain.cancelScheduledValues(context.currentTime);
    deck.fade.gain.value = 0;
    deck.audio.load();
    return deck;
  }
  const nextIndex = () => current + 1 < tracks.length ? current + 1 : preferences.repeat ? 0 : -1;
  async function advance(crossfade) {
    const next = nextIndex();
    if (next < 0) { stop(); report("Your mixed journey has finished."); return; }
    if (transitioning) return;
    transitioning = true;
    const ticket = generation, outgoing = decks[activeDeck], nextDeckIndex = 1 - activeDeck;
    const incoming = loadDeck(nextDeckIndex, next);
    incoming.audio.playbackRate = preferences.transitions === "tempo"
      ? tempoRate({ bpm: tracks[current].bpm, rate: outgoing.audio.playbackRate }, tracks[next]) : 1;
    try {
      await incoming.audio.play();
      if (ticket !== generation) return;
      const now = context.currentTime;
      const seconds = crossfade ? Math.min(preferences.fadeSeconds,
        outgoing.audio.duration / (2 * outgoing.audio.playbackRate),
        Number.isFinite(incoming.audio.duration) ? incoming.audio.duration / (2 * incoming.audio.playbackRate) : preferences.fadeSeconds) : 0;
      if (seconds > 0) {
        outgoing.fade.gain.cancelScheduledValues(now);
        incoming.fade.gain.cancelScheduledValues(now);
        outgoing.fade.gain.setValueCurveAtTime(equalPowerCurve(false), now, seconds);
        incoming.fade.gain.setValueCurveAtTime(equalPowerCurve(true), now, seconds);
      } else {
        outgoing.fade.gain.value = 0;
        incoming.fade.gain.value = 1;
      }
      activeDeck = nextDeckIndex;
      current = next;
      onTrack(tracks[current], incoming.audio);
      const version = outgoing.version;
      const finish = now + seconds;
      const cleanup = () => {
        if (ticket !== generation || version !== outgoing.version) return;
        if (context.currentTime < finish) {
          window.setTimeout(cleanup, Math.max(100, (finish - context.currentTime) * 1000));
          return;
        }
        outgoing.audio.pause();
        outgoing.fade.gain.value = 0;
        transitioning = false;
        if (decks[activeDeck].audio.ended) advance(false);
      };
      window.setTimeout(cleanup, Math.max(0, seconds * 1000));
    } catch (error) {
      if (ticket !== generation) return;
      stop();
      report(`The next song could not start (${error.name}). Choose Play again or use original playback.`);
    }
  }
  function tick(index) {
    if (!running || index !== activeDeck) return;
    const deck = decks[index], audio = deck.audio;
    if (preferences.normalize) {
      deck.analyser.getFloatTimeDomainData(deck.samples);
      deck.level.gain.setTargetAtTime(reductionGain(deck.samples), context.currentTime, .25);
    }
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = nextIndex();
    if (next >= 0 && audio.currentTime / audio.duration >= .6 && !transitioning) loadDeck(1 - activeDeck, next);
    const remaining = (audio.duration - audio.currentTime) / audio.playbackRate;
    if (next >= 0 && preferences.transitions !== "original" && !transitioning
      && remaining <= Math.min(preferences.fadeSeconds, audio.duration / (2 * audio.playbackRate))) advance(true);
  }
  async function start(nextTracks, settings) {
    stop();
    fallbackAllowed = false;
    if (!nextTracks.length) { report("No playable songs match these listening controls."); return false; }
    if (!nextTracks.every(sourceAllowed)) {
      fallbackAllowed = true;
      report("Mixed playback needs same-origin streams. This playlist will use original playback instead; external audio is not fetched for analysis.");
      return false;
    }
    try { initialize(); } catch (error) { fallbackAllowed = true; report(error.message); return false; }
    const ticket = generation;
    tracks = nextTracks;
    preferences = settings;
    current = settings.startIndex ?? 0; activeDeck = 0;
    try {
      await context.resume();
      if (ticket !== generation) return false;
      player.close();
      window.dispatchEvent(new window.CustomEvent("halo:personal-queue-start"));
      const deck = loadDeck(0, current);
      deck.fade.gain.value = 1;
      running = true;
      await deck.audio.play();
      if (ticket !== generation) return false;
      onTrack(tracks[current], deck.audio);
      report(settings.transitions === "tempo"
        ? "Tempo-aware crossfades active (within 4%, pitch preserved). No beat-phase alignment or rendered mix."
        : settings.transitions === "smooth" ? "Equal-power crossfades active. Recordings are not downloaded or rendered."
          : "Original-speed sequence with live loudness reduction. This is RMS gain matching, not LUFS mastering.");
      return true;
    } catch (error) {
      if (ticket === generation) { stop(); report(`Mix playback could not start (${error.name}). Press Play again.`); }
      return false;
    }
  }
  async function toggle() {
    if (!running) return;
    const active = decks[activeDeck].audio;
    try {
      if (!active.paused) {
        for (const deck of decks) { deck.wasPlaying = !deck.audio.paused; deck.audio.pause(); }
        await context.suspend(); report("Mixed playback paused.");
      } else {
        await context.resume();
        for (const deck of decks) if (deck.wasPlaying) await deck.audio.play();
        report("Mixed playback resumed.");
      }
    } catch (error) { stop(); throw error; }
  }
  function stopContinuation() {
    if (!running) return;
    tracks = tracks.slice(0, current + 1);
    preferences.repeat = false;
  }
  async function skip(direction) {
    if (!running) return;
    const next = current + direction;
    const index = next >= 0 && next < tracks.length ? next : preferences.repeat ? direction > 0 ? 0 : tracks.length - 1 : -1;
    if (index < 0 || index === current) { report("There is no other song in that direction."); return; }
    await start(tracks, { ...preferences, startIndex: index });
  }
  function setVolume(value, muted) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Choose a volume between 0 and 100%.");
    if (master) master.gain.value = muted ? 0 : value;
  }
  window.addEventListener("pagehide", stop);
  return { start, stop, stopContinuation, skip, setVolume, toggle, get running() { return running; }, get fallbackAllowed() { return fallbackAllowed; }, get audio() { return decks?.[activeDeck]?.audio; } };
}
