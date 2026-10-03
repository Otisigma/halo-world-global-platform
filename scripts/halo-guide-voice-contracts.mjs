import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const [voiceSource, companion] = await Promise.all([
  readFile(resolve(root, "halo-guide-voice.js"), "utf8"),
  readFile(resolve(root, "halo-companion.js"), "utf8")
]);

class Utterance {
  constructor(text) {
    this.text = text;
  }
}

function createSynth(voices, { deferVoices = false, behaviour = "start" } = {}) {
  const listeners = new Map();
  let available = deferVoices ? [] : voices;
  return {
    spoken: [],
    cancels: 0,
    behaviour,
    getVoices: () => available,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount: type => listeners.get(type)?.size || 0,
    loadVoices() {
      available = voices;
      listeners.get("voiceschanged")?.forEach(listener => listener());
    },
    cancel() {
      this.cancels += 1;
    },
    speak(utterance) {
      this.spoken.push(utterance);
      queueMicrotask(() => {
        if (this.behaviour === "start") utterance.onstart?.();
        else if (this.behaviour !== "silent") utterance.onerror?.({ error: this.behaviour });
      });
    }
  };
}

function loadVoice({ synth, language = "en-US", withSpeech = true } = {}) {
  const context = { setTimeout, clearTimeout, queueMicrotask, navigator: { language } };
  if (withSpeech) {
    context.speechSynthesis = synth;
    context.SpeechSynthesisUtterance = Utterance;
  }
  vm.runInNewContext(voiceSource, context);
  return { api: context.HaloGuideVoice, context };
}

const voices = [
  { name: "Albert", lang: "en-US" },
  { name: "Fred", lang: "en-US" },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" },
  { name: "Daniel", lang: "en-GB" },
  { name: "Google UK English Female", lang: "en_GB" },
  { name: "Thomas", lang: "fr-FR", default: true }
];

// --- Locale resolution + voice ranking ----------------------------------------------
{
  const { api } = loadVoice({ synth: createSynth(voices) });
  assert.equal(api.resolveLocale("auto", "en-AU"), "en-GB", "Commonwealth English browsers default to a UK voice");
  assert.equal(api.resolveLocale("auto", "en-IE"), "en-GB");
  assert.equal(api.resolveLocale("auto", "fr-FR"), "en-US", "non-English browsers default to a US voice");
  assert.equal(api.resolveLocale("en-GB", "en-US"), "en-GB", "an explicit accent wins over the browser locale");
  assert.equal(api.selectVoice(voices, { locale: "en-US" }).name, voices[2].name, "US picks the highest-quality en-US voice");
  assert.equal(api.selectVoice(voices, { locale: "en-GB" }).name, "Google UK English Female", "UK picks the best en-GB voice and tolerates underscore locales");
  assert.equal(api.selectVoice(voices, { locale: "en-GB", style: "calm" }).name, "Daniel", "tone hints refine the choice within a locale");
  assert.equal(api.selectVoice([{ name: "Karen", lang: "en-AU" }], { locale: "en-GB" }).name, "Karen", "any English voice is a fallback when the locale is missing");
  assert.equal(api.selectVoice([{ name: "Albert", lang: "en-US" }, { name: "Alex", lang: "en-US" }], { locale: "en-US" }).name, "Alex", "novelty voices are avoided");
  assert.equal(api.selectVoice([voices[5]], { locale: "en-US" }), null, "non-English voices are never chosen");
  assert.equal(api.selectVoice([], { locale: "en-US" }), null);
}

// --- Waiting for voiceschanged -------------------------------------------------------
{
  const synth = createSynth(voices, { deferVoices: true });
  const { api } = loadVoice({ synth });
  const pending = api.ready(1000);
  assert.equal(synth.listenerCount("voiceschanged"), 1, "ready() subscribes to voiceschanged when voices are not loaded yet");
  setTimeout(() => synth.loadVoices(), 5);
  const loaded = await pending;
  assert.equal(loaded.length, voices.length, "ready() resolves once voices load");
  assert.equal(synth.listenerCount("voiceschanged"), 0, "voiceschanged listener is cleaned up");

  const empty = loadVoice({ synth: createSynth([], { deferVoices: true }) });
  assert.deepEqual([...await empty.api.ready(10)], [], "ready() times out gracefully when no voices ever load");
}

// --- Speaking, stale cancellation, and fallback states ------------------------------
{
  const synth = createSynth(voices, { deferVoices: true });
  const { api } = loadVoice({ synth, language: "en-GB" });
  const first = api.speak("First reply", { locale: "auto" });
  const second = api.speak("Second reply", { locale: "auto", style: "bright" });
  synth.loadVoices();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.reason, "superseded", "a stale reply never speaks after a newer reply");
  assert.equal(secondResult.ok, true);
  assert.equal(synth.spoken.length, 1, "only the latest reply is spoken");
  assert.equal(synth.spoken[0].text, "Second reply");
  assert.equal(synth.spoken[0].voice.name, "Google UK English Female", "auto accent follows the browser locale");
  assert.equal(synth.spoken[0].lang, "en_GB");
  assert.equal(synth.spoken[0].pitch, api.profiles.bright.pitch, "tone profile shapes the utterance");
  assert.ok(synth.cancels >= 2, "previous speech is cancelled before each new reply");

  const cancelsBefore = synth.cancels;
  api.cancel();
  assert.equal(synth.cancels, cancelsBefore + 1, "cancel() stops browser speech");
  assert.equal((await api.speak("   ")).reason, "empty");
}
{
  const synth = createSynth(voices, { behaviour: "not-allowed" });
  const { api } = loadVoice({ synth });
  const result = await api.speak("Blocked reply");
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "blocked" }, "autoplay-blocked speech is reported, not thrown");

  synth.behaviour = "synthesis-failed";
  assert.equal((await api.speak("Broken")).reason, "error");

  synth.speak = () => {
    throw new Error("speech crashed");
  };
  assert.equal((await api.speak("Crash")).reason, "error", "synthesis exceptions are contained");
}
{
  const { api } = loadVoice({ withSpeech: false });
  assert.equal(api.supported(), false);
  assert.equal(api.engineName(), "none");
  assert.equal((await api.speak("Hello")).reason, "unsupported", "missing speech support degrades gracefully");
  assert.deepEqual([...await api.ready()], []);
}

// --- Premium engine swap ----------------------------------------------------------
{
  const synth = createSynth(voices);
  const { api } = loadVoice({ synth });
  const calls = [];
  let cancelled = 0;
  api.registerEngine({
    name: "premium-tts",
    async speak(text, options) {
      calls.push({ text, options });
      return true;
    },
    cancel() {
      cancelled += 1;
    }
  });
  assert.equal(api.engineName(), "premium-tts");
  const result = await api.speak("Premium reply", { locale: "en-GB", style: "warm" });
  assert.equal(result.engine, "premium-tts");
  assert.equal(calls[0].options.locale, "en-GB", "engines receive the resolved accent");
  assert.equal(calls[0].options.style, "warm");
  assert.equal(synth.spoken.length, 0, "browser speech is not used when the premium engine succeeds");
  assert.ok(cancelled >= 1, "premium engines are cancelled before new speech");

  api.registerEngine({ name: "offline-tts", speak: async () => { throw new Error("offline"); } });
  const fallback = await api.speak("Fallback reply");
  assert.equal(fallback.engine, "browser", "a failing premium engine falls back to browser speech");
  assert.equal(synth.spoken.at(-1).text, "Fallback reply");

  assert.throws(() => api.registerEngine({ name: "broken" }), { name: "TypeError" });
  api.registerEngine(null);
  assert.equal(api.engineName(), "browser", "engines can be removed to restore the browser fallback");
}

// --- Guide wiring -----------------------------------------------------------------
assert.match(companion, /\/halo-guide-voice\.js/, "the guide lazy-loads the shared voice layer");
assert.match(companion, /voiceLocale: \["auto", "en-US", "en-GB"\]/, "the voice accent setting is normalized");
assert.match(companion, /<option value="en-US">US English<\/option><option value="en-GB">UK English<\/option>/, "US/UK accents are selectable");
assert.match(companion, /cancelSpeech\(\);\s*addMessage\("visitor"/, "sending a new message cancels stale speech");
assert.match(companion, /AbortController/, "requests are abortable with a timeout");
assert.match(companion, /halo-companion-unread/, "the launcher shows an unread reply badge");
assert.match(companion, /new \$\{count === 1 \? "reply" : "replies"\}/, "unread replies are announced in the launcher label");
assert.match(companion, /initial: true/, "the opening greeting does not count as unread");
assert.match(companion, /root\.contains\(document\.activeElement\)\) return;\s*toggle\(false\);/, "Escape only closes the guide when focus is inside it");
assert.match(companion, /prefers-reduced-motion: reduce/, "scrolling respects reduced motion");
assert.match(companion, /Voice blocked by the browser/, "blocked speech is surfaced to the user");
assert.match(companion, /fetch\("\/api\/halo-companion"/, "assistant policy and replies stay server-side");
assert.doesNotMatch(companion, /role: "system"/, "the client never carries the system prompt");

console.log("HALO Guide voice contracts: voiceschanged wait, US/UK voice ranking, stale speech cancellation, blocked/unsupported fallback, and premium engine swap verified.");
