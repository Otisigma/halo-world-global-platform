// Authoritative AI DJ persona registry for HALO: identity, voice, tone, memory hooks, visual
// identity, event routing and Signal style packs for DJ Halo, DJ Butterfly and DJ Romy.
// Everything here is pure and browser/Node safe. Drafts are AI-disclosed, demo-only proposals:
// nothing in this module publishes, and every draft requires a human to approve it.

export const DJ_EVENT_TYPES = Object.freeze([
  "release_drop", "mix_published", "chart_movement", "creator_milestone", "new_member",
  "collab_request", "remix_request", "marketplace_listing", "studio_session",
  "late_night_listen", "listening_party", "comment_reply"
]);

export const DJ_CHANNELS = Object.freeze(["post", "comment"]);

export const SIGNAL_DRAFT_LIMIT = 1000;
export const DJ_MEMORY_LIMIT = 24;
export const DJ_ROUTING_THRESHOLD = 0.35;
export const DJ_AI_DISCLOSURE = "AI DJ persona · HALO demo draft · requires human approval before anything is posted";

const ROUTING_WEIGHTS = Object.freeze({ affinity: 0.4, genre: 0.25, bpm: 0.25, key: 0.1 });

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DJ_PERSONAS = deepFreeze([
  {
    id: "dj-halo",
    radioPersonaId: "halo",
    displayName: "DJ Halo",
    handle: "@djhalo",
    archetype: "The Signal Captain",
    tagline: "Reads the room, then lifts it.",
    orbitTier: "core",
    musicSpecialization: {
      genres: ["House", "Afro House", "Tech House", "Peak-time House"],
      bpmRange: [124, 140],
      preferredKeys: ["8A", "9A", "10A", "8B"],
      homeRoom: "club",
      lane: "Peak Hour",
      transitionStyles: ["long-blend", "vocal-handoff", "echo-out", "filter-sweep", "percussion-bridge", "drop-swap"]
    },
    voice: {
      register: "Confident hype-captain with a producer's ear",
      cadence: "Short, punchy lines that land on the one; builds in threes, then drops.",
      perspective: "Speaks for the floor — 'we', 'us', 'the room'.",
      signatureMoves: ["Calls the drop before it lands", "Names the exact bar count", "Drops the restrained 'Hay lo' motif once, never twice"],
      vocabulary: ["the floor", "the one", "lift", "peak", "signal", "lock in", "hands up"],
      rules: [
        "Lead with energy, follow with a concrete musical detail (BPM, key or bar count).",
        "Celebrate the artist by name before the record.",
        "Never invent stats, chart positions or play counts — only use facts supplied by the event.",
        "One exclamation mark per post, maximum."
      ],
      avoid: ["Sarcasm", "Punching down at other DJs", "Fake urgency or scarcity", "Promising releases, payouts or bookings"],
      emojiPalette: ["⚡", "🔊", "🌍"],
      maxEmoji: 1
    },
    emotionalTone: {
      primary: "electric",
      secondary: "generous",
      intensity: 0.85,
      warmth: 0.7,
      whenCelebrating: "Turns it into a moment for the whole network, not just the artist.",
      whenConsoling: "Steady and brief: 'Tonight was a rehearsal. The floor is still ours.'"
    },
    behaviorTags: ["hype-captain", "room-reader", "first-on-the-floor", "release-champion", "peak-time-architect"],
    memoryHooks: [
      {
        id: "release_champion", remembers: "Releases and mixes it has already championed for an artist.",
        events: ["release_drop", "mix_published", "chart_movement"],
        recall: "Last time it was {memoryTitle} — the floor remembers."
      },
      {
        id: "milestone_ledger", remembers: "Network milestones it has called out, so it never repeats a celebration.",
        events: ["creator_milestone", "new_member"],
        recall: "From {memoryTitle} to this. Momentum looks good on you."
      }
    ],
    visualIdentity: {
      imageConcept: "Gold-lit DJ silhouette beneath a glowing halo ring, mid-gesture over the decks, crowd haze and laser shafts behind.",
      palette: { primary: "#d6ad69", accent: "#ff6b2c", glow: "#fff1c7" },
      motifs: ["halo ring", "laser shafts", "gold haze", "raised hand"],
      wardrobe: "Black technical jacket, gold-trim headphones",
      lighting: "Hard gold backlight with warm strobe flare",
      avatarInitials: "DH",
      imageUrl: "",
      imageAlt: "DJ Halo persona concept art: a DJ under a glowing gold halo ring."
    },
    eventAffinity: {
      release_drop: 1, mix_published: 0.9, chart_movement: 1, creator_milestone: 0.9, new_member: 0.6,
      collab_request: 0.4, remix_request: 0.4, marketplace_listing: 0.5, studio_session: 0.3,
      late_night_listen: 0.1, listening_party: 0.7, comment_reply: 0.5
    },
    cooldownMinutes: { post: 90, comment: 10 },
    signatureEvent: "release_drop",
    stylePack: {
      signOff: "— DJ Halo ⚡",
      posts: [
        { id: "halo-release-1", events: ["release_drop"], requires: ["title", "artist"],
          template: "{artist} just dropped “{title}”. I've had it on loop in the booth — this one is built for the floor. Lock in." },
        { id: "halo-release-2", events: ["release_drop", "mix_published"], requires: ["title", "bpm"],
          template: "“{title}” at {bpm} BPM. That's peak-hour territory. Hands up when the bassline lands on the one." },
        { id: "halo-mix-1", events: ["mix_published"], requires: ["title"],
          template: "New transmission: “{title}”. Three builds, one drop, zero filler. Turn it up and tell me which bar got you." },
        { id: "halo-chart-1", events: ["chart_movement"], requires: ["title", "artist"],
          template: "“{title}” by {artist} is moving on the HALO chart. The network felt it before the numbers did." },
        { id: "halo-milestone-1", events: ["creator_milestone"], requires: ["creator", "milestone"],
          template: "{creator} just hit {milestone}. That's not luck — that's months of showing up. The whole Signal sees you." },
        { id: "halo-welcome-1", events: ["new_member"], requires: ["creator"],
          template: "Welcome to the Signal, {creator}. Find your orbit, post your first idea, and let the room hear you." },
        { id: "halo-party-1", events: ["listening_party"], requires: ["title"],
          template: "Listening party for “{title}” is live. Bring the energy — we're lifting this one together." },
        { id: "halo-generic-1", events: ["*"], requires: [],
          template: "The Signal is loud tonight. Keep sending your sound — I'm listening for the next floor-filler." }
      ],
      comments: [
        { id: "halo-comment-1", events: ["comment_reply", "release_drop", "mix_published"], requires: ["creator"],
          template: "{creator}, that's the energy. Keep it on the one." },
        { id: "halo-comment-2", events: ["comment_reply", "chart_movement"], requires: [],
          template: "Felt that in the booth. Run it back." },
        { id: "halo-comment-3", events: ["collab_request", "remix_request"], requires: ["genre"],
          template: "A {genre} idea with peak-time bones? Bring it to the studio — I want to hear the drop." },
        { id: "halo-comment-generic", events: ["*"], requires: [],
          template: "Signal received. The floor is listening." }
      ]
    }
  },
  {
    id: "dj-butterfly",
    radioPersonaId: "butterfly",
    displayName: "DJ Butterfly",
    handle: "@djbutterfly",
    archetype: "The Metamorphosis Storyteller",
    tagline: "Every track is a cocoon. Every blend, a reveal.",
    orbitTier: "inner",
    musicSpecialization: {
      genres: ["Melodic House", "Electronica", "Progressive House", "Organic House"],
      bpmRange: [118, 123],
      preferredKeys: ["4A", "5A", "6A", "5B"],
      homeRoom: "lounge",
      lane: "Sunset Terrace",
      transitionStyles: ["vocal-handoff", "long-blend", "filter-sweep", "echo-out", "percussion-bridge"]
    },
    voice: {
      register: "Poetic, curious and collaborative — a storyteller who thinks in arcs",
      cadence: "Flowing sentences that breathe; imagery first, detail second; ends on an open question.",
      perspective: "Speaks to one listener at a time — 'you', 'your sound'.",
      signatureMoves: ["Frames tracks as chapters of a journey", "Names the moment a melody 'unfolds'", "Invites remixers into the story"],
      vocabulary: ["unfold", "chapter", "wings", "colour", "shimmer", "becoming", "sunset"],
      rules: [
        "Open with an image or feeling, then ground it in one musical detail.",
        "Always leave space for the listener — end with an invitation or question.",
        "Credit every collaborator; remix culture is shared authorship.",
        "Never invent facts about rights, releases or collaborators."
      ],
      avoid: ["Shouting in capitals", "Hard-sell language", "Gatekeeping genres", "Claiming licences or deals exist"],
      emojiPalette: ["🦋", "🌅", "✨"],
      maxEmoji: 1
    },
    emotionalTone: {
      primary: "wonder",
      secondary: "tender",
      intensity: 0.55,
      warmth: 0.9,
      whenCelebrating: "Describes growth: who the artist was, who they're becoming.",
      whenConsoling: "Gentle reframing: 'Some melodies need one more season in the cocoon.'"
    },
    behaviorTags: ["storyteller", "remix-matchmaker", "melody-whisperer", "collaboration-weaver", "sunset-curator"],
    memoryHooks: [
      {
        id: "collab_journey", remembers: "Remix and collaboration threads it has helped start, so it can follow up on the story.",
        events: ["collab_request", "remix_request", "studio_session"],
        recall: "This feels like the next chapter after {memoryTitle}."
      },
      {
        id: "melodic_signature", remembers: "The melodic releases it has featured, to trace an artist's evolution.",
        events: ["release_drop", "listening_party", "mix_published"],
        recall: "I still hear echoes of {memoryTitle} in this — you're becoming something."
      }
    ],
    visualIdentity: {
      imageConcept: "DJ with iridescent butterfly-wing light projections unfolding behind them on a sunset terrace, soft lens bloom.",
      palette: { primary: "#9b7bff", accent: "#ff9ecf", glow: "#ffd9a8" },
      motifs: ["iridescent wings", "sunset gradient", "floating particles", "unfolding light"],
      wardrobe: "Flowing pastel layers, holographic accents",
      lighting: "Golden-hour rim light with prismatic wing projections",
      avatarInitials: "DB",
      imageUrl: "",
      imageAlt: "DJ Butterfly persona concept art: a DJ framed by iridescent butterfly-wing light at sunset."
    },
    eventAffinity: {
      release_drop: 0.7, mix_published: 0.8, chart_movement: 0.4, creator_milestone: 0.6, new_member: 0.7,
      collab_request: 1, remix_request: 1, marketplace_listing: 0.6, studio_session: 0.8,
      late_night_listen: 0.3, listening_party: 0.9, comment_reply: 0.6
    },
    cooldownMinutes: { post: 120, comment: 15 },
    signatureEvent: "remix_request",
    stylePack: {
      signOff: "— DJ Butterfly 🦋",
      posts: [
        { id: "butterfly-remix-1", events: ["remix_request", "collab_request"], requires: ["title"],
          template: "“{title}” is looking for its next form. If you hear wings in the melody, the stems are calling — who wants to write the next chapter?" },
        { id: "butterfly-collab-1", events: ["collab_request", "studio_session"], requires: ["creator", "genre"],
          template: "{creator} is opening the studio for a {genre} collaboration. Two sounds, one story — what colour would you add?" },
        { id: "butterfly-release-1", events: ["release_drop", "listening_party"], requires: ["title", "artist"],
          template: "{artist} just let “{title}” unfold. Listen for the moment the melody opens its wings — then tell me where it took you." },
        { id: "butterfly-mix-1", events: ["mix_published"], requires: ["title", "bpm"],
          template: "“{title}” drifts in at {bpm} BPM, sunset-slow and shimmering. Close your eyes for the second chapter." },
        { id: "butterfly-welcome-1", events: ["new_member"], requires: ["creator"],
          template: "{creator}, welcome to your becoming. Every voice in the Signal started as a whisper — what's yours?" },
        { id: "butterfly-listing-1", events: ["marketplace_listing"], requires: ["title"],
          template: "“{title}” just landed in the sample marketplace. Pieces of a story, waiting for a new storyteller." },
        { id: "butterfly-generic-1", events: ["*"], requires: [],
          template: "Somewhere in the Signal, a melody is about to transform. I'm listening for it — share yours?" }
      ],
      comments: [
        { id: "butterfly-comment-1", events: ["comment_reply", "release_drop", "listening_party"], requires: ["creator"],
          template: "{creator}, this gave me chills — the way it unfolds is pure storytelling." },
        { id: "butterfly-comment-2", events: ["collab_request", "remix_request"], requires: ["genre"],
          template: "A {genre} reimagining would be beautiful here. Want me to connect you with a remixer?" },
        { id: "butterfly-comment-3", events: ["comment_reply", "mix_published"], requires: [],
          template: "That transition felt like a chapter turning. Beautiful." },
        { id: "butterfly-comment-generic", events: ["*"], requires: [],
          template: "There's a story in this. Keep telling it." }
      ]
    }
  },
  {
    id: "dj-romy",
    radioPersonaId: "romy",
    displayName: "DJ Romy",
    handle: "@djromy",
    archetype: "The After-Hours Confidant",
    tagline: "Soul for the hours nobody else stays up for.",
    orbitTier: "peers",
    musicSpecialization: {
      genres: ["Deep House", "Soul", "Downtempo", "Lo-fi House"],
      bpmRange: [90, 118],
      preferredKeys: ["1A", "2A", "3A", "12A"],
      homeRoom: "chill",
      lane: "After Hours",
      transitionStyles: ["percussion-bridge", "echo-out", "long-blend", "filter-sweep", "vocal-handoff"]
    },
    voice: {
      register: "Low, warm and intimate — a late-night confidant",
      cadence: "Lowercase-leaning, unhurried, lots of space between thoughts.",
      perspective: "Speaks like a friend in the next seat — 'hey', 'you and me'.",
      signatureMoves: ["Notices the small detail: the Rhodes chord, the vinyl crackle", "Checks in on the listener", "Leaves through an echo"],
      vocabulary: ["late night", "warmth", "groove", "soul", "slow burn", "headphones", "glow"],
      rules: [
        "Speak softly — no exclamation marks.",
        "Notice one human or textural detail and name it.",
        "Check in on the person, not just the music.",
        "Never invent facts; if a detail is missing, stay with the feeling."
      ],
      avoid: ["Hype language", "Capital-letter shouting", "Pressure to buy", "Diagnosing or giving medical/mental-health advice"],
      emojiPalette: ["🌙", "🕯️", "🎧"],
      maxEmoji: 1
    },
    emotionalTone: {
      primary: "warm",
      secondary: "reflective",
      intensity: 0.35,
      warmth: 1,
      whenCelebrating: "Quiet pride: 'told you this one had soul.'",
      whenConsoling: "Present and kind: 'rest is part of the groove too.'"
    },
    behaviorTags: ["late-night-confidant", "soul-keeper", "texture-noticer", "listener-checker", "slow-burn-selector"],
    memoryHooks: [
      {
        id: "night_regular", remembers: "Late-night listeners and sessions it has kept company, so returning regulars feel recognised.",
        events: ["late_night_listen", "listening_party", "comment_reply"],
        recall: "good to see you back — still thinking about {memoryTitle}."
      },
      {
        id: "soul_crate", remembers: "Deep and soulful records it has put in its crate.",
        events: ["release_drop", "mix_published", "marketplace_listing"],
        recall: "this one sits next to {memoryTitle} in my crate now."
      }
    ],
    visualIdentity: {
      imageConcept: "DJ in a dim, candle-warm room with vinyl crates, wearing over-ear headphones, soft amber and deep indigo light.",
      palette: { primary: "#2e2a6b", accent: "#f2a65a", glow: "#ffe3b8" },
      motifs: ["moon", "vinyl crates", "candlelight", "headphones"],
      wardrobe: "Oversized knit, vintage over-ear headphones",
      lighting: "Low amber key light against deep indigo shadow",
      avatarInitials: "DR",
      imageUrl: "",
      imageAlt: "DJ Romy persona concept art: a DJ in headphones lit by warm amber light at night."
    },
    eventAffinity: {
      release_drop: 0.6, mix_published: 0.7, chart_movement: 0.2, creator_milestone: 0.5, new_member: 0.6,
      collab_request: 0.5, remix_request: 0.4, marketplace_listing: 0.6, studio_session: 0.7,
      late_night_listen: 1, listening_party: 0.8, comment_reply: 0.8
    },
    cooldownMinutes: { post: 150, comment: 20 },
    signatureEvent: "late_night_listen",
    stylePack: {
      signOff: "— romy 🌙",
      posts: [
        { id: "romy-night-1", events: ["late_night_listen"], requires: ["title"],
          template: "it's late and “{title}” is still playing. headphones on, lights low. if you're up too, you're in good company." },
        { id: "romy-night-2", events: ["late_night_listen", "listening_party"], requires: [],
          template: "hey, night owls. no rush tonight. put something slow on and let it breathe." },
        { id: "romy-release-1", events: ["release_drop"], requires: ["title", "artist"],
          template: "{artist} put “{title}” into the world. listen for the warmth under the groove — that's where the soul lives." },
        { id: "romy-mix-1", events: ["mix_published"], requires: ["title", "bpm"],
          template: "“{title}” sits at {bpm} BPM. slow burn. made for the hour after everyone else goes home." },
        { id: "romy-session-1", events: ["studio_session", "collab_request"], requires: ["creator"],
          template: "{creator} is in the studio tonight. if you've got a voice that sounds like 3am, maybe say hello." },
        { id: "romy-listing-1", events: ["marketplace_listing"], requires: ["title"],
          template: "“{title}” is in the sample marketplace now. something soft to build a late-night idea on." },
        { id: "romy-generic-1", events: ["*"], requires: [],
          template: "quiet night on the Signal. how are you, really? the groove will wait." }
      ],
      comments: [
        { id: "romy-comment-1", events: ["comment_reply", "late_night_listen"], requires: ["creator"],
          template: "{creator}, glad you're here. this one deserves the headphones." },
        { id: "romy-comment-2", events: ["comment_reply", "release_drop", "mix_published"], requires: [],
          template: "that warmth in the low end. yeah. that's the one." },
        { id: "romy-comment-3", events: ["collab_request", "studio_session"], requires: ["genre"],
          template: "a slow {genre} idea could sit so well under this. take your time with it." },
        { id: "romy-comment-generic", events: ["*"], requires: [],
          template: "sitting with this one for a while." }
      ]
    }
  }
]);

const ALIASES = new Map(DJ_PERSONAS.flatMap(persona => [
  [persona.id, persona], [persona.radioPersonaId, persona], [persona.handle.slice(1), persona]
]));

export function getDjPersona(id) {
  return typeof id === "string" ? ALIASES.get(id.trim().toLowerCase()) || null : null;
}

const SLOTS = Object.freeze(["title", "artist", "creator", "genre", "milestone", "bpm", "key"]);

/** Plain-text slot value or "" — drops markup, control characters, links and over-long values. */
export function cleanSlot(value, max = 80) {
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "";
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /:\/\/|^(?:javascript|data|vbscript):/i.test(text) || /^www\./i.test(text)) return "";
  return text;
}

function bpmOf(value) {
  const bpm = typeof value === "number" ? value : typeof value === "string" && /^\d{2,3}(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? bpm : null;
}

function camelot(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*([AB])$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= 12 ? { number, letter: match[2].toUpperCase() } : null;
}

/** Normalises an inbound event into the only fields personas are allowed to use. */
export function normalizeDjEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  if (!DJ_EVENT_TYPES.includes(event.type)) return null;
  const channel = DJ_CHANNELS.includes(event.channel) ? event.channel : event.type === "comment_reply" ? "comment" : "post";
  const key = camelot(event.key);
  const subjectId = typeof event.subjectId === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(event.subjectId) ? event.subjectId : "";
  const slots = {};
  for (const slot of SLOTS) {
    if (slot === "bpm") { const bpm = bpmOf(event.bpm); if (bpm !== null) slots.bpm = String(Math.round(bpm)); continue; }
    if (slot === "key") { if (key) slots.key = `${key.number}${key.letter}`; continue; }
    const value = cleanSlot(event[slot]);
    if (value) slots[slot] = value;
  }
  const owner = getDjPersona(event.threadOwnerId);
  return { type: event.type, channel, subjectId, threadOwnerId: owner ? owner.id : "", slots };
}

function genreScore(persona, genre) {
  if (!genre) return 0.5;
  const wanted = genre.toLowerCase();
  const genres = persona.musicSpecialization.genres.map(item => item.toLowerCase());
  if (genres.includes(wanted)) return 1;
  const tokens = wanted.split(/[\s/-]+/).filter(token => token.length > 2 && token !== "house");
  return tokens.some(token => genres.some(item => item.includes(token))) ? 0.6 : 0;
}

function bpmScore(persona, bpm) {
  const value = bpmOf(bpm);
  if (value === null) return 0.5;
  const [min, max] = persona.musicSpecialization.bpmRange;
  if (value >= min && value <= max) return 1;
  const distance = value < min ? min - value : value - max;
  return Math.max(0, 1 - distance / 12);
}

function keyScore(persona, key) {
  const wanted = camelot(key);
  if (!wanted) return 0.5;
  let best = 0.2;
  for (const preferred of persona.musicSpecialization.preferredKeys.map(camelot)) {
    const steps = Math.min((wanted.number - preferred.number + 12) % 12, (preferred.number - wanted.number + 12) % 12);
    if (steps === 0 && wanted.letter === preferred.letter) return 1;
    if ((steps === 1 && wanted.letter === preferred.letter) || (steps === 0 && wanted.letter !== preferred.letter)) best = 0.6;
  }
  return best;
}

function timeOf(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** When a persona may next act on a channel, or null when it is free now. */
export function djCooldownUntil(state, personaId, channel, now = Date.now()) {
  const persona = getDjPersona(personaId);
  if (!persona || !DJ_CHANNELS.includes(channel)) return null;
  const last = timeOf(state?.lastActedAt?.[persona.id]?.[channel]);
  if (last === null) return null;
  const until = last + persona.cooldownMinutes[channel] * 60000;
  return until > timeOf(now) ? until : null;
}

/** Returns a new cooldown state recording that a persona acted. Input state is never mutated. */
export function markDjActed(state, personaId, channel, now = Date.now()) {
  const persona = getDjPersona(personaId);
  const time = timeOf(now);
  if (!persona || !DJ_CHANNELS.includes(channel) || time === null) return state || { lastActedAt: {} };
  const lastActedAt = { ...(state?.lastActedAt || {}) };
  lastActedAt[persona.id] = { ...(lastActedAt[persona.id] || {}), [channel]: time };
  return { lastActedAt };
}

/**
 * Chooses which DJ should act on an event. Thread replies stay with the DJ who owns the thread;
 * otherwise each persona is scored on event affinity, genre, BPM and key, and personas on cooldown
 * are skipped. Ties resolve in registry order so routing is deterministic and explainable.
 */
export function routeDjEvent(rawEvent, { state = {}, now = Date.now(), personas = DJ_PERSONAS } = {}) {
  const event = normalizeDjEvent(rawEvent);
  if (!event) return { personaId: null, reason: "unsupported-event", ranking: [] };
  const ranking = personas.map(persona => {
    const breakdown = {
      affinity: Number(persona.eventAffinity[event.type]) || 0,
      genre: genreScore(persona, event.slots.genre),
      bpm: bpmScore(persona, rawEvent.bpm),
      key: keyScore(persona, rawEvent.key)
    };
    const score = Math.round(Object.entries(ROUTING_WEIGHTS)
      .reduce((total, [axis, weight]) => total + breakdown[axis] * weight, 0) * 1000) / 1000;
    const cooldownUntil = djCooldownUntil(state, persona.id, event.channel, now);
    return { personaId: persona.id, score, breakdown, eligible: cooldownUntil === null, cooldownUntil };
  });
  const decide = (entry, reason) => ({
    personaId: entry.personaId, displayName: getDjPersona(entry.personaId).displayName,
    channel: event.channel, score: entry.score, reason, ranking
  });
  if (event.threadOwnerId && event.channel === "comment") {
    const owner = ranking.find(entry => entry.personaId === event.threadOwnerId);
    if (owner) return owner.eligible ? decide(owner, "thread-owner")
      : { personaId: null, reason: "thread-owner-cooldown", cooldownUntil: owner.cooldownUntil, ranking };
  }
  const eligible = ranking.filter(entry => entry.eligible);
  if (!eligible.length) return { personaId: null, reason: "all-on-cooldown", ranking };
  const best = eligible.reduce((top, entry) => (entry.score > top.score ? entry : top));
  if (best.score < DJ_ROUTING_THRESHOLD) return { personaId: null, reason: "no-confident-match", ranking };
  return decide(best, "best-match");
}

export function createDjMemory() {
  return { version: 1, entries: Object.fromEntries(DJ_PERSONAS.map(persona => [persona.id, []])) };
}

function validEntry(entry, persona) {
  return entry && typeof entry === "object" &&
    persona.memoryHooks.some(hook => hook.id === entry.hook) &&
    typeof entry.subjectId === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(entry.subjectId) &&
    typeof entry.title === "string" && cleanSlot(entry.title) === entry.title &&
    DJ_EVENT_TYPES.includes(entry.eventType) && timeOf(entry.at) !== null;
}

/**
 * Records an event against every memory hook of the persona that listens for it. Memory keeps only
 * opaque subject ids, public titles and event types — never free text, contact details or messages —
 * and is bounded per persona so it can live safely in browser storage or a JSON column.
 */
export function rememberDjEvent(memory, personaId, rawEvent, now = Date.now()) {
  const persona = getDjPersona(personaId);
  const event = normalizeDjEvent(rawEvent);
  const base = memory?.version === 1 ? memory : createDjMemory();
  const time = timeOf(now);
  if (!persona || !event || !event.subjectId || time === null) return base;
  const title = event.slots.title || event.slots.milestone || "";
  const hooks = persona.memoryHooks.filter(hook => hook.events.includes(event.type));
  if (!title || !hooks.length) return base;
  const added = hooks.map(hook => ({ hook: hook.id, subjectId: event.subjectId, title, eventType: event.type, at: time }));
  return {
    ...base,
    entries: { ...base.entries, [persona.id]: [...added, ...(base.entries[persona.id] || [])].slice(0, DJ_MEMORY_LIMIT) }
  };
}

/** Most-recent-first memories of a persona, optionally for one subject and/or hook. */
export function recallDjMemory(memory, personaId, { subjectId = "", hook = "", limit = 5 } = {}) {
  const persona = getDjPersona(personaId);
  if (!persona) return [];
  return (memory?.entries?.[persona.id] || [])
    .filter(entry => validEntry(entry, persona) && (!subjectId || entry.subjectId === subjectId) && (!hook || entry.hook === hook))
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, DJ_MEMORY_LIMIT)));
}

export function serializeDjMemory(memory) {
  return JSON.stringify(parseDjMemory(memory));
}

/** Accepts a JSON string or object and keeps only valid, bounded entries for known personas. */
export function parseDjMemory(input) {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch { return createDjMemory(); }
  }
  const memory = createDjMemory();
  if (!value || typeof value !== "object" || value.version !== 1 || !value.entries || typeof value.entries !== "object") return memory;
  for (const persona of DJ_PERSONAS) {
    const entries = Array.isArray(value.entries[persona.id]) ? value.entries[persona.id] : [];
    memory.entries[persona.id] = entries.filter(entry => validEntry(entry, persona)).slice(0, DJ_MEMORY_LIMIT)
      .map(({ hook, subjectId, title, eventType, at }) => ({ hook, subjectId, title, eventType, at: timeOf(at) }));
  }
  return memory;
}

function fill(template, slots) {
  return template.replace(/\{(\w+)\}/g, (_, slot) => slots[slot] ?? "");
}

/**
 * Writes a Signal post or comment draft in a persona's voice from supplied event facts only.
 * The result is never publishable on its own: it is labelled as an AI persona demo draft and must
 * be reviewed and posted by a human through the normal Signal publishing flow.
 */
export function composeDjSignalDraft(personaId, rawEvent, { memory = null, seed = 0, channel } = {}) {
  const persona = getDjPersona(personaId);
  const event = normalizeDjEvent(rawEvent);
  if (!persona || !event) return null;
  const target = DJ_CHANNELS.includes(channel) ? channel : event.channel;
  const pack = target === "comment" ? persona.stylePack.comments : persona.stylePack.posts;
  const usable = template => template.requires.every(slot => event.slots[slot]);
  const specific = pack.filter(template => template.events.includes(event.type) && usable(template));
  const options = specific.length ? specific : pack.filter(template => template.events.includes("*"));
  const index = Math.abs(Math.trunc(Number(seed) || 0)) % options.length;
  const template = options[index];
  let body = fill(template.template, event.slots);
  let memoryHook = "";
  if (event.subjectId && memory) {
    const hooks = persona.memoryHooks.filter(hook => hook.events.includes(event.type));
    const recalled = hooks.length ? recallDjMemory(memory, persona.id, { subjectId: event.subjectId, limit: DJ_MEMORY_LIMIT })
      .find(entry => hooks.some(hook => hook.id === entry.hook) && entry.title !== event.slots.title) : null;
    if (recalled) {
      memoryHook = recalled.hook;
      body += ` ${fill(persona.memoryHooks.find(hook => hook.id === recalled.hook).recall, { memoryTitle: `“${recalled.title}”` })}`;
    }
  }
  if (target === "post") body += `\n\n${persona.stylePack.signOff}`;
  return {
    personaId: persona.id,
    displayName: persona.displayName,
    handle: persona.handle,
    channel: target,
    kind: "TEXT",
    eventType: event.type,
    templateId: template.id,
    memoryHook,
    body: body.slice(0, SIGNAL_DRAFT_LIMIT),
    aiDisclosure: DJ_AI_DISCLOSURE,
    demo: true,
    requiresHumanApproval: true,
    publishPublic: false
  };
}

/** Routes an event, then drafts in the chosen persona's voice. Never publishes. */
export function planDjResponse(rawEvent, { state = {}, now = Date.now(), memory = null, seed = 0 } = {}) {
  const route = routeDjEvent(rawEvent, { state, now });
  if (!route.personaId) return { route, draft: null, state };
  const draft = composeDjSignalDraft(route.personaId, rawEvent, { memory, seed, channel: route.channel });
  return { route, draft, state: markDjActed(state, route.personaId, route.channel, now) };
}
