// HALO Song Catalog → Artist Shop bridge.
// Loads the tracks that the Song Catalog has published to Shop & Charts (via /api/release-catalog)
// and shows them as buyable releases on the Artist Shop, grouped by artist.
(() => {
  const PAGE_SIZE = 12;
  const CHANNEL = "halo-catalog-shop";
  const root = document.querySelector("#catalog-tracks");
  if (!root) return;

  const elements = {
    grid: root.querySelector("#catalog-track-grid"),
    status: root.querySelector("#catalog-track-status"),
    filters: root.querySelector("#catalog-track-filters"),
    search: root.querySelector("#catalog-track-search"),
    more: root.querySelector("#catalog-track-more"),
    error: root.querySelector("#catalog-track-error"),
    retry: root.querySelector("#catalog-track-retry")
  };

  const state = { tracks: [], artist: "all", query: "", visible: PAGE_SIZE, playingId: "", loading: false };
  const audio = new Audio();
  audio.preload = "none";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeUrl(value) {
    const raw = String(value || "").trim();
    if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function formatPrice(cents, currency) {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    // Follow the shop's GBP/USD toggle when the shop experience layer is loaded.
    if (window.haloShopMoney) return window.haloShopMoney.format(cents, currency);
    const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "USD";
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).format(cents / 100);
    } catch {
      return `${code} ${(cents / 100).toFixed(2)}`;
    }
  }

  // Only tracks that came from the Song Catalog and whose rights are not disputed are shown.
  function toTrack(release) {
    const catalog = release?.catalog || {};
    if (catalog.source !== "song-catalog" || !release.id) return null;
    if (String(catalog.rightsStatus || "").toLowerCase() === "disputed") return null;
    const saleStatus = String(catalog.saleStatus || "").toLowerCase();
    const priceCents = Number(catalog.salePriceCents);
    const shopUrl = safeUrl(release.publication?.canonicalUrl) || `/music/?song=${encodeURIComponent(release.id)}`;
    const preview = safeUrl(catalog.masterCopy?.audioSource)
      || (release.storefront?.hasPlayableStream ? safeUrl(release.streamUrl) : "");
    return {
      id: String(release.id),
      songId: String(catalog.songId || ""),
      title: catalog.title || release.title || "Untitled",
      artist: catalog.artistName || release.artist || "HALO artist",
      album: release.albumTitle || "",
      genre: (release.genres || [])[0] || catalog.genre || "",
      artwork: safeUrl(release.artwork || catalog.artworkUrl),
      preview,
      shopUrl,
      saleStatus,
      priceMinor: Number.isFinite(priceCents) ? priceCents : 0,
      currency: /^[A-Z]{3}$/.test(String(catalog.currency || "")) ? catalog.currency : "USD",
      get price() { return saleStatus === "for_sale" ? formatPrice(this.priceMinor, this.currency) : ""; },
      releaseDate: release.releaseDate || ""
    };
  }

  function artistKey(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Groups artists case-insensitively so "DJ Halo x" and "DJ Halo X" share one filter.
  function artists() {
    const groups = new Map();
    state.tracks.forEach(track => {
      const key = artistKey(track.artist);
      const group = groups.get(key) || { key, name: track.artist, count: 0 };
      group.count += 1;
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function filteredTracks() {
    const query = state.query.trim().toLowerCase();
    return state.tracks.filter(track =>
      (state.artist === "all" || artistKey(track.artist) === state.artist)
      && (!query || `${track.title} ${track.artist} ${track.album} ${track.genre}`.toLowerCase().includes(query)));
  }

  function renderFilters() {
    const list = artists();
    elements.filters.innerHTML = [
      `<button class="filter-button${state.artist === "all" ? " is-active" : ""}" type="button" data-artist="all" aria-pressed="${state.artist === "all"}">All artists</button>`,
      ...list.map(({ key, name, count }) => `<button class="filter-button${state.artist === key ? " is-active" : ""}" type="button" data-artist="${escapeHtml(key)}" aria-pressed="${state.artist === key}">${escapeHtml(name)} · ${count}</button>`)
    ].join("");
  }

  function saleLabel(track) {
    if (track.saleStatus === "for_sale" && track.price) return { cta: "Buy", note: track.price };
    if (track.saleStatus === "coming_soon") return { cta: "Preview", note: "Coming soon" };
    return { cta: "Listen", note: "Streaming" };
  }

  function renderGrid() {
    const tracks = filteredTracks();
    const shown = tracks.slice(0, state.visible);
    if (!tracks.length) {
      elements.grid.innerHTML = state.tracks.length
        ? '<div class="empty-state"><h3>No matching tracks.</h3><p>Try another artist or search term.</p></div>'
        : '<div class="empty-state"><h3>No catalog tracks are live yet.</h3><p>Tracks appear here as soon as they are pushed to Shop &amp; Charts from the HALO Song Catalog.</p></div>';
    } else {
      elements.grid.innerHTML = shown.map((track, index) => {
        const sale = saleLabel(track);
        const playing = state.playingId === track.id;
        return `
        <article class="catalog-track-card" style="animation-delay:${Math.min(index, 11) * 35}ms">
          <div class="catalog-track-art">
            ${track.artwork ? `<img src="${escapeHtml(track.artwork)}" alt="" loading="lazy" decoding="async">` : `<span aria-hidden="true">${escapeHtml(track.title.slice(0, 2))}</span>`}
            ${track.preview ? `<button class="catalog-track-play${playing ? " is-playing" : ""}" type="button" data-play="${escapeHtml(track.id)}" aria-pressed="${playing}" aria-label="${playing ? "Pause" : "Play"} ${escapeHtml(track.title)}">${playing ? "❚❚" : "▶"}</button>` : ""}
          </div>
          <p class="product-type">${escapeHtml(track.genre || "HALO release")}</p>
          <h3>${escapeHtml(track.title)}</h3>
          <p class="product-creator">${escapeHtml(track.artist)}${track.album ? ` · ${escapeHtml(track.album)}` : ""}</p>
          <div class="catalog-track-footer">
            <span class="product-price">${escapeHtml(sale.note)}</span>
            <a class="button button-primary" href="${escapeHtml(track.shopUrl)}">${sale.cta} <span aria-hidden="true">→</span></a>
          </div>
        </article>`;
      }).join("");
    }
    elements.more.hidden = tracks.length <= state.visible;
    elements.more.textContent = `Show more (${tracks.length - shown.length} left)`;
  }

  function renderStatus() {
    const forSale = state.tracks.filter(track => track.saleStatus === "for_sale" && track.price).length;
    const artistCount = artists().length;
    elements.status.textContent = `${state.tracks.length} tracks from the HALO Song Catalog · ${artistCount} artist${artistCount === 1 ? "" : "s"} · ${forSale} on sale now`;
  }

  function render() {
    renderFilters();
    renderGrid();
    renderStatus();
  }

  async function load({ fresh = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    elements.error.hidden = true;
    if (!state.tracks.length) elements.status.textContent = "Loading published tracks from the HALO Song Catalog…";
    try {
      // A fresh query string skips the CDN copy so a just-synced track appears straight away.
      const url = fresh ? `/api/release-catalog?shop=${Date.now()}` : "/api/release-catalog";
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
      const data = await response.json();
      const seen = new Set();
      state.tracks = (Array.isArray(data.releases) ? data.releases : [])
        .map(toTrack)
        .filter(track => track && !seen.has(track.id) && seen.add(track.id));
      if (state.artist !== "all" && !state.tracks.some(track => artistKey(track.artist) === state.artist)) state.artist = "all";
      render();
      window.dispatchEvent(new CustomEvent("halo:artist-shop-catalog", { detail: { tracks: state.tracks.slice() } }));
    } catch (error) {
      console.warn("Artist Shop could not load the HALO Song Catalog", error);
      if (!state.tracks.length) {
        elements.grid.innerHTML = "";
        elements.more.hidden = true;
        elements.error.hidden = false;
        elements.status.textContent = "The HALO Song Catalog could not be reached.";
      }
    } finally {
      state.loading = false;
    }
  }

  function togglePlay(id) {
    const track = state.tracks.find(item => item.id === id);
    if (!track?.preview) return;
    if (state.playingId === id && !audio.paused) {
      audio.pause();
      return;
    }
    if (state.playingId !== id) {
      audio.src = track.preview;
      state.playingId = id;
    }
    window.dispatchEvent(new CustomEvent("halo:shop-audio", { detail: { source: "catalog-grid" } }));
    audio.play().catch(() => {
      state.playingId = "";
      renderGrid();
    });
    renderGrid();
  }

  // Switching tracks fires a pause for the old source after play() has started the new one,
  // so only clear the playing marker if playback is genuinely stopped.
  audio.addEventListener("pause", () => {
    if (!audio.paused) return;
    state.playingId = "";
    renderGrid();
  });
  audio.addEventListener("ended", () => { state.playingId = ""; renderGrid(); });

  // Only one HALO player sounds at a time: pause when the library or a video starts.
  window.addEventListener("halo:shop-audio", event => {
    if (event.detail?.source !== "catalog-grid" && !audio.paused) audio.pause();
  });
  window.addEventListener("halo:currency-change", () => { renderGrid(); renderStatus(); });

  elements.filters.addEventListener("click", event => {
    const button = event.target.closest("[data-artist]");
    if (!button) return;
    state.artist = button.dataset.artist;
    state.visible = PAGE_SIZE;
    renderFilters();
    renderGrid();
  });
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    state.visible = PAGE_SIZE;
    renderGrid();
  });
  elements.grid.addEventListener("click", event => {
    const button = event.target.closest("[data-play]");
    if (button) togglePlay(button.dataset.play);
  });
  elements.more.addEventListener("click", () => {
    state.visible += PAGE_SIZE;
    renderGrid();
  });
  elements.retry.addEventListener("click", () => load({ fresh: true }));

  // Refresh when the Song Catalog pushes a track to the shop (same tab or another open tab).
  window.addEventListener("halo:catalog-shop-synced", () => load({ fresh: true }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener("message", () => load({ fresh: true }));
  } catch {
    // BroadcastChannel is unavailable in some older browsers; the page still loads on open.
  }

  window.haloArtistShopCatalog = { reload: () => load({ fresh: true }), tracks: () => state.tracks.slice() };
  load();
})();
