// HALO Artist Shop — editable, artist-scoped video gallery.
// The gallery only ever shows one artist's own visuals, resolved by /api/shop-video-gallery:
//   • 'dreamweaver_only' (default): the artist's Dreamweaver song videos attach automatically.
//   • 'empty': nothing attaches automatically.
// The artist adds, pins, reorders, hides or removes videos; nothing from other artists or the
// global HALO feed is injected. With no artist context the section shows a clean empty state.
(() => {
  const API = "/api/shop-video-gallery";
  const ARTIST_KEY = "halo_shop_gallery_artist";
  const $ = selector => document.querySelector(selector);
  const section = $("#video-gallery");
  if (!section) return;

  const el = {
    stage: $("#video-stage"), grid: $("#video-grid"), empty: $("#gallery-empty"),
    player: $("#video-player"), frame: $("#video-embed"), placeholder: $("#video-placeholder"),
    tag: $("#video-active-tag"), title: $("#video-active-title"), desc: $("#video-active-desc"), cue: $("#video-cue"),
    status: $("#video-status"), heading: section.querySelector("[data-gallery-heading]"), intro: section.querySelector("[data-gallery-intro]"),
    switchWrap: section.querySelector("[data-gallery-switch]"), switchSelect: section.querySelector("[data-gallery-artist]"),
    editButton: section.querySelector("[data-gallery-edit]"), editor: $("#gallery-editor"),
    items: section.querySelector("[data-gallery-items]"), library: section.querySelector("[data-gallery-library]"),
    songs: section.querySelector("[data-gallery-songs]"), addForm: section.querySelector("[data-gallery-add-link]"),
    songSelect: section.querySelector("[data-song-select]"), versionSelect: section.querySelector("[data-version-select]"),
    emptyForm: section.querySelector("[data-gallery-empty-form]"), editorStatus: section.querySelector("[data-gallery-editor-status]")
  };

  let data = null;
  let activeId = "";
  let countdownTimer = 0;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  function safeMediaUrl(value) {
    const raw = String(value || "").trim();
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    try { const url = new URL(raw); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
  }
  const visibleVideos = () => (data?.videos || []).filter(video => !video.hidden);
  const currentTheme = () => document.documentElement.dataset.haloTheme || "";

  function requestedArtist() {
    const fromUrl = new URLSearchParams(location.search).get("artist");
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem(ARTIST_KEY) || ""; } catch { return ""; }
  }

  function videoTag(video) {
    if (video.pinned) return "Pinned visual";
    const kind = video.origin === "dreamweaver" ? "Dreamweaver" : "Artist visual";
    const version = video.versionLabel ? ` · ${video.versionLabel}` : "";
    return `${kind}${video.songTitle ? ` · ${video.songTitle}` : ""}${version}`;
  }

  // ---------- Player ----------
  function stopPlayback() {
    el.player.pause();
    el.player.hidden = true;
    el.frame.hidden = true;
    el.frame.removeAttribute("src");
    el.placeholder.hidden = true;
  }

  function loadVideo(id, { autoplay = false } = {}) {
    const video = visibleVideos().find(item => item.id === id);
    if (!video) return;
    activeId = id;
    stopPlayback();
    const embed = safeMediaUrl(video.embedUrl);
    const source = safeMediaUrl(video.sourceUrl);
    if (embed) {
      el.frame.src = `${embed.replace("https://www.youtube.com/", "https://www.youtube-nocookie.com/")}?rel=0${autoplay ? "&autoplay=1" : ""}`;
      el.frame.title = video.title;
      el.frame.hidden = false;
      if (autoplay) window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "video" } }));
    } else if (source) {
      el.player.poster = safeMediaUrl(video.thumbnailUrl);
      el.player.src = source;
      el.player.hidden = false;
      if (autoplay) {
        window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "video" } }));
        el.player.play().catch(() => {});
      }
    } else {
      el.placeholder.style.backgroundImage = video.thumbnailUrl ? `url("${safeMediaUrl(video.thumbnailUrl)}")` : "";
      el.placeholder.hidden = false;
    }
    el.tag.textContent = videoTag(video);
    el.title.textContent = video.title;
    el.desc.textContent = video.description || "";
    el.cue.hidden = !video.songId;
    el.cue.textContent = video.versionLabel ? `Play ${video.songTitle || "this song"} in the library` : "Play this song in the library";
    el.cue.dataset.song = video.songId || "";
    renderGrid();
  }

  function renderGrid() {
    const videos = visibleVideos();
    el.grid.innerHTML = videos.map(video => {
      const thumb = safeMediaUrl(video.thumbnailUrl);
      return `<button class="video-card${video.id === activeId ? " is-selected" : ""}${video.pinned ? " is-pinned" : ""}" type="button" data-video="${escapeHtml(video.id)}" aria-pressed="${video.id === activeId}">
        <span class="video-card-poster"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ""}><span class="video-card-play" aria-hidden="true">▶</span></span>
        <span class="video-card-body">
          <span class="signal-tag">${escapeHtml(videoTag(video))}</span>
          <strong>${escapeHtml(video.title)}</strong>
          ${video.description ? `<span>${escapeHtml(video.description)}</span>` : ""}
        </span>
      </button>`;
    }).join("");
  }

  // ---------- Empty state ----------
  function countdownText(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "Out now";
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return days ? `${days}d ${hours}h to go` : `${hours}h ${minutes}m to go`;
  }

  function renderEmpty() {
    clearInterval(countdownTimer);
    const custom = data?.emptyState || {};
    const hasCustom = Boolean(custom.title || custom.note || custom.coverUrl || custom.releaseAt);
    const cover = safeMediaUrl(custom.coverUrl);
    let body;
    if (!data?.artist) {
      const shops = data?.shops || [];
      body = `<h3>Open an artist's shop to watch their videos.</h3>
        <p>Each artist curates their own gallery. HALO doesn't fill it with other artists' visuals.</p>
        ${shops.length ? `<div class="gallery-shop-links">${shops.map(shop => `<a class="signal-btn-outline" href="?artist=${encodeURIComponent(shop.slug)}#video-gallery">${escapeHtml(shop.artistName)}</a>`).join("")}</div>` : ""}`;
    } else if (hasCustom) {
      body = `<h3>${escapeHtml(custom.title || "New visuals coming soon")}</h3>
        ${custom.note ? `<p>${escapeHtml(custom.note)}</p>` : ""}
        ${custom.releaseAt ? `<p class="gallery-countdown" data-countdown>${escapeHtml(countdownText(custom.releaseAt))}</p>` : ""}`;
    } else if (data.canEdit) {
      body = `<h3>Your gallery is empty — and that's on purpose.</h3>
        <p>Make a Dreamweaver song video from one of your tracks and it appears here automatically${data.mode === "empty" ? " once you switch the rule to Dreamweaver only" : ""}, or add a video yourself.</p>
        <div class="gallery-shop-links">
          <a class="signal-btn" href="/dreamweaver/?experience=studio">Make a Dreamweaver video</a>
          <button class="signal-btn-outline" type="button" data-open-editor>Add a video</button>
        </div>`;
    } else {
      body = `<h3>No visuals yet.</h3><p>${escapeHtml(data.artist.artistName)} hasn't published a video to this shop yet.</p>`;
    }
    el.empty.innerHTML = `<div class="gallery-empty-card"${cover ? ` style="--gallery-cover:url('${escapeHtml(cover)}')"` : ""}>${cover ? '<span class="gallery-empty-cover" aria-hidden="true"></span>' : ""}<div>${body}</div></div>`;
    if (custom.releaseAt && data?.artist) {
      countdownTimer = setInterval(() => {
        const node = el.empty.querySelector("[data-countdown]");
        if (node) node.textContent = countdownText(custom.releaseAt);
      }, 30000);
    }
  }

  // ---------- Viewer render ----------
  function render() {
    const videos = visibleVideos();
    const artist = data?.artist;
    el.heading.textContent = artist ? `${artist.artistName} — videos.` : "Watch the artist.";
    el.intro.textContent = artist
      ? (data.mode === "dreamweaver_only"
        ? `${artist.artistName}'s Dreamweaver song videos, plus the visuals they choose to add.`
        : `Visuals hand-picked by ${artist.artistName}.`)
      : "Only the artist's own visuals: Dreamweaver song videos and the videos they choose to add.";
    el.status.textContent = artist
      ? (videos.length ? `${videos.length} visual${videos.length === 1 ? "" : "s"} · ${data.mode === "dreamweaver_only" ? "Dreamweaver + curated" : "Curated"}` : "Gallery empty")
      : "Choose an artist shop";
    el.stage.hidden = !videos.length;
    el.empty.hidden = Boolean(videos.length);
    if (videos.length) {
      if (!videos.some(video => video.id === activeId)) activeId = videos[0].id;
      loadVideo(activeId);
    } else {
      stopPlayback();
      el.grid.innerHTML = "";
      renderEmpty();
    }
    const owned = data?.ownedArtists || [];
    el.switchWrap.hidden = owned.length < 2;
    el.switchSelect.innerHTML = owned.map(item => `<option value="${escapeHtml(item.slug)}"${item.slug === artist?.slug ? " selected" : ""}>${escapeHtml(item.artistName)}</option>`).join("");
    el.editButton.hidden = !data?.canEdit;
    if (!data?.canEdit) { el.editor.hidden = true; el.editButton.setAttribute("aria-expanded", "false"); }
    if (data?.canEdit) renderEditor();
  }

  // ---------- Editor ----------
  const dreamweaverLink = song => {
    const params = new URLSearchParams({ song: song.id, experience: "studio" });
    if (currentTheme()) params.set("shopTheme", currentTheme());
    return `/dreamweaver/?${params}`;
  };

  function renderEditor() {
    el.editor.querySelectorAll('input[name="gallery-mode"]').forEach(input => { input.checked = input.value === data.mode; });
    const songs = data.songs || [];
    const songOptions = songs.map(song => `<option value="${escapeHtml(song.id)}">${escapeHtml(song.title)}</option>`).join("");

    el.items.innerHTML = data.videos.length ? data.videos.map((video, index) => {
      const song = songs.find(item => item.id === video.songId);
      const versionOptions = (song?.versions || []).map(version => `<option value="${escapeHtml(version.id)}"${version.id === video.versionId ? " selected" : ""}>${escapeHtml(version.label)}</option>`).join("");
      return `<li class="gallery-item${video.hidden ? " is-hidden" : ""}" data-item="${escapeHtml(video.id)}">
        <div class="gallery-item-head">
          <strong>${escapeHtml(video.title)}</strong>
          <span class="gallery-item-meta">${video.placement === "dreamweaver_auto" ? "Dreamweaver · auto" : video.origin === "dreamweaver" ? "Dreamweaver · added" : "Added by you"}${video.pinned ? " · Pinned" : ""}${video.hidden ? " · Hidden" : ""}</span>
        </div>
        <div class="gallery-item-actions">
          <button class="signal-btn-outline" type="button" data-act="up" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(video.title)} up">↑</button>
          <button class="signal-btn-outline" type="button" data-act="down" ${index === data.videos.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(video.title)} down">↓</button>
          <button class="signal-btn-outline" type="button" data-act="pin" aria-pressed="${video.pinned}">${video.pinned ? "Unpin" : "Pin to top"}</button>
          <button class="signal-btn-outline" type="button" data-act="visibility" aria-pressed="${video.hidden}">${video.hidden ? "Show" : "Hide"}</button>
          ${video.placement === "manual" ? '<button class="signal-btn-outline" type="button" data-act="remove">Remove</button>' : ""}
        </div>
        <div class="gallery-item-links">
          <label>Song<select class="signal-select" data-link-song><option value="">Not linked</option>${songOptions.replace(`value="${escapeHtml(video.songId)}"`, `value="${escapeHtml(video.songId)}" selected`)}</select></label>
          <label>Version<select class="signal-select" data-link-version ${song ? "" : "disabled"}><option value="">Any version</option>${versionOptions}</select></label>
          <label>Where it lives<select class="signal-select" data-scope>
            <option value="shop_only"${video.publishScope === "shop_only" ? " selected" : ""}>Only my shop</option>
            <option value="halo_feed"${video.publishScope === "halo_feed" ? " selected" : ""}>Shop + HALO feed</option>
          </select></label>
        </div>
        ${video.youtubePackage ? `<details class="gallery-package">
          <summary>YouTube package</summary>
          <label>Title<input class="signal-input" readonly value="${escapeHtml(video.youtubePackage.title)}"></label>
          <label>Description<textarea class="signal-input" readonly rows="7">${escapeHtml(video.youtubePackage.description)}</textarea></label>
          <p class="gallery-item-meta">Tags: ${escapeHtml(video.youtubePackage.tags.join(", "))}</p>
          <button class="signal-btn-outline" type="button" data-act="copy">Copy title + description</button>
        </details>` : ""}
      </li>`;
    }).join("") : '<li class="gallery-item-empty">Nothing in your gallery yet.</li>';

    const library = data.library || [];
    el.library.innerHTML = library.length
      ? `<p class="gallery-item-meta">Or add one of your existing videos:</p>${library.map(video => `<button class="signal-btn-outline" type="button" data-add-existing="${escapeHtml(video.id)}">+ ${escapeHtml(video.title)}${video.origin === "dreamweaver" ? " · Dreamweaver" : ""}</button>`).join("")}`
      : "";

    const missing = songs.filter(song => !song.hasVideo);
    el.songs.innerHTML = missing.length
      ? missing.map(song => `<div class="gallery-song"><span>${escapeHtml(song.title)}<small>${escapeHtml(song.versions.map(v => v.label).join(" · "))}</small></span><a class="signal-btn" href="${escapeHtml(dreamweaverLink(song))}">Make Dreamweaver video</a></div>`).join("")
      : '<p class="gallery-item-meta">Every song in your catalog has a visual.</p>';

    const selectedSong = el.songSelect.value;
    el.songSelect.innerHTML = `<option value="">Not linked</option>${songOptions}`;
    el.songSelect.value = songs.some(song => song.id === selectedSong) ? selectedSong : "";
    fillVersions(el.versionSelect, el.songSelect.value);

    const empty = data.emptyState || {};
    el.emptyForm.title.value = empty.title || "";
    el.emptyForm.note.value = empty.note || "";
    el.emptyForm.coverUrl.value = empty.coverUrl || "";
    el.emptyForm.releaseAt.value = empty.releaseAt ? toLocalInput(empty.releaseAt) : "";
  }

  function toLocalInput(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fillVersions(select, songId) {
    const song = (data?.songs || []).find(item => item.id === songId);
    select.innerHTML = `<option value="">Any version</option>${(song?.versions || []).map(version => `<option value="${escapeHtml(version.id)}">${escapeHtml(version.label)}</option>`).join("")}`;
    select.disabled = !song;
  }

  async function act(payload, success) {
    el.editorStatus.textContent = "Saving…";
    try {
      const response = await fetch(API, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ artist: data.artist.slug, ...payload })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "The gallery could not be saved.");
      data = body;
      render();
      el.editorStatus.textContent = success || "Saved.";
      return true;
    } catch (error) {
      el.editorStatus.textContent = error.message;
      return false;
    }
  }

  el.editor.addEventListener("change", event => {
    const target = event.target;
    if (target.name === "gallery-mode") return act({ action: "settings", mode: target.value }, target.value === "empty" ? "Gallery now starts empty." : "Dreamweaver song videos now attach automatically.");
    if (target === el.songSelect) return fillVersions(el.versionSelect, target.value);
    const item = target.closest("[data-item]");
    if (!item) return;
    const videoId = item.dataset.item;
    if (target.matches("[data-link-song]")) return act({ action: "link", videoId, songId: target.value, versionId: "" }, "Video linked to the song.");
    if (target.matches("[data-link-version]")) return act({ action: "link", videoId, songId: item.querySelector("[data-link-song]").value, versionId: target.value }, "Video linked to that version.");
    if (target.matches("[data-scope]")) return act({ action: "scope", videoId, publishScope: target.value }, target.value === "shop_only" ? "This video now lives only in your shop." : "This video is now eligible for the HALO video feed.");
  });

  el.editor.addEventListener("click", async event => {
    const existing = event.target.closest("[data-add-existing]");
    if (existing) return act({ action: "add", videoId: existing.dataset.addExisting }, "Added to your gallery.");
    const button = event.target.closest("[data-act]");
    const item = button?.closest("[data-item]");
    if (!button || !item) return;
    const videoId = item.dataset.item;
    const video = data.videos.find(entry => entry.id === videoId);
    const actName = button.dataset.act;
    if (actName === "up" || actName === "down") {
      const ids = data.videos.map(entry => entry.id);
      const from = ids.indexOf(videoId);
      const to = from + (actName === "up" ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return act({ action: "reorder", videoIds: ids }, "Order saved.");
    }
    if (actName === "pin") return act({ action: "pin", videoId: video.pinned ? "" : videoId }, video.pinned ? "Unpinned." : "Pinned to the top of your gallery.");
    if (actName === "visibility") return act({ action: "visibility", videoId, hidden: !video.hidden }, video.hidden ? "Video is visible again." : "Video hidden from visitors.");
    if (actName === "remove") return act({ action: "remove", videoId }, "Removed from your gallery. The video itself is still in your library.");
    if (actName === "copy" && video.youtubePackage) {
      try {
        await navigator.clipboard.writeText(`${video.youtubePackage.title}\n\n${video.youtubePackage.description}`);
        el.editorStatus.textContent = "YouTube title and description copied.";
      } catch {
        el.editorStatus.textContent = "Copy isn't available here — select the text and copy it manually.";
      }
    }
  });

  el.addForm.addEventListener("submit", async event => {
    event.preventDefault();
    const form = el.addForm;
    const ok = await act({
      action: "addLink",
      youtubeUrl: form.youtubeUrl.value, title: form.title.value, description: form.description.value,
      songId: form.songId.value, versionId: form.versionId.value, publishScope: form.publishScope.value,
      origin: form.dreamweaver.checked ? "dreamweaver" : "manual"
    }, "Video added to your gallery.");
    if (ok) form.reset();
  });

  el.emptyForm.addEventListener("submit", event => {
    event.preventDefault();
    const form = el.emptyForm;
    const releaseAt = form.releaseAt.value ? new Date(form.releaseAt.value).toISOString() : "";
    act({ action: "settings", emptyState: { title: form.title.value, note: form.note.value, coverUrl: form.coverUrl.value, releaseAt } }, "Empty-state card saved.");
  });

  function openEditor(open = el.editor.hidden) {
    el.editor.hidden = !open;
    el.editButton.setAttribute("aria-expanded", String(open));
    el.editButton.textContent = open ? "Close editor" : "Edit gallery";
    if (open) el.editor.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }
  el.editButton.addEventListener("click", () => openEditor());
  el.empty.addEventListener("click", event => { if (event.target.closest("[data-open-editor]")) openEditor(true); });

  // ---------- Viewer interactions ----------
  el.grid.addEventListener("click", event => {
    const card = event.target.closest("[data-video]");
    if (!card) return;
    loadVideo(card.dataset.video, { autoplay: true });
    el.stage.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  });
  el.cue.addEventListener("click", () => {
    if (!el.cue.dataset.song) return;
    loadVideo(activeId); // reloads the visual without autoplay so the song plays alone
    window.dispatchEvent(new CustomEvent("halo:cue-song", { detail: { songId: el.cue.dataset.song } }));
  });
  el.player.addEventListener("play", () => window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "video" } })));
  window.addEventListener("halo:shop-audio", event => {
    if (event.detail?.source === "video") return;
    if (!el.player.paused) el.player.pause();
    if (!el.frame.hidden && el.frame.src.includes("autoplay=1")) el.frame.src = el.frame.src.replace("&autoplay=1", "");
  });
  // Clicking a library track surfaces its matching visual (without starting the video).
  window.addEventListener("halo:library-track", event => {
    const songId = event.detail?.songId;
    if (!songId) return;
    const match = visibleVideos().find(video => video.songId === songId);
    if (match && match.id !== activeId) loadVideo(match.id);
  });
  el.switchSelect.addEventListener("change", () => {
    try { localStorage.setItem(ARTIST_KEY, el.switchSelect.value); } catch { /* ignore */ }
    load(el.switchSelect.value);
  });

  async function load(artist = requestedArtist()) {
    el.status.textContent = "Loading the gallery…";
    try {
      const query = artist ? `?artist=${encodeURIComponent(artist)}` : "";
      let response = await fetch(`${API}${query}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      // A stale remembered artist falls back to the default context.
      if (response.status === 404 && artist && !new URLSearchParams(location.search).get("artist")) {
        try { localStorage.removeItem(ARTIST_KEY); } catch { /* ignore */ }
        response = await fetch(API, { credentials: "same-origin", headers: { Accept: "application/json" } });
      }
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
    } catch {
      data = { artist: null, videos: [], shops: [], canEdit: false };
      el.status.textContent = "The gallery couldn't load — nothing else is shown in its place";
      el.stage.hidden = true;
      el.empty.hidden = false;
      renderEmpty();
      return;
    }
    render();
  }

  // Signing in or out changes who can edit (and which shop is the default).
  const watchIdentity = identity => identity?.onAuthChange?.(event => { if (event === "login" || event === "logout") load(); });
  if (window.haloIdentity) watchIdentity(window.haloIdentity);
  else window.addEventListener("halo-identity-ready", event => watchIdentity(event.detail), { once: true });
  load();
})();
