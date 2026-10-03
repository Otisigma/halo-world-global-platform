// Shared HALO Creator Network seed data contract.
// Seeded profiles are HALO house residents so discovery and the Signal Feed are populated
// before any member opts in. They carry no member identity, email, or private split data.

export const ORBIT_TIERS = Object.freeze([
  Object.freeze({ id: "core", label: "Core Studio Vault", ring: 0, summary: "Private masters, stems, and the owner studio." }),
  Object.freeze({ id: "inner", label: "Inner Crew", ring: 1, summary: "Direct split partners on active work." }),
  Object.freeze({ id: "peers", label: "Network Peers", ring: 2, summary: "Collaborators and brief applicants." }),
  Object.freeze({ id: "public", label: "Public Signal", ring: 3, summary: "Listeners, fans, and opt-in public profiles." })
]);

export const ORBIT_TIER_IDS = Object.freeze(ORBIT_TIERS.map(tier => tier.id));

const creator = profile => Object.freeze({
  ...profile,
  roles: Object.freeze([...profile.roles]),
  genres: Object.freeze([...profile.genres]),
  languages: Object.freeze([...profile.languages]),
  verified: true,
  seed: true
});

export const SEEDED_CREATORS = Object.freeze([
  creator({
    id: "dj-halo",
    handle: "djhalo",
    displayName: "DJ Halo",
    verification: "HALO resident",
    orbitTier: "core",
    bio: "Peak-hour resident. Reads the room and changes mode mid-set; owns the HALO studio vault.",
    roles: ["DJ", "Producer"],
    genres: ["House", "Afro House", "Techno"],
    languages: ["English", "Swahili"],
    bpmMin: 124,
    bpmMax: 140,
    lane: "Peak Hour",
    homeRoute: "/halo-x.html"
  }),
  creator({
    id: "dj-butterfly",
    handle: "djbutterfly",
    displayName: "DJ Butterfly",
    verification: "HALO resident",
    orbitTier: "inner",
    bio: "Sunset Terrace resident. Long melodic blends across vocals; protects harmony on every handoff.",
    roles: ["DJ", "Vocal curator"],
    genres: ["Melodic House", "Soul", "Lounge"],
    languages: ["English"],
    bpmMin: 118,
    bpmMax: 123,
    lane: "Sunset Terrace",
    homeRoute: "/radio/"
  }),
  creator({
    id: "dj-romy",
    handle: "djromy",
    displayName: "DJ Romy",
    verification: "HALO resident",
    orbitTier: "peers",
    bio: "After Hours resident. Percussion tension, deep low end, and exits through an echo.",
    roles: ["DJ", "Percussion"],
    genres: ["Downtempo", "Afro Tech", "Deep House"],
    languages: ["English", "French"],
    bpmMin: 90,
    bpmMax: 118,
    lane: "After Hours",
    homeRoute: "/radio/"
  })
]);

export const SEEDED_SIGNAL_POSTS = Object.freeze([
  Object.freeze({
    id: "seed-halo-001",
    authorId: "dj-halo",
    kind: "signal",
    minutesAgo: 18,
    body: "Peak-hour test pressing is in the vault. @djbutterfly the vocal handoff at the second drop is yours — tell me where it breathes.",
    durationSec: 212,
    reactions: Object.freeze({ fire: 42, love: 17, replay: 9 }),
    comments: Object.freeze([
      Object.freeze({ authorId: "dj-butterfly", body: "Hold the pad four more bars before the vocal lands.", atSec: 96 })
    ])
  }),
  Object.freeze({
    id: "seed-butterfly-001",
    authorId: "dj-butterfly",
    kind: "signal",
    minutesAgo: 64,
    body: "Sunset Terrace blend notes: 121 BPM, A minor into C major. Long fades only tonight.",
    durationSec: 184,
    reactions: Object.freeze({ fire: 23, love: 31, replay: 12 }),
    comments: Object.freeze([])
  }),
  Object.freeze({
    id: "seed-romy-001",
    authorId: "dj-romy",
    kind: "studio",
    minutesAgo: 140,
    body: "Studio task: percussion stems for the after-hours edit need a 24-bit re-export. @djhalo can you run Studio Guardian before council review?",
    durationSec: 248,
    reactions: Object.freeze({ fire: 11, love: 6, replay: 4 }),
    comments: Object.freeze([
      Object.freeze({ authorId: "dj-halo", body: "On it — 50/50 split verified, stems next.", atSec: null })
    ])
  })
]);

export function findSeededCreator(idOrHandle) {
  const key = String(idOrHandle || "").replace(/^@/, "").toLowerCase();
  return SEEDED_CREATORS.find(item => item.id === key || item.handle === key) || null;
}

export function filterSeededCreators(filters = {}) {
  const has = (list, value) => !value || list.some(item => item.toLowerCase().includes(String(value).trim().toLowerCase()));
  const bpm = Number(filters.bpm);
  return SEEDED_CREATORS.filter(item =>
    has(item.roles, filters.role) && has(item.genres, filters.genre) && has(item.languages, filters.language) &&
    (!filters.bpm || !Number.isFinite(bpm) || (bpm >= item.bpmMin && bpm <= item.bpmMax)));
}
