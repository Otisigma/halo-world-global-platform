// HALO Artist Shop — dynamic artist storefronts.
// Resolves which artist's storefront is showing (?artist=<slug>, or the artist the video gallery
// settles on for a signed-in owner), loads that artist's profile and Song Catalog songs from
// /api/artist-storefront, renders the profile card (name, role, bio), and broadcasts the artist
// scope so the release feed, Signal Drops and Always-On Library show only this artist's music.
//
// Events:
//   halo:shop-artist          (in)  { slug }               — announced by the video gallery
//   halo:shop-artist-profile  (out) { profile, songIds }   — profile is null on the all-artists view
//   halo:shop-profile-released (out)                      — no real storefronts; demo creators may render
(() => {
  const API = "/api/artist-storefront";
  const feature = document.querySelector("#artist-feature");
  const list = document.querySelector("#artist-list");
  if (!feature || !list) return;

  const CREDIT_SPLIT = /\s*(?:&|,|\+|\/|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b)\s*/i;
  const artistKey = name => String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const credited = name => {
    const full = artistKey(name);
    return full ? [...new Set([full, ...full.split(CREDIT_SPLIT).map(part => part.trim()).filter(Boolean)])] : [];
  };
  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const initials = name => String(name || "").split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();

  const state = { slug: null, profile: null, songIds: new Set(), songs: [], storefronts: [], loadedFor: undefined, requestId: 0 };
  const original = {
    title: document.title,
    eyebrow: document.querySelector(".signal-hero .signal-eyebrow")?.textContent || "",
    heading: document.querySelector("#artists-title")?.textContent || "",
    note: document.querySelector("#artists .section-note")?.textContent || ""
  };

  // Shared API for the other shop scripts (catalog-tracks.js, shop-experience.js, artist-persona.js).
  window.haloShopArtist = {
    ownsProfileCard: true,
    get profile() { return state.profile; },
    get songIds() { return new Set(state.songIds); },
    /** True when a track belongs on the current storefront (always true on the all-artists view). */
    includes(track) {
      if (!state.profile) return true;
      if (track?.songId && state.songIds.has(String(track.songId))) return true;
      if (track?.id && state.songIds.has(String(track.id))) return true;
      return credited(track?.artist).includes(artistKey(state.profile.name));
    }
  };

  function announce() {
    window.dispatchEvent(new CustomEvent("halo:shop-artist-profile", {
      detail: { profile: state.profile, songIds: [...state.songIds] }
    }));
  }

  function setPageCopy(profile) {
    const eyebrow = document.querySelector(".signal-hero .signal-eyebrow");
    const heading = document.querySelector("#artists-title");
    const note = document.querySelector("#artists .section-note");
    const tracksHeading = document.querySelector("#catalog-tracks-title");
    if (profile) {
      document.title = `${profile.name} — HALO Artist Shop`;
      if (eyebrow) eyebrow.textContent = `${profile.name} · ${profile.role} · UK Sterling (£)`;
      if (heading) heading.textContent = `${profile.name}'s storefront.`;
      if (note) note.textContent = "Profile, releases and playlist for this artist, straight from the HALO Song Catalog.";
      if (tracksHeading) tracksHeading.textContent = `Released music, direct from ${profile.name}.`;
    } else {
      document.title = original.title;
      if (eyebrow) eyebrow.textContent = original.eyebrow;
      if (heading) heading.textContent = original.heading;
      if (note) note.textContent = original.note;
      if (tracksHeading) tracksHeading.textContent = "Released music, direct from the artist.";
    }
  }

  function artHtml(profile) {
    const accent = escapeHtml(profile.accent || "#d5ff52");
    if (profile.artwork) {
      return `<div class="artist-art artist-art--photo" style="--artist-accent:${accent}">
        <img src="${escapeHtml(profile.artwork)}" alt="" loading="eager" decoding="async">
      </div>`;
    }
    return `<div class="artist-art" style="--artist-accent:${accent}" data-initials="${escapeHtml(initials(profile.name))}"></div>`;
  }

  function renderProfile() {
    const profile = state.profile;
    const songs = state.songs;
    const onSale = songs.filter(song => song.saleStatus === "for_sale" && song.priceMinor > 0).length;
    const meta = [profile.location, profile.role].filter(Boolean).join(" · ");
    feature.innerHTML = `
      ${artHtml(profile)}
      <div class="artist-feature-copy">
        <small>${escapeHtml(meta || "HALO artist")}</small>
        <h3>${escapeHtml(profile.name)}</h3>
        <p class="artist-feature-role">${escapeHtml(profile.role)}</p>
        <p class="artist-feature-bio">${escapeHtml(profile.bio)}</p>
        <small>${songs.length} ${songs.length === 1 ? "song" : "songs"} in the HALO Song Catalog · ${onSale} on sale${profile.currentRelease?.title ? ` · Now: ${escapeHtml(profile.currentRelease.title)}` : ""}</small>
        <div class="artist-feature-actions">
          <a class="signal-btn-outline" href="${escapeHtml(profile.roomUrl)}">Visit artist room <span aria-hidden="true">↗</span></a>
          <a class="signal-btn-outline" href="#catalog-tracks">Releases</a>
          <a class="signal-btn-outline" href="#always-on-library">Playlist</a>
          ${profile.persona ? `<button class="signal-btn" type="button" data-open-persona>Talk with ${escapeHtml(profile.persona.name)} <span class="ai-chip">AI</span></button>` : ""}
        </div>
      </div>`;
    feature.querySelector("[data-open-persona]")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("halo:open-persona"));
    });
  }

  function renderPicker() {
    feature.innerHTML = `
      <div class="artist-art" style="--artist-accent:#d5ff52" data-initials="HA"></div>
      <div class="artist-feature-copy">
        <small>HALO Artist Shop · ${state.storefronts.length} artist ${state.storefronts.length === 1 ? "storefront" : "storefronts"}</small>
        <h3>Choose an artist.</h3>
        <p class="artist-feature-bio">Every artist has their own storefront: their profile, their releases and their playlist, straight from the HALO Song Catalog.</p>
      </div>`;
  }

  function renderList() {
    const rows = state.storefronts.filter(item => item.slug !== state.slug);
    const allRow = state.profile
      ? `<a class="artist-row" href="${location.pathname}" style="--artist-accent:#d5ff52">
          <span class="artist-row-index">00</span>
          <span><strong>All artists</strong><small>Every release in the HALO Song Catalog</small></span>
          <span class="artist-row-arrow" aria-hidden="true">↺</span>
        </a>`
      : "";
    list.setAttribute("aria-label", "Artist storefronts");
    list.innerHTML = allRow + rows.map((item, index) => `
      <a class="artist-row" href="?artist=${encodeURIComponent(item.slug)}" style="--artist-accent:${escapeHtml(item.accent)}">
        <span class="artist-row-index">${String(index + 1).padStart(2, "0")}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.location, item.role].filter(Boolean).join(" · ") || "HALO artist")}</small></span>
        <span class="artist-row-arrow" aria-hidden="true">↗</span>
      </a>`).join("");
    if (!list.innerHTML.trim()) list.innerHTML = '<p class="artist-list-empty">More artist storefronts open soon.</p>';
  }

  function releaseToDemo() {
    window.haloShopArtist.ownsProfileCard = false;
    window.dispatchEvent(new CustomEvent("halo:shop-profile-released"));
  }

  async function load(slug) {
    const normalised = String(slug || "").trim().toLowerCase();
    if (state.loadedFor === normalised) return;
    state.loadedFor = normalised;
    const requestId = ++state.requestId;
    try {
      const query = normalised ? `?artist=${encodeURIComponent(normalised)}` : "";
      let response = await fetch(`${API}${query}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 404 && normalised) response = await fetch(API, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (requestId !== state.requestId) return;
      state.profile = data.artist || null;
      state.slug = state.profile?.slug || null;
      state.songs = Array.isArray(data.songs) ? data.songs : [];
      state.songIds = new Set((data.songIds || []).map(String));
      state.storefronts = Array.isArray(data.storefronts) ? data.storefronts : [];
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.warn("Artist storefront could not load", error);
      state.profile = null;
      state.slug = null;
      state.songs = [];
      state.songIds = new Set();
      state.storefronts = [];
    }

    setPageCopy(state.profile);
    if (state.profile) {
      window.haloShopArtist.ownsProfileCard = true;
      renderProfile();
      renderList();
    } else if (state.storefronts.length) {
      window.haloShopArtist.ownsProfileCard = true;
      renderPicker();
      renderList();
    } else {
      // No real storefronts are published yet: fall back to the concept creator profiles.
      releaseToDemo();
    }
    announce();
  }

  const requested = new URLSearchParams(location.search).get("artist");
  if (requested) load(requested);

  // The video gallery settles which shop is showing (it also knows a signed-in owner's default
  // page), so the storefront follows it. Without ?artist= we wait briefly for that answer.
  window.addEventListener("halo:shop-artist", event => {
    const slug = String(event.detail?.slug || "");
    if (requested && !slug) return;
    load(slug);
  });
  if (!requested) setTimeout(() => { if (state.loadedFor === undefined) load(""); }, 3500);
})();
