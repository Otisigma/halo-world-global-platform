(() => {
  const gateways = [
    { id: "dance", label: "Electronic & Deep House", description: "Electronic, dance, house, deep house, Afro house and techno." },
    { id: "global", label: "Afrobeats & Global Sounds", description: "Afrobeats, amapiano and global rhythm traditions." },
    { id: "ambient", label: "Ambient & Experimental", description: "Ambient, instrumental, experimental and cinematic sound." },
    { id: "rock-alternative", label: "Rock & Alternative", description: "Rock, alternative, indie, punk and live-band releases." }
  ];
  const chartRooms = {
    all: [],
    dance: ["electronic", "dance", "house", "deep house", "afro house", "afro-house", "techno", "garage", "club"],
    global: ["afrobeat", "afrobeats", "amapiano", "global", "reggae", "dancehall", "latin", "world"],
    ambient: ["ambient", "experimental", "instrumental", "cinematic", "score", "soundtrack", "soundscape", "drone", "new age"],
    "rock-alternative": ["rock", "alternative", "indie", "punk", "metal", "live band"],
    "hip-hop": ["hip hop", "hip-hop", "rap", "drill", "grime"],
    rnb: ["r&b", "rnb", "soul", "neo soul", "neo-soul"],
    gospel: ["gospel", "christian", "worship", "inspirational", "spiritual"]
  };
  const secondary = [
    { id: "hip-hop", label: "Hip-Hop / Rap" },
    { id: "rnb", label: "R&B / Soul" },
    { id: "gospel", label: "Gospel / Inspirational" }
  ];
  const normalize = value => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9&-]+/g, " ").trim().replace(/\s+/g, " ");
  const releaseGenres = release => {
    const genres = Array.isArray(release?.genres) && release.genres.length
      ? release.genres : typeof release?.catalog?.genre === "string" ? [release.catalog.genre] : [];
    return genres.flatMap(value => typeof value === "string" ? value.split(",") : []).map(value => value.trim()).filter(Boolean);
  };
  const matches = (release, id) => {
    const aliases = chartRooms[id];
    if (!aliases) return false;
    if (!aliases.length) return true;
    const genres = releaseGenres(release).map(normalize);
    return aliases.some(alias => {
      const needle = normalize(alias);
      return genres.some(genre => genre === needle || genre.includes(needle));
    });
  };
  const filterReleases = (releases, id, query = "") => {
    const needle = String(query || "").trim().toLowerCase();
    return releases.filter(release => matches(release, id)
      && [release.title, release.artist, release.pitch, ...releaseGenres(release)].join(" ").toLowerCase().includes(needle));
  };
  const syncPlaybackControls = (container, playingId, playing) => {
    container.querySelectorAll("[data-discovery-play]").forEach(button => {
      const active = button.dataset.discoveryPlay === playingId && playing;
      button.textContent = active ? "❚❚ Pause" : "▶ Play";
      button.setAttribute("aria-pressed", String(active));
    });
  };
  window.HaloGenreRooms = Object.freeze({ gateways: Object.freeze(gateways), chartRooms: Object.freeze(chartRooms),
    secondary: Object.freeze(secondary), normalize, releaseGenres, matches, filterReleases, syncPlaybackControls });
})();
