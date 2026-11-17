import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalSignal, creditSignal, readSignal, SIGNAL_KEY, signalStreak, unlockedSignalSkins } from "../lib/local-signal.js";

const storageFixture = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};
const creditDay = (state, day) => {
  for (let tick = 0; tick < 6; tick++) state = creditSignal(state, { seconds: 5, date: new Date(`${day}T12:00:00Z`) });
  return state;
};

test("UTC streaks qualify at 30 seconds, reset across gaps, resist backwards dates and unlock only cosmetics", () => {
  let state = { ...readSignal(storageFixture()), enabled: true };
  state = creditSignal(state, { seconds: 5, date: new Date("2026-11-01T23:59:59Z") });
  assert.equal(state.streak, 0);
  state = creditDay(state, "2026-11-01");
  state = creditDay(state, "2026-11-02");
  state = creditDay(state, "2026-11-03");
  assert.equal(state.streak, 3);
  assert.deepEqual(unlockedSignalSkins(state), ["original", "neon"]);
  const repeated = creditDay(state, "2026-11-03");
  assert.equal(repeated.streak, 3);
  assert.deepEqual(creditDay(state, "2026-11-02"), state);
  assert.equal(signalStreak(state, "2026-11-05"), 0);
  state = creditDay(state, "2026-11-05");
  assert.equal(state.streak, 1);
  assert.equal(state.best, 3);
  assert.deepEqual(unlockedSignalSkins({ ...state, best: 7, seconds: 3600 }), ["original", "neon", "amber", "midnight"]);
});

test("seven/thirty-day badges and the 60-minute vault require their full playback thresholds", () => {
  let state = { ...readSignal(storageFixture()), enabled: true };
  for (let day = 1; day <= 30; day++) {
    state = creditDay(state, `2026-11-${String(day).padStart(2, "0")}`);
    if (day === 6) assert.ok(!unlockedSignalSkins(state).includes("amber"));
    if (day === 7) assert.ok(unlockedSignalSkins(state).includes("amber"));
  }
  assert.equal(state.best, 30);
  assert.equal(state.seconds, 900);
  for (let i = 0; i < 539; i++) state = creditSignal(state, { seconds: 5, date: new Date("2026-11-30T12:00:00Z") });
  assert.equal(state.seconds, 3595);
  assert.ok(!unlockedSignalSkins(state).includes("midnight"));
  state = creditSignal(state, { seconds: 5, date: new Date("2026-11-30T12:00:00Z") });
  assert.ok(unlockedSignalSkins(state).includes("midnight"));
});

function fixture() {
  const storage = storageFixture(), events = {}, errors = [];
  const document = { hidden: false, addEventListener(name, callback) { events[name] = callback; } };
  let milliseconds = 0;
  const signal = createLocalSignal({ storage, document, now: () => milliseconds, date: () => new Date("2026-11-12T12:00:00Z"),
    changed: (_state, error) => { if (error) errors.push(error); } });
  const audio = () => {
    const handlers = {};
    const element = { currentTime: 0, playbackRate: 1, readyState: 4, paused: false, muted: false, volume: 1,
      addEventListener(name, callback) { handlers[name] = callback; }, emit: name => handlers[name]?.() };
    return element;
  };
  const deck = audio(); signal.bindAudio(deck, () => "one");
  const tick = (seconds = 1) => { milliseconds += seconds * 1000; deck.currentTime += seconds; deck.emit("timeupdate"); };
  return { storage, signal, deck, document, events, errors, tick, audio };
}

test("foreground playback is opt-in; seeks, pauses, muted audio, hidden tabs and overlapping decks do not farm time", () => {
  const f = fixture();
  f.tick(); f.tick();
  assert.equal(f.storage.getItem(SIGNAL_KEY), null);
  f.signal.enable(true);
  f.tick();
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.signal.read().seconds, 30);
  assert.deepEqual(f.signal.read().ids, ["one"]);
  const second = f.audio(); f.signal.bindAudio(second, () => "two");
  second.emit("timeupdate"); f.tick(); second.currentTime += 1; second.emit("timeupdate");
  assert.equal(f.signal.read().seconds, 31, "two decks never double-credit elapsed wall time");
  f.deck.currentTime += 200; f.tick();
  assert.equal(f.signal.read().seconds, 31, "seeking forward is not listening");
  f.document.hidden = true; f.events.visibilitychange(); f.tick();
  f.document.hidden = false; f.events.visibilitychange(); f.tick();
  assert.equal(f.signal.read().seconds, 31);
  f.deck.muted = true; f.tick();
  f.deck.muted = false; f.tick();
  assert.equal(f.signal.read().seconds, 31, "unmuting does not retroactively count a muted interval");
  f.deck.paused = true; f.tick();
  assert.equal(f.signal.read().seconds, 31);
  f.signal.enable(false); f.deck.paused = false; f.tick(); f.tick();
  assert.equal(f.signal.read().seconds, 31);
  assert.throws(() => f.signal.skin("amber"), /not been unlocked/);
  f.signal.reset();
  assert.equal(f.storage.getItem(SIGNAL_KEY), null);
  assert.equal(f.signal.read().enabled, false);
});

test("master-muted mixer routing and external resets invalidate sampled progress", () => {
  const f = fixture();
  let audible = false;
  const deck = f.audio();
  f.signal.bindAudio(deck, () => "mixed", () => audible);
  f.signal.enable(true);
  deck.emit("timeupdate");
  f.tick(); deck.currentTime++; deck.emit("timeupdate");
  assert.equal(f.signal.read().seconds, 0, "Web Audio master mute suppresses credit even when the element is unmuted");
  audible = true;
  f.tick(); deck.currentTime++; deck.emit("timeupdate");
  assert.equal(f.signal.read().seconds, 1, "only the original deck counted during the unmute interval");
  f.signal.refresh();
  f.tick(); deck.currentTime++; deck.emit("timeupdate");
  assert.equal(f.signal.read().seconds, 1, "external storage changes invalidate every deck baseline");
});

test("frequent media events accumulate correctly without writing storage on every frame", () => {
  const f = fixture();
  f.signal.enable(true);
  f.deck.emit("timeupdate");
  let writes = 0;
  const save = f.storage.setItem;
  f.storage.setItem = (...args) => { writes++; save(...args); };
  for (let i = 0; i < 8; i++) f.tick(.25);
  assert.equal(f.signal.read().seconds, 2);
  assert.equal(writes, 2);
});

test("corrupt and blocked storage never becomes a success-shaped reward or silent replacement", () => {
  const f = fixture();
  f.storage.setItem(SIGNAL_KEY, "{bad");
  assert.throws(() => f.signal.enable(true));
  assert.equal(f.storage.getItem(SIGNAL_KEY), "{bad");
  f.signal.reset(); f.signal.enable(true); f.tick();
  f.storage.setItem = () => { throw new Error("Quota exceeded"); };
  f.tick();
  assert.equal(f.errors.at(-1).message, "Quota exceeded");
  assert.equal(f.signal.read().seconds, 0);
});
