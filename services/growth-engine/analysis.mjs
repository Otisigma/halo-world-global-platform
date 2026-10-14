export function energyFrames(samples, sampleRate, frameSeconds = 1) {
  if (!samples?.length || samples.length > 100_000_000 || !Number.isFinite(sampleRate) || sampleRate < 1 ||
      !Number.isFinite(frameSeconds) || frameSeconds < 0.1 || frameSeconds > 10) {
    throw new Error("Invalid decoded mono PCM");
  }
  const size = Math.max(1, Math.round(sampleRate * frameSeconds));
  const frames = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    let sum = 0;
    const end = Math.min(samples.length, offset + size);
    for (let index = offset; index < end; index++) {
      const sample = samples[index];
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error("PCM must be normalized");
      sum += sample * sample;
    }
    frames.push({ start: offset / sampleRate, end: end / sampleRate, energy: Math.sqrt(sum / (end - offset)) });
  }
  return frames;
}

export function selectHooks(frames, { durationSeconds, clipSeconds = 20, count = 3, overlap = 0.25 } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 7200 ||
      !Number.isFinite(clipSeconds) || clipSeconds < 1 || clipSeconds > 60 ||
      !Number.isInteger(count) || count < 1 || count > 10 ||
      !Number.isFinite(overlap) || overlap < 0 || overlap > 0.5 ||
      !Array.isArray(frames) || !frames.length || frames.length > 72000) throw new Error("Invalid hook analysis input");
  let previousEnd = 0;
  for (const frame of frames) {
    if (![frame.start, frame.end, frame.energy].every(Number.isFinite) ||
        Math.abs(frame.start - previousEnd) > 0.001 || frame.end <= frame.start ||
        frame.end > durationSeconds + 0.001 || frame.energy < 0 || frame.energy > 1) {
      throw new Error("Energy frames must cover contiguous, bounded audio");
    }
    previousEnd = frame.end;
  }
  if (Math.abs(previousEnd - durationSeconds) > 0.001) throw new Error("Incomplete audio analysis");
  const length = Math.min(clipSeconds, durationSeconds);
  const starts = [...new Set([...frames.map(frame => Math.min(frame.start, durationSeconds - length)), durationSeconds - length])];
  const prefix = [0];
  for (const frame of frames) prefix.push(prefix.at(-1) + frame.energy * (frame.end - frame.start));
  function integral(time) {
    let low = 0, high = frames.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].end <= time) low = middle + 1;
      else high = middle;
    }
    return prefix[low] + (low < frames.length ? frames[low].energy * Math.max(0, time - frames[low].start) : 0);
  }
  const candidates = starts.map(start => {
    const end = start + length;
    const energy = integral(end) - integral(start);
    return { start, end, score: energy / length, features: { meanRms: energy / length }, model: "rms-window-v1" };
  }).sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(other => Math.max(0, Math.min(candidate.end, other.end) - Math.max(candidate.start, other.start)) <= length * overlap)) {
      selected.push({ ...candidate, rank: selected.length + 1 });
      if (selected.length === count) break;
    }
  }
  return selected;
}
