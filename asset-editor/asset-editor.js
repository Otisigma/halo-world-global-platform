(() => {
  "use strict";

  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const panels = Array.from(document.querySelectorAll(".editor-panel"));
  const songCatalogFrame = document.getElementById("songCatalogFrame");
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

  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget);
      if (button.dataset.tabTarget === "songCatalogPanel") setSongCatalogSource();
    });
  });

  window.addEventListener("message", event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "halo-song-catalog-height") return;
    const height = Number(event.data.height || 0);
    if (!songCatalogFrame || !Number.isFinite(height) || height < 200) return;
    songCatalogFrame.style.height = `${Math.max(700, Math.round(height))}px`;
  });

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const targetPanelId = tabMap[requestedTab] || "songCatalogPanel";
  setActiveTab(targetPanelId);
  setSongCatalogSource();
})();
