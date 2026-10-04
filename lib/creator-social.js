const STORAGE_KEY = "halo.creator-social.v1";
const SPARKS = ["follow", "draft", "save"];
const DEFAULT_IDENTITY = Object.freeze({ displayName: "Your studio", handle: "local-creator", intro: "" });

function plainText(value, limit) {
  if (typeof value !== "string") return "";
  let text = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<") insideTag = true;
    else if (character === ">") insideTag = false;
    else if (!insideTag) text += character;
  }
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, limit);
}

export function sanitizeSocialIdentity(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const handle = plainText(input.handle, 128).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return {
    displayName: plainText(input.displayName, 60) || DEFAULT_IDENTITY.displayName,
    handle: handle || DEFAULT_IDENTITY.handle,
    intro: plainText(input.intro, 280)
  };
}

export function createSocialStore(storage) {
  let identity = { ...DEFAULT_IDENTITY };
  let sparks = [];
  let status = "Text settings and studio sparks stay in this browser only.";
  let available = Boolean(storage);
  function read() {
    if (!available) {
      status = "Browser storage unavailable. Text settings and sparks last only this session.";
      return;
    }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw && raw.length > 4096) throw new Error("Oversized settings");
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && (typeof saved !== "object" || Array.isArray(saved) || saved.version !== 1)) throw new Error("Invalid settings");
      identity = sanitizeSocialIdentity(saved?.identity);
      sparks = SPARKS.filter(action => Array.isArray(saved?.sparks) && saved.sparks.includes(action));
      status = "Text settings and studio sparks stay in this browser only.";
    } catch {
      status = "Saved settings could not be read. Using session-only settings.";
      available = false;
    }
  }
  read();
  const snapshot = () => ({ identity: { ...identity }, sparks: [...sparks], status, persistent: available });
  function persist() {
    if (!available) return snapshot();
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, identity, sparks }));
    } catch {
      available = false;
      status = "Browser storage unavailable or full. Changes last only this session.";
    }
    return snapshot();
  }
  return {
    get: snapshot,
    save(value) { identity = sanitizeSocialIdentity(value); return persist(); },
    recordSpark(action) {
      if (!SPARKS.includes(action) || sparks.includes(action)) return false;
      sparks.push(action); persist(); return true;
    },
    resetSparks() { sparks = []; return persist(); },
    reset() {
      identity = { ...DEFAULT_IDENTITY }; sparks = [];
      if (storage) {
        try {
          storage.removeItem(STORAGE_KEY);
          available = true;
          status = "Text settings and studio sparks stay in this browser only.";
        } catch { available = false; status = "Browser storage unavailable. Reset applies to this session only."; }
      }
      return snapshot();
    },
    reload() { read(); return snapshot(); }
  };
}

export function validateIntroMedia(file, kind) {
  const photoTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const videoTypes = ["video/mp4", "video/webm", "video/ogg"];
  const types = kind === "photo" ? photoTypes : kind === "video" ? videoTypes : [];
  const maxBytes = kind === "photo" ? 5 * 1024 * 1024 : 25 * 1024 * 1024;
  if (!file || !types.includes(file.type)) return { valid: false, error: kind === "photo" ? "Choose a JPEG, PNG, WebP or GIF photo." : "Choose an MP4, WebM or Ogg video." };
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
    return { valid: false, error: `Choose a ${kind} under ${kind === "photo" ? 5 : 25} MB (and not empty).` };
  }
  return { valid: true, error: "" };
}

function timestamp(value) {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return NaN;
  if (typeof value === "string" && !value.trim()) return NaN;
  return new Date(value).getTime();
}

export function relativeTime(value, now = Date.now()) {
  const time = timestamp(value);
  const current = timestamp(now);
  if (!Number.isFinite(time) || !Number.isFinite(current)) return "";
  const difference = time - current;
  const seconds = Math.abs(difference) / 1000;
  if (seconds < 60) return difference > 0 ? "in less than a minute" : "less than a minute ago";
  const [unit, divisor] = seconds < 3600 ? ["minute", 60]
    : seconds < 86400 ? ["hour", 3600]
      : seconds < 2592000 ? ["day", 86400]
        : seconds < 31536000 ? ["month", 2592000] : ["year", 31536000];
  const count = Math.floor(seconds / divisor);
  const text = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return difference > 0 ? `in ${text}` : `${text} ago`;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
const localStore = createSocialStore(browserStorage());
const previews = { photo: "", video: "" };
let previewToken = 0;
const documents = new Set();
const initialized = new WeakSet();

function notify() {
  const targets = new Set(documents);
  if (globalThis.document) targets.add(globalThis.document);
  for (const doc of targets) {
    try {
      const EventType = doc.defaultView?.CustomEvent || globalThis.CustomEvent;
      if (typeof doc.dispatchEvent === "function" && typeof EventType === "function") {
        doc.dispatchEvent(new EventType("halo-social-change", { detail: { identity: getLocalIdentity(), sparks: localStore.get().sparks } }));
      }
    } catch { /* Local settings still work in restricted or partial DOM environments. */ }
  }
}

export function getLocalIdentity() {
  return { ...localStore.get().identity, local: true, previewToken };
}

export function recordStudioSpark(action) {
  const changed = localStore.recordSpark(action);
  if (changed) notify();
  return changed;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createSocialAvatar(doc, identity = getLocalIdentity()) {
  const safe = sanitizeSocialIdentity(identity);
  const avatar = element(doc, "span", "halo-social-avatar");
  avatar.setAttribute("aria-hidden", "true");
  const current = getLocalIdentity();
  if (previews.photo && identity?.local === true && identity.previewToken === current.previewToken &&
      safe.handle === current.handle && safe.displayName === current.displayName) {
    const image = element(doc, "img");
    image.src = previews.photo; image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = safe.displayName.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || "").join("").toUpperCase();
  }
  return avatar;
}

export function createAuthorHeader(doc, { displayName, handle, createdAt, label, identity } = {}) {
  const author = {
    displayName: typeof displayName === "string" && displayName.trim() ? displayName.slice(0, 60) : "Creator",
    handle: sanitizeSocialIdentity({ handle }).handle
  };
  const header = element(doc, "header", "halo-social-author");
  const avatarIdentity = identity && author.displayName === identity.displayName && author.handle === identity.handle
    ? identity : author;
  header.append(createSocialAvatar(doc, avatarIdentity));
  const metadata = element(doc, "div", "halo-social-author-text");
  metadata.append(element(doc, "strong", "", author.displayName), element(doc, "span", "halo-social-handle", `@${author.handle}`));
  const relative = relativeTime(createdAt);
  if (relative) {
    const time = element(doc, "time", "halo-social-time", relative);
    time.dateTime = new Date(createdAt).toISOString();
    time.title = new Date(createdAt).toLocaleString();
    metadata.append(time);
  } else metadata.append(element(doc, "span", "halo-social-time", plainText(label, 80) || "Sample showcase"));
  header.append(metadata);
  return header;
}

function clearPreview(kind, view) {
  if (previews[kind]) {
    try { (view?.URL || globalThis.URL).revokeObjectURL(previews[kind]); } catch { /* Already unavailable. */ }
    previews[kind] = "";
  }
  previewToken++;
}

export function initSocialWelcome(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function" || typeof doc.createElement !== "function") return;
  documents.add(doc);
  const view = doc.defaultView || globalThis;
  for (const root of doc.querySelectorAll("[data-halo-social-welcome]")) {
    if (initialized.has(root)) continue;
    initialized.add(root);
    root.classList.add("halo-social-welcome");
    const title = element(doc, "h2", "", "Make a little room for you.");
    const lead = element(doc, "p", "halo-social-lead", "An optional local studio identity — not an account profile. Explore freely with or without it.");
    const identityPreview = element(doc, "div", "halo-social-identity-preview");
    const editor = element(doc, "details", "halo-social-editor");
    editor.append(element(doc, "summary", "", "Personalize this browser · optional"));
    const form = element(doc, "form", "halo-social-form");
    const fields = {};
    for (const [key, text, limit] of [["displayName", "Display name", 60], ["handle", "Local handle", 32], ["intro", "Short introduction", 280]]) {
      const label = element(doc, "label", "halo-social-field", text);
      const input = element(doc, key === "intro" ? "textarea" : "input");
      if (key !== "intro") input.type = "text";
      input.name = key; input.maxLength = limit;
      input.value = getLocalIdentity()[key];
      if (key === "handle") {
        input.pattern = "[A-Za-z0-9_-]+";
        label.append(element(doc, "small", "", "Letters, numbers, underscores and hyphens only."));
      }
      label.append(input); fields[key] = input; form.append(label);
    }
    const submit = element(doc, "button", "halo-social-button", "Save local text"); submit.type = "submit";
    form.append(submit);
    const status = element(doc, "p", "halo-social-status", localStore.get().status);
    let persistenceStatus = localStore.get().status;
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    form.addEventListener("submit", event => {
      event.preventDefault();
      localStore.save(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
      previewToken++; notify();
      status.textContent = localStore.get().status;
    });
    editor.append(form, element(doc, "p", "halo-social-notice", "Photos and intro videos preview only in this tab/session. Nothing is uploaded or saved as media. Clearing local identity also resets sparks; no account is changed."));
    const mediaPreview = element(doc, "div", "halo-social-media-preview");
    let renderedVideoURL = "";
    let currentVideo = null;
    const mediaInputs = {};
    for (const kind of ["photo", "video"]) {
      const label = element(doc, "label", "halo-social-field", kind === "photo" ? "Local photo · up to 5 MB" : "Local intro video · up to 25 MB");
      const input = element(doc, "input"); input.type = "file";
      input.accept = kind === "photo" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/ogg";
      mediaInputs[kind] = input;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const result = validateIntroMedia(file, kind);
        if (!result.valid) { status.textContent = result.error; input.value = ""; return; }
        try {
          const url = (view.URL || globalThis.URL).createObjectURL(file);
          clearPreview(kind, view); previews[kind] = url;
          notify(); status.textContent = "Session-only preview ready. Nothing was uploaded or saved.";
        } catch { status.textContent = "Local media previews are unavailable in this browser."; }
      });
      label.append(input); editor.append(label);
    }
    const clearMedia = element(doc, "button", "halo-social-button halo-social-secondary", "Clear session media");
    clearMedia.type = "button";
    clearMedia.addEventListener("click", () => {
      clearPreview("photo", view); clearPreview("video", view);
      for (const input of Object.values(mediaInputs)) input.value = "";
      notify(); status.textContent = "Session media cleared. Local text is unchanged.";
    });
    const reset = element(doc, "button", "halo-social-button halo-social-secondary", "Clear local identity and sparks");
    reset.type = "button";
    reset.addEventListener("click", () => {
      clearPreview("photo", view); clearPreview("video", view); localStore.reset();
      for (const input of Object.values(mediaInputs)) input.value = "";
      notify(); status.textContent = localStore.get().status;
    });
    editor.append(clearMedia, reset);
    const milestones = element(doc, "details", "halo-social-sparks");
    const sparkSummary = element(doc, "summary");
    const sparkList = element(doc, "ul");
    const resetSparks = element(doc, "button", "halo-social-button halo-social-secondary", "Reset studio sparks");
    resetSparks.type = "button";
    resetSparks.addEventListener("click", () => { localStore.resetSparks(); notify(); });
    milestones.append(sparkSummary, element(doc, "p", "", "Optional browser milestones, not a streak. They never unlock Orbits, access or payment."), sparkList, resetSparks);
    function render() {
      const identity = getLocalIdentity();
      const snapshot = localStore.get();
      if (snapshot.status !== persistenceStatus) {
        persistenceStatus = snapshot.status;
        status.textContent = snapshot.status;
      }
      identityPreview.replaceChildren(createAuthorHeader(doc, { ...identity, label: "Local studio · this browser only", identity }));
      if (identity.intro) identityPreview.append(element(doc, "p", "halo-social-intro", identity.intro));
      for (const [key, input] of Object.entries(fields)) {
        if (doc.activeElement !== input) input.value = identity[key];
      }
      if (previews.video !== renderedVideoURL) {
        if (currentVideo) {
          try {
            currentVideo.pause?.();
            currentVideo.removeAttribute?.("src");
            currentVideo.load?.();
          } catch { /* Playback may already have ended or been detached. */ }
        }
        mediaPreview.replaceChildren();
        currentVideo = null;
        renderedVideoURL = previews.video;
        if (previews.video) {
          currentVideo = element(doc, "video");
          currentVideo.src = previews.video; currentVideo.controls = true; currentVideo.preload = "metadata"; currentVideo.playsInline = true;
          currentVideo.setAttribute("aria-label", "Your session-only introduction video");
          mediaPreview.append(currentVideo);
        }
      }
      sparkSummary.textContent = `${snapshot.sparks.length}/3 studio sparks · optional`;
      sparkList.replaceChildren(...SPARKS.map(action => element(doc, "li", snapshot.sparks.includes(action) ? "is-complete" : "", `${snapshot.sparks.includes(action) ? "✓" : "○"} ${ { follow: "Follow a creator locally", draft: "Start a local draft", save: "Save an idea" }[action] }`)));
    }
    root.replaceChildren(title, lead, identityPreview, editor, mediaPreview, milestones, status);
    doc.addEventListener?.("halo-social-change", render);
    render();
  }
  if (!initialized.has(doc)) {
    initialized.add(doc);
    view.addEventListener?.("pagehide", () => {
      clearPreview("photo", view); clearPreview("video", view); notify();
    });
    view.addEventListener?.("storage", event => {
      if (event.key === STORAGE_KEY || event.key === null) {
        localStore.reload(); previewToken++; notify();
      }
    });
  }
}

if (globalThis.document && typeof globalThis.document.querySelectorAll === "function") {
  if (globalThis.document.readyState === "loading") globalThis.document.addEventListener?.("DOMContentLoaded", () => initSocialWelcome(globalThis.document), { once: true });
  else initSocialWelcome(globalThis.document);
}
