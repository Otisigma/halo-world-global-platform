/* HALO Welcome Studio — an optional, local-only identity + play layer.
 * Nothing here is uploaded, published, or used for access decisions.
 * Avatar, intro line, vibes, badges and streaks live in this browser only. */
(() => {
  const STORAGE_KEY = "halo.welcomeStudio.v1";
  const PHOTO_PREFIX = "data:image/jpeg;base64,";
  const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const MAX_VIDEO_SECONDS = 60;
  const MAX_INTRO = 140;
  const MAX_VIBES = 3;

  const AURAS = {
    gold: { label: "Signal gold", from: "#f0d59f", to: "#9a6a22" },
    ember: { label: "Ember", from: "#ffb27a", to: "#8f3a17" },
    violet: { label: "Dream violet", from: "#d4b3ff", to: "#5b2a99" },
    cyan: { label: "Relay cyan", from: "#a6f3ff", to: "#1b6e80" },
    rose: { label: "Velvet rose", from: "#ffc2d4", to: "#8c2c4f" },
    jade: { label: "Jade", from: "#b9f5cf", to: "#22704a" }
  };
  const RINGS = { orbit: "Orbit ring", pulse: "Pulse glow", halo: "Double halo" };
  const VIBES = ["Late-night producer", "Hook hunter", "Crate digger", "Visual dreamer", "Live wire",
    "Lyric first", "Sample flipper", "Studio rat", "Dancefloor scientist", "Soft-focus soul"];
  const BADGES = [
    { id: "studio-spark", icon: "✦", name: "Studio Spark", hint: "Save your avatar look" },
    { id: "say-hi", icon: "☺", name: "Say Hi", hint: "Write a welcome line" },
    { id: "vibe-check", icon: "♫", name: "Vibe Check", hint: "Pick your vibes" },
    { id: "picture-day", icon: "◐", name: "Picture Day", hint: "Add a photo" },
    { id: "lights-camera", icon: "▶", name: "Lights, Camera", hint: "Preview an intro video" },
    { id: "orbit-explorer", icon: "◎", name: "Orbit Explorer", hint: "Explore HALO Orbits" },
    { id: "tuned-in", icon: "≋", name: "Tuned In", hint: "Visit The Signal feed" },
    { id: "crossover", icon: "⇄", name: "Crossover", hint: "Visit Creator Network and The Signal" },
    { id: "first-signal", icon: "⚡", name: "First Signal", hint: "Publish a public signal" },
    { id: "three-day-glow", icon: "☀", name: "Three-Day Glow", hint: "Drop by three days in a row" }
  ];
  const LEVELS = [
    { name: "Spark", at: 0 }, { name: "Pulse", at: 2 }, { name: "Glow", at: 4 },
    { name: "Radiant", at: 6 }, { name: "Halo", at: 9 }
  ];

  const root = document.querySelector("[data-halo-welcome]");
  const surface = root?.dataset.haloWelcome === "signal" ? "signal" : "creator";
  let storageAvailable = true;
  let videoUrl = "";
  let toastTimer = 0;

  function defaults() {
    return {
      name: "", aura: "gold", ring: "orbit", intro: "", vibes: [], photo: "",
      collapsed: false, surfaces: {}, badges: {}, visits: { last: "", streak: 0, best: 0 }
    };
  }

  function clean(raw) {
    const state = defaults();
    if (!raw || typeof raw !== "object") return state;
    state.name = typeof raw.name === "string" ? raw.name.slice(0, 40) : "";
    state.aura = Object.hasOwn(AURAS, raw.aura) ? raw.aura : "gold";
    state.ring = Object.hasOwn(RINGS, raw.ring) ? raw.ring : "orbit";
    state.intro = typeof raw.intro === "string" ? raw.intro.slice(0, MAX_INTRO) : "";
    state.vibes = Array.isArray(raw.vibes) ? raw.vibes.filter(vibe => VIBES.includes(vibe)).slice(0, MAX_VIBES) : [];
    state.photo = typeof raw.photo === "string" && raw.photo.startsWith(PHOTO_PREFIX) && raw.photo.length < 400000 ? raw.photo : "";
    state.collapsed = raw.collapsed === true;
    for (const key of ["creator", "signal"]) if (raw.surfaces?.[key] === true) state.surfaces[key] = true;
    for (const badge of BADGES) if (typeof raw.badges?.[badge.id] === "string") state.badges[badge.id] = raw.badges[badge.id];
    const visits = raw.visits || {};
    state.visits = {
      last: typeof visits.last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(visits.last) ? visits.last : "",
      streak: Number.isInteger(visits.streak) && visits.streak > 0 ? Math.min(visits.streak, 3650) : 0,
      best: Number.isInteger(visits.best) && visits.best > 0 ? Math.min(visits.best, 3650) : 0
    };
    return state;
  }

  function load() {
    try { return clean(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null")); }
    catch { storageAvailable = false; return defaults(); }
  }

  let state = load();

  function save() {
    if (!storageAvailable) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { storageAvailable = false; renderNote(); }
  }

  function h(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") element.className = value;
      else if (key === "text") element.textContent = value;
      else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value === true ? "" : String(value));
    }
    element.append(...children.filter(child => child != null));
    return element;
  }

  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "H";
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
    return letters.toUpperCase();
  }

  function today(offset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function level() {
    const count = Object.keys(state.badges).length;
    let index = 0;
    LEVELS.forEach((entry, position) => { if (count >= entry.at) index = position; });
    const current = LEVELS[index], next = LEVELS[index + 1];
    const progress = next ? (count - current.at) / (next.at - current.at) : 1;
    return { count, current, next, progress: Math.max(0, Math.min(1, progress)) };
  }

  /* ── Avatar painting (shared by every [data-halo-avatar] slot) ── */
  function paintAvatar(slot) {
    const aura = AURAS[state.aura];
    slot.classList.add("halo-avatar");
    slot.dataset.ring = state.ring;
    slot.style.setProperty("--halo-aura-from", aura.from);
    slot.style.setProperty("--halo-aura-to", aura.to);
    if (state.photo) {
      const image = h("img", { alt: "" });
      image.src = state.photo;
      slot.replaceChildren(image);
    } else {
      slot.replaceChildren(h("span", { text: initials(state.name) }));
    }
  }

  function paintAllAvatars() {
    document.querySelectorAll("[data-halo-avatar]").forEach(paintAvatar);
  }

  /* ── Gamification ── */
  const toast = h("p", { class: "halo-welcome__toast", role: "status", "aria-live": "polite" });

  function celebrate(message) {
    toast.textContent = message;
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3800);
  }

  function unlock(...ids) {
    const before = level().current.name;
    const earned = ids.map(id => BADGES.find(entry => entry.id === id)).filter(badge => badge && !state.badges[badge.id]);
    if (!earned.length) return false;
    const stamp = new Date().toISOString();
    earned.forEach(badge => { state.badges[badge.id] = stamp; });
    save();
    const after = level().current.name;
    const names = earned.map(badge => `${badge.icon} ${badge.name}`).join(" · ");
    celebrate(`Badge${earned.length > 1 ? "s" : ""} unlocked: ${names}${after !== before ? ` — vibe level up: ${after}!` : ""}`);
    renderProgress();
    return true;
  }

  function trackVisit() {
    const day = today();
    if (state.visits.last !== day) {
      state.visits.streak = state.visits.last === today(-1) ? state.visits.streak + 1 : 1;
      state.visits.best = Math.max(state.visits.best, state.visits.streak);
      state.visits.last = day;
    }
    state.surfaces[surface] = true;
    save();
  }

  function checkVisitBadges() {
    unlock(surface === "signal" && "tuned-in", state.surfaces.creator && state.surfaces.signal && "crossover",
      state.visits.streak >= 3 && "three-day-glow");
  }

  /* ── Panel ── */
  if (!root) {
    paintAllAvatars();
    return;
  }

  const avatarPreview = h("div", { class: "halo-welcome__avatar", "data-halo-avatar": "", "aria-hidden": "true" });
  const greeting = h("h2", { class: "halo-welcome__title", id: `haloWelcomeTitle-${surface}` });
  const introLine = h("p", { class: "halo-welcome__intro" });
  const vibeLine = h("p", { class: "halo-welcome__vibes" });
  const levelName = h("strong");
  const levelMeta = h("small");
  const levelRing = h("div", { class: "halo-welcome__level-ring", role: "img" }, h("span", { text: "0" }));
  const streakValue = h("strong");
  const streakMeta = h("small");
  const badgeList = h("ul", { class: "halo-welcome__badges", "aria-label": "Badges" });
  const storageNote = h("p", { class: "halo-welcome__note" });
  const videoFrame = h("div", { class: "halo-welcome__video", hidden: true });
  const fileStatus = h("p", { class: "halo-welcome__file-status", role: "status", "aria-live": "polite" });

  function renderIdentity() {
    const name = state.name.trim();
    greeting.textContent = name ? `Welcome back, ${name}.` : surface === "signal" ? "Say hi to The Signal." : "Welcome to the studio.";
    introLine.textContent = state.intro.trim() || "Make it yours: craft an avatar, drop a welcome line, and pick your vibe. Totally optional — and totally fun.";
    vibeLine.replaceChildren(...state.vibes.map(vibe => h("span", { text: vibe })));
    vibeLine.hidden = !state.vibes.length;
    paintAllAvatars();
  }

  function renderProgress() {
    const info = level();
    levelName.textContent = info.current.name;
    levelMeta.textContent = info.next
      ? `${info.next.at - info.count} badge${info.next.at - info.count === 1 ? "" : "s"} to ${info.next.name}`
      : "Max vibe reached — legendary.";
    levelRing.style.setProperty("--halo-progress", `${Math.round(info.progress * 360)}deg`);
    levelRing.firstChild.textContent = String(info.count);
    levelRing.setAttribute("aria-label", `Vibe level ${info.current.name}: ${info.count} of ${BADGES.length} badges unlocked`);
    streakValue.textContent = `${state.visits.streak} day${state.visits.streak === 1 ? "" : "s"}`;
    streakMeta.textContent = `Best streak: ${state.visits.best} · just for fun`;
    badgeList.replaceChildren(...BADGES.map(badge => {
      const earned = Boolean(state.badges[badge.id]);
      return h("li", { class: earned ? "is-earned" : "", title: earned ? `${badge.name} — unlocked` : `Locked — ${badge.hint}` },
        h("span", { class: "halo-welcome__badge-icon", "aria-hidden": "true", text: earned ? badge.icon : "?" }),
        h("span", { class: "halo-welcome__badge-name", text: badge.name }),
        h("small", { text: earned ? "Unlocked" : `Locked · ${badge.hint}` }));
    }));
  }

  function renderNote() {
    storageNote.textContent = storageAvailable
      ? "Local-only: your avatar, photo, vibes, badges and streaks are saved in this browser. Nothing is uploaded or shared, and none of it changes access or permissions."
      : "Local-only preview: this browser is blocking storage, so your look resets when you leave. Nothing is uploaded or shared.";
  }

  /* ── Avatar studio form ── */
  const nameInput = h("input", { name: "welcomeName", maxlength: "40", autocomplete: "nickname", placeholder: "Stage name or nickname" });
  const introInput = h("textarea", { name: "welcomeIntro", maxlength: String(MAX_INTRO), rows: "2", placeholder: "Say hi — what are you cooking in the studio today?" });
  const introCount = h("small", { class: "halo-welcome__count", "aria-live": "polite" });
  const auraGroup = h("div", { class: "halo-welcome__swatches", role: "radiogroup", "aria-label": "Avatar aura" });
  const ringGroup = h("div", { class: "halo-welcome__chips", role: "radiogroup", "aria-label": "Avatar ring style" });
  const vibeGroup = h("div", { class: "halo-welcome__chips", role: "group", "aria-label": `Pick up to ${MAX_VIBES} vibes` });
  const photoInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", class: "sr-only", id: `haloWelcomePhoto-${surface}` });
  const videoInput = h("input", { type: "file", accept: "video/mp4,video/webm,video/quicktime", class: "sr-only", id: `haloWelcomeVideo-${surface}` });
  const removePhoto = h("button", { type: "button", class: "halo-welcome__ghost", text: "Remove photo" });

  function updateIntroCount() {
    const length = introInput.value.length;
    introCount.textContent = `${length} / ${MAX_INTRO}`;
    introCount.toggleAttribute("data-near-limit", length > MAX_INTRO - 20);
  }

  function radio(group, options, current, onPick, renderOption) {
    group.replaceChildren(...Object.entries(options).map(([value, option]) => {
      const button = renderOption(value, option);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(value === current()));
      button.tabIndex = value === current() ? 0 : -1;
      button.addEventListener("click", () => { onPick(value); radio(group, options, current, onPick, renderOption); group.querySelector('[aria-checked="true"]')?.focus(); });
      button.addEventListener("keydown", event => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const values = Object.keys(options);
        onPick(values[(values.indexOf(value) + keys[event.key] + values.length) % values.length]);
        radio(group, options, current, onPick, renderOption);
        group.querySelector('[aria-checked="true"]')?.focus();
      });
      return button;
    }));
  }

  function renderPickers() {
    radio(auraGroup, AURAS, () => state.aura, value => { state.aura = value; renderIdentity(); },
      (value, aura) => {
        const swatch = h("button", { class: "halo-welcome__swatch", "aria-label": aura.label, title: aura.label });
        swatch.style.setProperty("--halo-aura-from", aura.from);
        swatch.style.setProperty("--halo-aura-to", aura.to);
        return swatch;
      });
    radio(ringGroup, RINGS, () => state.ring, value => { state.ring = value; renderIdentity(); },
      (_value, label) => h("button", { class: "halo-welcome__chip", text: label }));
    vibeGroup.replaceChildren(...VIBES.map(vibe => {
      const picked = state.vibes.includes(vibe);
      return h("button", {
        type: "button", class: "halo-welcome__chip", "aria-pressed": String(picked), text: vibe,
        onclick: () => {
          if (picked) state.vibes = state.vibes.filter(entry => entry !== vibe);
          else if (state.vibes.length >= MAX_VIBES) { fileStatus.textContent = `Pick up to ${MAX_VIBES} vibes — tap one to swap it out.`; return; }
          else state.vibes = [...state.vibes, vibe];
          renderPickers(); renderIdentity();
        }
      });
    }));
    removePhoto.hidden = !state.photo;
  }

  async function readPhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Choose a JPG, PNG, WebP or GIF photo.");
    if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is over 8 MB. Try a smaller one.");
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("That photo could not be read."));
        element.src = url;
      });
      const size = 256, side = Math.min(image.naturalWidth, image.naturalHeight);
      if (!side) throw new Error("That photo could not be read.");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return canvas.toDataURL("image/jpeg", 0.82);
    } finally { URL.revokeObjectURL(url); }
  }

  photoInput.addEventListener("change", async () => {
    try {
      const photo = await readPhoto(photoInput.files?.[0]);
      if (!photo) return;
      state.photo = photo;
      save(); renderPickers(); renderIdentity();
      fileStatus.textContent = "Photo added to your local avatar. It stays on this device.";
      unlock("picture-day");
    } catch (error) { fileStatus.textContent = error.message; }
    finally { photoInput.value = ""; }
  });

  removePhoto.addEventListener("click", () => {
    state.photo = ""; save(); renderPickers(); renderIdentity();
    fileStatus.textContent = "Photo removed. Your monogram avatar is back.";
  });

  function clearVideo() {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = "";
    videoFrame.replaceChildren();
    videoFrame.hidden = true;
  }

  videoInput.addEventListener("change", () => {
    const file = videoInput.files?.[0];
    videoInput.value = "";
    if (!file) return;
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) { fileStatus.textContent = "Choose an MP4, WebM or MOV intro clip."; return; }
    if (file.size > MAX_VIDEO_BYTES) { fileStatus.textContent = "That clip is too large. Keep intro videos short and under 250 MB."; return; }
    clearVideo();
    const objectUrl = URL.createObjectURL(file);
    if (!objectUrl.startsWith("blob:")) { URL.revokeObjectURL(objectUrl); fileStatus.textContent = "That clip could not be previewed."; return; }
    videoUrl = objectUrl;
    const video = h("video", { controls: true, playsinline: true, preload: "metadata", "aria-label": "Your intro video preview" });
    video.muted = true;
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration) && video.duration > MAX_VIDEO_SECONDS) {
        clearVideo();
        fileStatus.textContent = `Keep your welcome clip under ${MAX_VIDEO_SECONDS} seconds — short and sweet wins.`;
        return;
      }
      fileStatus.textContent = "Intro video ready to preview. It is never uploaded and disappears when you leave this page.";
      unlock("lights-camera");
    });
    video.addEventListener("error", () => { clearVideo(); fileStatus.textContent = "That clip could not be played in this browser."; });
    video.src = objectUrl;
    videoFrame.replaceChildren(video, h("button", { type: "button", class: "halo-welcome__ghost", text: "Remove video preview", onclick: () => { clearVideo(); fileStatus.textContent = "Video preview removed."; } }));
    videoFrame.hidden = false;
  });

  const studioForm = h("form", { class: "halo-welcome__form", "aria-label": "Avatar studio" },
    h("label", {}, h("span", { text: "Name on your avatar" }), nameInput),
    h("label", {}, h("span", { text: "Welcome line" }), introInput, introCount),
    h("fieldset", {}, h("legend", { text: "Aura" }), auraGroup),
    h("fieldset", {}, h("legend", { text: "Ring style" }), ringGroup),
    h("fieldset", {}, h("legend", { text: `Your vibes (up to ${MAX_VIBES})` }), vibeGroup),
    h("fieldset", { class: "halo-welcome__media" }, h("legend", { text: "Photo + video welcome (optional)" }),
      h("label", { class: "halo-welcome__upload", for: photoInput.id }, h("span", { "aria-hidden": "true", text: "◐" }), h("span", { text: "Add a photo" })),
      photoInput, removePhoto,
      h("label", { class: "halo-welcome__upload", for: videoInput.id }, h("span", { "aria-hidden": "true", text: "▶" }), h("span", { text: "Preview an intro video" })),
      videoInput, videoFrame),
    fileStatus,
    h("div", { class: "halo-welcome__form-actions" },
      h("button", { type: "submit", class: "halo-welcome__primary", text: "Save my look" }),
      h("button", { type: "button", class: "halo-welcome__ghost", text: "Surprise me", onclick: surprise }),
      h("button", { type: "button", class: "halo-welcome__ghost halo-welcome__reset", text: "Reset local studio", onclick: reset })));

  nameInput.addEventListener("input", () => { state.name = nameInput.value.slice(0, 40); renderIdentity(); });
  introInput.addEventListener("input", () => { state.intro = introInput.value.slice(0, MAX_INTRO); updateIntroCount(); renderIdentity(); });

  studioForm.addEventListener("submit", event => {
    event.preventDefault();
    state.name = nameInput.value.trim().slice(0, 40);
    state.intro = introInput.value.trim().slice(0, MAX_INTRO);
    save();
    renderIdentity();
    const unlocked = unlock("studio-spark", state.intro && "say-hi", state.vibes.length && "vibe-check");
    if (!unlocked) celebrate(storageAvailable ? "✦ Look saved on this device." : "✦ Look applied for this visit.");
  });

  function surprise() {
    const pick = list => list[Math.floor(Math.random() * list.length)];
    state.aura = pick(Object.keys(AURAS));
    state.ring = pick(Object.keys(RINGS));
    const pool = [...VIBES];
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    state.vibes = pool.slice(0, 2);
    renderPickers(); renderIdentity();
    fileStatus.textContent = "Fresh look shuffled — save it if you like it.";
  }

  function reset() {
    if (!window.confirm("Reset your local avatar, vibes, badges and streak on this device?")) return;
    clearVideo();
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { storageAvailable = false; }
    state = defaults();
    trackVisit();
    nameInput.value = ""; introInput.value = "";
    updateIntroCount(); renderPickers(); renderIdentity(); renderProgress(); renderNote();
    fileStatus.textContent = "Local studio reset. Start fresh whenever you like.";
  }

  /* ── Layout ── */
  const studio = h("details", { class: "halo-welcome__studio" },
    h("summary", {}, h("span", { text: "Open avatar studio" }), h("small", { text: "Optional · about 30 seconds" })),
    studioForm);

  const toggle = h("button", { type: "button", class: "halo-welcome__toggle", "aria-expanded": "true", "aria-controls": `haloWelcomeBody-${surface}` });
  const body = h("div", { class: "halo-welcome__body", id: `haloWelcomeBody-${surface}` },
    h("div", { class: "halo-welcome__hero" },
      avatarPreview,
      h("div", { class: "halo-welcome__copy" },
        h("p", { class: "halo-welcome__eyebrow", text: surface === "signal" ? "The Signal / say hi" : "Creator Network / your vibe" }),
        greeting, introLine, vibeLine,
        h("div", { class: "halo-welcome__cta" },
          h("button", { type: "button", class: "halo-welcome__primary", text: "Make my avatar", onclick: () => { studio.open = true; nameInput.focus(); } }),
          surface === "signal"
            ? h("a", { class: "halo-welcome__ghost", href: "/creator-network/#orbits", text: "Explore HALO Orbits ↗" })
            : h("a", { class: "halo-welcome__ghost", href: "/signal-network/#feed", text: "Say hi on The Signal ↗" })))),
    h("div", { class: "halo-welcome__stats" },
      h("div", { class: "halo-welcome__stat" }, levelRing, h("div", {}, h("span", { class: "halo-welcome__eyebrow", text: "Vibe level" }), levelName, levelMeta)),
      h("div", { class: "halo-welcome__stat" }, h("span", { class: "halo-welcome__flame", "aria-hidden": "true", text: "☀" }), h("div", {}, h("span", { class: "halo-welcome__eyebrow", text: "Glow streak" }), streakValue, streakMeta))),
    badgeList, studio, storageNote);

  function applyCollapsed() {
    body.hidden = state.collapsed;
    root.classList.toggle("is-collapsed", state.collapsed);
    toggle.setAttribute("aria-expanded", String(!state.collapsed));
    toggle.textContent = state.collapsed ? "Show welcome" : "Hide welcome";
  }
  toggle.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    save(); applyCollapsed();
    if (!state.collapsed) toggle.focus();
  });

  const compact = h("div", { class: "halo-welcome__bar" },
    h("div", { class: "halo-welcome__bar-id", "data-halo-avatar": "", "aria-hidden": "true" }),
    h("p", {}, h("strong", { text: "HALO Welcome Studio" }), h("small", { text: "Optional · local-only · just for fun" })),
    toggle);

  root.replaceChildren(compact, body, toast);

  nameInput.value = state.name;
  introInput.value = state.intro;
  trackVisit();
  updateIntroCount();
  renderPickers();
  renderIdentity();
  renderProgress();
  renderNote();
  applyCollapsed();
  checkVisitBadges();

  if (surface === "creator") {
    const orbits = document.getElementById("orbits");
    if (orbits && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { unlock("orbit-explorer"); observer.disconnect(); }
      }, { threshold: 0.35 });
      observer.observe(orbits);
    } else if (orbits) {
      orbits.addEventListener("click", () => unlock("orbit-explorer"), { once: true });
    }
  }
  window.addEventListener("halo:signal-published", () => unlock("first-signal"));
  window.addEventListener("pagehide", clearVideo);
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY) return;
    state = load();
    nameInput.value = state.name; introInput.value = state.intro; updateIntroCount();
    renderPickers(); renderIdentity(); renderProgress(); applyCollapsed();
  });
})();
