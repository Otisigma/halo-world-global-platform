// Signal Feed data contract and pure helpers shared by /signal/ and contract tests.
import { SEEDED_CREATORS, SEEDED_SIGNAL_POSTS, findSeededCreator } from "./halo-creator-seed.js";

export const SIGNAL_POST_KINDS = Object.freeze(["signal", "studio"]);
export const SIGNAL_REACTIONS = Object.freeze([
  Object.freeze({ id: "fire", label: "Fire", glyph: "🔥" }),
  Object.freeze({ id: "love", label: "Love", glyph: "♥" }),
  Object.freeze({ id: "replay", label: "Replay", glyph: "↻" })
]);
export const SIGNAL_LIMITS = Object.freeze({ body: 500, comment: 280, localPosts: 50, commentsPerPost: 100 });
export const SIGNAL_STORAGE_KEY = "halo.signal.feed.v1";

const clean = (value, max) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function splitMentions(text = "") {
  const parts = [];
  const pattern = /@([a-z0-9_]{2,30})/gi;
  let last = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    const creator = findSeededCreator(match[1]);
    parts.push({ type: "mention", value: match[0], handle: match[1].toLowerCase(), creatorId: creator?.id || null });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

export function waveformBars(seed = "", count = 48) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const bars = [];
  for (let index = 0; index < count; index++) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    const envelope = Math.sin(Math.PI * (index + 0.5) / count) * 0.55 + 0.35;
    bars.push(Math.round(Math.min(1, Math.max(0.12, envelope * (0.55 + (hash % 1000) / 2200))) * 100) / 100);
  }
  return bars;
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function createLocalPost({ body, kind = "signal", track = null } = {}, { now = Date.now(), id } = {}) {
  const text = clean(body, SIGNAL_LIMITS.body);
  if (!text) throw new Error("Write something before posting to the Signal Feed.");
  return {
    id: id || `local-${now.toString(36)}`,
    authorId: "you",
    kind: SIGNAL_POST_KINDS.includes(kind) ? kind : "signal",
    createdAt: now,
    body: text,
    durationSec: Number(track?.durationSec) > 0 ? Number(track.durationSec) : 0,
    track: track?.src ? { src: String(track.src), title: clean(track.title, 180), artist: clean(track.artist, 180) } : null,
    reactions: { fire: 0, love: 0, replay: 0 },
    comments: []
  };
}

export function createComment({ body, atSec = null } = {}, { now = Date.now() } = {}) {
  const text = clean(body, SIGNAL_LIMITS.comment);
  if (!text) throw new Error("Write a comment first.");
  const stamp = Number(atSec);
  return { authorId: "you", body: text, atSec: atSec !== null && Number.isFinite(stamp) && stamp >= 0 ? Math.floor(stamp) : null, createdAt: now };
}

export function catalogPost(release, src, index = 0, now = Date.now()) {
  const title = clean(release?.title, 180) || "Untitled release";
  const artist = clean(release?.artist, 180) || "HALO artist";
  return {
    id: `catalog-${clean(String(release?.id || release?.slug || title), 80) || index}`,
    authorId: "halo-signal",
    kind: "signal",
    createdAt: now - (index + 1) * 45 * 60_000,
    body: `Now on HALO: ${title} by ${artist}. Tap play for the published preview.`,
    durationSec: Number(release?.durationSec || release?.duration) || 0,
    track: { src, title, artist },
    reactions: { fire: 0, love: 0, replay: 0 },
    comments: []
  };
}

export function seedPosts(now = Date.now()) {
  return SEEDED_SIGNAL_POSTS.map(post => ({
    ...post,
    createdAt: now - post.minutesAgo * 60_000,
    track: null,
    reactions: { ...post.reactions },
    comments: post.comments.map(comment => ({ ...comment }))
  }));
}

export function resolveAuthor(authorId) {
  if (authorId === "you") return { id: "you", displayName: "You", handle: "you", verified: false, orbitTier: "public", verification: "HALO member" };
  if (authorId === "halo-signal") return { id: "halo-signal", displayName: "HALO Signal", handle: "halosignal", verified: true, orbitTier: "public", verification: "HALO catalog" };
  return findSeededCreator(authorId) || { id: authorId, displayName: "HALO creator", handle: "halo", verified: false, orbitTier: "public" };
}

export function sanitizeStoredState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const posts = (Array.isArray(state.posts) ? state.posts : []).slice(0, SIGNAL_LIMITS.localPosts).filter(post =>
    post && typeof post.id === "string" && post.authorId === "you" && typeof post.body === "string").map(post => ({
    ...createLocalPost({ body: post.body, kind: post.kind }, { now: Number(post.createdAt) || Date.now(), id: post.id.slice(0, 80) }),
    track: post.track && typeof post.track.src === "string" && /^(https:\/\/|\/(?!\/))/.test(post.track.src)
      ? { src: post.track.src, title: clean(post.track.title, 180), artist: clean(post.track.artist, 180) } : null
  }));
  const reactions = {};
  for (const [postId, picked] of Object.entries(state.reactions && typeof state.reactions === "object" ? state.reactions : {})) {
    if (!Array.isArray(picked)) continue;
    reactions[postId.slice(0, 80)] = picked.filter(id => SIGNAL_REACTIONS.some(reaction => reaction.id === id));
  }
  const comments = {};
  for (const [postId, list] of Object.entries(state.comments && typeof state.comments === "object" ? state.comments : {})) {
    if (!Array.isArray(list)) continue;
    comments[postId.slice(0, 80)] = list.slice(-SIGNAL_LIMITS.commentsPerPost).flatMap(comment => {
      try { return [createComment(comment, { now: Number(comment?.createdAt) || Date.now() })]; } catch { return []; }
    });
  }
  return { posts, reactions, comments };
}

export function buildFeed({ posts = [], mode = "all", creator = "" } = {}) {
  const handle = String(creator || "").replace(/^@/, "").toLowerCase();
  const author = handle ? findSeededCreator(handle) : null;
  return posts
    .filter(post => mode === "all" || post.kind === mode)
    .filter(post => !author || post.authorId === author.id || splitMentions(post.body).some(part => part.creatorId === author.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export { SEEDED_CREATORS };
