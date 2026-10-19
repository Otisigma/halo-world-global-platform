import { getDjPersona } from "./dj-personas.js";
import { cleanDreamweaverMixId } from "./dreamweaver-storefront.js";
import { formatReleaseCaption } from "./signal-dreamweaver.js";

export const RELEASE_KIT_STORAGE_KEY = "halo.dreamweaver.deck-kit.v2";
export const RELEASE_KIT_DISCLOSURE = "Dreamweaver local editorial draft · human review required. No audio, rights approval, mastering approval, or publication is included.";
const line = (value, max = 180) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const xml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

export function cleanCompanionTrack(track) {
  if (!track || track.empty || !line(track.id, 100)) return null;
  return {
    id: line(track.id, 100),
    title: line(track.title) || "Untitled",
    artist: line(track.artist) || "Unknown artist",
    bpm: bounded(track.bpm, 40, 240, 120),
    energy: bounded(track.energy, 1, 10, 5),
    key: line(track.key, 12),
    mood: line(track.sonicWeather, 240),
    playing: track.playing === true
  };
}

export function buildDeckCompanion(snapshot = {}) {
  const decks = ["A", "B"].map(id => ({ deck: id, track: cleanCompanionTrack(snapshot.decks?.[id]) })).filter(item => item.track);
  const mix = bounded(snapshot.crossfader, 0, 100, 50);
  const live = decks.filter(item => item.track.playing);
  const current = live.find(item => item.deck === (mix > 50 ? "B" : "A")) || live[0] || decks[0];
  const next = cleanCompanionTrack(snapshot.nextTrack);
  const decision = ["hold", "silence", "mix"].includes(snapshot.recommendation?.decision) ? snapshot.recommendation.decision : "hold";
  const persona = getDjPersona(`dj-${line(snapshot.personaId, 20) || "halo"}`) || getDjPersona("dj-halo");
  return {
    current: current?.track || null,
    deck: current?.deck || "",
    next,
    persona: persona.displayName,
    phase: ["opening", "build", "peak", "release", "close"].includes(snapshot.phase) ? snapshot.phase : "opening",
    curve: line(snapshot.curve, 24) || "journey",
    energyCurve: list(snapshot.energyCurve).slice(0, 16).map(value => bounded(value, 1, 10, 5)),
    nextMove: !current ? "Load a track in the deck to begin."
      : !current.track.playing ? "Deck ready. Start playback when you are ready."
        : decision === "silence" ? "Let the record finish; silence can be the transition."
          : decision === "hold" || !next ? "Hold the current record. Protect its hook and let the phrase breathe."
            : `Prepare ${next.title}; ${line(snapshot.recommendation?.transitionStyle, 60) || "phrase blend"}. Keep the deck in control.`,
    context: line(snapshot.recommendation?.summary, 500) || current?.track.mood || "Waiting for musical context.",
    setArc: list(snapshot.recommendation?.setArc).slice(0, 3).map(step => ({
      title: line(step.title || step.trackId),
      purpose: line(step.purpose, 240)
    }))
  };
}

export function sessionTimestamp(seconds) {
  const total = Math.floor(bounded(seconds, 0, 86400, 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function buildReleaseKit(input = {}) {
  const tracks = list(input.tracks).slice(0, 200).map(entry => {
    const track = cleanCompanionTrack(entry);
    return track && { id: track.id, title: track.title, artist: track.artist, bpm: track.bpm, energy: track.energy, offsetSeconds: bounded(entry.offsetSeconds, 0, 86400, 0) };
  }).filter(Boolean);
  if (!tracks.length) throw new Error("Play a track in the deck before building a release kit.");
  const title = line(input.title, 140) || "HALO live session";
  const artist = line(input.artist) || "HALO DJ";
  const format = input.format === "mix_album" ? "mix_album" : "free_stream";
  const audience = line(input.audience) || "the HALO room";
  const notes = line(input.notes, 600);
  const mood = line(input.mood, 240) || "a patient, groove-led journey";
  const description = `${title} by ${artist}: ${tracks.length} selections shaped into ${mood} for ${audience}.${notes ? ` ${notes}` : ""}`;
  const mixId = cleanDreamweaverMixId(input.mixId);
  const destination = mixId ? `/dreamweaver/?mix=${encodeURIComponent(mixId)}` : "";
  const chapters = [
    { label: "The Hook", copy: `Enter with ${tracks[0].title} by ${tracks[0].artist}.` },
    { label: "Lyric Break", copy: notes || "Protect the hooks and leave space for the records to speak." },
    { label: "Sonic World", copy: `The set follows ${mood}.` },
    { label: "Open Door", copy: destination ? "Preview the linked mix in Dreamweaver." : "Add an approved mix recording before sharing a listening destination." }
  ];
  return {
    version: 2, status: "draft", disclosure: RELEASE_KIT_DISCLOSURE,
    title, artist, format, audience, notes, mood, mixId, destination, tracks, description, chapters,
    tracklist: tracks.map((track, index) => `${String(index + 1).padStart(2, "0")}. ${sessionTimestamp(track.offsetSeconds)} ${track.artist} — ${track.title}`).join("\n"),
    timestampNote: "Session playback offsets, not verified master cue points. Review against the final recording.",
    shareCaption: destination ? formatReleaseCaption(`${title}\n${description}`, { link: destination }) : `${description}\nListening link pending approval.`,
    rollout: {
      teaser: `${title} — a new journey from ${artist}. ${chapters[0].copy}`,
      release: `${description} ${destination ? `Listening preview: ${destination}` : "Listening link pending approval."}`,
      followUp: `Which moment stayed with you in ${title}? Share your favourite selection with ${artist}.`
    },
    reviewChecklist: [
      "Review track order and session offsets against the final audio master.",
      "Confirm audio, artwork, lyric, contributor and promotional permissions for the intended territories.",
      "Complete mastering, credits, pricing and rights review in Mix Flightplan before publishing."
    ]
  };
}

export function parseReleaseKit(raw) {
  if (typeof raw !== "string" || raw.length > 250_000) return null;
  try {
    const value = JSON.parse(raw);
    return value?.version === 2 ? buildReleaseKit(value) : null;
  } catch {
    return null;
  }
}

export function releaseKitSvg(kit, { card = false } = {}) {
  const width = card ? 1200 : 1080;
  const height = card ? 630 : 1080;
  const title = xml(line(kit.title, 46));
  const artist = xml(line(kit.artist, 64));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${title} — ${artist}</title><desc id="desc">Dreamweaver release ${card ? "share card" : "cover"} draft. Review before publishing.</desc>
<rect width="100%" height="100%" fill="#07090e"/><circle cx="${width - 220}" cy="210" r="190" fill="none" stroke="#06b6d4" stroke-width="3"/><circle cx="${width - 220}" cy="210" r="148" fill="none" stroke="#f59e0b"/>
<path d="M70 ${height - 220}H${width - 70}" stroke="#06b6d4"/>
<g fill="#e2e8f0" font-family="sans-serif"><text x="70" y="100" font-size="22" letter-spacing="5">HALO / DREAMWEAVER</text>
<text x="70" y="${height - 305}" font-size="38">${title}</text><text x="70" y="${height - 250}" font-size="26">${artist}</text>
<text x="70" y="${height - 150}" font-size="22">${list(kit.tracks).length} selections · ${kit.format === "mix_album" ? "MIX ALBUM" : "LIVE MIX"}</text>
<text x="70" y="${height - 70}" font-size="18" fill="#94a3b8">EDITORIAL DRAFT / HUMAN REVIEW REQUIRED</text></g></svg>`;
}
