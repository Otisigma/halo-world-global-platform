(() => {
  const narrowQuery = window.matchMedia("(max-width: 767px)");
  const mobileQuery = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const dismissalKey = "halo-install-dismissed-until";
  let installPrompt;
  let installCard;

  const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;

  const syncNavigationMenu = () => {
    document.querySelectorAll(".halo-mobile-menu").forEach(menu => {
      const nextMode = narrowQuery.matches ? "mobile" : "desktop";
      if (menu.dataset.haloViewport === nextMode) return;
      menu.open = false;
      menu.dataset.haloViewport = nextMode;
    });
  };

  const closeNavigationMenus = except => {
    document.querySelectorAll(".halo-mobile-menu[open]").forEach(menu => {
      if (menu !== except) menu.open = false;
    });
  };

  const isDismissed = () => {
    try {
      return Number(window.localStorage.getItem(dismissalKey) || 0) > Date.now();
    } catch {
      return false;
    }
  };

  const removeInstallCard = () => {
    installCard?.remove();
    installCard = null;
    document.body.classList.remove("halo-install-visible");
  };

  const dismissInstallCard = () => {
    try {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      window.localStorage.setItem(dismissalKey, String(Date.now() + sevenDays));
    } catch {
      // The prompt can still be dismissed for this page view.
    }
    removeInstallCard();
  };

  const showManualInstructions = () => {
    if (!installCard) return;
    const copy = installCard.querySelector("small");
    const action = installCard.querySelector(".halo-install-action");
    const isAppleMobile = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    copy.textContent = isAppleMobile
      ? "In Safari, tap Share, then Add to Home Screen."
      : "Open your browser menu and choose Add to Home screen.";
    action.textContent = "Got it";
    action.addEventListener("click", dismissInstallCard, { once: true });
  };

  const requestInstall = async () => {
    if (!installPrompt) {
      showManualInstructions();
      return;
    }

    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    if (choice.outcome === "accepted") removeInstallCard();
  };

  const showInstallCard = () => {
    if (installCard || !mobileQuery.matches || isStandalone() || isDismissed()) return;

    installCard = document.createElement("aside");
    installCard.className = "halo-install-card";
    installCard.setAttribute("aria-label", "Add HALO to your phone home screen");
    installCard.innerHTML = `
      <span class="halo-install-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="14" stroke="currentColor" stroke-width="4"/>
          <ellipse cx="24" cy="24" rx="19" ry="6" stroke="currentColor" stroke-width="2.5" transform="rotate(-18 24 24)"/>
        </svg>
      </span>
      <span class="halo-install-copy">
        <strong>Add HALO to your phone</strong>
        <small>Open the site in one tap, like your other apps.</small>
      </span>
      <button class="halo-install-action" type="button" data-stat-event="install_halo_app">Add</button>
      <button class="halo-install-dismiss" type="button" aria-label="Dismiss home screen prompt">×</button>`;

    installCard.querySelector(".halo-install-action").addEventListener("click", requestInstall);
    installCard.querySelector(".halo-install-dismiss").addEventListener("click", dismissInstallCard);
    document.body.append(installCard);
    document.body.classList.add("halo-install-visible");
  };

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    showInstallCard();
  });

  window.addEventListener("appinstalled", removeInstallCard);
  narrowQuery.addEventListener?.("change", syncNavigationMenu);
  standaloneQuery.addEventListener?.("change", event => {
    if (event.matches) removeInstallCard();
  });

  document.addEventListener("click", event => {
    const activeMenu = event.target.closest(".halo-mobile-menu");
    if (!activeMenu) {
      closeNavigationMenus();
      return;
    }

    if (event.target.closest(".halo-site-actions a, .halo-site-actions button")) {
      activeMenu.open = false;
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeNavigationMenus();
  });

  document.addEventListener("toggle", event => {
    const menu = event.target.closest?.(".halo-mobile-menu");
    if (menu?.open) closeNavigationMenus(menu);
  }, true);

  const navigationObserver = new MutationObserver(() => {
    if (!document.querySelector(".halo-mobile-menu")) return;
    syncNavigationMenu();
    navigationObserver.disconnect();
  });
  navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
  syncNavigationMenu();

  if ("serviceWorker" in window.navigator) {
    window.addEventListener("load", () => {
      window.navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  window.setTimeout(showInstallCard, 1800);
})();
