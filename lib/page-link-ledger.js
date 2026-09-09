import { CANONICAL_HOME_ROUTE, MENU_ROUTE_REGISTRY, PUBLIC_ROUTE_REGISTRY } from "./route-registry.js";

export const PAGE_LINK_STATUS = Object.freeze({
  WORKING: "working",
  ATTENTION: "attention",
  FALLBACK: "fallback"
});

export const VERIFIED_WORKING_CARD_ROUTES = Object.freeze([
  "/halo-x.html",
  "/dj-deck.html",
  "/halo-live.html",
  "/magazine.html"
]);

const VERIFIED_WORKING_ROUTES = new Set([CANONICAL_HOME_ROUTE, ...VERIFIED_WORKING_CARD_ROUTES]);
export const BROKEN_PUBLIC_ROUTE_TARGETS = Object.freeze([
  "/music/",
  "/mixes/",
  "/radio/",
  "/artist-pro/",
  "/creators/",
  "/artists/",
  "/creator-freedom/",
  "/campaign-studio/",
  "/release-house/",
  "/song-catalog/",
  "/dreamweaver/",
  "/dreamweaver-lab/",
  "/album-concierge/",
  "/finish-house/",
  "/support/"
]);
const ATTENTION_ROUTES = new Set(BROKEN_PUBLIC_ROUTE_TARGETS);

export const FALLBACK_ROUTE_ALIASES = Object.freeze([
  { route: "/halo-support", canonicalTarget: "/support/", reason: "Legacy support shortcut should land on Feedback Desk." },
  { route: "/halo-support/", canonicalTarget: "/support/", reason: "Legacy support shortcut with trailing slash should land on Feedback Desk." },
  { route: "/halo-%20support", canonicalTarget: "/support/", reason: "Encoded malformed support route should land on Feedback Desk." },
  { route: "/halo- support", canonicalTarget: "/support/", reason: "Malformed support route should land on Feedback Desk." }
]);

const routeFileByCanonicalTarget = new Map(PUBLIC_ROUTE_REGISTRY.map(({ route, file }) => [route, file]));

export const PAGE_LINK_LEDGER = Object.freeze([
  {
    name: "HALO",
    route: CANONICAL_HOME_ROUTE,
    canonicalTarget: CANONICAL_HOME_ROUTE,
    file: "halo.html",
    status: PAGE_LINK_STATUS.WORKING,
    workingCard: false,
    notes: "Canonical public landing route."
  },
  ...MENU_ROUTE_REGISTRY.map(({ name, route, file }) => {
    const status = VERIFIED_WORKING_ROUTES.has(route)
      ? PAGE_LINK_STATUS.WORKING
      : ATTENTION_ROUTES.has(route)
        ? PAGE_LINK_STATUS.ATTENTION
        : PAGE_LINK_STATUS.ATTENTION;
    return {
      name,
      route,
      canonicalTarget: route,
      file,
      status,
      workingCard: VERIFIED_WORKING_CARD_ROUTES.includes(route),
      notes: status === PAGE_LINK_STATUS.WORKING
        ? "Verified live route used as a source-of-truth behavior reference."
        : "Route stays monitored and should render or route cleanly without blank states."
    };
  }),
  ...FALLBACK_ROUTE_ALIASES.map(({ route, canonicalTarget, reason }) => ({
    name: "Feedback Desk fallback",
    route,
    canonicalTarget,
    file: routeFileByCanonicalTarget.get(canonicalTarget) || "404.html",
    status: PAGE_LINK_STATUS.FALLBACK,
    workingCard: false,
    notes: reason
  }))
]);

export const ROUTE_RENDER_INDEX_TARGETS = Object.freeze([
  ...BROKEN_PUBLIC_ROUTE_TARGETS
]);
