import { SatelliteAudio } from "./audio.js";

const $ = id => document.getElementById(id);
let engine;
let recordingUrl;
let operation = false;
const status = message => { $("status").textContent = message; };

function update() {
  const busy = operation || engine?.busy;
  for (const id of ["a", "b"]) {
    const deck = engine?.decks[id];
    $(`file-${id}`).disabled = Boolean(busy);
    $(`play-${id}`).disabled = !deck?.buffer || busy && !engine?.recorder || Boolean(engine?.takeover) || Boolean(deck?.music);
    $(`stop-${id}`).disabled = !deck?.music;
    $(`cue-${id}`).disabled = !deck?.buffer || Boolean(operation && !deck?.cue);
    $(`cue-${id}`).checked = Boolean(deck?.cue && !deck.cue.stopped);
  }
  $("enable").disabled = Boolean(busy);
  $("check").disabled = !engine || Boolean(busy);
  $("record").disabled = !engine || Boolean(busy);
  $("takeover").disabled = !engine || Boolean(busy) || !engine.decks.a.buffer || !engine.decks.b.buffer;
  $("finish").disabled = !engine?.recorder;
  $("crossfader").disabled = Boolean(engine?.takeover);
}

async function enable() {
  if (!engine) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is not supported in this browser.");
    const context = new Context();
    try {
      engine = new SatelliteAudio(context, {
        onEvent: () => {
          if (engine) $("events").textContent = engine.events.slice(-12).map(event => `${event.audioTime.toFixed(3)}s ${event.type}`).join("\n");
        },
        onRecording: blob => {
          if (recordingUrl) URL.revokeObjectURL(recordingUrl);
          recordingUrl = null;
          $("download").hidden = true;
          if (blob?.size) {
            recordingUrl = URL.createObjectURL(blob);
            $("download").href = recordingUrl;
            $("download").download = `halo-satellite.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`;
            $("download").hidden = false;
            status("Recording finished. Download and listen separately to compare with local monitoring.");
          } else status("Recording discarded: the recorder feed was unavailable or recording failed.");
          update();
        }
      });
      engine.setCrossfader($("crossfader").value);
      engine.output.gain.value = Number($("monitor").value);
      engine.cueBus.gain.value = Number($("cue-volume").value);
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  await engine.context.resume();
  if (engine.context.state !== "running") throw new Error("Audio is suspended. Try Enable audio again.");
  return engine;
}

async function run(action) {
  if (operation) return;
  operation = true;
  update();
  try { await action(); }
  catch (error) { status(error.message || "Audio operation failed."); }
  finally { operation = false; update(); }
}

$("enable").addEventListener("click", () => run(async () => { await enable(); status("Audio ready. Load songs or check the quiet feed."); }));
for (const id of ["a", "b"]) {
  $(`file-${id}`).addEventListener("change", () => run(async () => {
    const file = $(`file-${id}`).files[0];
    if (!file) return;
    $(`track-${id}`).textContent = "Loading…";
    try {
      const audio = await enable();
      const buffer = await audio.load(id, file);
      $(`track-${id}`).textContent = `${file.name} — ${buffer.duration.toFixed(1)}s`;
      status("Decoded locally. Nothing started. Two loaded songs enable the takeover test.");
    } catch (error) {
      $(`track-${id}`).textContent = "No playable song loaded";
      throw error;
    }
  }));
  $(`cue-${id}`).addEventListener("change", () => {
    const enabled = $(`cue-${id}`).checked;
    if (!enabled) {
      engine?.cue(id, false);
      update();
      return;
    }
    return run(async () => { (await enable()).cue(id, enabled); });
  });
}
document.querySelectorAll("[data-deck-play]").forEach(button => {
  button.addEventListener("click", () => run(async () => {
    const id = button.dataset.deckPlay;
    (await enable()).play(id);
    status(`Deck ${id.toUpperCase()} playing.`);
  }));
});
document.querySelectorAll("[data-deck-stop]").forEach(button => {
  button.addEventListener("click", () => { engine?.stop(button.dataset.deckStop); update(); });
});
$("crossfader").addEventListener("input", () => engine?.setCrossfader($("crossfader").value));
$("monitor").addEventListener("input", () => engine?.output.gain.setTargetAtTime(Number($("monitor").value), engine.context.currentTime, 0.01));
$("cue-volume").addEventListener("input", () => engine?.cueBus.gain.setTargetAtTime(Number($("cue-volume").value), engine.context.currentTime, 0.01));
$("check").addEventListener("click", () => run(async () => {
  await (await enable()).quietCheck();
  status("Quiet-feed check passed: six frames below −80 dBFS with an advancing clock. Recording still requires its own fresh check.");
}));
for (const [id, takeover] of [["record", false], ["takeover", true]]) {
  $(id).addEventListener("click", () => run(async () => {
    const audio = await enable();
    status("Checking recorder isolation… leave music stopped.");
    await audio.record(takeover);
    status(takeover ? "Recording A → B once each. CUE remains monitor-only." : "Recording the post-limiter bus. Start either deck manually.");
  }));
}
$("finish").addEventListener("click", () => engine?.finish());
$("stop-all").addEventListener("click", () => { engine?.stopAll(); status("Stopped / cancelled. Wait for source tails before checking again."); update(); });
$("export").addEventListener("click", () => {
  const data = { surface: "halo-dj-satellite", diagnostics: engine?.diagnostics() || null, samples: engine?.samples || [], events: engine?.events || [] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "halo-dj-satellite-diagnostics.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const db = value => value === 0 ? "−∞" : (20 * Math.log10(value)).toFixed(1);
const meterTimer = setInterval(() => {
  if (!engine) return;
  const data = engine.diagnostics();
  $("meters").textContent = [
    `Context: ${data.context} | ${data.sampleRate} Hz | ${data.audioTime.toFixed(2)}s`,
    `Music sources: ${data.activeMusicSources} | CUE: ${data.cueActive} | Recorder: ${data.recording}`,
    `Limiter reduction: ${data.limiterReduction.toFixed(1)} dB`,
    ...["music", "cue", "recorder"].map(name => {
      const level = data[name];
      return level.valid ? `${name}: peak ${db(level.peak)} / RMS ${db(level.rms)} / DC ${db(level.dc)} dBFS | near-full-scale samples ${level.clipped}` : `${name}: INVALID SAMPLES`;
    })
  ].join("\n");
  update();
}, 250);
window.addEventListener("pagehide", () => {
  clearInterval(meterTimer);
  engine?.destroy();
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
});
update();
