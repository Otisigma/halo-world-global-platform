// HALO Artist Shop experience layer: GBP-first currency toggle, Signal Drops, the saved bag,
// the Always-On Library player and the HALO Video Gallery.
// The library is fed by real Song Catalog tracks (see catalog-tracks.js) and the gallery by
// /api/videos. Starter entries fill the gaps until real previews and videos are published.
(() => {
  const BAG_KEY = "halo_uk_shop_bag_v1";
  const CURRENCY_KEY = "halo_shop_currency";
  const SETTINGS_KEY = "halo_library_settings_v1";
  // Display-only conversion. Checkout is always settled in the item's own currency (GBP for HALO drops).
  const GBP_TO_USD = 1.27;
  const SUPPORTED = ["GBP", "USD"];

  const STARTER_DROPS = [
    { id: "drop-salty", title: "I Love You When You're Salty — Master & Stems", artist: "Owen Anthony & Anna Jayne", tag: "Single + Stems", priceMinor: 799, currency: "GBP", art: "/assets/releases/salty.jpg" },
    { id: "drop-all-about-you", title: "All About You Tonight — Obsidian Master", artist: "Owen Anthony", tag: "Signal Release", priceMinor: 599, currency: "GBP", art: "/assets/artists/owen-anthony-glass-house.webp" },
    { id: "drop-blue-ink", title: "Blue Ink & Coffee — Acoustic Session Pack", artist: "Anna Jayne", tag: "Acoustic Edition", priceMinor: 649, currency: "GBP", art: "/assets/artists/owen-anthony-quicksand.jpg" }
  ];

  // Shown in the library until the Song Catalog has published previews. No audio is attached yet.
  const STARTER_TRACKS = [
    { id: "starter-all-about-you", title: "All About You Tonight", artist: "Owen Anthony", genre: "Deep House", bpm: "122 BPM", priceMinor: 599, currency: "GBP", preview: "", artwork: "/assets/artists/owen-anthony-glass-house.webp", bagId: "drop-all-about-you" },
    { id: "starter-salty", title: "I Love You When You're Salty", artist: "Owen Anthony & Anna Jayne", genre: "Warm Fusion", bpm: "104 BPM", priceMinor: 799, currency: "GBP", preview: "", artwork: "/assets/releases/salty.jpg", bagId: "drop-salty" },
    { id: "starter-blue-ink", title: "Blue Ink & Coffee", artist: "Anna Jayne", genre: "Acoustic", bpm: "98 BPM", priceMinor: 649, currency: "GBP", preview: "", artwork: "", bagId: "drop-blue-ink" },
    { id: "starter-quiet-heart", title: "Quiet Heart", artist: "Owen Anthony & DJ Futon", genre: "Afro House", bpm: "122 BPM", priceMinor: 599, currency: "GBP", preview: "", artwork: "" }
  ];

  const STARTER_VIDEOS = [
    { id: "starter-signal", tag: "Obsidian Signal", title: "Enter the Signal — Brass & Gold Wave", description: "High-contrast obsidian and gold teaser introducing the HALO catalog.", thumbnailUrl: "/assets/enter-the-signal.webp" },
    { id: "starter-studio", tag: "Sunlit Studio Cut", title: "Anna Jayne — Acoustic Strings & Mornings", description: "An intimate studio session capturing raw acoustic energy.", thumbnailUrl: "/assets/artists/owen-anthony-quicksand.jpg" },
    { id: "starter-club", tag: "Club & Deck Reel", title: "Late-Night Deck Transitions — Club Cut", description: "Turntable and mixer visuals for DJ and club sets.", thumbnailUrl: "/assets/releases/hit-that-beat.webp" }
  ];

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }

  // ---------- Money ----------
  let displayCurrency = SUPPORTED.includes(localStorage.getItem(CURRENCY_KEY)) ? localStorage.getItem(CURRENCY_KEY) : "GBP";

  function convertMinor(minor, from, to) {
    if (from === to) return minor;
    if (from === "GBP" && to === "USD") return Math.round(minor * GBP_TO_USD);
    if (from === "USD" && to === "GBP") return Math.round(minor / GBP_TO_USD);
    return null;
  }
  function formatMinor(minor, currency) {
    return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(minor / 100);
  }
  // Formats a price in the visitor's chosen currency; converted values are marked as approximate.
  function formatPrice(minor, currency = "GBP") {
    const native = String(currency || "GBP").toUpperCase();
    if (!Number.isFinite(minor) || minor <= 0) return "";
    const converted = convertMinor(minor, native, displayCurrency);
    if (converted === null) {
      try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: native, currencyDisplay: "narrowSymbol" }).format(minor / 100); } catch { return `${native} ${(minor / 100).toFixed(2)}`; }
    }
    return `${native === displayCurrency ? "" : "≈ "}${formatMinor(converted, displayCurrency)}`;
  }
  window.haloShopMoney = { format: formatPrice, currency: () => displayCurrency };

  // ---------- Catalog registry (everything that can sit in the bag) ----------
  let catalogTracks = [];
  const purchasable = new Map();
  function rebuildRegistry() {
    purchasable.clear();
    STARTER_DROPS.forEach(drop => purchasable.set(drop.id, { ...drop, kind: "drop" }));
    catalogTracks.forEach(track => {
      if (track.saleStatus === "for_sale" && track.priceMinor > 0 && SUPPORTED.includes(track.currency)) {
        purchasable.set(`track:${track.id}`, { id: `track:${track.id}`, title: track.title, artist: track.artist, priceMinor: track.priceMinor, currency: track.currency, art: track.artwork, url: track.shopUrl, kind: "track" });
      }
    });
  }
  rebuildRegistry();

  // ---------- Bag (stores ids and quantities only; prices always come from the page) ----------
  let bag = (Array.isArray(readJson(BAG_KEY, [])) ? readJson(BAG_KEY, []) : [])
    .filter(item => item && typeof item.id === "string")
    .map(item => ({ id: item.id, qty: Math.min(Math.max(parseInt(item.qty, 10) || 1, 1), 20) }));
  const saveBag = () => writeJson(BAG_KEY, bag.map(({ id, qty }) => ({ id, qty })));

  function addToBag(id) {
    const product = purchasable.get(id);
    if (!product) return;
    const existing = bag.find(item => item.id === id);
    if (existing) existing.qty = Math.min(existing.qty + 1, 20);
    else bag.push({ id, qty: 1 });
    saveBag();
    renderBag();
    toast(`${product.title} added to your bag`);
    pulseBagButton();
  }
  function setQty(id, delta) {
    const item = bag.find(entry => entry.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) bag = bag.filter(entry => entry.id !== id);
    saveBag();
    renderBag();
  }

  const bagEls = {
    count: $("#bag-count"), button: $("#open-bag"), backdrop: $("#bag-backdrop"), drawer: $("#bag-drawer"),
    items: $("#bag-items"), total: $("#bag-total"), note: $("#bag-total-note"), checkout: $("#bag-checkout"), status: $("#bag-status")
  };

  function bagTotals() {
    let total = 0;
    let pending = 0;
    const native = new Map();
    bag.forEach(item => {
      const product = purchasable.get(item.id);
      if (!product) { pending += 1; return; }
      const line = product.priceMinor * item.qty;
      total += convertMinor(line, product.currency, displayCurrency) ?? 0;
      native.set(product.currency, (native.get(product.currency) || 0) + line);
    });
    // What would actually be charged: each item settles in its own currency (HALO drops are GBP).
    const charged = [...native.entries()].sort(([a], [b]) => (a === "GBP" ? -1 : b === "GBP" ? 1 : a.localeCompare(b)))
      .map(([code, minor]) => `${formatMinor(minor, code)} ${code}`).join(" + ");
    const exact = native.size <= 1 && (!native.size || native.has(displayCurrency));
    return { total, charged: charged || formatMinor(0, "GBP") + " GBP", exact, pending };
  }

  function renderBag() {
    const qty = bag.reduce((sum, item) => sum + item.qty, 0);
    bagEls.count.textContent = String(qty);
    bagEls.button.setAttribute("aria-label", `Open bag, ${qty} item${qty === 1 ? "" : "s"}`);
    if (!bag.length) {
      bagEls.items.innerHTML = '<p class="bag-empty">Your bag is empty. Add a Signal Drop or a track from the Always-On Library.</p>';
    } else {
      bagEls.items.innerHTML = bag.map(item => {
        const product = purchasable.get(item.id);
        if (!product) {
          return `<div class="bag-item is-pending"><div><strong>Checking this release…</strong><span>It will reappear once the HALO Song Catalog loads.</span></div><button class="bag-remove" type="button" data-bag-remove="${escapeHtml(item.id)}">Remove</button></div>`;
        }
        return `<div class="bag-item">
          ${product.art ? `<img src="${escapeHtml(product.art)}" alt="" loading="lazy">` : '<span class="bag-thumb" aria-hidden="true">♪</span>'}
          <div><strong>${escapeHtml(product.title)}</strong><span>${escapeHtml(product.artist)} · ${escapeHtml(formatPrice(product.priceMinor * item.qty, product.currency))}</span></div>
          <div class="bag-qty" role="group" aria-label="Quantity for ${escapeHtml(product.title)}">
            <button type="button" data-bag-step="-1" data-bag-id="${escapeHtml(item.id)}" aria-label="One fewer">−</button>
            <output>${item.qty}</output>
            <button type="button" data-bag-step="1" data-bag-id="${escapeHtml(item.id)}" aria-label="One more">+</button>
          </div>
        </div>`;
      }).join("");
    }
    const { total, charged, exact } = bagTotals();
    bagEls.total.textContent = `${exact ? "" : "≈ "}${formatMinor(total, displayCurrency)}`;
    bagEls.note.textContent = exact
      ? (displayCurrency === "GBP" ? "Prices in UK pounds." : "Prices in US dollars.")
      : `Converted at an approximate rate. Each item is charged in its own currency: ${charged}.`;
    bagEls.checkout.textContent = `Checkout · ${charged}`;
    bagEls.checkout.disabled = !bag.length;
    bagEls.status.textContent = "";
  }

  let lastFocus = null;
  function openBag() {
    lastFocus = document.activeElement;
    bagEls.backdrop.hidden = false;
    requestAnimationFrame(() => bagEls.backdrop.classList.add("is-open"));
    bagEls.drawer.querySelector("button")?.focus();
  }
  function closeBag() {
    bagEls.backdrop.classList.remove("is-open");
    bagEls.backdrop.hidden = true;
    lastFocus?.focus?.();
  }
  function pulseBagButton() {
    bagEls.button.classList.remove("is-pulsing");
    void bagEls.button.offsetWidth;
    bagEls.button.classList.add("is-pulsing");
  }

  bagEls.button.addEventListener("click", openBag);
  bagEls.backdrop.addEventListener("click", event => {
    if (event.target === bagEls.backdrop || event.target.closest("[data-close-bag]")) closeBag();
    const step = event.target.closest("[data-bag-step]");
    if (step) setQty(step.dataset.bagId, Number(step.dataset.bagStep));
    const remove = event.target.closest("[data-bag-remove]");
    if (remove) setQty(remove.dataset.bagRemove, -Infinity);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !bagEls.backdrop.hidden) closeBag();
  });
  bagEls.checkout.addEventListener("click", () => {
    if (!bag.length) return;
    const { charged } = bagTotals();
    bagEls.status.textContent = `Your ${charged} bag is saved on this device. Card checkout opens as soon as each artist approves their release for sale.`;
  });

  // ---------- Toast (reuses the page toast from marketplace.js styling) ----------
  let toastTimer = 0;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- Signal Drops ----------
  function renderDrops() {
    $("#signal-drop-grid").innerHTML = STARTER_DROPS.map(drop => `
      <article class="signal-card">
        <img class="signal-card-art" src="${escapeHtml(drop.art)}" alt="" loading="lazy" decoding="async">
        <div class="signal-card-body">
          <p class="signal-tag">${escapeHtml(drop.tag)}</p>
          <h3>${escapeHtml(drop.title)}</h3>
          <p class="signal-meta">${escapeHtml(drop.artist)}</p>
          <div class="signal-card-foot">
            <span class="signal-price">${escapeHtml(formatPrice(drop.priceMinor, drop.currency))}</span>
            <button class="signal-btn" type="button" data-add="${escapeHtml(drop.id)}">Add to bag</button>
          </div>
        </div>
      </article>`).join("");
  }
  $("#signal-drop-grid").addEventListener("click", event => {
    const button = event.target.closest("[data-add]");
    if (button) addToBag(button.dataset.add);
  });

  // ---------- Always-On Library ----------
  const lib = {
    list: $("#library-list"), search: $("#library-search"), genre: $("#library-genre"), audio: $("#library-audio"),
    nowTitle: $("#library-now-title"), nowMeta: $("#library-now-meta"), nowArt: $("#library-now-art"),
    play: $("#library-play"), prev: $("#library-prev"), next: $("#library-next"), shuffle: $("#library-shuffle"),
    seek: $("#library-seek"), time: $("#library-time"), count: $("#library-count"),
    dock: $("#library-dock"), dockTitle: $("#library-dock-title"), dockPlay: $("#library-dock-play"), dockNext: $("#library-dock-next")
  };
  const settings = { shuffle: false, ...readJson(SETTINGS_KEY, {}) };
  const libState = { activeId: "", query: "", genre: "all" };

  function libraryTracks() {
    const live = catalogTracks.map(track => ({
      id: track.id, title: track.title, artist: track.artist, genre: track.genre || "HALO release", bpm: track.album || "",
      preview: track.preview, artwork: track.artwork,
      priceMinor: track.saleStatus === "for_sale" ? track.priceMinor : 0, currency: track.currency,
      bagId: purchasable.has(`track:${track.id}`) ? `track:${track.id}` : "", url: track.shopUrl, live: true
    }));
    const liveKeys = new Set(live.map(track => track.title.toLowerCase()));
    return [...live, ...STARTER_TRACKS.filter(track => !liveKeys.has(track.title.toLowerCase()))];
  }
  function visibleTracks() {
    const query = libState.query.trim().toLowerCase();
    return libraryTracks().filter(track =>
      (libState.genre === "all" || track.genre.toLowerCase() === libState.genre)
      && (!query || `${track.title} ${track.artist} ${track.genre} ${track.bpm}`.toLowerCase().includes(query)));
  }
  const playable = () => visibleTracks().filter(track => track.preview);

  function renderGenres() {
    const genres = [...new Set(libraryTracks().map(track => track.genre))].sort();
    if (libState.genre !== "all" && !genres.some(g => g.toLowerCase() === libState.genre)) libState.genre = "all";
    lib.genre.innerHTML = ['<option value="all">All styles</option>', ...genres.map(g => `<option value="${escapeHtml(g.toLowerCase())}"${libState.genre === g.toLowerCase() ? " selected" : ""}>${escapeHtml(g)}</option>`)].join("");
  }

  function renderLibrary() {
    const tracks = visibleTracks();
    const ready = tracks.filter(track => track.preview).length;
    lib.count.textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"} · ${ready} ready to play`;
    if (!tracks.length) {
      lib.list.innerHTML = '<p class="library-empty">No tracks match. Try another style or search.</p>';
      return;
    }
    const playing = !lib.audio.paused;
    lib.list.innerHTML = tracks.map((track, index) => {
      const active = track.id === libState.activeId;
      const price = track.priceMinor ? formatPrice(track.priceMinor, track.currency) : "";
      return `<div class="library-row${active ? " is-active" : ""}${track.preview ? "" : " is-silent"}">
        <span class="library-index" aria-hidden="true">${active && playing ? '<span class="eq"><i></i><i></i><i></i></span>' : String(index + 1).padStart(2, "0")}</span>
        <div class="library-info">
          <strong>${escapeHtml(track.title)}</strong>
          <span>${escapeHtml(track.artist)}${track.genre ? ` · ${escapeHtml(track.genre)}` : ""}${track.bpm ? ` · ${escapeHtml(track.bpm)}` : ""}${track.live ? ' <em class="library-live">Song Catalog</em>' : ""}</span>
        </div>
        <div class="library-actions">
          ${price ? `<span class="signal-price">${escapeHtml(price)}</span>` : ""}
          ${track.preview
            ? `<button class="signal-btn-outline" type="button" data-audition="${escapeHtml(track.id)}" aria-pressed="${active && playing}">${active && playing ? "Pause" : "Play"}</button>`
            : '<span class="library-soon">Preview soon</span>'}
          ${track.bagId ? `<button class="signal-btn" type="button" data-add="${escapeHtml(track.bagId)}">Add</button>` : track.url ? `<a class="signal-btn-outline" href="${escapeHtml(track.url)}">Open</a>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  function setNowPlaying(track) {
    const playing = Boolean(track) && !lib.audio.paused;
    lib.nowTitle.textContent = track ? track.title : "Pick a track to start the signal";
    lib.nowMeta.textContent = track ? `${track.artist}${track.genre ? ` · ${track.genre}` : ""}` : "Previews play back-to-back, so the library never goes quiet.";
    lib.nowArt.style.backgroundImage = track?.artwork ? `url("${track.artwork.replace(/"/g, "%22")}")` : "";
    lib.play.textContent = playing ? "❚❚" : "▶";
    lib.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    lib.dockPlay.textContent = playing ? "❚❚" : "▶";
    lib.dockPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
    lib.dockTitle.textContent = track ? `${track.title} — ${track.artist}` : "";
    lib.dock.hidden = !track;
    if ("mediaSession" in navigator && track) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: "HALO Always-On Library", artwork: track.artwork ? [{ src: track.artwork }] : [] });
    }
  }

  function playTrack(id) {
    const track = libraryTracks().find(item => item.id === id);
    if (!track?.preview) return;
    if (libState.activeId === id && lib.audio.src) {
      lib.audio.paused ? lib.audio.play().catch(() => {}) : lib.audio.pause();
      return;
    }
    libState.activeId = id;
    lib.audio.src = track.preview;
    window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "library" } }));
    lib.audio.play().catch(() => toast("This preview could not start. Try another track."));
    setNowPlaying(track);
    renderLibrary();
  }

  function step(direction) {
    const queue = playable();
    if (!queue.length) { toast("No previews are published yet — they appear here the moment an artist adds one."); return; }
    let index = queue.findIndex(track => track.id === libState.activeId);
    if (settings.shuffle && queue.length > 1) {
      let next = index;
      while (next === index) next = Math.floor(Math.random() * queue.length);
      index = next;
    } else {
      index = (index + direction + queue.length) % queue.length;
    }
    playTrack(queue[index].id);
  }

  function togglePlay() {
    if (!libState.activeId || !lib.audio.src) return step(1);
    lib.audio.paused ? lib.audio.play().catch(() => {}) : lib.audio.pause();
  }

  const fmtTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
  lib.audio.addEventListener("timeupdate", () => {
    const { currentTime, duration } = lib.audio;
    lib.seek.value = duration ? String(Math.round((currentTime / duration) * 1000)) : "0";
    lib.time.textContent = `${fmtTime(currentTime)} / ${fmtTime(duration)}`;
  });
  lib.seek.addEventListener("input", () => {
    if (lib.audio.duration) lib.audio.currentTime = (Number(lib.seek.value) / 1000) * lib.audio.duration;
  });
  ["play", "pause"].forEach(type => lib.audio.addEventListener(type, () => {
    setNowPlaying(libraryTracks().find(track => track.id === libState.activeId));
    renderLibrary();
  }));
  // Always-on: when a preview ends, the next one starts.
  lib.audio.addEventListener("ended", () => step(1));
  lib.audio.addEventListener("error", () => { if (lib.audio.src) setTimeout(() => step(1), 800); });

  lib.play.addEventListener("click", togglePlay);
  lib.dockPlay.addEventListener("click", togglePlay);
  lib.prev.addEventListener("click", () => step(-1));
  lib.next.addEventListener("click", () => step(1));
  lib.dockNext.addEventListener("click", () => step(1));
  lib.shuffle.setAttribute("aria-pressed", String(settings.shuffle));
  lib.shuffle.addEventListener("click", () => {
    settings.shuffle = !settings.shuffle;
    lib.shuffle.setAttribute("aria-pressed", String(settings.shuffle));
    writeJson(SETTINGS_KEY, settings);
  });
  lib.search.addEventListener("input", () => { libState.query = lib.search.value; renderLibrary(); });
  lib.genre.addEventListener("change", () => { libState.genre = lib.genre.value; renderLibrary(); });
  lib.list.addEventListener("click", event => {
    const audition = event.target.closest("[data-audition]");
    if (audition) playTrack(audition.dataset.audition);
    const add = event.target.closest("[data-add]");
    if (add) addToBag(add.dataset.add);
  });
  // Only one HALO player sounds at a time on this page.
  window.addEventListener("halo:shop-audio", event => {
    if (event.detail?.source !== "library" && !lib.audio.paused) lib.audio.pause();
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  }

  // ---------- HALO Video Gallery ----------
  const vid = {
    grid: $("#video-grid"), player: $("#video-player"), frame: $("#video-embed"), placeholder: $("#video-placeholder"),
    tag: $("#video-active-tag"), title: $("#video-active-title"), desc: $("#video-active-desc"), status: $("#video-status")
  };
  let videos = STARTER_VIDEOS.map(video => ({ ...video, starter: true }));
  let activeVideoId = videos[0].id;

  function safeMediaUrl(value) {
    const raw = String(value || "").trim();
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    try { const url = new URL(raw); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
  }

  function loadVideo(id, { autoplay = false } = {}) {
    const video = videos.find(item => item.id === id);
    if (!video) return;
    activeVideoId = id;
    vid.player.pause();
    vid.player.hidden = true;
    vid.frame.hidden = true;
    vid.frame.removeAttribute("src");
    vid.placeholder.hidden = true;
    const embed = safeMediaUrl(video.embedUrl);
    const source = safeMediaUrl(video.sourceUrl);
    if (embed) {
      vid.frame.src = `${embed.replace("https://www.youtube.com/", "https://www.youtube-nocookie.com/")}?rel=0${autoplay ? "&autoplay=1" : ""}`;
      vid.frame.title = video.title;
      vid.frame.hidden = false;
    } else if (source && !video.starter) {
      vid.player.poster = safeMediaUrl(video.thumbnailUrl);
      vid.player.src = source;
      vid.player.hidden = false;
      if (autoplay) {
        window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "video" } }));
        vid.player.play().catch(() => {});
      }
    } else {
      vid.placeholder.style.backgroundImage = video.thumbnailUrl ? `url("${safeMediaUrl(video.thumbnailUrl)}")` : "";
      vid.placeholder.hidden = false;
    }
    vid.tag.textContent = video.tag || (video.featured ? "Featured visual" : video.artistName || "HALO visual");
    vid.title.textContent = video.title;
    vid.desc.textContent = video.description || (video.starter ? "This visual is being finished. It appears here as soon as it's published to the HALO Video Gallery." : "");
    renderVideoGrid();
  }

  function renderVideoGrid() {
    vid.grid.innerHTML = videos.map(video => {
      const thumb = safeMediaUrl(video.thumbnailUrl);
      return `<button class="video-card${video.id === activeVideoId ? " is-selected" : ""}" type="button" data-video="${escapeHtml(video.id)}" aria-pressed="${video.id === activeVideoId}">
        <span class="video-card-poster"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ""}><span class="video-card-play" aria-hidden="true">${video.starter ? "Soon" : "▶"}</span></span>
        <span class="video-card-body">
          <span class="signal-tag">${escapeHtml(video.tag || video.artistName || "HALO visual")}</span>
          <strong>${escapeHtml(video.title)}</strong>
          ${video.description ? `<span>${escapeHtml(video.description)}</span>` : ""}
        </span>
      </button>`;
    }).join("");
  }
  vid.grid.addEventListener("click", event => {
    const card = event.target.closest("[data-video]");
    if (!card) return;
    loadVideo(card.dataset.video, { autoplay: true });
    $("#video-stage").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  });
  vid.player.addEventListener("play", () => window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "video" } })));
  window.addEventListener("halo:shop-audio", event => { if (event.detail?.source !== "video" && !vid.player.paused) vid.player.pause(); });

  async function loadGallery() {
    try {
      const response = await fetch("/api/videos", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const published = (Array.isArray(data.videos) ? data.videos : []).filter(video => video && video.galleryVisible && video.id);
      if (published.length) {
        videos = published.map(video => ({ ...video, tag: video.featured ? "Featured visual" : video.artistName || "HALO visual" }));
        vid.status.textContent = `${published.length} published visual${published.length === 1 ? "" : "s"}`;
      } else {
        vid.status.textContent = "Starter visuals · published HALO videos replace these automatically";
      }
    } catch {
      vid.status.textContent = "Showing starter visuals while the gallery reconnects";
    }
    loadVideo(videos[0].id);
  }

  // ---------- Currency toggle ----------
  const currencySelect = $("#currency-select");
  currencySelect.value = displayCurrency;
  function renderCurrencyCopy() {
    $("#currency-note").textContent = displayCurrency === "GBP" ? "Prices in UK pounds (GBP £)" : `Approximate US dollar view · checkout settles in GBP (£1 ≈ $${GBP_TO_USD.toFixed(2)})`;
  }
  currencySelect.addEventListener("change", () => {
    displayCurrency = SUPPORTED.includes(currencySelect.value) ? currencySelect.value : "GBP";
    try { localStorage.setItem(CURRENCY_KEY, displayCurrency); } catch { /* ignore */ }
    renderCurrencyCopy();
    renderDrops();
    renderLibrary();
    renderBag();
    window.dispatchEvent(new CustomEvent("halo:currency-change", { detail: { currency: displayCurrency } }));
  });

  // ---------- Song Catalog feed ----------
  window.addEventListener("halo:artist-shop-catalog", event => {
    catalogTracks = Array.isArray(event.detail?.tracks) ? event.detail.tracks : [];
    rebuildRegistry();
    renderGenres();
    renderLibrary();
    renderBag();
  });
  if (window.haloArtistShopCatalog) {
    catalogTracks = window.haloArtistShopCatalog.tracks();
    rebuildRegistry();
  }

  renderCurrencyCopy();
  renderDrops();
  renderGenres();
  renderLibrary();
  setNowPlaying(null);
  renderBag();
  loadGallery();
})();
