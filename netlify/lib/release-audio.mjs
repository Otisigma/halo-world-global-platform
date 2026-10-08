// Bounded PCM WAV processing only. Original bytes and catalog master are never changed.
export const MAX_PREFLIGHT_BYTES = 128 * 1024 * 1024;

export function conditionReleaseWav(input, { humHz = 0 } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length < 44 || bytes.length > MAX_PREFLIGHT_BYTES
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
  if (![0, 50, 60].includes(humHz)) throw new Error("Hum filtering must be off, 50 Hz or 60 Hz.");
  const frames = data.size / format.align;
  const samples = new Float32Array(frames * format.channels);
  const stride = format.bits / 8;
  const fadeFrames = Math.min(frames, Math.round(format.rate * 0.005));
  const angle = 2 * Math.PI * humHz / format.rate;
  const alpha = Math.sin(angle) / (2 * 30);
  const a0 = 1 + alpha;
  const b1 = -2 * Math.cos(angle) / a0;
  const a2 = (1 - alpha) / a0;
  const history = Array.from({ length: format.channels }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
  let peak = 0, sum = 0;
  for (let index = 0; index < samples.length; index++) {
    const offset = data.start + index * stride;
    let value = format.bits === 16 ? bytes.readInt16LE(offset) / 32768
      : format.bits === 24 ? bytes.readIntLE(offset, 3) / 8388608 : bytes.readInt32LE(offset) / 2147483648;
    if (humHz) {
      const h = history[index % format.channels];
      const filtered = value / a0 + b1 * h.x1 + h.x2 / a0 - b1 * h.y1 - a2 * h.y2;
      h.x2 = h.x1; h.x1 = value; h.y2 = h.y1; h.y1 = filtered;
      value = filtered;
    }
    const frame = Math.floor(index / format.channels);
    if (frame < fadeFrames) value *= frame / Math.max(1, fadeFrames - 1);
    samples[index] = value;
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms < 0.000001) throw new Error("The WAV is silent. Upload an audible master.");
  // Conservative RMS gain, capped at +3 dB and sample peak -1.5 dBFS; not a LUFS/true-peak claim.
  const gain = Math.min(10 ** (-18 / 20) / rms, 10 ** (3 / 20), 10 ** (-1.5 / 20) / peak);
  const output = Buffer.from(bytes);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.round(Math.max(-1, Math.min(1, samples[index] * gain)) * (2 ** (format.bits - 1) - 1));
    const offset = data.start + index * stride;
    if (format.bits === 16) output.writeInt16LE(value, offset);
    else if (format.bits === 24) output.writeIntLE(value, offset, 3);
    else output.writeInt32LE(value, offset);
  }
  return { bytes: output, report: { durationSeconds: frames / format.rate,
    sampleRate: format.rate, channels: format.channels, bits: format.bits,
    fadeMilliseconds: 5, humHz, gainDb: Math.round(20 * Math.log10(gain) * 100) / 100,
    samplePeakDbfs: 20 * Math.log10(peak * gain), rmsDbfs: 20 * Math.log10(rms * gain),
    loudnessMethod: "RMS estimate; integrated LUFS and true peak require mastering review.",
    originalPreserved: true } };
}
