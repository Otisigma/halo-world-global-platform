(() => {
  "use strict";

  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const panels = Array.from(document.querySelectorAll(".editor-panel"));
  const editorContext = document.getElementById("editorContext");
  const songCatalogFrame = document.getElementById("songCatalogFrame");
  const releaseHouseFrame = document.getElementById("releaseHouseFrame");
  let lastSongCatalogHeight = 0;
  const tabMap = {
    songs: "songCatalogPanel",
    release: "releaseMetadataPanel"
  };
  const surfaceMap = {
    "song-catalog-artwork": { panelId: "songCatalogPanel", label: "Song Catalog · album artwork" },
    "song-catalog-version-artwork": { panelId: "songCatalogPanel", label: "Song Catalog · version cover art" },
    "campaign-visual-asset": { panelId: "songCatalogPanel", label: "Campaign Studio · visual asset override" },
    "artwork-manager": { panelId: "songCatalogPanel", label: "Artwork Manager · library and uploads" },
    "single-cover-lab": { panelId: "songCatalogPanel", label: "Single Cover Lab · artwork and media" },
    "release-house-artwork": { panelId: "songCatalogPanel", label: "Release House · artwork room" },
    "release-house-metadata": { panelId: "releaseMetadataPanel", label: "Release House · release metadata" },
    "artists-release-artwork": { panelId: "songCatalogPanel", label: "Artist Room · release artwork" },
    "mixes-artwork": { panelId: "songCatalogPanel", label: "Mixes · artwork" }
  };

  function setSongCatalogSource() {
    if (!songCatalogFrame || songCatalogFrame.src) return;
    const url = new URL("/song-catalog/", window.location.origin);
    url.searchParams.set("parentOrigin", window.location.origin);
    songCatalogFrame.src = url.toString();
  }

  function setReleaseHouseSource() {
    if (!releaseHouseFrame || releaseHouseFrame.src) return;
    releaseHouseFrame.src = new URL("/release-house/", window.location.origin).toString();
  }

  function setActiveTab(panelId) {
    panels.forEach(panel => {
      const active = panel.id === panelId;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    tabButtons.forEach(button => {
      const active = button.dataset.tabTarget === panelId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function activatePanel(panelId) {
    setActiveTab(panelId);
    if (panelId === "songCatalogPanel") setSongCatalogSource();
    if (panelId === "releaseMetadataPanel") setReleaseHouseSource();
  }

  function setEditorContext(label) {
    if (!editorContext) return;
    if (!label) {
      editorContext.hidden = true;
      editorContext.textContent = "";
      return;
    }
    editorContext.hidden = false;
    editorContext.textContent = `Opened from ${label}`;
  }

  function focusTab(index) {
    const target = tabButtons[index];
    if (!target) return;
    target.focus();
    activatePanel(target.dataset.tabTarget);
  }

  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      activatePanel(button.dataset.tabTarget);
    });
    button.addEventListener("keydown", event => {
      const currentIndex = tabButtons.indexOf(button);
      if (event.key === "ArrowRight") {
        event.preventDefault();
        focusTab((currentIndex + 1) % tabButtons.length);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusTab((currentIndex - 1 + tabButtons.length) % tabButtons.length);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusTab(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusTab(tabButtons.length - 1);
      }
    });
  });

  window.addEventListener("message", event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "halo-song-catalog-height") return;
    if (event.source !== songCatalogFrame?.contentWindow) return;
    const height = Number(event.data.height || 0);
    if (!songCatalogFrame || !Number.isFinite(height) || height < 200) return;
    const nextHeight = Math.max(700, Math.round(height));
    if (nextHeight === lastSongCatalogHeight) return;
    lastSongCatalogHeight = nextHeight;
    songCatalogFrame.style.height = `${nextHeight}px`;
  });

  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface");
  const requestedTab = params.get("tab");
  const surfaceConfig = surfaceMap[surface] || null;
  const targetPanelId = surfaceConfig?.panelId || tabMap[requestedTab] || "songCatalogPanel";
  setEditorContext(surfaceConfig?.label || "");
  activatePanel(targetPanelId);
})();
