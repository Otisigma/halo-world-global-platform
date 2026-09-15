(() => {
  "use strict";

  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const panels = Array.from(document.querySelectorAll(".editor-panel"));
  const songCatalogFrame = document.getElementById("songCatalogFrame");
  const releaseHouseFrame = document.getElementById("releaseHouseFrame");
  let lastSongCatalogHeight = 0;
  const tabMap = {
    songs: "songCatalogPanel",
    release: "releaseMetadataPanel"
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

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const targetPanelId = tabMap[requestedTab] || "songCatalogPanel";
  activatePanel(targetPanelId);
})();
