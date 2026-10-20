// Deterministic, local mix-request parsing for the Dreamweaver catalog curator.
// No external model is called and no catalog or audio data leaves the browser: a fixed
// vocabulary maps supported phrases to a structured intent, and every phrase that is not
// understood is reported back instead of being silently guessed at.

export const MIX_PROMPT_MAX_LENGTH = 500;
export const MIX_PRESET_STORAGE_KEY = "halo:dreamweaver-mix-presets";
export const MAX_USER_PRESETS = 12;

export const ENERGY_LEVEL_LABELS = Object.freeze(["", "warm-up", "build", "lift", "peak"]);
const DEFAULT_ARC = Object.freeze({ opening: 1, build: 2, peak: 3, closing: 4 });
const SEGMENTS = ["opening", "build", "peak", "closing"];

export const MOOD_VOCABULARY = Object.freeze({
  warm: ["warm"], cinematic: ["cinematic", "filmic", "epic"], dreamy: ["dreamy", "ethereal", "floaty"],
  dark: ["dark", "moody", "brooding"], uplifting: ["uplifting", "hopeful", "bright"], euphoric: ["euphoric"],
  chill: ["chill", "mellow", "relaxed", "laid back", "calm"], emotional: ["emotional", "heartfelt"],
  soulful: ["soulful"], melodic: ["melodic"], groovy: ["groovy", "funky"], romantic: ["romantic"],
  sunset: ["sunset", "golden hour"], "late night": ["late night", "after hours", "midnight"]
});

// Longer phrases first so "deep house" never also counts as plain "house".
export const GENRE_VOCABULARY = Object.freeze({
  "melodic techno": ["melodic techno"], "deep house": ["deep house"], "tech house": ["tech house"],
  "afro house": ["afro house", "afrohouse"], "melodic house": ["melodic house"],
  "progressive house": ["progressive house", "prog house"], "organic house": ["organic house"],
  "lo-fi house": ["lo fi house", "lofi house"], "drum and bass": ["drum and bass", "drum & bass", "dnb"],
  "nu-disco": ["nu disco"], "hip hop": ["hip hop", "hiphop"], "r&b": ["r&b", "rnb"],
  house: ["house"], techno: ["techno"], trance: ["trance"], disco: ["disco"], amapiano: ["amapiano"],
  soul: ["soul"], pop: ["pop"], ambient: ["ambient"], downtempo: ["downtempo"], garage: ["garage", "ukg"],
  electronica: ["electronica"], edm: ["edm"]
});

// HALO-defined profile labels. These are house style settings for HALO's own DJ personas and
// shows — Dreamweaver does not imitate, clone, or claim to sound like any third-party artist.
export const MIX_PRESETS = Object.freeze([
  { id: "halo-x", label: "Halo X", aliases: ["dj halo x", "halo x", "halox"],
    description: "DJ HALO X peak-hour house: warm open, rolling house build, anthemic finish.",
    moods: ["uplifting", "euphoric"], genres: ["house", "tech house", "afro house"],
    bpmRange: { min: 122, max: 130 }, arc: { opening: 1, build: 2, peak: 3, closing: 4 }, preferFresh: true },
  { id: "dj-halo", label: "DJ Halo", aliases: ["dj halo"],
    description: "HALO's peak-time persona: driving house from the first track.",
    moods: ["uplifting"], genres: ["house", "afro house", "tech house"],
    bpmRange: { min: 124, max: 134 }, arc: { opening: 2, build: 3, peak: 4, closing: 4 }, preferFresh: false },
  { id: "dj-butterfly", label: "DJ Butterfly", aliases: ["dj butterfly", "butterfly"],
    description: "HALO's sunset-terrace persona: melodic, progressive, slow-blooming lifts.",
    moods: ["melodic", "dreamy", "sunset"], genres: ["melodic house", "progressive house", "organic house", "electronica"],
    bpmRange: { min: 116, max: 124 }, arc: { opening: 1, build: 2, peak: 3, closing: 3 }, preferFresh: false },
  { id: "dj-romy", label: "DJ Romy", aliases: ["dj romy", "romy"],
    description: "HALO's after-hours persona: deep, soulful and low-key.",
    moods: ["soulful", "late night", "chill"], genres: ["deep house", "soul", "downtempo", "lo-fi house"],
    bpmRange: { min: 96, max: 120 }, arc: { opening: 1, build: 1, peak: 2, closing: 2 }, preferFresh: false },
  { id: "cinematic-sunrise", label: "Cinematic Sunrise", aliases: ["cinematic sunrise"],
    description: "Warm cinematic opening that rises into a euphoric finale.",
    moods: ["warm", "cinematic", "euphoric"], genres: ["melodic house", "progressive house"],
    bpmRange: { min: 118, max: 126 }, arc: { opening: 1, build: 2, peak: 3, closing: 4 }, preferFresh: true },
  { id: "deep-house-journey", label: "Deep House Journey", aliases: ["deep house journey"],
    description: "Steady deep-house groove with a soulful lift at the end.",
    moods: ["groovy", "soulful"], genres: ["deep house", "house"],
    bpmRange: { min: 118, max: 124 }, arc: { opening: 1, build: 2, peak: 2, closing: 3 }, preferFresh: false }
].map(preset => Object.freeze({ ...preset, source: "halo" })));

const ENERGY_WORDS = [
  [4, ["peak time", "anthemic", "anthem", "explosive", "euphoric", "massive", "huge", "maximum", "peak"]],
  [3, ["high energy", "lifter", "lift", "uplifting", "driving", "big", "banging", "pumping", "energetic", "hype"]],
  [2, ["groove", "groovy", "steady", "rolling", "medium energy"]],
  [1, ["warm", "chill", "mellow", "soft", "gentle", "calm", "laid back", "low key", "smooth", "low energy", "ambient"]]
];
const OVERALL_ENERGY = [
  [3, ["high energy", "peak time", "banging", "hard hitting", "energetic", "driving", "hype"]],
  [1, ["low energy", "chill", "mellow", "laid back", "relaxed", "calm", "low key"]]
];
const SEGMENT_WORDS = [
  ["opening", ["open with", "start with", "starting with", "begin with", "warm up", "opening", "opener", "intro", "start", "begin"]],
  ["build", ["build up", "buildup", "build", "middle", "mid set", "main section"]],
  ["closing", ["close with", "end with", "finish with", "closing", "closer", "finale", "finish", "ending", "outro", "end"]]
];
const COOL_DOWN = ["winds down", "wind down", "winding down", "wind it down", "cool down", "cools down", "come down", "comes down", "chill ending", "calm ending", "soft landing"];
const RECENT_WORDS = /\b(?:recent|recently|played|used|repeats?|last (?:week|month|night)|this (?:week|month)|yesterday|before|again)\b/;
const AVOID_LEAD = /^(?:avoid|no|without|skip|exclude|not|don't use|dont use|never)\s+(.+)$/;
const ALLOW_REUSE = ["allow repeats", "repeats ok", "repeats are ok", "repeats are fine", "allow recent", "include recent", "reuse", "replay favorites", "any tracks"];
const FRESH_ONLY = ["fresh only", "only fresh", "fresh tracks", "new tracks", "only new", "newest tracks", "something new", "never the same"];
const FILLER = new Set([
  "a", "an", "the", "mix", "mixes", "set", "please", "with", "track", "tracks", "song", "songs", "music",
  "some", "of", "for", "me", "my", "style", "styled", "inspired", "vibe", "vibes", "feel", "feeling", "sound",
  "sounds", "energy", "that", "it", "to", "from", "into", "in", "on", "really", "very", "just", "playlist",
  "dreamweaver", "halo", "dj", "and", "&", "like", "lots", "plenty", "go", "take", "us", "then", "followed",
  "by", "is", "be", "should", "make", "create", "build", "generate", "give", "play", "curate", "want", "i",
  "can", "you", "lets", "let's", "kind", "type", "at", "end", "bit", "little", "more", "some", "your", "our"
]);

function normalizeText(value, max = MIX_PROMPT_MAX_LENGTH) {
  return String(value ?? "").normalize("NFKC").slice(0, max).toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9&'\-.,;:!?/~\s]/g, " ")
    .replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

// Phrase matching on word boundaries; a matched phrase is blanked so it cannot match twice.
function take(clause, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`);
  if (!pattern.test(clause.text)) return false;
  clause.text = clause.text.replace(pattern, "$1 ").replace(/\s+/g, " ").trim();
  return true;
}

const unique = values => [...new Set(values)];
const clampLevel = value => Math.min(4, Math.max(1, Math.round(Number(value) || 1)));
const safeFragment = value => normalizeText(value, 80).replace(/[^a-z0-9&' ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

function validBpmRange(range) {
  if (!range || typeof range !== "object") return null;
  const min = Number(range.min), max = Number(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 40 || max > 240 || min > max) return null;
  return { min: Math.round(min), max: Math.round(max) };
}

function normalizeArc(arc) {
  const base = { ...DEFAULT_ARC, ...(arc && typeof arc === "object" ? arc : {}) };
  const result = {};
  let floor = 1;
  for (const segment of SEGMENTS) floor = result[segment] = Math.max(floor, clampLevel(base[segment]));
  return result;
}

/** Validates any intent (parsed, preset, or caller-provided) into the bounded curator shape. */
export function normalizeMixIntent(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const inVocabulary = (values, vocabulary) => unique((Array.isArray(values) ? values : [])
    .filter(value => typeof value === "string" && Object.hasOwn(vocabulary, value))).slice(0, 8);
  const days = Number(source.recentWindowDays);
  return {
    profileId: typeof source.profileId === "string" && /^[a-z0-9-]{1,40}$/.test(source.profileId) ? source.profileId : "",
    profileLabel: safeLabel(source.profileLabel),
    durationMinutes: source.durationMinutes === 20 || source.durationMinutes === 60 ? source.durationMinutes : null,
    moods: inVocabulary(source.moods, MOOD_VOCABULARY),
    genres: inVocabulary(source.genres, GENRE_VOCABULARY),
    bpmRange: validBpmRange(source.bpmRange),
    arc: normalizeArc(source.arc),
    allowRecent: source.allowRecent === true ? true : source.allowRecent === false ? false : null,
    recentWindowDays: Number.isInteger(days) && days >= 1 && days <= 90 ? days : 7,
    preferFresh: source.preferFresh === true,
    avoidTerms: unique((Array.isArray(source.avoidTerms) ? source.avoidTerms : [])
      .map(term => typeof term === "string" ? safeFragment(term).slice(0, 40) : "").filter(Boolean)).slice(0, 5)
  };
}

function safeLabel(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/[^\p{L}\p{N} '&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** User presets are saved prompts with a label; they never carry markup, URLs, or track data. */
export function normalizeUserPreset(input) {
  if (!input || typeof input !== "object") return null;
  const label = safeLabel(input.label);
  const prompt = typeof input.prompt === "string" ? input.prompt.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, MIX_PROMPT_MAX_LENGTH) : "";
  const id = `user-${normalizeText(label, 40).replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-")}`.slice(0, 40);
  if (!label || !prompt || id === "user-") return null;
  if (MIX_PRESETS.some(preset => preset.id === id || preset.label.toLowerCase() === label.toLowerCase())) return null;
  return { id, label, prompt, source: "user" };
}

export function normalizeUserPresets(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normalizeUserPreset)
    .filter(preset => preset && !seen.has(preset.id) && seen.add(preset.id)).slice(0, MAX_USER_PRESETS);
}

export function readUserPresets(storage) {
  try {
    return normalizeUserPresets(JSON.parse(storage?.getItem(MIX_PRESET_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function saveUserPreset(preset, storage) {
  const normalized = normalizeUserPreset(preset);
  if (!normalized) return { ok: false, reason: "invalid", presets: readUserPresets(storage) };
  const existing = readUserPresets(storage).filter(item => item.id !== normalized.id);
  if (existing.length >= MAX_USER_PRESETS) return { ok: false, reason: "limit", presets: existing };
  const presets = [normalized, ...existing];
  try {
    storage.setItem(MIX_PRESET_STORAGE_KEY, JSON.stringify(presets));
    return { ok: true, preset: normalized, presets };
  } catch {
    return { ok: false, reason: "storage", presets: existing };
  }
}

export function deleteUserPreset(id, storage) {
  const presets = readUserPresets(storage).filter(item => item.id !== id);
  try { storage.setItem(MIX_PRESET_STORAGE_KEY, JSON.stringify(presets)); } catch {}
  return presets;
}

function presetIntent(preset) {
  return {
    profileId: preset.id, profileLabel: preset.label, moods: [...preset.moods], genres: [...preset.genres],
    bpmRange: preset.bpmRange ? { ...preset.bpmRange } : null, arc: { ...preset.arc }, preferFresh: preset.preferFresh === true
  };
}

function findPresetMentions(clause, presets) {
  const found = [];
  const phrases = presets.flatMap(preset => [preset.label, ...(preset.aliases || [])]
    .map(alias => ({ preset, alias: normalizeText(alias, 60) })))
    .filter(entry => entry.alias).sort((a, b) => b.alias.length - a.alias.length);
  for (const { preset, alias } of phrases) if (take(clause, alias) && !found.includes(preset)) found.push(preset);
  return found;
}

/**
 * Parses a natural-language mix request into a curator intent.
 * Returns { intent, understood, unsupported, notes } — `unsupported` lists ignored fragments.
 */
export function parseMixPrompt(prompt, { presetId = "", userPresets = [], expandUserPresets = true } = {}) {
  const raw = typeof prompt === "string" ? prompt : "";
  const notes = [], understood = [], unsupported = [];
  const users = normalizeUserPresets(userPresets);
  const allPresets = [...MIX_PRESETS, ...users];
  if (raw.length > MIX_PROMPT_MAX_LENGTH) notes.push(`Only the first ${MIX_PROMPT_MAX_LENGTH} characters of the request were read.`);
  let intent = { moods: [], genres: [], arc: { ...DEFAULT_ARC }, avoidTerms: [] };
  const segmentLevels = {};
  const profiles = [];
  const explicit = new Set();

  const applyProfile = (preset, segment = "") => {
    if (profiles.includes(preset)) return;
    profiles.push(preset);
    const profile = preset.source === "user"
      ? parseMixPrompt(preset.prompt, { expandUserPresets: false }).intent
      : presetIntent(preset);
    if (!intent.profileId) {
      // Explicit request details (tempo, duration, reuse policy, energy) always win over profile defaults.
      for (const key of ["bpmRange", "arc", "preferFresh", "allowRecent", "recentWindowDays", "durationMinutes"]) {
        if (!explicit.has(key) && profile[key] != null) intent[key] = profile[key];
      }
      intent.profileId = preset.id;
      intent.profileLabel = preset.label;
      intent.moods = unique([...intent.moods, ...profile.moods]);
      intent.genres = unique([...intent.genres, ...profile.genres]);
      intent.avoidTerms = unique([...intent.avoidTerms, ...(profile.avoidTerms || [])]).slice(0, 5);
    } else {
      intent.moods = unique([...intent.moods, ...profile.moods]);
      intent.genres = unique([...intent.genres, ...profile.genres]);
      if (segment) segmentLevels[segment] = Math.max(segmentLevels[segment] || 0, profile.arc[segment]);
    }
    understood.push(`${preset.source === "user" ? "Your preset" : "HALO profile"} “${preset.label}”`);
  };

  const selected = allPresets.find(preset => preset.id === presetId);
  if (presetId && !selected) notes.push("The selected preset is no longer available; using defaults.");
  if (selected) applyProfile(selected);

  let text = normalizeText(raw);
  // Protect multi-word genres that contain clause separators.
  text = text.replace(/\bdrum and bass\b/g, "dnb").replace(/\br and b\b/g, "r&b");

  const duration = /\b(\d{1,3}|one|an|a|half an?)\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\b/.exec(text);
  if (duration) {
    const [phrase, amount] = duration;
    const hours = /h/.test(phrase.replace(amount, ""));
    const value = /half/.test(amount) ? 30 : /^(?:one|an|a)$/.test(amount) ? 60 : Number(amount) * (hours ? 60 : 1);
    if (value === 20 || value === 60) {
      intent.durationMinutes = value;
      explicit.add("durationMinutes");
      understood.push(`${value}-minute set`);
    } else {
      notes.push(`Sets can be 20 or 60 minutes; “${safeFragment(phrase)}” isn't available, so the duration selector is used.`);
    }
    text = text.replace(phrase, " ");
  }

  const bpmRangeMatch = /\b(\d{2,3})\s*(?:to|~|\/|\s)\s*(\d{2,3})\s*bpm\b/.exec(text);
  const bpmSingle = bpmRangeMatch ? null : /\b(?:around|about|roughly|near|~)?\s*(\d{2,3})\s*bpm\b/.exec(text);
  if (bpmRangeMatch || bpmSingle) {
    const range = bpmRangeMatch
      ? validBpmRange({ min: Math.min(+bpmRangeMatch[1], +bpmRangeMatch[2]), max: Math.max(+bpmRangeMatch[1], +bpmRangeMatch[2]) })
      : validBpmRange({ min: +bpmSingle[1] - 4, max: +bpmSingle[1] + 4 });
    if (range) {
      intent.bpmRange = range;
      explicit.add("bpmRange");
      understood.push(`${range.min}–${range.max} BPM`);
    } else {
      notes.push("BPM must be between 40 and 240; the requested tempo was ignored.");
    }
    text = text.replace((bpmRangeMatch || bpmSingle)[0], " ");
  }

  const clauses = text.split(/[,.;:!?]|\bthen\b|\band then\b|\bfollowed by\b|\band\b(?=\s+(?:a|an|the|finish|end|close|build|open|start|avoid|no|skip|allow)\b)/)
    .map(part => ({ text: part.replace(/\s+/g, " ").trim(), original: part.trim() })).filter(part => part.text);

  for (const clause of clauses) {
    clause.text = clause.text.replace(/^(?:please\s+)?(?:can you\s+)?(?:(?:create|make|build|generate|give|play|curate)(?:\s+(?:me|us))?\s+(?:a|an|the|some)\b|i want(?:\s+(?:a|an|the))?\b|let'?s do(?:\s+(?:a|an|the))?\b)\s*/, "").trim();
    // Freshness / rotation policy.
    if (ALLOW_REUSE.some(phrase => take(clause, phrase))) {
      intent.allowRecent = true;
      explicit.add("allowRecent");
      understood.push("Recent tracks may be reused");
    }
    if (FRESH_ONLY.some(phrase => take(clause, phrase))) {
      intent.preferFresh = true;
      explicit.add("preferFresh");
      understood.push("Fresh tracks first");
    }
    const avoid = AVOID_LEAD.exec(clause.text);
    if (avoid && RECENT_WORDS.test(avoid[1])) {
      intent.allowRecent = false;
      explicit.add("allowRecent").add("recentWindowDays");
      intent.recentWindowDays = /month/.test(avoid[1]) ? 30 : /yesterday|last night/.test(avoid[1]) ? 1 : 7;
      understood.push(`Avoid tracks played in the last ${intent.recentWindowDays === 1 ? "day" : intent.recentWindowDays === 30 ? "30 days" : "7 days"}`);
      continue;
    }
    if (avoid) {
      const term = safeFragment(avoid[1].replace(/\b(?:tracks?|songs?|music|please)\b/g, " ").replace(/\s+/g, " ").trim());
      if (term) {
        intent.avoidTerms = unique([...intent.avoidTerms, term.slice(0, 40)]).slice(0, 5);
        understood.push(`Avoid “${term.slice(0, 40)}”`);
      }
      continue;
    }

    if (COOL_DOWN.some(phrase => take(clause, phrase))) {
      notes.push("Cool-down endings aren't supported yet: Dreamweaver keeps the energy level or rising toward the closer.");
    }
    const segment = SEGMENT_WORDS.find(([, words]) => words.some(word => take(clause, word)))?.[0] || "";
    for (const preset of findPresetMentions(clause, allPresets)) {
      if (preset.source === "user" && !expandUserPresets) continue;
      applyProfile(preset, segment);
    }
    for (const [genre, words] of Object.entries(GENRE_VOCABULARY)) {
      if (words.some(word => take(clause, normalizeText(word)))) {
        intent.genres = unique([...intent.genres, genre]);
        understood.push(`Genre: ${genre}`);
      }
    }
    const before = clause.text;
    let level = 0;
    for (const [value, words] of ENERGY_WORDS) {
      for (const word of words) if (new RegExp(`(^|\\s)${word}(?=\\s|$)`).test(before)) level = Math.max(level, value);
    }
    for (const [mood, words] of Object.entries(MOOD_VOCABULARY)) {
      if (words.some(word => take(clause, word))) {
        intent.moods = unique([...intent.moods, mood]);
        understood.push(`Mood: ${mood}`);
      }
    }
    if (segment) {
      if (level) segmentLevels[segment] = Math.max(segmentLevels[segment] || 0, level);
      understood.push(`${segment[0].toUpperCase()}${segment.slice(1)}${level ? `: ${ENERGY_LEVEL_LABELS[level]} energy` : ""}`);
    } else {
      const overall = OVERALL_ENERGY.find(([, words]) => words.some(word => new RegExp(`(^|\\s)${word}(?=\\s|$)`).test(before)))?.[0];
      if (overall === 3) intent.arc = { opening: 2, build: 3, peak: 4, closing: 4 };
      if (overall === 1) intent.arc = { opening: 1, build: 1, peak: 2, closing: 2 };
      if (overall) explicit.add("arc");
      if (overall) understood.push(overall === 3 ? "High-energy arc" : "Low-energy arc");
    }
    for (const [, words] of ENERGY_WORDS) for (const word of words) take(clause, word);
    const leftover = clause.text.split(" ").filter(word => word && !FILLER.has(word) && !/^\d+$/.test(word));
    if (leftover.length) unsupported.push(safeFragment(leftover.join(" ")));
  }

  const requested = { ...intent.arc, ...segmentLevels };
  if (segmentLevels.closing && !segmentLevels.peak) requested.peak = Math.min(requested.peak, segmentLevels.closing);
  if (segmentLevels.closing && segmentLevels.closing < Math.max(requested.opening, requested.build)) {
    notes.push("Cool-down endings aren't supported yet: Dreamweaver keeps the energy level or rising toward the closer.");
  }
  intent.arc = requested;
  if (profiles.length > 1) notes.push(`Blended HALO profiles: ${profiles.map(preset => preset.label).join(" + ")}.`);
  if (profiles.some(preset => preset.source === "halo")) {
    notes.push("HALO profiles are house-defined style settings (genres, moods, BPM and energy); Dreamweaver doesn't imitate any artist.");
  }
  const cleanUnsupported = unique(unsupported.filter(Boolean)).slice(0, 5);
  if (cleanUnsupported.length) notes.push(`Not understood, so ignored: ${cleanUnsupported.map(part => `“${part}”`).join(", ")}.`);
  if (!raw.trim() && !selected) notes.push("No request entered — using the default warm-up → peak arc.");
  return { intent: normalizeMixIntent(intent), understood: unique(understood), unsupported: cleanUnsupported, notes: unique(notes) };
}

/** Human-readable, plain-text summary (render with textContent only). */
export function describeMixIntent(intent) {
  const value = normalizeMixIntent(intent);
  const parts = [];
  if (value.profileLabel) parts.push(`Profile: ${value.profileLabel}`);
  if (value.moods.length) parts.push(`Moods: ${value.moods.join(", ")}`);
  if (value.genres.length) parts.push(`Genres: ${value.genres.join(", ")}`);
  if (value.bpmRange) parts.push(`BPM ${value.bpmRange.min}–${value.bpmRange.max}`);
  parts.push(`Arc: ${SEGMENTS.map(segment => ENERGY_LEVEL_LABELS[value.arc[segment]]).join(" → ")}`);
  parts.push(value.allowRecent === true ? "Recent tracks allowed" : `Avoiding tracks played in the last ${value.recentWindowDays} day${value.recentWindowDays === 1 ? "" : "s"}`);
  if (value.preferFresh) parts.push("Fresh tracks first");
  if (value.avoidTerms.length) parts.push(`Avoid: ${value.avoidTerms.join(", ")}`);
  return parts.join(" · ");
}

export function normalizeMixSeed(value) {
  const seed = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9-]{1,32}$/.test(seed) ? seed : "";
}

/** A short session nonce; any reproducible code entered by the listener is used as-is. */
export function createMixSeed(random = globalThis.crypto) {
  try {
    if (random && typeof random.getRandomValues === "function") {
      return [...random.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {}
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

/** Deterministic value in [0, 1) for a seed + key (FNV-1a). */
export function seededUnit(seed, key) {
  let hash = 0x811c9dc5;
  for (const character of `${seed}:${key}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}
