import { canonicalizeRoutePath } from "./route-registry.js";

const DASH_FIX_AGENTS = Object.freeze({
  routing: "Routing Agent",
  ui: "UI Agent",
  playback: "Playback Agent",
  content: "Content Agent"
});

export function canonicalizeWatcherTarget(rawTarget = "") {
  const target = String(rawTarget || "").trim();
  if (!target) return "";
  try {
    const resolved = new URL(target, "https://halo.world");
    return canonicalizeRoutePath(resolved.pathname);
  } catch {
    return canonicalizeRoutePath(target);
  }
}

export const HALO_BUTTON_WATCHER_REGISTRY = Object.freeze([
  {
    id: "index-album-concierge",
    label: "Album Concierge (private landing card)",
    pageRoute: "/private",
    selector: 'a.release-feature[href="/album-concierge/"]',
    target: "/album-concierge/",
    expectedBehavior: "Open the Create Your Album route.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/album-concierge"]
  },
  {
    id: "halo-menu-music",
    label: "All Music (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_music_catalog"][href="/music/"]',
    target: "/music/",
    expectedBehavior: "Open the permanent music catalog.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/music", "/music/index.html"]
  },
  {
    id: "halo-menu-radio",
    label: "HALO Radio (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_halo_radio"][href="/radio/"]',
    target: "/radio/",
    expectedBehavior: "Open the HALO Radio route.",
    ownerAgent: DASH_FIX_AGENTS.playback,
    legacyTargets: ["/radio", "/radio/index.html"]
  },
  {
    id: "halo-menu-dj-deck",
    label: "Live DJ Deck (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_dj_deck"][href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open the DJ deck command route.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "halo-menu-halo-live",
    label: "HALO Live (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_halo_live"][href="/halo-live.html"]',
    target: "/halo-live.html",
    expectedBehavior: "Open the HALO Live broadcast room.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-live"]
  },
  {
    id: "halo-menu-halo-x",
    label: "DJ HALO X (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_halo_x"][href="/halo-x.html"]',
    target: "/halo-x.html",
    expectedBehavior: "Open the DJ HALO X room.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-x"]
  },
  {
    id: "halo-menu-creators",
    label: "Creator World (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_creator_world"][href="/creators/"]',
    target: "/creators/",
    expectedBehavior: "Open the creator world route.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/creators", "/creators/index.html"]
  },
  {
    id: "halo-menu-dreamweaver",
    label: "Dreamweaver Experience (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_dreamweaver_show"][href="/dreamweaver/"]',
    target: "/dreamweaver/",
    expectedBehavior: "Open the Dreamweaver route.",
    ownerAgent: DASH_FIX_AGENTS.content,
    legacyTargets: ["/dreamweaver", "/dreamweaver/index.html"]
  },
  {
    id: "halo-menu-support",
    label: "Feedback Desk (HALO menu)",
    pageRoute: "/halo",
    selector: 'a[data-stat-event="open_feedback_desk"][href="/support/"]',
    target: "/support/",
    expectedBehavior: "Open the support route.",
    ownerAgent: DASH_FIX_AGENTS.ui,
    legacyTargets: ["/support"]
  },
  {
    id: "halo-x-open-console",
    label: "Enter the console (HALO X hero)",
    pageRoute: "/halo-x.html",
    selector: 'a.button-primary[href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open DJ deck from HALO X.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "halo-live-nav-dj-deck",
    label: "DJ deck (HALO Live nav)",
    pageRoute: "/halo-live.html",
    selector: 'a.nav-link[href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open DJ deck from HALO Live nav.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "halo-live-cta-dj-deck",
    label: "Open the DJ deck (HALO Live CTA)",
    pageRoute: "/halo-live.html",
    selector: 'a.button[href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open DJ deck from HALO Live CTA.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "dj-deck-header-live",
    label: "HALO Live (DJ deck header)",
    pageRoute: "/dj-deck.html",
    selector: 'a.compact-button[data-stat-event="open_halo_live"][href="/halo-live.html"]',
    target: "/halo-live.html",
    expectedBehavior: "Open HALO Live from DJ deck.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-live"]
  },
  {
    id: "dj-deck-header-halo-x",
    label: "DJ HALO X (DJ deck header)",
    pageRoute: "/dj-deck.html",
    selector: 'a.compact-button[href="/halo-x.html"]',
    target: "/halo-x.html",
    expectedBehavior: "Open HALO X from DJ deck.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-x"]
  },
  {
    id: "music-nav-world",
    label: "World (music nav)",
    pageRoute: "/music/",
    selector: 'nav a[href="/halo"]',
    target: "/halo",
    expectedBehavior: "Return to the HALO world portal.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/"]
  },
  {
    id: "music-nav-dj-deck",
    label: "DJ Deck (music nav)",
    pageRoute: "/music/",
    selector: 'nav a[href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open DJ deck from music catalog.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "radio-nav-hub",
    label: "Hub (radio nav)",
    pageRoute: "/radio/",
    selector: 'nav a[href="/halo"]',
    target: "/halo",
    expectedBehavior: "Return to HALO world from radio.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/"]
  },
  {
    id: "radio-nav-dj-deck",
    label: "DJ deck (radio nav)",
    pageRoute: "/radio/",
    selector: 'nav a[href="/dj-deck.html"]',
    target: "/dj-deck.html",
    expectedBehavior: "Open DJ deck from radio nav.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/dj-deck"]
  },
  {
    id: "radio-footer-halo-live",
    label: "Halo Live (radio footer)",
    pageRoute: "/radio/",
    selector: 'footer a[href="/halo-live.html"]',
    target: "/halo-live.html",
    expectedBehavior: "Open HALO Live from radio footer.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-live"]
  },
  {
    id: "creators-home-link",
    label: "Main HALO (creator world header)",
    pageRoute: "/creators/",
    selector: 'a.home-link[href="/halo"]',
    target: "/halo",
    expectedBehavior: "Return to HALO world from creator world.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/"]
  },
  {
    id: "creators-footer-halo-live",
    label: "HALO Live (creator world footer)",
    pageRoute: "/creators/",
    selector: '.footer-links a[href="/halo-live.html"]',
    target: "/halo-live.html",
    expectedBehavior: "Open HALO Live from creator world footer.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/halo-live"]
  },
  {
    id: "magazine-enter-halo",
    label: "Enter HALO World (signal header)",
    pageRoute: "/magazine.html",
    selector: 'a.home-button[href="/halo"]',
    target: "/halo",
    expectedBehavior: "Return to HALO world from HALO Signal.",
    ownerAgent: DASH_FIX_AGENTS.routing,
    legacyTargets: ["/"]
  }
]);

export function watchersForPage(pageRoute = "/") {
  const route = canonicalizeWatcherTarget(pageRoute);
  return HALO_BUTTON_WATCHER_REGISTRY.filter(watcher => watcher.pageRoute === route);
}
