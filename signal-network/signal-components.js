import { createObjectUrlAttachment, validateSignalMedia, signalMediaKind, SIGNAL_MEDIA_TYPES } from "../lib/signal-media.js";
import { suggestSignal, DREAMWEAVER_DISCLOSURE } from "../lib/signal-dreamweaver.js";

export const SIGNAL_VISIBILITY = Object.freeze({
  PUBLIC: "Public Frequency", INNER_CIRCLE: "Inner Circle", COLLABORATOR_VAULT: "Collaborator Vault"
});
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function link(text, url) {
  const element = node("a", text);
  element.href = url; element.target = "_blank"; element.rel = "noopener noreferrer";
  return element;
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const host = url.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : "";
  } catch {
    return "";
  }
}

export function createMediaCard({ url, type, name }, { preview = false } = {}) {
  const element = node("div", null, "signal-feed__media");
  const player = node(signalMediaKind(type) === "VIDEO" ? "video" : "audio");
  player.controls = true; player.preload = preview ? "metadata" : "none";
  if (player.tagName === "VIDEO") player.playsInline = true;
  player.setAttribute("aria-label", `${name} ${type.startsWith("video/") ? "video" : "audio"} player`);
  player.src = url;
  player.append(node("p", "Your browser cannot play this media. Use the media link below."));
  const fallback = node("p", "Playback unavailable. Try another browser or open the media file.", "signal-feed__media-error");
  fallback.hidden = true; fallback.setAttribute("role", "status");
  player.addEventListener("error", () => { fallback.hidden = false; });
  element.append(node("h3", name), player, fallback, link("Open media file ↗", url));
  return { element, player };
}

export function createFeedCard(post, { preview = false } = {}) {
  const element = node("article", null, "signal-feed__post");
  const heading = node("header");
  const author = node("strong"), kind = node("span"), visibility = node("small");
  const time = node("time");
  heading.append(author, kind, visibility, time);
  const body = node("p", null, "signal-feed__body");
  const media = node("div");
  element.append(heading, body, media);
  let mediaKey = "", player = null;
  function update(next) {
    author.textContent = next.authorName || "Your signal";
    kind.textContent = next.kind;
    visibility.textContent = SIGNAL_VISIBILITY[next.visibility] || SIGNAL_VISIBILITY.PUBLIC;
    time.hidden = preview;
    if (!preview) {
      time.dateTime = next.createdAt;
      time.textContent = new Date(next.createdAt).toLocaleString();
    }
    body.textContent = next.body || "Your caption appears here.";
    const key = JSON.stringify([next.attachment, next.media, next.linkUrl, next.kind]);
    if (key === mediaKey) return;
    mediaKey = key;
    if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
    player = null; media.replaceChildren();
    if (next.attachment) {
      const card = createMediaCard(next.attachment, { preview });
      player = card.player; media.append(card.element);
    } else if (next.kind === "AUDIO") {
      if (next.media?.audioUrl) {
        const card = createMediaCard({ url: next.media.audioUrl, type: "audio/mpeg", name: `${next.media.title} — ${next.media.artist}` }, { preview });
        player = card.player;
        const details = [
          next.media.bpm != null ? `${next.media.bpm} BPM` : "",
          next.media.musicalKey ? `Key: ${next.media.musicalKey}` : "",
          next.media.genres?.length ? next.media.genres.join(" / ") : ""
        ].filter(Boolean);
        if (details.length) media.append(node("p", details.join(" · "), "signal-feed__music-metadata"));
        const wave = node("div", null, "signal-feed__waveform"); wave.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 48; index++) wave.append(node("i"));
        media.append(wave, node("small", "Curated visual waveform — decorative, not analyzed audio."), card.element);
        if (next.media.purchaseUrl) media.append(link("Purchase at the release's existing destination ↗", next.media.purchaseUrl));
      } else media.append(node("p", preview ? "Choose a published release or attach an audio clip." : "This release's public audio is no longer available. No private asset is exposed."));
    }
    if (next.linkUrl) {
      const videoId = next.kind === "VIDEO" && !next.attachment ? youtubeVideoId(next.linkUrl) : "";
      if (videoId) {
        const wrapper = node("div", null, "signal-feed__media");
        const frame = node("iframe", null, "signal-feed__video-embed");
        frame.src = `https://www.youtube.com/embed/${videoId}`;
        frame.title = "YouTube video player";
        frame.loading = "lazy";
        frame.allow = "encrypted-media; picture-in-picture; fullscreen";
        frame.allowFullscreen = true;
        frame.addEventListener("error", () => { frame.hidden = true; });
        // Cross-origin embeds can show playback errors without firing an iframe error event.
        wrapper.append(frame, link("Open public video ↗", next.linkUrl)); media.append(wrapper);
      } else media.append(link(next.kind === "VIDEO" ? "Open public video ↗" : "Open public brief ↗", next.linkUrl));
    }
  }
  update(post);
  return { element, update, get player() { return player; } };
}

export function createVisibilitySelector(form) {
  const select = form.elements.visibility;
  const audience = form.elements.audience;
  const consent = form.elements.publishPublic;
  function update() {
    const isPublic = select.value === "PUBLIC";
    document.getElementById("feedAudienceField").hidden = isPublic;
    document.getElementById("feedConsentText").textContent = isPublic
      ? "I deliberately publish this signal and its links for everyone to see."
      : "I confirm sharing only with myself and the member IDs selected above.";
    document.getElementById("btn-publish-signal").textContent = `Publish to ${SIGNAL_VISIBILITY[select.value]}`;
  }
  select.addEventListener("change", () => { consent.checked = false; update(); });
  audience.addEventListener("input", () => { consent.checked = false; });
  update();
  return {
    update,
    snapshot: () => ({
      visibility: select.value,
      audience: select.value === "PUBLIC" ? [] : [...new Set(audience.value.split(/[\s,]+/).filter(Boolean))],
      publishPublic: select.value === "PUBLIC" && consent.checked,
      confirmAudience: select.value !== "PUBLIC" && consent.checked
    })
  };
}

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Unable to read this clip. Please select it again."));
    reader.readAsDataURL(file);
  });
}

export function createSignalComposer(form, { onTypeChange, suggest = suggestSignal } = {}) {
  const attachment = createObjectUrlAttachment();
  const visibility = createVisibilitySelector(form);
  const input = document.getElementById("feedAttachment");
  const remove = document.getElementById("feedRemoveAttachment");
  const attachmentStatus = document.getElementById("feedAttachmentStatus");
  const aiStatus = document.getElementById("feedDreamweaverStatus");
  const aiResult = document.getElementById("feedDreamweaverResult");
  const apply = document.getElementById("feedApplySuggestion");
  const card = createFeedCard({ kind: "TEXT", body: "", visibility: "PUBLIC" }, { preview: true });
  document.getElementById("feedPreview").append(card.element);
  document.getElementById("feedDreamweaverDisclosure").textContent = DREAMWEAVER_DISCLOSURE;
  input.accept = Object.keys(SIGNAL_MEDIA_TYPES).join(",");
  let revision = 0, fileRevision = 0, pending = false, locked = false, suggestion = null, aiController = null;
  let releases = new Map();
  function snapshot() {
    const fields = form.elements;
    const release = releases.get(fields.releaseId.value);
    const clip = attachment.current;
    return {
      kind: fields.kind.value, body: fields.body.value,
      releaseId: clip ? "" : fields.releaseId.value, linkUrl: clip ? "" : fields.linkUrl.value,
      includePurchase: !clip && fields.kind.value === "AUDIO" && fields.includePurchase.checked,
      ...visibility.snapshot(),
      attachment: clip ? { name: clip.name, type: clip.type, size: clip.size, url: clip.url } : null,
      media: !clip && release ? {
        title: release.title, artist: release.artist, audioUrl: release.audioUrl || "",
        bpm: release.bpm, musicalKey: release.musicalKey, genres: release.genres,
        purchaseUrl: fields.includePurchase.checked ? release.purchaseUrl : ""
      } : null
    };
  }
  function refresh() {
    revision++; aiController?.abort(); suggestion = null; apply.hidden = true;
    aiResult.textContent = ""; aiStatus.textContent = "";
    card.update(snapshot());
    remove.hidden = !attachment.current;
    input.disabled = locked || !["AUDIO", "VIDEO"].includes(form.elements.kind.value);
    onTypeChange?.(Boolean(attachment.current));
  }
  function clearAttachment() {
    fileRevision++; pending = false;
    card.update({ ...snapshot(), attachment: null });
    attachment.clear(); input.value = ""; attachmentStatus.textContent = ""; refresh();
  }
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const version = ++fileRevision; pending = true;
    attachmentStatus.textContent = "Validating clip…";
    try {
      validateSignalMedia(file);
      validateSignalMedia(file, new Uint8Array(await file.arrayBuffer()));
      if (version !== fileRevision || locked) return;
      card.update({ ...snapshot(), attachment: null });
      attachment.set(file);
      form.elements.kind.value = signalMediaKind(file.type);
      form.elements.releaseId.value = ""; form.elements.linkUrl.value = ""; form.elements.includePurchase.checked = false;
      attachmentStatus.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB · ready to publish`;
      refresh();
    } catch (error) {
      if (version === fileRevision) { input.value = ""; attachmentStatus.textContent = error.message; }
    } finally { if (version === fileRevision) pending = false; }
  });
  remove.addEventListener("click", () => { clearAttachment(); input.focus(); });
  form.addEventListener("input", event => { if (event.target !== input) refresh(); });
  form.elements.kind.addEventListener("change", () => {
    if (attachment.current && signalMediaKind(attachment.current.type) !== form.elements.kind.value) clearAttachment();
    else refresh();
  });
  form.elements.releaseId.addEventListener("change", refresh);
  const aiButtons = [...form.querySelectorAll("[data-dreamweaver-action]")];
  for (const control of aiButtons) control.addEventListener("click", async () => {
    const version = revision, draft = snapshot();
    aiController?.abort();
    const controller = new AbortController(); aiController = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    aiStatus.textContent = "Preparing a suggestion…"; aiResult.setAttribute("aria-busy", "true");
    aiButtons.forEach(button => { button.disabled = true; });
    try {
      const result = await Promise.race([
        suggest(control.dataset.dreamweaverAction, draft, { signal: controller.signal }),
        new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Suggestion cancelled or timed out. Please retry.")), { once: true }))
      ]);
      if (version !== revision || controller.signal.aborted) return;
      if (!result || typeof result.summary !== "string" || result.summary.length > 4000
        || (result.text != null && (typeof result.text !== "string" || result.text.length > 1000))
        || (result.tags != null && (!Array.isArray(result.tags) || result.tags.length > 6
          || result.tags.some(tag => typeof tag !== "string" || !/^#[\p{L}\p{N}_]{1,40}$/u.test(tag))))) throw new Error("The suggestion could not be used. Please retry.");
      suggestion = result;
      aiResult.textContent = [result.summary, result.text, result.tags?.join(" ")].filter(Boolean).join("\n\n");
      aiStatus.textContent = "Suggestion ready. Review before applying.";
      apply.hidden = result.text == null && !result.tags?.length;
    } catch (error) { if (version === revision) aiStatus.textContent = error.message; }
    finally {
      clearTimeout(timeout);
      if (aiController === controller) {
        aiButtons.forEach(button => { button.disabled = locked; }); aiResult.setAttribute("aria-busy", "false");
      }
    }
  });
  apply.addEventListener("click", () => {
    if (!suggestion || locked) return;
    const body = form.elements.body;
    const missing = suggestion.tags?.filter(tag => !body.value.includes(tag)) || [];
    const value = suggestion.text ?? [body.value.trim(), missing.join(" ")].filter(Boolean).join("\n\n");
    if (value.length > 1000) { aiStatus.textContent = "The suggestion exceeds 1000 characters. Shorten your caption first."; return; }
    body.value = value; refresh(); body.focus();
  });
  window.addEventListener("pagehide", () => { clearAttachment(); aiController?.abort(); });
  refresh();
  return {
    snapshot, get hasAttachment() { return Boolean(attachment.current); },
    setReleases(items) { releases = new Map(items.map(release => [release.id, release])); card.update(snapshot()); },
    reset() { clearAttachment(); visibility.update(); },
    lock(value) {
      locked = value; revision++; aiController?.abort();
      form.querySelectorAll("input, select, textarea, button").forEach(field => { field.disabled = value; });
      if (!value) refresh();
    },
    async publishData() {
      if (pending) throw new Error("Wait for clip validation to finish.");
      const draft = snapshot(), clip = attachment.current;
      const { media, attachment: preview, ...data } = draft;
      if (!clip) return data;
      return { ...data, attachment: { name: preview.name, type: preview.type, size: preview.size, data: await encodeFile(clip.file) } };
    }
  };
}
