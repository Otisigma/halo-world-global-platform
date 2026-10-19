import { googleDriveFileId } from "./dreamweaver-playback.js";

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const TRACK_ID = /^[A-Za-z0-9_-]{1,96}$/;
const ENERGY = new Map([
  ["warm-up groove", 1], ["fresh drop", 2], ["build-up", 2],
  ["crowd-lifter", 3], ["peak anthemic", 4]
]);
const ENERGY_LABELS = ["Warm-up Groove", "Fresh Drop", "Build-up", "Crowd-Lifter", "Peak Anthemic"];
const ROTATIONS = ["Fresh", "Active", "Used-Recently"];
const AUDIO_PATH = /\.(?:mp3|wav|m4a|m4b|aac|ogg|oga|flac|webm)$/i;
const AUDIO_API = /^\/api\/(?:drive-catalog\/audio|song-catalog\/audio|mixes\/audio|radio\/audio|stem-vault\/audio)$/;

export function catalogAudioUrl(value) {
  if (typeof value !== "string" || !value || value.length > 1200 || /[\s\\\u0000-\u001f]/.test(value)) return "";
  try {
    const local = value.startsWith("/") && !value.startsWith("//");
    if (!local && !value.startsWith("https://")) return "";
    const url = new URL(value, "https://catalog.invalid");
    if (!local && url.protocol !== "https:") return "";
    if (url.username || url.password || url.hash) return "";
    if (/%(?:2f|5c|00)/i.test(url.pathname) || (!AUDIO_PATH.test(url.pathname) && !AUDIO_API.test(url.pathname))) return "";
    return local ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return "";
  }
}

function text(value, name, required = true, max = 200) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid ${name}`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new Error(`Invalid ${name}`);
  return result;
}

function date(value, name) {
  if (value == null || value === "") return "";
  const input = text(value, name, true, 40);
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error(`Invalid ${name}`);
  return new Date(input).toISOString();
}

/** A Drive index is an explicit publishing manifest, not a listing of every private master. */
export function normalizeCatalog(index) {
  if (!index || index.version !== 1 || !Array.isArray(index.tracks) || index.tracks.length > 1000) throw new Error("Invalid catalog version or tracks");
  const seen = new Set();
  const tracks = index.tracks.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid track");
    const id = text(entry.id, "track id", true, 96);
    if (!TRACK_ID.test(id) || seen.has(id)) throw new Error("Invalid or duplicate track id");
    seen.add(id);
    const driveFileId = entry.driveFileId || googleDriveFileId(entry.googleDriveFallbackUrl);
    if (typeof driveFileId !== "string" || !DRIVE_ID.test(driveFileId)) throw new Error("Invalid Drive file id");
    const bpm = typeof entry.bpm === "number" || typeof entry.bpm === "string" ? Number(entry.bpm) : NaN;
    const durationSeconds = typeof entry.durationSeconds === "number" || typeof entry.durationSeconds === "string" ? Number(entry.durationSeconds) : NaN;
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error("Invalid BPM");
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 7200) throw new Error("Invalid track duration");
    const energyInput = text(entry.energyLevel, "energy level");
    const energyLevel = ENERGY_LABELS.find(label => label.toLowerCase() === energyInput.toLowerCase());
    const rotationInput = text(entry.rotationStatus, "rotation status");
    const rotationStatus = ROTATIONS.find(label => label.toLowerCase() === rotationInput.toLowerCase());
    if (!energyLevel || !rotationStatus) throw new Error("Invalid energy or rotation");
    const primaryAudioPath = entry.primaryAudioPath ? catalogAudioUrl(entry.primaryAudioPath) : "";
    if (entry.primaryAudioPath && !primaryAudioPath) throw new Error("Invalid primary audio path");
    const driveStream = `/api/drive-catalog/audio?track=${encodeURIComponent(id)}`;
    return {
      id, title: text(entry.title, "title"), artist: text(entry.artist, "artist"),
      genre: text(entry.genre, "genre", false), bpm, durationSeconds, energyLevel, rotationStatus,
      releasedAt: date(entry.releasedAt, "release date"), lastPlayedAt: date(entry.lastPlayedAt, "last played date"),
      driveFileId, primaryAudioPath, public: entry.public === true,
      streamUrl: primaryAudioPath || driveStream, fallbackUrl: primaryAudioPath ? driveStream : ""
    };
  });
  return { version: 1, tracks };
}

/** Deterministic sequencing only: no time stretching, crossfading, or duplicated filler tracks. */
export function generateAutomatedSet(catalog, durationMinutes = 60, options = {}) {
  if (![20, 60].includes(durationMinutes)) throw new Error("Choose a 20- or 60-minute set");
  const tracks = normalizeCatalog(Array.isArray(catalog) ? { version: 1, tracks: catalog } : catalog).tracks;
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("Invalid curation time");
  const recent = new Set(Array.isArray(options.recentTrackIds) ? options.recentTrackIds : []);
  const wasRecent = track => recent.has(track.id) || track.rotationStatus === "Used-Recently" ||
    Boolean(track.lastPlayedAt && now - Date.parse(track.lastPlayedAt) < 7 * 86400000);
  let pool = tracks.filter(track => track.public && (options.allowRecent === true || !wasRecent(track)));
  const targetDurationSeconds = durationMinutes * 60;
  const result = [];
  let elapsed = 0;
  let previous = null;
  const energy = track => ENERGY.get(track.energyLevel.toLowerCase());
  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const freshOrder = (a, b) => Number(wasRecent(a)) - Number(wasRecent(b)) ||
    Number(b.rotationStatus === "Fresh") - Number(a.rotationStatus === "Fresh") ||
    (Date.parse(b.releasedAt || "1970-01-01") - Date.parse(a.releasedAt || "1970-01-01")) ||
    compareText(a.id, b.id);
  const compatible = track => !previous || (Math.abs(track.bpm - previous.bpm) <= 8 && energy(track) >= energy(previous));
  const append = (track, role, limit = Infinity) => {
    const playDurationSeconds = Math.min(track.durationSeconds, targetDurationSeconds - elapsed, limit);
    result.push({ ...track, slot: result.length + 1, role, startSeconds: elapsed, playDurationSeconds });
    elapsed += playDurationSeconds;
    previous = track;
    pool = pool.filter(item => item.id !== track.id);
  };

  while (pool.length && elapsed < targetDurationSeconds) {
    const available = pool.filter(compatible);
    if (!available.length) break;
    const remaining = targetDurationSeconds - elapsed;
    const peak = available.filter(track => energy(track) >= 3).sort((a, b) => energy(b) - energy(a) || freshOrder(a, b));
    const closer = peak[0];
    if (result.length && closer && remaining <= closer.durationSeconds) {
      append(closer, "peak");
      break;
    }
    const desired = !result.length ? 1 : elapsed >= targetDurationSeconds * 0.7 ? 3 : 2;
    // Reserve a lifter for the closing slot whenever another compatible track is available.
    const candidates = available.filter(track => track !== closer || available.length === 1);
    const durationByEnergy = [1, 2, 3, 4].map(level => {
      const ordered = pool.filter(track => energy(track) >= level).sort((a, b) => a.bpm - b.bpm);
      const sums = [0];
      for (const track of ordered) sums.push(sums.at(-1) + track.durationSeconds);
      const bound = (bpm, inclusive) => {
        let low = 0, high = ordered.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (ordered[middle].bpm < bpm || (inclusive && ordered[middle].bpm === bpm)) low = middle + 1;
          else high = middle;
        }
        return low;
      };
      return bpm => sums[bound(bpm + 8, true)] - sums[bound(bpm - 8, false)];
    });
    const canFinish = candidate => durationByEnergy[energy(candidate) - 1](candidate.bpm) >= remaining;
    candidates.sort((a, b) => Number(canFinish(b)) - Number(canFinish(a)) ||
      Math.abs(energy(a) - desired) - Math.abs(energy(b) - desired) ||
      freshOrder(a, b) || (previous ? Math.abs(a.bpm - previous.bpm) - Math.abs(b.bpm - previous.bpm) : a.bpm - b.bpm));
    const next = candidates[0];
    const reserveClosingTime = closer && next !== closer && remaining > closer.durationSeconds &&
      Math.abs(next.bpm - closer.bpm) <= 8 && energy(next) <= energy(closer);
    append(next, !result.length ? "opening" : energy(next) >= 3 ? "peak" : "build-up",
      reserveClosingTime ? remaining - closer.durationSeconds : Infinity);
  }
  return {
    tracks: result, targetDurationSeconds, durationSeconds: elapsed,
    complete: elapsed === targetDurationSeconds, shortfallSeconds: targetDurationSeconds - elapsed
  };
}
