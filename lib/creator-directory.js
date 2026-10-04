export const HALO_CREATOR_SEEDS = Object.freeze([
  {
    display_name: "DJ Halo", artist_slug: "dj-halo",
    bio: "HALO founding artist. Connect through the artist room for releases and collaboration.",
    roles: ["DJ", "Producer"], genres: [], languages: ["English", "Swahili"],
    bpm_min: null, bpm_max: null, verified: true, curated: true
  },
  {
    display_name: "DJ Butterfly", artist_slug: null,
    bio: "A featured HALO creator. Explore the network to discover new creative connections.",
    roles: ["DJ"], genres: [], languages: [],
    bpm_min: null, bpm_max: null, verified: true, curated: true
  },
  {
    display_name: "DJ Romy", artist_slug: null,
    bio: "A featured HALO creator. Bring your next idea into the shared music world.",
    roles: ["DJ"], genres: [], languages: [],
    bpm_min: null, bpm_max: null, verified: true, curated: true
  }
]);

export function curatedCreators(filters = {}) {
  return HALO_CREATOR_SEEDS.filter(creator =>
    ["role", "genre", "language"].every((field, index) => !filters[field] ||
      creator[["roles", "genres", "languages"][index]].some(tag => tag.toLowerCase() === filters[field].toLowerCase())) &&
    (!filters.bpm || (creator.bpm_min !== null && Number(filters.bpm) >= creator.bpm_min && Number(filters.bpm) <= creator.bpm_max))
  );
}

export function withCuratedCreators(creators, filters = {}) {
  const names = new Set(creators.map(creator => creator.display_name.toLowerCase()));
  return [...creators, ...curatedCreators(filters).filter(creator => !names.has(creator.display_name.toLowerCase()))];
}
