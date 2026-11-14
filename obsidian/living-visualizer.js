export function createLivingVisualizer({ audio, button, status, field, window, document }) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let context = null, stream = null, source = null, analyser = null, data = null, frame = null;
  let active = false, generation = 0, silentSince = null, signalSeen = false;

  function resetVisual() {
    field.style.setProperty("--bass", "0");
    field.style.setProperty("--treble", "0");
  }
  function stopFrames() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    resetVisual();
  }
  function dispose(message = "Visualizer is off.") {
    ++generation;
    active = false;
    stopFrames();
    source?.disconnect();
    analyser?.disconnect();
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (context && context.state !== "closed") {
      context.close().catch(error => console.error("Visualizer audio context could not close", error));
    }
    context = stream = source = analyser = data = null;
    button.textContent = "Enable audio visualizer";
    button.setAttribute("aria-pressed", "false");
    status.textContent = message;
  }
  function tick(timestamp) {
    frame = null;
    if (!active || audio.paused || audio.ended || document.hidden || motion.matches) return;
    analyser.getByteFrequencyData(data);
    const average = (low, high) => {
      const binHz = context.sampleRate / analyser.fftSize;
      const first = Math.max(0, Math.min(data.length - 1, Math.floor(low / binHz)));
      const last = Math.max(first + 1, Math.min(data.length, Math.ceil(high / binHz)));
      let sum = 0;
      for (let i = first; i < last; i++) sum += data[i];
      return sum / (last - first) / 255;
    };
    const bass = average(40, 250), treble = average(2000, 8000);
    field.style.setProperty("--bass", bass.toFixed(3));
    field.style.setProperty("--treble", treble.toFixed(3));
    if (bass > 0 || treble > 0) {
      silentSince = null;
      if (signalSeen !== true) status.textContent = "Visualizer responding to audio frequencies.";
      signalSeen = true;
    } else {
      silentSince ??= timestamp;
      if (timestamp - silentSince >= 3000 && signalSeen !== "silent") {
        status.textContent = "No frequency signal detected; the audio may be silent or its source may restrict analysis.";
        signalSeen = "silent";
      }
    }
    frame = window.requestAnimationFrame(tick);
  }
  function startFrames() {
    if (active && frame === null && !audio.paused && !audio.ended && !document.hidden && !motion.matches) {
      silentSince = null;
      frame = window.requestAnimationFrame(tick);
    }
  }
  async function enable() {
    if (motion.matches) {
      status.textContent = "Visualizer unavailable while reduced motion is enabled.";
      return;
    }
    if (audio.paused || audio.ended || !audio.currentSrc) {
      status.textContent = "Start a playable release first, then enable the visualizer.";
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || typeof audio.captureStream !== "function") {
      status.textContent = "Audio visualization is not supported in this browser. Playback is unchanged.";
      return;
    }
    const ticket = ++generation;
    button.disabled = true;
    status.textContent = "Starting audio visualizer…";
    try {
      context = new AudioContext();
      stream = audio.captureStream();
      if (!stream.getAudioTracks().length) throw new Error("No audio track is available for analysis");
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      data = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      await context.resume();
      if (ticket !== generation) return;
      if (context.state !== "running") throw new Error("Audio analysis could not start");
      active = true;
      signalSeen = false;
      button.textContent = "Turn off audio visualizer";
      button.setAttribute("aria-pressed", "true");
      status.textContent = "Listening for a frequency signal. Audio remains under your control.";
      startFrames();
    } catch (error) {
      if (ticket !== generation) return;
      console.error("Obsidian audio visualization unavailable", error);
      dispose("Audio visualization could not start. Playback is unchanged.");
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener("click", () => { if (active) dispose(); else void enable(); });
  audio.addEventListener("playing", startFrames);
  for (const event of ["pause", "waiting"]) audio.addEventListener(event, stopFrames);
  for (const event of ["ended", "error"]) audio.addEventListener(event, () => {
    if (active || context) dispose("Playback ended or failed. Start audio and enable the visualizer again.");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopFrames(); else startFrames(); });
  const onMotionChange = () => { if (motion.matches && (active || context)) dispose("Visualizer turned off because reduced motion is enabled."); };
  if (motion.addEventListener) motion.addEventListener("change", onMotionChange);
  else motion.addListener(onMotionChange);
  window.addEventListener("pagehide", () => dispose());
  return { reset: () => { if (active || context) dispose("Release changed. Start playback and enable the visualizer again."); } };
}
