export const SIGNAL_KEY = "halo_local_signal_v1";
export const SIGNAL_SKINS = { original: "Original", neon: "Neon Synth", amber: "Deep House Amber", midnight: "Obsidian Dark" };
const empty = () => ({ version: 1, enabled: false, seconds: 0, day: "", daySeconds: 0, lastDay: "", streak: 0, best: 0, ids: [], skin: "original" });
const dayNumber = day => Date.parse(`${day}T00:00:00Z`) / 86400000;
const validDay = day => day === "" || (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(dayNumber(day))
  && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day);

export function readSignal(storage) {
  const raw = storage.getItem(SIGNAL_KEY);
  if (raw === null) return empty();
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || typeof data.enabled !== "boolean"
    || !["seconds", "daySeconds", "streak", "best"].every(key => Number.isFinite(data[key]) && data[key] >= 0 && data[key] <= Number.MAX_SAFE_INTEGER)
    || !["day", "lastDay"].every(key => typeof data[key] === "string" && validDay(data[key]))
    || !Array.isArray(data.ids) || data.ids.length > 1000 || data.ids.some(id => typeof id !== "string" || id.length > 120)
    || new Set(data.ids).size !== data.ids.length || !Object.hasOwn(SIGNAL_SKINS, data.skin)) {
    throw new Error("Local Signal data is invalid. Reset it explicitly to start again.");
  }
  return data;
}

export function unlockedSignalSkins(state) {
  return ["original", ...(state.best >= 3 ? ["neon"] : []), ...(state.best >= 7 ? ["amber"] : []),
    ...(state.seconds >= 3600 ? ["midnight"] : [])];
}

export function signalStreak(state, today) {
  return dayNumber(today) - dayNumber(state.lastDay) > 1 || !state.lastDay ? 0 : state.streak;
}

export function creditSignal(state, { seconds, date, releaseId, discovered = false }) {
  if (!state.enabled || !Number.isFinite(seconds) || seconds <= 0 || seconds > 5) return state;
  const day = date.toISOString().slice(0, 10);
  // A backwards device clock must not create another qualifying day.
  if (state.day && day < state.day) return state;
  const next = { ...state, ids: [...state.ids], seconds: state.seconds + seconds, day,
    daySeconds: (state.day === day ? state.daySeconds : 0) + seconds };
  if (next.daySeconds >= 30 && next.lastDay !== day) {
    next.streak = next.lastDay && dayNumber(day) - dayNumber(next.lastDay) === 1 ? next.streak + 1 : 1;
    next.lastDay = day; next.best = Math.max(next.best, next.streak);
  }
  if (discovered && typeof releaseId === "string" && releaseId.length <= 120 && !next.ids.includes(releaseId) && next.ids.length < 1000) next.ids.push(releaseId);
  return next;
}

export function createLocalSignal({ storage, document, now = () => performance.now(), date = () => new Date(), changed = () => {} }) {
  const samples = new WeakMap(), trackSeconds = new Map();
  let lastCredit = -Infinity, epoch = 0;
  document.addEventListener("visibilitychange", () => { epoch++; });
  const save = state => { storage.setItem(SIGNAL_KEY, JSON.stringify(state)); changed(state); return state; };
  return {
    read: () => readSignal(storage),
    refresh() { epoch++; trackSeconds.clear(); return readSignal(storage); },
    enable(value) { const state = readSignal(storage); epoch++; return save({ ...state, enabled: value }); },
    reset() { storage.removeItem(SIGNAL_KEY); trackSeconds.clear(); epoch++; lastCredit = -Infinity; changed(empty()); },
    skin(value) {
      const state = readSignal(storage);
      if (!unlockedSignalSkins(state).includes(value)) throw new Error("This cosmetic skin has not been unlocked.");
      return save({ ...state, skin: value });
    },
    bindAudio(audio, getReleaseId, isAudible = () => true) {
      const reset = () => samples.delete(audio);
      for (const event of ["seeking", "seeked", "pause", "ended", "emptied", "playing", "ratechange"]) audio.addEventListener(event, reset);
      audio.addEventListener("timeupdate", () => {
        try {
          const current = { at: now(), media: audio.currentTime, id: getReleaseId(), epoch,
            active: !document.hidden && !audio.paused && !audio.ended && !audio.seeking && !audio.muted
              && audio.volume > 0 && audio.readyState >= 2 && isAudible() };
          const previous = samples.get(audio);
          if (previous && previous.active && current.active && previous.id === current.id
            && previous.epoch === epoch && current.at - previous.at < 1000) return;
          samples.set(audio, current);
          if (!previous || previous.id !== current.id || previous.epoch !== epoch || !current.id
            || !current.active || !previous.active) return;
          const elapsed = (current.at - previous.at) / 1000, media = (current.media - previous.media) / audio.playbackRate;
          if (elapsed <= 0 || elapsed > 5 || media <= 0 || media > elapsed + .75) return;
          const seconds = Math.min(elapsed, media, Math.max(0, (current.at - lastCredit) / 1000));
          if (seconds <= 0) return;
          const state = readSignal(storage);
          if (!state.enabled) return;
          const heard = (trackSeconds.get(current.id) || 0) + seconds;
          const next = creditSignal(state, { seconds, date: date(), releaseId: current.id, discovered: heard >= 30 });
          save(next); trackSeconds.set(current.id, heard); lastCredit = current.at;
        } catch (error) {
          epoch++;
          changed(null, error);
        }
      });
    }
  };
}
