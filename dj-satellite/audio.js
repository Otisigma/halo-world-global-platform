const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECORD_BYTES = 100 * 1024 * 1024;

export function measure(analyser) {
  const samples = new Float32Array(analyser.fftSize);
  samples.fill(Number.NaN);
  analyser.getFloatTimeDomainData(samples);
  let peak = 0, sum = 0, squares = 0, clipped = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return { valid: false };
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
    squares += sample * sample;
    if (Math.abs(sample) >= 0.999) clipped += 1;
  }
  return { valid: true, peak, rms: Math.sqrt(squares / samples.length), dc: Math.abs(sum / samples.length), clipped };
}

export class SatelliteAudio {
  constructor(context, { guard = globalThis.HaloRecorderGuard, Recorder = globalThis.MediaRecorder, onEvent = () => {}, onRecording = () => {} } = {}) {
    if (!guard) throw new Error("Recorder isolation guard is unavailable. Reload to try again.");
    this.context = context;
    this.guard = guard;
    this.Recorder = Recorder;
    this.onEvent = onEvent;
    this.onRecording = onRecording;
    this.events = [];
    this.samples = [];
    this.ticks = 0;
    this.decks = {};
    this.musicSources = new Set();
    this.bus = context.createGain();
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.output = context.createGain();
    this.output.gain.value = 0.5;
    this.bus.connect(this.limiter);
    this.limiter.connect(this.output);
    this.output.connect(context.destination);
    this.feed = guard.createRecordingFeed(context, this.limiter);
    this.musicMeter = context.createAnalyser();
    this.bus.connect(this.musicMeter);
    this.cueBus = context.createGain();
    this.cueBus.gain.value = 0.15;
    this.cueBus.connect(context.destination);
    this.cueMeter = context.createAnalyser();
    this.cueBus.connect(this.cueMeter);
    for (const id of ["a", "b"]) {
      const gain = context.createGain();
      gain.connect(this.bus);
      this.decks[id] = { gain, buffer: null, music: null, cue: null, loading: false };
    }
    this.setCrossfader(0.5);
    this.contextChange = () => {
      this.event("context-state", { state: context.state });
      if (this.recorder && context.state !== "running") this.finish(true);
    };
    context.addEventListener("statechange", this.contextChange);
    this.watchdog = setInterval(() => this.tick(), 250);
    this.event("graph-ready", { sampleRate: context.sampleRate, recordingTap: "post-limiter", cue: "monitor-only" });
  }

  event(type, detail = {}) {
    const event = { type, audioTime: this.context.currentTime, at: new Date().toISOString(), ...detail };
    this.events.push(event);
    if (this.events.length > 150) this.events.shift();
    this.onEvent(event);
  }

  get busy() { return Boolean(this.checking || this.recorder); }

  async load(id, file) {
    if (this.busy || this.decks[id].loading) throw new Error("Finish the current check, recording, or load first.");
    if (!file || file.size > MAX_FILE_BYTES) throw new Error("Choose an audio file no larger than 50 MiB.");
    const deck = this.decks[id];
    deck.loading = true;
    this.stop(id);
    this.cue(id, false);
    deck.buffer = null;
    this.event("load-start", { deck: id });
    try {
      const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 600 || buffer.numberOfChannels > 2) {
        throw new Error("Use a playable mono/stereo song no longer than 10 minutes.");
      }
      deck.buffer = buffer;
      this.event("load-ready", { deck: id, duration: buffer.duration, channels: buffer.numberOfChannels });
      return buffer;
    } catch (error) {
      this.event("load-failed", { deck: id });
      throw error;
    } finally {
      deck.loading = false;
    }
  }

  setCrossfader(value) {
    if (this.takeover) throw new Error("Crossfader is locked during the sequencing test.");
    const x = Number(value);
    if (!Number.isFinite(x) || x < 0 || x > 1) throw new Error("Invalid crossfader value.");
    this.crossfader = x;
    this.decks.a.gain.gain.setTargetAtTime(Math.cos(x * Math.PI / 2), this.context.currentTime, 0.01);
    this.decks.b.gain.gain.setTargetAtTime(Math.sin(x * Math.PI / 2), this.context.currentTime, 0.01);
  }

  source(id, output, when, isCue = false) {
    const deck = this.decks[id];
    if (!deck.buffer) throw new Error(`Load playable audio on deck ${id.toUpperCase()} first.`);
    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    source.buffer = deck.buffer;
    source.connect(envelope);
    envelope.connect(output);
    const end = when + deck.buffer.duration;
    const fade = Math.min(0.01, deck.buffer.duration / 4);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(1, when + fade);
    envelope.gain.setValueAtTime(1, end - fade);
    envelope.gain.linearRampToValueAtTime(0, end);
    const handle = { source, envelope, stopped: false };
    if (!isCue) this.musicSources.add(handle);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      this.musicSources.delete(handle);
      if (deck[isCue ? "cue" : "music"] === handle) deck[isCue ? "cue" : "music"] = null;
      this.event(isCue ? "cue-ended" : "music-ended", { deck: id });
    };
    try {
      source.start(when);
    } catch (error) {
      source.onended = null;
      source.disconnect();
      envelope.disconnect();
      this.musicSources.delete(handle);
      throw error;
    }
    this.event(isCue ? "cue-start" : "music-scheduled", { deck: id, scheduledAt: when, endsAt: end });
    return handle;
  }

  stopHandle(handle) {
    if (!handle || handle.stopped) return;
    handle.stopped = true;
    const now = this.context.currentTime;
    handle.envelope.gain.cancelScheduledValues(now);
    handle.envelope.gain.setTargetAtTime(0, now, 0.003);
    handle.source.stop(now + 0.02);
  }

  play(id) {
    if (this.checking || this.takeover) throw new Error("Wait for preflight or cancel takeover first.");
    if (this.decks[id].music) throw new Error("Stop this deck before restarting it.");
    this.decks[id].music = this.source(id, this.decks[id].gain, this.context.currentTime + 0.02);
  }

  stop(id) {
    if (this.takeover) { this.finish(); return; }
    this.stopHandle(this.decks[id].music);
  }

  cue(id, enabled) {
    const deck = this.decks[id];
    if (!enabled) this.stopHandle(deck.cue);
    else if (!deck.cue) deck.cue = this.source(id, this.cueBus, this.context.currentTime + 0.02, true);
  }

  async quietCheck() {
    if (this.busy || Object.values(this.decks).some(deck => deck.loading)) throw new Error("Finish the current operation first.");
    this.checking = true;
    this.cancelled = false;
    this.event("preflight-start", { cueActive: Object.values(this.decks).some(deck => deck.cue) });
    try {
      await this.guard.preflight(this.feed, { isMusicIdle: () => !this.musicSources.size && !this.cancelled });
      if (this.cancelled) throw new Error("Preflight cancelled.");
      this.event("preflight-passed");
    } catch (error) {
      this.event("preflight-failed");
      throw error;
    } finally {
      this.checking = false;
    }
  }

  async record(takeover = false) {
    if (!this.Recorder) throw new Error("Recording is not supported in this browser.");
    if (takeover && Object.values(this.decks).some(deck => !deck.buffer)) throw new Error("Takeover requires two decoded playable songs.");
    await this.quietCheck();
    // No await between the successful preflight and recorder start.
    if (this.cancelled || this.recorder || !this.guard.isFeedAvailable(this.feed) || this.musicSources.size) throw new Error("Recording start was cancelled or the feed is unavailable.");
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(mime => this.Recorder.isTypeSupported(mime));
    const recorder = type ? new this.Recorder(this.feed.destination.stream, { mimeType: type }) : new this.Recorder(this.feed.destination.stream);
    const chunks = [];
    let bytes = 0;
    this.discard = false;
    this.recorder = recorder;
    recorder.ondataavailable = event => {
      if (event.data.size && !this.discard) {
        bytes += event.data.size;
        if (bytes > MAX_RECORD_BYTES) this.finish(true);
        else chunks.push(event.data);
      }
    };
    recorder.onerror = () => this.finish(true);
    recorder.onstop = () => {
      const blob = this.discard ? null : new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
      this.recorder = null;
      this.event(this.discard ? "recording-discarded" : "recording-finished");
      this.onRecording(blob);
    };
    try {
      recorder.start(1000);
      this.recordStartedAt = this.context.currentTime;
      this.event("recording-start", { mode: takeover ? "takeover" : "manual", mimeType: recorder.mimeType });
      if (takeover) {
        this.takeover = true;
        const start = this.context.currentTime + 0.05;
        for (const id of ["a", "b"]) this.decks[id].gain.gain.setTargetAtTime(1, this.context.currentTime, 0.01);
        this.decks.a.music = this.source("a", this.decks.a.gain, start);
        this.decks.b.music = this.source("b", this.decks.b.gain, start + this.decks.a.buffer.duration);
        this.takeoverEnd = start + this.decks.a.buffer.duration + this.decks.b.buffer.duration + 0.5;
        this.event("takeover-scheduled", { order: ["a", "b"], start });
      }
    } catch (error) {
      this.finish(true);
      if (recorder.state === "inactive") this.recorder = null;
      throw error;
    }
  }

  finish(discard = false) {
    if (!this.recorder) return;
    this.discard ||= discard;
    if (this.takeover) {
      this.takeover = false;
      for (const handle of this.musicSources) this.stopHandle(handle);
      this.setCrossfader(this.crossfader);
    }
    if (this.recorder.state !== "inactive") this.recorder.stop();
  }

  stopAll() {
    this.cancelled = true;
    this.finish();
    for (const handle of this.musicSources) this.stopHandle(handle);
    for (const id of ["a", "b"]) this.cue(id, false);
    this.event("stop-all");
  }

  diagnostics() {
    return {
      context: this.context.state, sampleRate: this.context.sampleRate, audioTime: this.context.currentTime,
      activeMusicSources: this.musicSources.size, cueActive: Object.values(this.decks).some(deck => deck.cue),
      recording: this.recorder?.state || "inactive", takeover: Boolean(this.takeover),
      limiterReduction: this.limiter.reduction,
      music: measure(this.musicMeter), cue: measure(this.cueMeter), recorder: measure(this.feed.analyser)
    };
  }

  tick() {
    if (++this.ticks % 4 === 0) {
      this.samples.push(this.diagnostics());
      if (this.samples.length > 120) this.samples.shift();
    }
    if (!this.recorder || this.recorder.state !== "recording") return;
    if (!this.guard.isFeedAvailable(this.feed) || !measure(this.feed.analyser).valid) {
      this.event("feed-unavailable");
      this.finish(true);
    } else if (this.takeover && this.context.currentTime >= this.takeoverEnd || this.context.currentTime - this.recordStartedAt >= 1200) {
      this.finish();
    }
  }

  destroy() {
    this.stopAll();
    clearInterval(this.watchdog);
    this.context.removeEventListener("statechange", this.contextChange);
    this.feed.destination.stream.getTracks().forEach(track => track.stop());
    return this.context.close();
  }
}
