const text = (value, limit = 1200) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const roomUrl = id => `/music-upload/?song=${encodeURIComponent(id)}`;

const MOODS = [
  { id: "focus", pattern: /\bfocus|lock in|study|working|deep house|melodic techno/i, genres: /house|techno|electronic/i, bpm: 122 },
  { id: "soulful", pattern: /soulful|swahili|bilingual|cultur|comfort|sensitive/i, genres: /soul|afro|r&b|vocal/i },
  { id: "energy", pattern: /energy|energize|dance|party|workout|uplift/i, genres: /house|afro|dance/i },
  { id: "cinematic", pattern: /cinematic|night|dark|reflect|calm|relax/i, genres: /cinematic|ambient|electronic/i }
];

export function routeOracleIntent(message) {
  const query = text(message).toLowerCase();
  if (/early access|signal score|countdown|launch|release date|listening party|invitation|exclusive|event|upcoming|drop/.test(query)) return "event";
  if (/album|collector|curat|concierge|favorites|personaliz/.test(query)) return "curator";
  if (/story|lore|behind|inspir|bassline|saxophone|production|liner|lyrics/.test(query)) return "story";
  if (/version|remix|extended/.test(query)) return "versions";
  if (MOODS.some(mood => mood.pattern.test(query)) || /mood|vibe|bpm|recommend|mix/.test(query)) return "mood";
  return "welcome";
}

export function countdownLabel(startsAt, now = Date.now()) {
  const remaining = Date.parse(startsAt) - now;
  if (!Number.isFinite(remaining)) return "Schedule not announced";
  if (remaining <= 0) return "Release is live";
  const minutes = Math.ceil(remaining / 60000);
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h ${minutes % 60}m until release`;
}

export function respondOracle({ message = "", contextTrackId = "", favoriteTrackIds = [] } = {}, releases = [], now = Date.now()) {
  const query = text(message);
  const intent = routeOracleIntent(query);
  const seen = new Set();
  const catalog = (Array.isArray(releases) ? releases : []).filter(release => {
    if (!release || release.status !== "published" || release.isLiveVisible === false || !text(release.id, 100) || seen.has(release.id)) return false;
    seen.add(release.id);
    return true;
  }).map(release => ({
    id: text(release.id, 100), title: text(release.title, 200), artist: text(release.artist, 200),
    genres: Array.isArray(release.genres) ? release.genres.filter(item => typeof item === "string").slice(0, 10) : [],
    bpm: Number.isFinite(Number(release.bpm)) && Number(release.bpm) > 0 ? Number(release.bpm) : null,
    story: text(release.pitch), releaseDate: text(release.releaseDate, 40),
    versions: Array.isArray(release.availableVersions) ? release.availableVersions.slice(0, 20).map(value => text(typeof value === "string" ? value : value?.name, 100)).filter(Boolean) : [],
    actionUrl: roomUrl(text(release.id, 100))
  }));
  const named = catalog.find(track => track.title && query.toLowerCase().includes(track.title.toLowerCase()));
  const track = named || catalog.find(track => track.id === contextTrackId) || catalog[0] || null;
  const quickActions = [
    { label: "Find my focus", query: "I need to lock in and focus" },
    { label: "Behind the track", query: "Tell me the story behind this track" },
    { label: "Curate my album", query: "Curate a collector album from my favorites" },
    { label: "Release invitations", query: "Show upcoming releases and early access" }
  ];
  const result = {
    intent, reply: "", trackDetails: track, recommendations: [], quickActions,
    gateways: [{ label: "Discover the Living Chart", actionUrl: "/music/#chartTitle" }],
    event: null, album: null
  };
  const recommend = tracks => tracks.map(item => ({
    id: item.id, label: item.title, type: [item.artist, item.bpm ? `${item.bpm} BPM` : "", ...item.genres].filter(Boolean).join(" · "),
    actionUrl: item.actionUrl
  }));
  if (intent === "mood" || intent === "curator") {
    const mood = MOODS.find(item => item.pattern.test(query));
    const tempo = query.match(/\b(\d{2,3})\s*bpm\b/i);
    const bpm = tempo ? Number(tempo[1]) : mood?.bpm;
    const favorites = new Set(Array.isArray(favoriteTrackIds) ? favoriteTrackIds.filter(id => typeof id === "string").slice(0, 50) : []);
    const ranked = catalog.map((item, index) => ({
      item, index, score: (favorites.has(item.id) ? 100 : 0)
        + (mood?.genres.test(item.genres.join(" ")) ? 20 : 0)
        + (bpm && item.bpm ? Math.max(0, 15 - Math.abs(bpm - item.bpm)) : 0)
    })).sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.item);
    const selections = ranked.slice(0, intent === "curator" ? 12 : 4);
    result.recommendations = recommend(selections);
    result.reply = intent === "curator"
      ? `Your collector shortlist has ${selections.length} published tracks${favorites.size ? ", with your saved signals first" : ""}. Shape this selection into a personal album concept with Album Concierge.`
      : `Let's set the room for ${mood?.id || "your vibe"}${bpm ? `, centered on ${bpm} BPM` : ""}. These are the closest published catalog matches; tempos and genres are shown where available.`;
    if (intent === "curator") {
      result.album = { trackIds: selections.map(item => item.id), targetSize: 12 };
      const seed = text(`Oracle collector shortlist: ${selections.map(item => `${item.title} — ${item.artist}`).join("; ")}. Shape these selections into a personal collector album concept.`, 1800);
      result.gateways.push({ label: "Build with Album Concierge", actionUrl: `/album-concierge/?purpose=collector&oracleStory=${encodeURIComponent(seed)}#concierge` });
    }
  } else if (intent === "story") {
    result.reply = track
      ? `Behind ${track.title} — ${track.story || "The artist has not published liner notes yet."}\n${track.bpm ? `Tempo: ${track.bpm} BPM. ` : ""}${track.genres.join(" · ")}\nSpecific performer credits and studio techniques are not verified here; explore the release room for artist-provided details.`
      : "Select a published track to explore its artist-provided story.";
  } else if (intent === "versions") {
    result.reply = track?.versions.length ? `Explore the published versions of ${track.title}.` : "No alternate versions are listed yet. Check the release room for updates.";
    result.recommendations = (track?.versions || []).map(version => ({
      label: version, type: "Catalog version", actionUrl: `${track.actionUrl}&version=${encodeURIComponent(version)}`
    }));
  } else if (intent === "event") {
    const upcoming = catalog.filter(item => Date.parse(item.releaseDate) > now).sort((a, b) => Date.parse(a.releaseDate) - Date.parse(b.releaseDate));
    const eventTrack = named || upcoming[0] || track;
    result.event = {
      trackId: eventTrack?.id || "", startsAt: eventTrack?.releaseDate || "",
      countdown: countdownLabel(eventTrack?.releaseDate, now),
      access: "verification-required"
    };
    result.reply = `${eventTrack ? `${eventTrack.title}: ${result.event.countdown}.` : "No release schedule is announced."} Exclusive invitations require host verification. Living Chart Signal Scores describe track momentum, not a fan's access eligibility; the Oracle cannot unlock a private room from a supplied score.`;
    result.recommendations = recommend(upcoming.slice(0, 4));
    result.gateways.push({ label: "Meet the event host", actionUrl: "/live-party/" });
    if (eventTrack) result.gateways.push({
      label: "Have an invitation? Verify your private preview",
      actionUrl: `/release-kit.html?slug=${encodeURIComponent(eventTrack.id)}&audience=preview`
    });
  } else {
    result.reply = `Welcome to HALO ORACLE${track ? `, tuned to ${track.title} by ${track.artist}` : ""}. Tell me how you feel, explore a track's story, curate a collector album, or discover a release invitation.`;
  }
  if (track) result.gateways.push({ label: `Enter ${track.title} release room`, actionUrl: track.actionUrl });
  if (!catalog.length && ["mood", "curator"].includes(intent)) result.reply = "The published catalog has no selections available yet. Discover the Living Chart or return when a release is published.";
  return result;
}
