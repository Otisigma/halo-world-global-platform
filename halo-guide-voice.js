/**
 * HALO Guide voice — swappable speech layer for the HALO Guide (halo-companion.js).
 *
 * - Default engine: browser speech synthesis, used as a graceful fallback.
 *   It waits for `voiceschanged`, picks the best US/UK English voice for the
 *   requested locale, cancels stale speech, and reports blocked/unsupported states.
 * - Premium engines (server-side TTS) can be plugged in later with
 *   `window.HaloGuideVoice.registerEngine({ name, speak(text, options), cancel() })`
 *   without touching the guide UI. If a registered engine fails, the browser
 *   engine takes over automatically.
 */
(function (global) {
  if (global.HaloGuideVoice) return;

  const VOICES_TIMEOUT_MS = 1500;
  const START_TIMEOUT_MS = 4000;
  const UK_REGIONS = ["gb", "uk", "ie", "au", "nz", "za"];
  const LOW_QUALITY = /compact|eloquence|novelty|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox/i;
  const HIGH_QUALITY = /natural|neural|premium|enhanced|siri/i;
  const PROFILES = {
    steady: { rate: 1, pitch: 1, tokens: [] },
    warm: { rate: 0.96, pitch: 0.95, tokens: ["warm", "samantha", "victoria", "serena", "libby", "sonia"] },
    calm: { rate: 0.92, pitch: 0.9, tokens: ["calm", "daniel", "serena", "zira", "ryan", "guy"] },
    bright: { rate: 1.02, pitch: 1.08, tokens: ["bright", "ava", "aria", "luna", "nova", "jenny"] }
  };

  const state = { generation: 0, engine: null, voices: [], voicesPromise: null };

  function synth() {
    return global.speechSynthesis;
  }

  function browserSupported() {
    return typeof global.speechSynthesis !== "undefined" && typeof global.SpeechSynthesisUtterance !== "undefined";
  }

  function supported() {
    return Boolean(state.engine) || browserSupported();
  }

  function normalizeLang(value) {
    return String(value || "").trim().replace(/_/g, "-").toLowerCase();
  }

  function resolveLocale(value, navigatorLanguage = global.navigator?.language) {
    if (value === "en-US" || value === "en-GB") return value;
    const [language, region] = normalizeLang(navigatorLanguage).split("-");
    return language === "en" && UK_REGIONS.includes(region) ? "en-GB" : "en-US";
  }

  function profileFor(style) {
    return PROFILES[style] || PROFILES.steady;
  }

  function scoreVoice(voice, locale, style) {
    const lang = normalizeLang(voice?.lang);
    const name = String(voice?.name || "").toLowerCase();
    const target = normalizeLang(locale);
    let score = 0;
    if (lang === target) score += 100;
    else if (lang.split("-")[0] === "en") score += 20;
    else return -1;
    if (HIGH_QUALITY.test(name)) score += 15;
    if (/google/.test(name)) score += 8;
    if (profileFor(style).tokens.some(token => name.includes(token))) score += 10;
    if (voice.default) score += 1;
    if (LOW_QUALITY.test(name)) score -= 60;
    return score;
  }

  function selectVoice(voices, { locale = "en-US", style = "steady" } = {}) {
    const target = resolveLocale(locale);
    let best = null;
    let bestScore = -1;
    for (const voice of Array.isArray(voices) ? voices : []) {
      const score = scoreVoice(voice, target, style);
      if (score > bestScore) {
        best = voice;
        bestScore = score;
      }
    }
    return best;
  }

  function readVoices() {
    try {
      const voices = synth()?.getVoices?.() || [];
      if (voices.length) state.voices = voices;
    } catch {}
    return state.voices;
  }

  function ready(timeoutMs = VOICES_TIMEOUT_MS) {
    if (!browserSupported()) return Promise.resolve([]);
    if (readVoices().length) return Promise.resolve(state.voices);
    if (state.voicesPromise) return state.voicesPromise;
    state.voicesPromise = new Promise(resolve => {
      const speech = synth();
      let timer = null;
      let usedProperty = false;
      const finish = () => {
        clearTimeout(timer);
        speech.removeEventListener?.("voiceschanged", onChange);
        if (usedProperty && speech.onvoiceschanged === onChange) speech.onvoiceschanged = null;
        state.voicesPromise = null;
        resolve(readVoices());
      };
      const onChange = () => {
        if (readVoices().length) finish();
      };
      if (typeof speech.addEventListener === "function") speech.addEventListener("voiceschanged", onChange);
      else if (!speech.onvoiceschanged) {
        usedProperty = true;
        speech.onvoiceschanged = onChange;
      }
      timer = setTimeout(finish, timeoutMs);
    });
    return state.voicesPromise;
  }

  function cancelBrowser() {
    if (!browserSupported()) return;
    try {
      synth().cancel();
    } catch {}
  }

  async function speakWithBrowser(text, options, generation) {
    if (!browserSupported()) return { ok: false, reason: "unsupported", engine: "browser" };
    const voices = await ready();
    if (generation !== state.generation) return { ok: false, reason: "superseded", engine: "browser" };
    const locale = resolveLocale(options.locale);
    const profile = profileFor(options.style);
    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      const settle = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ engine: "browser", ...result });
      };
      try {
        cancelBrowser();
        const utterance = new global.SpeechSynthesisUtterance(text);
        const voice = selectVoice(voices, { locale, style: options.style });
        utterance.lang = voice?.lang || locale;
        if (voice) utterance.voice = voice;
        utterance.rate = profile.rate;
        utterance.pitch = profile.pitch;
        utterance.onstart = () => settle({ ok: true, voice: voice?.name || null });
        utterance.onerror = event => {
          const error = String(event?.error || "");
          if (error === "canceled" || error === "interrupted") settle({ ok: false, reason: "superseded" });
          else settle({ ok: false, reason: error === "not-allowed" ? "blocked" : "error" });
        };
        timer = setTimeout(() => {
          const speech = synth();
          if (speech.speaking || speech.pending) settle({ ok: true, pending: true, voice: voice?.name || null });
          else {
            cancelBrowser();
            settle({ ok: false, reason: "timeout" });
          }
        }, options.startTimeoutMs || START_TIMEOUT_MS);
        synth().speak(utterance);
      } catch {
        settle({ ok: false, reason: "error" });
      }
    });
  }

  async function speak(text, options = {}) {
    const message = String(text || "").trim();
    cancel();
    const generation = state.generation;
    if (!message) return { ok: false, reason: "empty" };
    const engine = state.engine;
    if (engine) {
      try {
        const result = await engine.speak(message, { locale: resolveLocale(options.locale), style: options.style || "steady" });
        if (generation !== state.generation) return { ok: false, reason: "superseded", engine: engine.name };
        if (result !== false) return { ok: true, engine: engine.name };
      } catch {
        if (generation !== state.generation) return { ok: false, reason: "superseded", engine: engine.name };
      }
    }
    return speakWithBrowser(message, options, generation);
  }

  function cancel() {
    state.generation += 1;
    try {
      state.engine?.cancel?.();
    } catch {}
    cancelBrowser();
  }

  function registerEngine(engine) {
    if (engine != null && typeof engine.speak !== "function") {
      throw new TypeError("A HALO Guide voice engine must provide speak(text, options).");
    }
    cancel();
    state.engine = engine != null ? { name: String(engine.name || "custom"), speak: engine.speak.bind(engine), cancel: typeof engine.cancel === "function" ? engine.cancel.bind(engine) : null } : null;
  }

  function engineName() {
    return state.engine?.name || (browserSupported() ? "browser" : "none");
  }

  global.HaloGuideVoice = Object.freeze({
    supported,
    browserSupported,
    ready,
    speak,
    cancel,
    registerEngine,
    engineName,
    selectVoice,
    resolveLocale,
    profiles: PROFILES
  });
})(typeof window !== "undefined" ? window : globalThis);
