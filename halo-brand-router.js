const STORAGE_KEY = "halo_logo_ab_variant";
const VARIANTS = Object.freeze({
  SHOP: "Variant_A_Shop",
  DREAMWEAVER: "Variant_B_Dreamweaver"
});
const DESTINATIONS = Object.freeze({
  [VARIANTS.SHOP]: "/signal-network/#signal-feed",
  [VARIANTS.DREAMWEAVER]: "/signal-network/#dreamweaver"
});
const TEASERS = Object.freeze({
  [VARIANTS.SHOP]: "🛒 Explore exclusive releases — enter the Signal Marketplace →",
  [VARIANTS.DREAMWEAVER]: "✨ Shape your next idea — open Dreamweaver →"
});

export function createHaloBrandRouter({
  document = globalThis.document,
  window = globalThis.window,
  random = Math.random
} = {}) {
  if (!document?.addEventListener) return { getVariant: () => null, destroy() {} };

  let variant;
  let observer;

  function getVariant() {
    if (variant) return variant;
    let storage;
    try { storage = window?.localStorage; } catch {}
    try {
      const stored = storage?.getItem(STORAGE_KEY);
      if (Object.hasOwn(DESTINATIONS, stored)) {
        variant = stored;
        return variant;
      }
    } catch {}
    variant = random() < 0.5 ? VARIANTS.SHOP : VARIANTS.DREAMWEAVER;
    try { storage?.setItem(STORAGE_KEY, variant); } catch {}
    return variant;
  }

  function apply(root = document) {
    const assigned = getVariant();
    const destination = DESTINATIONS[assigned];
    const elements = selector => [
      ...(root.matches?.(selector) ? [root] : []),
      ...(root.querySelectorAll?.(selector) || [])
    ];
    for (const link of [...elements("[data-halo-logo-link]"), ...elements("[data-halo-teaser-link]")]) {
      if (link.getAttribute("href") !== destination) link.setAttribute("href", destination);
      link.dataset.haloVariant = assigned;
    }
    for (const teaser of elements("[data-halo-teaser-text]")) {
      const text = TEASERS[assigned];
      if (teaser.textContent !== text) teaser.textContent = text;
    }
  }

  function trackClick(event) {
    const target = event.target;
    if (typeof target?.closest !== "function") return;
    const link = target.closest("[data-halo-logo-link], [data-halo-teaser-link]");
    if (!link) return;
    const assigned = getVariant();
    const metadata = {
      target: link.hasAttribute("data-halo-logo-link") ? "logo" : "teaser",
      variant: assigned,
      destination: DESTINATIONS[assigned]
    };
    try { window?.haloStats?.track?.("halo_logo_router_click", metadata); } catch {}
    try { window?.gtag?.("event", "halo_logo_router_click", metadata); } catch {}
  }

  apply();
  document.addEventListener("click", trackClick);
  if (typeof window?.MutationObserver === "function" && document.documentElement) {
    observer = new window.MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1) apply(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  return {
    getVariant,
    destroy() {
      document.removeEventListener?.("click", trackClick);
      observer?.disconnect();
    }
  };
}

if (globalThis.document) createHaloBrandRouter();
