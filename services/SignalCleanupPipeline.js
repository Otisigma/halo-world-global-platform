const MAINS = [50, 60];
const FLOOR_DB = -120;
const dbfs = value => value > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(value)) : FLOOR_DB;

// Ingress Sentinel: inspect quiet passages only, so musical bass is not treated as hum.
export function inspectSignalFrame({ samples, spectrum, sampleRate }) {
  if (!samples?.length || !spectrum?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Signal analysis is unavailable.");
  }
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error("Invalid signal samples.");
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  let noisePower = 0;
  let noiseBins = 0;
  const binHz = sampleRate / (spectrum.length * 2);
  for (let bin = 0; bin < spectrum.length; bin += 1) {
    const value = spectrum[bin];
    if (value !== -Infinity && !Number.isFinite(value)) throw new Error("Invalid signal spectrum.");
    if (bin * binHz >= 1000 && bin * binHz <= 10000) {
      noisePower += Math.pow(10, value / 10);
      noiseBins += 1;
    }
  }
  if (!noiseBins || binHz > 10) throw new Error("Insufficient signal spectrum resolution.");
  const rmsDbfs = dbfs(Math.sqrt(energy / samples.length));
  const noiseFloorDbfs = Math.max(FLOOR_DB, 10 * Math.log10(noisePower / noiseBins));
  let humFrequency = null;
  let humLevelDbfs = FLOOR_DB;
  let humDistance = Infinity;
  if (rmsDbfs <= -45) {
    for (const frequency of MAINS) {
      for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
        const center = Math.round(frequency * harmonic / binHz);
        let level = -Infinity;
        let peakBin = center;
        for (let bin = Math.max(1, center - 1); bin <= center + 1; bin += 1) {
          if (spectrum[bin] > level) { level = spectrum[bin]; peakBin = bin; }
        }
        const distance = Math.abs(peakBin * binHz - frequency * harmonic);
        // Compare nearby bins outside the FFT main lobe as well as the broadband floor.
        const background = Math.max(FLOOR_DB, spectrum[center - 5] ?? FLOOR_DB, spectrum[center + 5] ?? FLOOR_DB, noiseFloorDbfs);
        if (level > -85 && level - background >= 12 && (level > humLevelDbfs || (level === humLevelDbfs && distance < humDistance))) {
          humFrequency = frequency;
          humLevelDbfs = level;
          humDistance = distance;
        }
      }
    }
  }
  return { rmsDbfs, peakDbfs: dbfs(peak), noiseFloorDbfs, humDetected: humFrequency !== null, humFrequency, humLevelDbfs };
}

/**
 * Native Web Audio DSP runs on the audio thread; the bounded sentinel/auditor runs at 10 Hz.
 * @typedef {import("./SignalCleanupPipeline.js").SignalCleanupStatus} SignalCleanupStatus
 */
export class SignalCleanupPipeline {
  constructor(context, { routingGuard, assertIsolation, recorderAnalysers }) {
    this.context = context;
    this.routing = routingGuard;
    this.assertIsolation = assertIsolation;
    this.recorderAnalysers = recorderAnalysers;
    this.connected = false;
    this.timer = null;
    this.lastAudioTime = context.currentTime;
    this.status = this.unavailable("Signal audit has not run.");

    // Frequency Surgeon: preserve the low end above 35 Hz; widen only detected mains notches.
    this.highPass = context.createBiquadFilter();
    this.highPass.type = "highpass";
    this.highPass.frequency.value = 35;
    this.highPass.Q.value = .707;
    this.notches = MAINS.flatMap(frequency => [1, 2, 3, 4].map(harmonic => {
      const notch = context.createBiquadFilter();
      notch.type = "notch";
      notch.frequency.value = frequency * harmonic;
      notch.Q.value = 1000;
      return notch;
    }));

    // Spectral Scrubber: downward expansion below -65 dBFS and a sample-wise -1 dBFS ceiling.
    this.expander = context.createGain();
    this.expander.gain.value = 0;
    this.peakProtector = context.createWaveShaper();
    const ceiling = Math.pow(10, -1 / 20);
    this.peakProtector.curve = Float32Array.from({ length: 65537 }, (_, index) =>
      Math.max(-ceiling, Math.min(ceiling, index / 32768 - 1)));
    this.splitter = context.createChannelSplitter(2);
    this.ingressAnalysers = [0, 1].map(() => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 32768;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = FLOOR_DB;
      return analyser;
    });
    this.frames = [...this.ingressAnalysers, ...recorderAnalysers].map(analyser => ({
      samples: new Float32Array(analyser.fftSize),
      spectrum: new Float32Array(analyser.frequencyBinCount),
      sampleRate: context.sampleRate
    }));
  }

  unavailable(reason) {
    return Object.freeze({
      clean: false, reliable: false, isolationSecure: false,
      humDetected: false, humFrequency: null, humLevelDbfs: null,
      noiseFloorDbfs: null, ingressNoiseFloorDbfs: null, peakDbfs: null,
      auditedAt: null, reason
    });
  }

  connectSignalChain(inputNode, outputNode) {
    if (this.connected || inputNode.context !== this.context || outputNode.context !== this.context) {
      throw new Error("Invalid signal cleanup connection.");
    }
    const chain = [inputNode, this.highPass, ...this.notches, this.expander, this.peakProtector, outputNode];
    for (let index = 0; index < chain.length - 1; index += 1) this.routing.connectLive(chain[index], chain[index + 1]);
    this.routing.tap(inputNode, this.splitter);
    this.ingressAnalysers.forEach((analyser, channel) => {
      this.routing.connectUtility(analyser);
      this.splitter.connect(analyser, channel);
    });
    this.assertIsolation();
    this.routing.assertNoUtilityLeak();
    this.inputNode = inputNode;
    this.connected = true;
    this.timer = setInterval(() => this.auditSignal(), 100);
  }

  readFrames() {
    return [...this.ingressAnalysers, ...this.recorderAnalysers].map((analyser, index) => {
      const frame = this.frames[index];
      analyser.getFloatTimeDomainData(frame.samples);
      analyser.getFloatFrequencyData(frame.spectrum);
      return inspectSignalFrame(frame);
    });
  }

  /** @returns {SignalCleanupStatus} */
  auditSignal() {
    try {
      if (!this.connected || this.context.state !== "running" || this.context.currentTime <= this.lastAudioTime) {
        throw new Error("Signal audit audio clock is not running.");
      }
      this.lastAudioTime = this.context.currentTime;
      if (this.assertIsolation() !== true || !this.routing.assertNoUtilityLeak().ok) throw new Error("Signal bus isolation failed.");
      if (this.recorderAnalysers.length !== 2) throw new Error("Both recorder channels must be audited.");
      const frames = this.readFrames();
      const ingress = frames.slice(0, 2);
      const egress = frames.slice(2);
      const ingressRms = Math.max(...ingress.map(frame => frame.rmsDbfs));
      const expansion = Math.pow(10, Math.min(0, (ingressRms + 65) * 2) / 20);
      this.expander.gain.setTargetAtTime(Math.max(.001, expansion), this.context.currentTime, ingressRms > -65 ? .005 : .08);
      this.notches.forEach((notch, index) => {
        const frequency = MAINS[Math.floor(index / 4)];
        const detected = ingress.some(frame => frame.humDetected && frame.humFrequency === frequency);
        notch.Q.setTargetAtTime(detected ? 20 : 1000, this.context.currentTime, .1);
      });
      const hum = egress.filter(frame => frame.humDetected).sort((a, b) => b.humLevelDbfs - a.humLevelDbfs)[0];
      const peakDbfs = Math.max(...egress.map(frame => frame.peakDbfs));
      const idleNoise = ingressRms <= -65 && egress.some(frame => frame.rmsDbfs > -75);
      const clean = !hum && peakDbfs < -.1 && !idleNoise;
      this.status = Object.freeze({
        clean, reliable: true, isolationSecure: true,
        humDetected: Boolean(hum), humFrequency: hum?.humFrequency ?? null,
        humLevelDbfs: hum?.humLevelDbfs ?? FLOOR_DB,
        noiseFloorDbfs: Math.max(...egress.map(frame => frame.noiseFloorDbfs)),
        ingressNoiseFloorDbfs: Math.max(...ingress.map(frame => frame.noiseFloorDbfs)),
        peakDbfs, auditedAt: Date.now(),
        reason: clean ? "" : hum ? "Mains hum remains on the recorder bus." : idleNoise ? "Idle noise remains on the recorder bus." : "Recorder peaks exceed the safety limit."
      });
    } catch (error) {
      this.expander.gain.setTargetAtTime(0, this.context.currentTime, .005);
      this.status = this.unavailable(error.message);
    }
    return this.status;
  }

  /** @returns {SignalCleanupStatus} */
  getStatus() {
    if (!this.connected || this.context.state !== "running" || this.status.auditedAt === null || Date.now() - this.status.auditedAt > 500) {
      this.expander.gain.setTargetAtTime(0, this.context.currentTime, .005);
      return this.unavailable("Signal audit is unavailable or stale.");
    }
    return this.status;
  }

  destroy() {
    clearInterval(this.timer);
    if (this.inputNode) this.inputNode.disconnect(this.highPass);
    if (this.inputNode) this.inputNode.disconnect(this.splitter);
    for (const node of [this.highPass, ...this.notches, this.expander, this.peakProtector, this.splitter, ...this.ingressAnalysers]) this.routing.release(node);
    this.connected = false;
    this.status = this.unavailable("Signal cleanup was disconnected.");
  }
}

if (typeof window !== "undefined") window.HaloSignalCleanupPipeline = SignalCleanupPipeline;
