// Bounded PCM WAV processing only. Original bytes and catalog master are never changed.
export const MAX_PREFLIGHT_BYTES = 128 * 1024 * 1024;
const TARGET_LUFS = -14;
const MAX_GAIN_DB = 3;
const PEAK_DBFS = -1.5;

function biquad(coefficients, channels) {
  const [b0, b1, b2, a1, a2] = coefficients;
  const history = Array.from({ length: channels }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
  return (value, channel) => {
    const h = history[channel];
    const result = b0 * value + b1 * h.x1 + b2 * h.x2 - a1 * h.y1 - a2 * h.y2;
    h.x2 = h.x1; h.x1 = value; h.y2 = h.y1; h.y1 = result;
    return result;
  };
}

function loudnessMeter(rate, channels) {
  // BS.1770 K weighting, with the De Man coefficients recalculated for the sample rate.
  const shelfK = Math.tan(Math.PI * 1681.974450955533 / rate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = biquad([
    (vh + vb * shelfK / shelfQ + shelfK * shelfK) / shelfA,
    2 * (shelfK * shelfK - vh) / shelfA,
    (vh - vb * shelfK / shelfQ + shelfK * shelfK) / shelfA,
    2 * (shelfK * shelfK - 1) / shelfA,
    (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA,
  ], channels);
  const highK = Math.tan(Math.PI * 38.13547087602444 / rate);
  const highQ = 0.5003270373238773;
  const highA = 1 + highK / highQ + highK * highK;
  const highPass = biquad([1, -2, 1, 2 * (highK * highK - 1) / highA,
    (1 - highK / highQ + highK * highK) / highA], channels);
  const window = Math.round(rate * 0.4);
  const hop = Math.round(rate * 0.1);
  const ring = new Float64Array(window);
  const blocks = [];
  let frames = 0, sum = 0, energy = 0;
  return {
    push(value, channel) {
      const weighted = highPass(shelf(value, channel), channel);
      energy += weighted * weighted; // Mono/stereo channel weights are both 1, not averaged.
      if (channel !== channels - 1) return;
      const position = frames % window;
      sum += energy - ring[position];
      ring[position] = energy;
      energy = 0;
      frames++;
      if (frames >= window && (frames - window) % hop === 0) blocks.push(Math.max(0, sum / window));
    },
    integrated() {
      if (!blocks.length) return null;
      const toLufs = power => -0.691 + 10 * Math.log10(power);
      const absolute = blocks.filter(power => toLufs(power) >= -70);
      if (!absolute.length) return null;
      const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
      const relativeGate = toLufs(mean(absolute)) - 10;
      const gated = absolute.filter(power => toLufs(power) >= relativeGate);
      return toLufs(mean(gated));
    },
  };
}

function conditioner(format, humHz) {
  const frequencies = humHz === "both" ? [50, 60] : humHz ? [humHz] : [];
  const filters = frequencies.map(hz => {
    const angle = 2 * Math.PI * hz / format.rate;
    const alpha = Math.sin(angle) / (2 * 30);
    const a0 = 1 + alpha;
    return biquad([1 / a0, -2 * Math.cos(angle) / a0, 1 / a0,
      -2 * Math.cos(angle) / a0, (1 - alpha) / a0], format.channels);
  });
  const fadeFrames = Math.round(format.rate * 0.35);
  return (value, channel, frame) => {
    for (const filter of filters) value = filter(value, channel);
    if (frame < fadeFrames) value *= Math.log1p(9 * frame / Math.max(1, fadeFrames - 1)) / Math.log(10);
    return value;
  };
}

export function conditionReleaseWav(input, { humHz = 0 } = {}) {
  // View the input without duplicating it; only the separate output buffer is allocated.
  const bytes = Buffer.isBuffer(input) ? input
    : input instanceof ArrayBuffer ? Buffer.from(input)
      : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes || bytes.length < 44 || bytes.length > MAX_PREFLIGHT_BYTES
    || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Upload a PCM WAV within 128 MB for automatic conditioning.");
  }
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error("The WAV contains an incomplete chunk.");
    const tag = bytes.toString("ascii", offset, offset + 4);
    if (tag === "fmt " && size >= 16) format = { code: bytes.readUInt16LE(start),
      channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4),
      align: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    if (tag === "data") data = { start, size };
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.code !== 1 || ![16, 24, 32].includes(format.bits)
    || ![1, 2].includes(format.channels) || format.rate < 8000 || format.rate > 192000
    || format.align !== format.channels * format.bits / 8 || !data.size || data.size % format.align) {
    throw new Error("Automatic conditioning supports mono/stereo 16, 24 or 32-bit PCM WAV. Export a compatible WAV or approve an externally mastered source.");
  }
  if (![0, 50, 60, "both"].includes(humHz)) throw new Error("Hum filtering must be off, 50 Hz, 60 Hz or both.");
  const frames = data.size / format.align;
  const sampleCount = frames * format.channels;
  const stride = format.bits / 8;
  const scale = 2 ** (format.bits - 1);
  const read = (buffer, index) => buffer.readIntLE(data.start + index * stride, stride) / scale;
  const originalMeter = loudnessMeter(format.rate, format.channels);
  const conditionedMeter = loudnessMeter(format.rate, format.channels);
  let process = conditioner(format, humHz);
  let peak = 0, sum = 0, originalSum = 0;
  for (let index = 0; index < sampleCount; index++) {
    const channel = index % format.channels;
    const original = read(bytes, index);
    originalSum += original * original;
    originalMeter.push(original, channel);
    const value = process(original, channel, Math.floor(index / format.channels));
    conditionedMeter.push(value, channel);
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  const rms = Math.sqrt(sum / sampleCount);
  if (rms < 0.000001) throw new Error("The WAV is silent. Upload an audible master.");
  const inputIntegratedLufs = originalMeter.integrated();
  const conditionedIntegratedLufs = conditionedMeter.integrated();
  const requestedGain = conditionedIntegratedLufs === null
    ? 10 ** (-18 / 20) / rms : 10 ** ((TARGET_LUFS - conditionedIntegratedLufs) / 20);
  const cappedGain = Math.min(requestedGain, 10 ** (MAX_GAIN_DB / 20));
  const peakGain = 10 ** (PEAK_DBFS / 20) / peak;
  const gain = Math.min(cappedGain, peakGain);
  const output = Buffer.from(bytes);
  const outputMeter = loudnessMeter(format.rate, format.channels);
  process = conditioner(format, humHz);
  let outputPeak = 0, outputSum = 0;
  for (let index = 0; index < sampleCount; index++) {
    const channel = index % format.channels;
    const value = process(read(bytes, index), channel, Math.floor(index / format.channels)) * gain;
    const integer = Math.round(Math.max(-1, Math.min(1, value)) * (scale - 1));
    output.writeIntLE(integer, data.start + index * stride, stride);
    const quantized = integer / scale;
    outputMeter.push(quantized, channel);
    outputPeak = Math.max(outputPeak, Math.abs(quantized));
    outputSum += quantized * quantized;
  }
  return { bytes: output, report: { durationSeconds: frames / format.rate,
    sampleRate: format.rate, channels: format.channels, bits: format.bits,
    fadeMilliseconds: 350, fadeCurve: "logarithmic", humHz,
    gainDb: Math.round(20 * Math.log10(gain) * 100) / 100,
    samplePeakDbfs: 20 * Math.log10(outputPeak),
    rmsDbfs: 10 * Math.log10(outputSum / sampleCount),
    inputRmsDbfs: 10 * Math.log10(originalSum / sampleCount),
    conditionedRmsDbfs: 20 * Math.log10(rms),
    targetIntegratedLufs: TARGET_LUFS, inputIntegratedLufs, conditionedIntegratedLufs,
    achievedIntegratedLufs: outputMeter.integrated(),
    loudnessMethod: conditionedIntegratedLufs === null ? "RMS fallback (-18 dBFS); integrated LUFS unavailable."
      : "BS.1770 K-weighted integrated LUFS; 400 ms blocks, 75% overlap, -70 LUFS absolute and -10 LU relative gates.",
    loudnessFallbackReason: conditionedIntegratedLufs === null
      ? frames < Math.round(format.rate * 0.4) ? "Clip shorter than the 400 ms measurement window."
        : "No measurement blocks above the -70 LUFS absolute gate." : null,
    fallbackRmsTargetDbfs: conditionedIntegratedLufs === null ? -18 : null,
    maxGainDb: MAX_GAIN_DB, gainCapLimited: requestedGain > 10 ** (MAX_GAIN_DB / 20),
    samplePeakCeilingDbfs: PEAK_DBFS, peakLimited: peakGain < cappedGain,
    truePeakCertified: false, truePeakNote: "Sample-peak ceiling only; no true-peak measurement or certification.",
    masteringApproved: false, rightsApproved: false, originalPreserved: true } };
}
