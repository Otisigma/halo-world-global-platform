import {
  SIGNAL_REACTIONS, SIGNAL_LIMITS, SIGNAL_STORAGE_KEY, SEEDED_CREATORS,
  buildFeed, catalogPost, createComment, createLocalPost, formatTime, resolveAuthor,
  sanitizeStoredState, seedPosts, splitMentions, waveformBars
} from "/lib/halo-signal-feed.js";
import { ORBIT_TIERS } from "/lib/halo-creator-seed.js";

const byId = id => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const params = new URLSearchParams(location.search);
const audio = byId("signalAudio");
const store = loadStore();
let mode = "all";
let catalogPosts = [];
let previews = [];
let playingId = null;
const seeds = seedPosts();

function loadStore() {
  try { return sanitizeStoredState(JSON.parse(localStorage.getItem(SIGNAL_STORAGE_KEY) || "{}")); }
  catch { return sanitizeStoredState({}); }
}

function saveStore() {
  try { localStorage.setItem(SIGNAL_STORAGE_KEY, JSON.stringify(store)); }
  catch { status("This browser blocked local saving; your signal stays until you leave the page."); }
}

function status(message) { byId("signalStatus").textContent = message; }

function node(tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content || "";
  if (className) element.className = className;
  return element;
}

function richText(tag, text, className) {
  const element = node(tag, "", className);
  for (const part of splitMentions(text)) {
    if (part.type === "mention" && part.creatorId) {
      const link = node("a", part.value, "mention");
      link.href = `/signal/?creator=${encodeURIComponent(part.handle)}`;
      element.append(link);
    } else if (part.type === "mention") element.append(node("span", part.value, "mention"));
    else element.append(document.createTextNode(part.value));
  }
  return element;
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function tierLabel(id) { return ORBIT_TIERS.find(tier => tier.id === id)?.label || "Public Signal"; }

function allPosts() {
  const merged = [...store.posts, ...catalogPosts, ...seeds];
  return merged.map(post => ({ ...post, comments: [...post.comments, ...(store.comments[post.id] || [])] }));
}

function playable(post) { return Boolean(post.track?.src); }

function togglePlay(post) {
  if (!playable(post)) return;
  if (playingId === post.id && !audio.paused) { audio.pause(); return; }
  if (playingId !== post.id) { audio.src = post.track.src; playingId = post.id; }
  audio.play().catch(() => status("Preview could not start. Try again in a moment."));
}

function seek(post, seconds) {
  if (!playable(post)) return;
  if (playingId !== post.id) { audio.src = post.track.src; playingId = post.id; }
  const jump = () => { audio.currentTime = seconds; audio.play().catch(() => {}); };
  if (audio.readyState >= 1) jump(); else audio.addEventListener("loadedmetadata", jump, { once: true });
}

function waveform(post) {
  const wrap = node("div", "", `waveform${playable(post) ? "" : " waveform--locked"}`);
  wrap.dataset.post = post.id;
  const button = node("button", playable(post) ? "▶" : "◌", "wave-play");
  button.type = "button";
  button.disabled = !playable(post);
  button.setAttribute("aria-label", playable(post) ? `Play preview: ${post.track.title || "signal"}` : "Audio preview stays in the studio vault");
  button.addEventListener("click", () => togglePlay(post));
  const bars = waveformBars(post.id, 56);
  const graphic = document.createElementNS(SVG, "svg");
  graphic.setAttribute("viewBox", `0 0 ${bars.length * 6} 60`);
  graphic.setAttribute("preserveAspectRatio", "none");
  graphic.setAttribute("aria-hidden", "true");
  graphic.classList.add("wave-bars");
  bars.forEach((height, index) => {
    const rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", String(index * 6));
    rect.setAttribute("width", "3.4");
    rect.setAttribute("y", String(30 - height * 28));
    rect.setAttribute("height", String(height * 56));
    rect.setAttribute("rx", "1.5");
    graphic.append(rect);
  });
  graphic.addEventListener("click", event => {
    const box = graphic.getBoundingClientRect();
    const duration = audio.duration && playingId === post.id ? audio.duration : post.durationSec;
    if (duration && box.width) seek(post, ((event.clientX - box.left) / box.width) * duration);
  });
  const meta = node("div", "", "wave-meta");
  meta.append(node("span", playable(post) ? `${post.track.title}${post.track.artist ? ` · ${post.track.artist}` : ""}` : "Vault preview · listen in the studio"),
    node("span", post.durationSec ? formatTime(post.durationSec) : "—", "wave-time"));
  const body = node("div", "", "wave-body");
  body.append(graphic, meta);
  wrap.style.setProperty("--progress", "0%");
  wrap.append(button, body);
  return wrap;
}

function reactionBar(post) {
  const bar = node("div", "", "reaction-bar");
  const picked = new Set(store.reactions[post.id] || []);
  for (const reaction of SIGNAL_REACTIONS) {
    const active = picked.has(reaction.id);
    const count = (post.reactions?.[reaction.id] || 0) + (active ? 1 : 0);
    const button = node("button", `${reaction.glyph} ${count}`, "reaction");
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", `${reaction.label}, ${count}`);
    button.addEventListener("click", () => {
      const next = new Set(store.reactions[post.id] || []);
      next.has(reaction.id) ? next.delete(reaction.id) : next.add(reaction.id);
      store.reactions[post.id] = [...next];
      saveStore();
      render();
    });
    bar.append(button);
  }
  return bar;
}

function commentsBlock(post) {
  const section = node("div", "", "comments");
  const list = node("ul", "", "comment-list");
  for (const comment of post.comments) {
    const author = resolveAuthor(comment.authorId);
    const item = node("li");
    item.append(node("strong", author.displayName));
    if (comment.atSec !== null && comment.atSec !== undefined) {
      const stamp = node("button", `@ ${formatTime(comment.atSec)}`, "stamp");
      stamp.type = "button";
      stamp.disabled = !playable(post);
      stamp.setAttribute("aria-label", `Jump to ${formatTime(comment.atSec)}`);
      stamp.addEventListener("click", () => seek(post, comment.atSec));
      item.append(stamp);
    }
    item.append(richText("span", ` ${comment.body}`));
    list.append(item);
  }
  const form = node("form", "", "comment-form");
  const input = document.createElement("input");
  input.name = "comment";
  input.maxLength = SIGNAL_LIMITS.comment;
  input.placeholder = "Reply, or @mention a creator…";
  input.setAttribute("aria-label", `Comment on ${resolveAuthor(post.authorId).displayName}'s signal`);
  const stampLabel = node("label", "", "stamp-toggle");
  const stampBox = document.createElement("input");
  stampBox.type = "checkbox";
  stampBox.name = "stamp";
  stampBox.disabled = !playable(post);
  stampLabel.append(stampBox, document.createTextNode(" Pin to playhead"));
  const submit = node("button", "Reply");
  submit.type = "submit";
  form.append(input, stampLabel, submit);
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const atSec = stampBox.checked && playingId === post.id ? audio.currentTime : null;
      const comment = createComment({ body: input.value, atSec });
      store.comments[post.id] = [...(store.comments[post.id] || []), comment].slice(-SIGNAL_LIMITS.commentsPerPost);
      saveStore();
      render();
      status(atSec !== null ? `Feedback pinned at ${formatTime(atSec)}.` : "Reply added.");
    } catch (error) { status(error.message); }
  });
  section.append(list, form);
  return section;
}

function postCard(post) {
  const author = resolveAuthor(post.authorId);
  const card = node("article", "", `signal-post signal-post--${post.kind}`);
  card.id = `post-${post.id}`;
  const head = node("header", "", "post-head");
  const avatar = node("span", author.displayName.replace(/^DJ\s+/i, "").charAt(0), `post-avatar post-avatar--${author.orbitTier}`);
  avatar.setAttribute("aria-hidden", "true");
  const who = node("div", "", "post-who");
  const name = node("strong", author.displayName);
  if (author.verified) name.append(node("span", "✓", "verified-tick"));
  who.append(name, node("span", `@${author.handle} · ${tierLabel(author.orbitTier)} · ${relativeTime(post.createdAt)}`));
  head.append(avatar, who, node("span", post.kind === "studio" ? "Studio task" : "Public signal", "post-kind"));
  card.append(head, richText("p", post.body, "post-body"), waveform(post), reactionBar(post), commentsBlock(post));
  return card;
}

function render() {
  const creator = params.get("creator") || "";
  const posts = buildFeed({ posts: allPosts(), mode, creator });
  const feed = byId("feed");
  feed.replaceChildren(...posts.map(postCard));
  if (!posts.length) feed.append(node("p", "No signals in this lane yet. Be the first to post.", "empty-state"));
  const filter = byId("creatorFilter");
  const resident = SEEDED_CREATORS.find(item => item.handle === creator.replace(/^@/, "").toLowerCase());
  filter.hidden = !resident;
  if (resident) {
    const clear = node("a", "Show everyone");
    clear.href = "/signal/";
    filter.replaceChildren(document.createTextNode(`Showing signals from and mentioning ${resident.displayName}. `), clear);
  }
  syncProgress();
}

function syncProgress() {
  document.querySelectorAll(".waveform").forEach(wave => {
    const active = wave.dataset.post === playingId;
    const ratio = active && audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    wave.style.setProperty("--progress", `${ratio}%`);
    wave.classList.toggle("is-playing", active && !audio.paused);
    const button = wave.querySelector(".wave-play");
    if (button && !button.disabled) button.textContent = active && !audio.paused ? "❚❚" : "▶";
  });
}

function renderResidents() {
  byId("residentList").replaceChildren(...SEEDED_CREATORS.map(creator => {
    const item = node("li");
    const link = node("a", "", "resident");
    link.href = `/signal/?creator=${encodeURIComponent(creator.handle)}`;
    link.append(node("span", creator.displayName.replace(/^DJ\s+/i, "").charAt(0), `post-avatar post-avatar--${creator.orbitTier}`),
      node("strong", creator.displayName), node("small", `${creator.lane} · ${tierLabel(creator.orbitTier)}`));
    item.append(link);
    return item;
  }));
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/release-catalog", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Release catalog unavailable");
    const result = await response.json();
    previews = (Array.isArray(result.releases) ? result.releases : []).map(release => {
      const preview = window.HaloReleaseArtwork?.resolveAudio({
        audioUrl: release.audioUrl, audio_url: release.audio_url, previewAudio: release.previewAudio,
        preview_audio: release.preview_audio, streamUrl: release.streamUrl
      }, { preferPreview: true, requirePlayable: true });
      return preview?.src ? { release, src: preview.src } : null;
    }).filter(Boolean).slice(0, 12);
    catalogPosts = previews.slice(0, 3).map(({ release, src }, index) => catalogPost(release, src, index));
    const select = byId("composerTrack");
    select.replaceChildren(node("option", "No audio"));
    select.firstChild.value = "";
    previews.forEach(({ release }, index) => {
      const option = node("option", `${release.title || "Untitled release"} · ${release.artist || "HALO artist"}`);
      option.value = String(index);
      select.append(option);
    });
  } catch {
    catalogPosts = [];
  }
  render();
}

document.querySelectorAll(".signal-mode button").forEach(button => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  document.querySelectorAll(".signal-mode button").forEach(other => other.setAttribute("aria-pressed", String(other === button)));
  render();
}));

const composer = byId("composer");
composer.elements.body.addEventListener("input", () => { byId("composerCount").textContent = `${composer.elements.body.value.length} / ${SIGNAL_LIMITS.body}`; });
composer.addEventListener("submit", event => {
  event.preventDefault();
  try {
    const picked = previews[Number(composer.elements.track.value)];
    const track = composer.elements.track.value !== "" && picked
      ? { src: picked.src, title: picked.release.title, artist: picked.release.artist, durationSec: picked.release.durationSec } : null;
    const post = createLocalPost({ body: composer.elements.body.value, kind: composer.elements.kind.value, track });
    store.posts = [post, ...store.posts].slice(0, SIGNAL_LIMITS.localPosts);
    saveStore();
    composer.reset();
    byId("composerCount").textContent = `0 / ${SIGNAL_LIMITS.body}`;
    if (mode !== "all" && mode !== post.kind) document.querySelector('.signal-mode button[data-mode="all"]').click();
    else render();
    status("Signal posted.");
  } catch (error) { status(error.message); }
});

for (const type of ["timeupdate", "play", "pause", "ended"]) audio.addEventListener(type, syncProgress);

function identityReady(identity) {
  identity?.getUser?.().then(user => {
    byId("composerIdentity").textContent = user ? "Posting as a signed-in HALO member on this device" : "Posting as a HALO guest on this device";
  }).catch(() => {});
}
if (window.haloIdentity) identityReady(window.haloIdentity);
else window.addEventListener("halo-identity-ready", event => identityReady(event.detail || window.haloIdentity), { once: true });

renderResidents();
render();
loadCatalog();
