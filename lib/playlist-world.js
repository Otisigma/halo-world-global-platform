import { parseMixPrompt, seededUnit } from "./mix-intent.js";

export const WORLD_PALETTES = Object.freeze({
  sunrise: ["#261442", "#ff9862", "#fff2cd"],
  midnight: ["#08162e", "#64cfff", "#e4f6ff"],
  garden: ["#10271e", "#b4e878", "#f3ffe9"],
  electric: ["#28102e", "#fa68da", "#f2ff62"]
});
export const WORLD_DEFAULTS = Object.freeze({
  version: 1, palette: "sunrise", dedication: "", request: "", chapters: [],
  preferences: { discovery: 50, content: "all", transitions: "original", normalize: false, fadeSeconds: 6 }
});

function artworkUrl(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 1200 || value !== value.trim()
    || /[\u0000-\u0020\u007f]/.test(value)) throw new Error("Enter a valid public HTTPS artwork URL.");
  if (/^\/assets\/[a-z0-9._/-]+$/i.test(value) && !value.includes("..")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password
      && !/(^|\.)(localhost|drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)$/i.test(url.hostname)) return url.href;
  } catch {
    // Invalid URLs are reported below.
  }
  throw new Error("Enter a valid public HTTPS artwork URL or a HALO assets path.");
}

export function playlistWorld(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid playlist world.");
  if ((input.version !== undefined && input.version !== 1)
    || Object.keys(input).some(key => !["version", "palette", "artworkUrl", "dedication", "request", "chapters", "preferences"].includes(key))) {
    throw new Error("Unsupported playlist world format.");
  }
  if (input.preferences !== undefined && (!input.preferences || typeof input.preferences !== "object"
    || Array.isArray(input.preferences) || Object.keys(input.preferences).some(key =>
      !["discovery", "content", "transitions", "normalize", "fadeSeconds"].includes(key)))) throw new Error("Invalid listening preferences.");
  const text = (value, max) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error(`Use plain text of up to ${max} characters.`);
    }
    return value.trim();
  };
  const palette = input.palette ?? "sunrise";
  if (!Object.hasOwn(WORLD_PALETTES, palette)) throw new Error("Choose a HALO world palette.");
  const preferences = { ...WORLD_DEFAULTS.preferences, ...input.preferences };
  if (!Number.isInteger(preferences.discovery) || preferences.discovery < 0 || preferences.discovery > 100
    || !["all", "exclude-explicit", "clean-only"].includes(preferences.content)
    || !["original", "smooth", "tempo"].includes(preferences.transitions)
    || typeof preferences.normalize !== "boolean" || !Number.isInteger(preferences.fadeSeconds)
    || preferences.fadeSeconds < 2 || preferences.fadeSeconds > 10) throw new Error("Invalid listening preferences.");
  const chapters = input.chapters ?? [];
  if (!Array.isArray(chapters) || chapters.length > 12
    || new Set(chapters.map(chapter => chapter?.releaseId)).size !== chapters.length) throw new Error("Choose up to 12 different chapter starts.");
  return {
    version: 1, palette, artworkUrl: artworkUrl(input.artworkUrl), dedication: text(input.dedication, 500), request: text(input.request, 500),
    chapters: chapters.map(chapter => {
      if (!chapter || Object.keys(chapter).some(key => !["releaseId", "label", "energy"].includes(key))
        || typeof chapter.releaseId !== "string" || !/^[a-z0-9_-]{1,120}$/i.test(chapter.releaseId)
        || !Number.isInteger(chapter.energy) || chapter.energy < 1 || chapter.energy > 4) throw new Error("Invalid chapter start or target energy.");
      return { releaseId: chapter.releaseId, label: text(chapter.label, 80), energy: chapter.energy };
    }),
    preferences: {
      discovery: preferences.discovery, content: preferences.content,
      transitions: preferences.transitions, normalize: preferences.normalize, fadeSeconds: preferences.fadeSeconds
    }
  };
}

export function contentAllowed(release, policy) {
  const rating = release.contentRating || "unspecified";
  if (policy === "clean-only") return rating === "clean";
  if (policy === "exclude-explicit") return rating !== "explicit";
  return true;
}

export function buildPlaylistJourney({ releases, currentIds = [], prompt, preferences = WORLD_DEFAULTS.preferences, seed = "halo" }) {
  const parsed = parseMixPrompt(prompt);
  const eligible = releases.filter(release => release.isLiveVisible !== false
    && ["passed", "published"].includes(String(release.status || "").toLowerCase())
    && contentAllowed(release, preferences.content));
  const scored = eligible.map(release => {
    const tags = [...(release.genres || []), ...(release.tags || [])].join(" ").toLowerCase();
    const matches = [...parsed.intent.genres, ...parsed.intent.moods].filter(word => tags.includes(word));
    const bpm = Number(release.bpm);
    const tempoMatch = parsed.intent.bpmRange && bpm >= parsed.intent.bpmRange.min && bpm <= parsed.intent.bpmRange.max;
    const familiar = currentIds.includes(release.id);
    const avoid = parsed.intent.avoidTerms.some(term => `${tags} ${release.title} ${release.artist}`.toLowerCase().includes(term));
    const preference = (familiar ? 100 - preferences.discovery : preferences.discovery) / 25;
    return { release, avoid, score: matches.length * 5 + (tempoMatch ? 3 : 0) + preference + seededUnit(seed, release.id),
      explanation: [
        matches.length ? `Catalog tags match: ${matches.join(", ")}.` : "Variety choice; no matching mood/genre tags supplied.",
        tempoMatch ? `Catalog tempo ${bpm} BPM matches your range.` : "",
        familiar ? "Already in your playlist." : "New to this playlist, not inferred from listening history."
      ].filter(Boolean).join(" ") };
  }).filter(item => !item.avoid).sort((a, b) => b.score - a.score || a.release.id.localeCompare(b.release.id)).slice(0, 20);
  const stages = ["Opening", "Build", "Peak", "Landing"];
  const arc = [parsed.intent.arc.opening, parsed.intent.arc.build, parsed.intent.arc.peak, parsed.intent.arc.closing];
  return {
    tracks: scored.map((item, index) => ({ ...item, stage: stages[Math.min(3, Math.floor(index * 4 / scored.length))] })),
    chapters: scored.filter((_, index) => index === 0 || Math.floor(index * 4 / scored.length) !== Math.floor((index - 1) * 4 / scored.length))
      .map((item, index) => ({ releaseId: item.release.id, label: stages[index], energy: arc[index] })),
    notes: [...parsed.notes, "This is local, rule-based catalog matching, not audio analysis or an artist imitation. Chapter energy is your target, not a measured property of the recordings."]
  };
}

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export function playlistCover(playlist) {
  const world = playlistWorld(playlist.world);
  const [background, accent, ink] = WORLD_PALETTES[world.palette];
  const title = String(playlist.name || "My listening world").slice(0, 80);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
    <rect width="900" height="900" fill="${background}"/>
    <circle cx="450" cy="375" r="260" fill="none" stroke="${accent}" stroke-width="70"/>
    <path d="M80 600 Q450 180 820 600" fill="none" stroke="${ink}" stroke-width="12"/>
    <text x="60" y="82" fill="${ink}" font-family="sans-serif" font-size="28">HALO / LISTENING WORLD</text>
    <text x="60" y="735" fill="${ink}" font-family="sans-serif" font-size="34">${escape(title.slice(0, 36))}</text>
    <text x="60" y="785" fill="${ink}" font-family="sans-serif" font-size="30">${escape(title.slice(36))}</text>
    <text x="60" y="844" fill="${accent}" font-family="sans-serif" font-size="22">${playlist.releaseIds.length} songs / Your chosen journey</text>
  </svg>`;
}

export function playlistExport(playlist, releases, format, origin) {
  if (format === "json") return JSON.stringify({
    version: 1, name: playlist.name, world: playlistWorld(playlist.world),
    tracks: releases.map(release => ({ id: release.id, title: release.title, artist: release.artist }))
  }, null, 2);
  if (format === "svg") return playlistCover(playlist);
  const world = playlistWorld(playlist.world);
  const chapters = new Map(world.chapters.map(chapter => [chapter.releaseId, chapter.label]));
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
    <title>${escape(playlist.name)} / HALO</title><style>body{max-width:50rem;margin:3rem auto;padding:1rem;font:18px/1.7 system-ui}li{margin:1rem 0}a{color:#304f73}</style>
    <h1>${escape(playlist.name)}</h1><p>${escape(world.dedication)}</p><ol>${releases.map(release =>
      `<li>${chapters.has(release.id) ? `<h2>${escape(chapters.get(release.id))}</h2>` : ""}
      ${escape(release.title)} &mdash; ${escape(release.artist)}
      <a href="${escape(new URL(`/music/?song=${encodeURIComponent(release.id)}`, origin).href)}">Listen on HALO</a></li>`).join("")}</ol>
    <p>A listening-reference card, not an audio download, recording license, physical prize or ownership transfer.</p></html>`;
}
