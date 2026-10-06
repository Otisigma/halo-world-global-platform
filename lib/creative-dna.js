// Stable IDs are independent of labels. Suggestions never imply skill or competence.
const folded = value => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
export const DNA_CATEGORIES = Object.freeze({
  sound: "Sound / influences", disciplines: "Disciplines", tools: "Tools / techniques",
  themes: "Themes / aesthetics", beyond: "Beyond music"
});
export const DNA_TERMS = Object.freeze([
  ["sound.house", "sound", "House", ["house music"]],
  ["sound.jazz", "sound", "Jazz", []],
  ["sound.ambient", "sound", "Ambient", ["ambient music"]],
  ["sound.hip-hop", "sound", "Hip-hop", ["hip hop", "hiphop"]],
  ["sound.soul", "sound", "Soul", []],
  ["sound.afrobeat", "sound", "Afrobeat", []],
  ["disciplines.songwriting", "disciplines", "Songwriting", ["song writing"]],
  ["disciplines.production", "disciplines", "Music production", ["production", "producing"]],
  ["disciplines.dj", "disciplines", "DJing", ["dj", "deejaying"]],
  ["disciplines.visual-art", "disciplines", "Visual art", ["visual arts"]],
  ["disciplines.dance", "disciplines", "Dance", ["dancing"]],
  ["disciplines.film", "disciplines", "Filmmaking", ["film making"]],
  ["tools.field-recording", "tools", "Field recording", ["field recordings"]],
  ["tools.sampling", "tools", "Sampling", []],
  ["tools.synthesis", "tools", "Synthesis", ["synthesizers", "synths"]],
  ["tools.ableton", "tools", "Ableton Live", ["ableton"]],
  ["tools.logic", "tools", "Logic Pro", ["logic"]],
  ["tools.modular", "tools", "Modular synthesis", ["modular synth"]],
  ["themes.minimalism", "themes", "Minimalism", ["minimalist"]],
  ["themes.futurism", "themes", "Futurism", ["futurist"]],
  ["themes.nature", "themes", "Nature", []],
  ["themes.storytelling", "themes", "Storytelling", ["story telling"]],
  ["themes.nostalgia", "themes", "Nostalgia", ["nostalgic"]],
  ["themes.surrealism", "themes", "Surrealism", ["surrealist"]],
  ["beyond.cooking", "beyond", "Cooking", ["culinary arts"]],
  ["beyond.gardening", "beyond", "Gardening", []],
  ["beyond.hiking", "beyond", "Hiking", []],
  ["beyond.photography", "beyond", "Photography", []],
  ["beyond.gaming", "beyond", "Gaming", ["video games"]],
  ["beyond.astronomy", "beyond", "Astronomy", []]
].map(([id, category, label, aliases]) => Object.freeze({
  id, category, label, aliases: Object.freeze(aliases), normalizedKey: folded(label), active: true
})));
export const DNA_LIMITS = Object.freeze({ total: 24, category: 6, custom: 4, label: 48 });
export const DNA_AUDIENCES = Object.freeze(["private", "members", "public"]);
export const DNA_RELATIONSHIPS = Object.freeze(["", "inspired", "practicing", "learning"]);
export const emptyDNA = () => ({ enabled: false, audience: "private", discovery: false, revision: 0, items: [] });
const fail = message => { throw new Error(message); };

export function validateDNA(input, vocabulary = DNA_TERMS) {
  const termById = new Map(vocabulary.map(term => [term.id, term]));
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["enabled", "audience", "discovery", "revision", "items"].includes(key)) ||
      typeof input.enabled !== "boolean" || typeof input.discovery !== "boolean" ||
      !DNA_AUDIENCES.includes(input.audience) || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !Array.isArray(input.items) || input.items.length > DNA_LIMITS.total) fail("Invalid Creative DNA settings or limits.");
  const seen = new Set(), counts = {}, labels = new Set();
  let customCount = 0;
  const items = input.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(key => !["termId", "category", "label", "relationship", "audience"].includes(key)) ||
        !DNA_AUDIENCES.includes(item.audience) || !DNA_RELATIONSHIPS.includes(item.relationship ?? "")) fail("Invalid interest.");
    const term = termById.get(item.termId);
    let category, label, key;
    if (item.termId) {
      if (!term?.active || (item.category && item.category !== term.category) || (item.label && item.label !== term.label)) fail("Unknown, inactive or mismatched canonical term.");
      ({ category, label } = term);
      key = term.id;
    } else {
      if (!Object.hasOwn(DNA_CATEGORIES, item.category) || typeof item.label !== "string" ||
          item.label.trim().length < 1 || item.label.length > DNA_LIMITS.label || /[\u0000-\u001f]/.test(item.label)) fail("Invalid custom interest.");
      category = item.category;
      label = item.label.trim().replace(/\s+/g, " ");
      if (vocabulary.some(t => t.category === category && [t.normalizedKey, ...t.aliases].some(alias => folded(alias) === folded(label)))) {
        fail("Choose the canonical term for this label.");
      }
      key = `${category}:${folded(label)}`;
      if (++customCount > DNA_LIMITS.custom) fail("Use at most four custom interests.");
    }
    const labelKey = `${category}:${folded(label)}`;
    if (seen.has(key) || labels.has(labelKey)) fail("Duplicate interest.");
    seen.add(key); labels.add(labelKey);
    counts[category] = (counts[category] || 0) + 1;
    if (counts[category] > DNA_LIMITS.category) fail("Use at most six interests per category.");
    return { termId: term?.id || null, category, label, relationship: item.relationship || "", audience: item.audience };
  });
  return { enabled: input.enabled, audience: input.audience, discovery: input.discovery, revision: input.revision, items };
}

// Also used for the editor's preview; the database repeats this policy for every server destination.
export function projectDNA(dna, { viewer = "public", destination = "network", blocked = false,
  destinationVisible = true, discovery = false, vocabulary = DNA_TERMS } = {}) {
  if (blocked || !destinationVisible || !dna?.enabled || (discovery && !dna.discovery)) return [];
  const rank = value => DNA_AUDIENCES.indexOf(value);
  const minimum = !["public-network", "artist", "home"].includes(destination) && viewer === "members" ? 1 : 2;
  const activeIds = new Set(vocabulary.filter(term => term.active).map(term => term.id));
  if (rank(dna.audience) < minimum) return [];
  return (dna.items || []).filter(item => rank(item.audience) >= minimum && (!discovery || item.termId) &&
      (!item.termId || activeIds.has(item.termId)))
    .map(({ termId, category, label, relationship }) => ({ termId, category, label, relationship }));
}

export function suggestDNA(selectedText, vocabulary = DNA_TERMS) {
  if (typeof selectedText !== "string" || selectedText.length > 3000) fail("Select up to 3,000 characters.");
  const words = ` ${folded(selectedText).replace(/[^\p{L}\p{N}-]+/gu, " ")} `;
  return vocabulary.filter(term => term.active && [term.normalizedKey, ...term.aliases].some(alias =>
    words.includes(` ${folded(alias).replace(/[^\p{L}\p{N}-]+/gu, " ")} `)))
    .slice(0, 12).map(({ id, category, label }) => ({ termId: id, category, label }));
}

export function dnaFilters(url, vocabulary = DNA_TERMS) {
  const activeIds = new Set(vocabulary.filter(term => term.active).map(term => term.id));
  const category = url.searchParams.get("interestCategory") || "";
  const raw = url.searchParams.get("interests") || "";
  const ids = raw ? raw.split(",") : [];
  const mode = url.searchParams.get("interestMode") || "any";
  if ((category && !Object.hasOwn(DNA_CATEGORIES, category)) || ids.length > 24 ||
      new Set(ids).size !== ids.length || ids.some(id => !activeIds.has(id)) ||
      !["any", "all"].includes(mode)) fail("Invalid Creative DNA filters.");
  return { category, ids, mode };
}

export function readDNACursor(url) {
  const value = url.searchParams.get("cursor");
  if (!value) return { premium: true, time: "9999-12-31T00:00:00.000Z", key: "ffffffffffffffffffffffffffffffff" };
  try {
    if (value.length > 256) throw new Error();
    const cursor = JSON.parse(atob(value));
    if (typeof cursor.premium !== "boolean" || typeof cursor.time !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(cursor.time) || !Number.isFinite(Date.parse(cursor.time)) ||
        !/^[a-f0-9]{32}$/.test(cursor.key)) throw new Error();
    return cursor;
  } catch { fail("Invalid discovery cursor."); }
}
export function nextDNACursor(rows, limit) {
  if (rows.length < limit) return null;
  const row = rows.at(-1);
  if (!row?.cursor_key || !row?.updated_at) return null;
  return btoa(JSON.stringify({ premium: row.premium_verified === true, time: row.cursor_time || new Date(row.updated_at).toISOString(), key: row.cursor_key }));
}
