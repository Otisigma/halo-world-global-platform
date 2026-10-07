export const DISCOVERY_GENRES = Object.freeze(["Afro House", "House", "Deep House", "Melodic House", "Tech House", "Progressive House",
  "Soul", "Ambient", "Electronic", "Electronica", "Hip Hop", "Techno", "Jazz", "Pop", "R&B", "Afrobeats", "Drum and Bass"]);
export function normalizeDiscovery(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/(^|\s)[@#]+/g, "$1")
    .replace(/(afro|deep|melodic|tech|progressive)\s*house/g, "$1house").replace(/afro\s*beats/g, "afrobeats")
    .replace(/hip[\s-]*hop/g, "hiphop").replace(/drum\s*(?:&|and)\s*bass/g, "drumandbass").replace(/\s+/g, " ").trim();
}
export const normalizeTag = value => normalizeDiscovery(value).replace(/\s+/g, "");
export function discoveryMatches(text, tags, state = {}) {
  const haystack = normalizeDiscovery(text);
  const terms = normalizeDiscovery(state.query).split(" ").filter(Boolean);
  const available = new Set(tags.map(normalizeTag));
  return terms.every(term => haystack.includes(term)) &&
    (!state.tags?.length || state.tags.some(tag => available.has(normalizeTag(tag))));
}
export function creatorSearchRecord(creator) {
  const tags = [...(creator.genres || []), ...(creator.roles || []), ...(creator.languages || [])];
  return { text: [creator.display_name || creator.displayName, creator.handle, creator.bio, creator.location,
    creator.availability, ...tags].filter(Boolean).join(" "), tags };
}
export function feedSearchRecord(post) {
  const hashtags = String(post.body || "").match(/#[\p{L}\p{N}_-]+/gu) || [];
  const tags = [...(post.media?.genres || []), ...hashtags];
  return { text: [post.authorName, post.body, post.kind, post.media?.title, post.media?.artist, ...tags].filter(Boolean).join(" "), tags };
}

const emptyPreferences = () => ({ query: "", tags: [] });
export function validatedDiscoveryPreferences(value, allowedTags = DISCOVERY_GENRES) {
  if (!value || value.version !== 1 || typeof value.query !== "string" || value.query.length > 120 ||
      /[\u0000-\u001f]/.test(value.query) || !Array.isArray(value.tags) || value.tags.length > 12 ||
      value.tags.some(tag => typeof tag !== "string" || tag.length > 48)) return emptyPreferences();
  const allowed = new Set(allowedTags.map(normalizeTag));
  return { query: value.query, tags: [...new Set(value.tags.map(normalizeTag))].filter(tag => allowed.has(tag)) };
}
export function createDiscoveryPreferences(namespace, { getStorage = () => globalThis.localStorage, allowedTags = DISCOVERY_GENRES, delay = 250 } = {}) {
  const key = `halo.discovery.${namespace}.v1`;
  let timer;
  const read = () => {
    try {
      const raw = getStorage()?.getItem(key) || "null";
      return raw.length <= 4096 ? validatedDiscoveryPreferences(JSON.parse(raw), allowedTags) : emptyPreferences();
    }
    catch { return emptyPreferences(); }
  };
  const cancel = () => { clearTimeout(timer); };
  const write = state => {
    cancel();
    const snapshot = validatedDiscoveryPreferences({ version: 1, query: state.query, tags: state.tags }, allowedTags);
    timer = setTimeout(() => {
      try { getStorage()?.setItem(key, JSON.stringify({ version: 1, ...snapshot })); } catch { /* Storage is optional. */ }
    }, delay);
  };
  const reset = () => { cancel(); try { getStorage()?.removeItem(key); } catch { /* Storage is optional. */ } };
  return { read, write, reset, cancel };
}

export function shortcutTargetEnabled(target, doc) {
  return Boolean(target && !target.disabled && !target.hidden && !target.closest?.("[hidden], [inert]") &&
    !doc.querySelector?.('dialog[open], [aria-modal="true"]') && target.getClientRects?.().length);
}
const shortcutRegistrations = new WeakMap();
export function registerDiscoveryShortcut(doc, getTarget) {
  let registration = shortcutRegistrations.get(doc);
  if (registration) { registration.getTarget = getTarget; return; }
  registration = { getTarget };
  shortcutRegistrations.set(doc, registration);
  doc.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey ||
        event.ctrlKey === event.metaKey || String(event.key).toLowerCase() !== "k") return;
    const target = registration.getTarget();
    if (!shortcutTargetEnabled(target, doc)) return;
    event.preventDefault(); target.focus(); target.select?.();
  });
}

// Audience selection never grants access: the server remains the sole post authorization boundary.
export function createAudienceSelection() {
  let audience = "PUBLIC", requested = "", completed = false;
  const valid = new Set(["PUBLIC", "INNER_CIRCLE", "COLLABORATOR_VAULT"]);
  return {
    get audience() { return audience; },
    get requested() { return requested; },
    request(next, authenticated, memberId) {
      if (!valid.has(next)) return false;
      if (next === "PUBLIC" || (authenticated && memberId)) {
        audience = next; requested = ""; completed = false; return true;
      }
      requested = next; completed = false; return false;
    },
    complete() { completed = Boolean(requested); },
    confirm(authenticated, memberId) {
      if (!completed || !authenticated || !memberId || !requested) return false;
      audience = requested; requested = ""; completed = false; return true;
    },
    cancel() { requested = ""; completed = false; },
    reset(preserveRequest = false) { audience = "PUBLIC"; if (!preserveRequest) { requested = ""; completed = false; } }
  };
}
