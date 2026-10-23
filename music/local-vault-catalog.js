(() => {
  function hydrateLocalCatalog() {
    const surface = document.getElementById("localVaultCatalog");
    const grid = document.getElementById("localVaultTracks");
    if (!surface || !grid) return;

    let catalog;
    try {
      const raw = window.localStorage.getItem("halo_master_vault_catalog");
      if (!raw || raw.length > 1024 * 1024) return;
      catalog = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(catalog) || catalog.length > 1000) return;

    const text = value => typeof value === "string" ? value.trim().slice(0, 200) : "";
    const cards = [];
    for (const track of catalog) {
      if (!track || typeof track !== "object" || Array.isArray(track)) continue;
      const title = text(track.title);
      if (!title) continue;
      const card = document.createElement("article");
      card.className = "release-card";
      const copy = document.createElement("div");
      copy.className = "card-copy";
      const heading = document.createElement("h3");
      heading.textContent = title;
      const artist = document.createElement("p");
      artist.className = "card-artist";
      artist.textContent = text(track.artist) || "Artist not supplied";
      copy.append(heading, artist);
      card.append(copy);
      cards.push(card);
    }
    grid.replaceChildren(...cards);
    surface.hidden = cards.length === 0;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrateLocalCatalog, { once: true });
  } else {
    hydrateLocalCatalog();
  }
})();
