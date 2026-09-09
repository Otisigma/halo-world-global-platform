const directoryRoute = (name, route, file, options = {}) => ({
  name,
  route,
  file,
  aliases: [`${route.slice(0, -1)}`, `${route}index.html`, ...(options.aliases || [])],
  menuLabel: options.menuLabel || null,
  statusTarget: options.statusTarget ?? Boolean(options.menuLabel),
  featuredWorking: Boolean(options.featuredWorking),
  fallbackHubVisible: options.fallbackHubVisible ?? false,
  watcherRequired: options.watcherRequired ?? false,
  monitorMode: options.monitorMode || null,
  contentSentinel: options.contentSentinel || null,
  fallbackLabel: options.fallbackLabel || options.menuLabel || name
});

const fileRoute = (name, route, file, options = {}) => {
  const basename = route.replace(/\.html$/, "");
  return {
    name,
    route,
    file,
    aliases: [basename, `${basename}/`, ...(options.aliases || [])],
    menuLabel: options.menuLabel || null,
    statusTarget: options.statusTarget ?? Boolean(options.menuLabel),
    featuredWorking: Boolean(options.featuredWorking),
    fallbackHubVisible: options.fallbackHubVisible ?? false,
    watcherRequired: options.watcherRequired ?? false,
    monitorMode: options.monitorMode || null,
    contentSentinel: options.contentSentinel || null,
    fallbackLabel: options.fallbackLabel || options.menuLabel || name
  };
};

export const CANONICAL_HOME_ROUTE = "/halo";

export const PUBLIC_ROUTE_REGISTRY = Object.freeze([
  {
    name: "HALO",
    route: CANONICAL_HOME_ROUTE,
    file: "halo.html",
    aliases: ["/", "/halo/", "/halo.html"],
    menuLabel: null,
    statusTarget: true,
    featuredWorking: false,
    fallbackHubVisible: true,
    watcherRequired: true,
    monitorMode: "required",
    contentSentinel: "HALO Music World — Artist-Controlled Music Infrastructure",
    fallbackLabel: "HALO Home"
  },
  directoryRoute("Album Concierge", "/album-concierge/", "album-concierge/index.html", { menuLabel: "CREATE YOUR ALBUM", statusTarget: true, fallbackHubVisible: true, contentSentinel: "Album Concierge — HALO World", fallbackLabel: "Build your album promotion" }),
  directoryRoute("Ambassadors", "/ambassadors/", "ambassadors/index.html", { statusTarget: true, fallbackHubVisible: true, monitorMode: "required", contentSentinel: "Sovereign Ambassadors · HALO Music World", fallbackLabel: "Ambassador path" }),
  directoryRoute("Artist Economy", "/artist-economy/", "artist-economy/index.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Artist Economy", fallbackLabel: "Artist Economy" }),
  directoryRoute("Artist Pro", "/artist-pro/", "artist-pro/index.html", { menuLabel: "ARTIST PRO", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Artist Pro — Your Release Command System" }),
  fileRoute("Artist Team", "/artist-team.html", "artist-team.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Artist Agent Team", fallbackLabel: "Artist team" }),
  directoryRoute("Artists", "/artists/", "artists/index.html", { menuLabel: "ARTIST ROOMS + CHARTS", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Artist Room" }),
  directoryRoute("Campaign Studio", "/campaign-studio/", "campaign-studio/index.html", { menuLabel: "CAMPAIGN STUDIO", statusTarget: true, watcherRequired: true, monitorMode: "required", contentSentinel: "Dreamweaver Campaign Studio — HALO" }),
  directoryRoute("Creator Freedom", "/creator-freedom/", "creator-freedom/index.html", { menuLabel: "CREATOR FREEDOM", statusTarget: true, fallbackHubVisible: true, contentSentinel: "Creator Freedom Charter — HALO World" }),
  directoryRoute("Creator World", "/creators/", "creators/index.html", { menuLabel: "CREATOR WORLD", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Creator World — UK + Ireland Founding Edition" }),
  fileRoute("Creator Gear Guide", "/creators/gear-guide.html", "creators/gear-guide.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Signal Chain — Gear + Release Guide", fallbackLabel: "Creator gear guide" }),
  fileRoute("DJ Deck", "/dj-deck.html", "dj-deck.html", { menuLabel: "LIVE DJ DECK", statusTarget: true, featuredWorking: true, fallbackHubVisible: true, contentSentinel: "HALO — Live DJ Command Deck" }),
  directoryRoute("Dreamweaver", "/dreamweaver/", "dreamweaver/index.html", { menuLabel: "DREAMWEAVER EXPERIENCE", statusTarget: true, fallbackHubVisible: true, monitorMode: "required", contentSentinel: "Dreamweaver Show — HALO", fallbackLabel: "Open Dreamweaver experience" }),
  directoryRoute("Dreamweaver Lab", "/dreamweaver-lab/", "dreamweaver-lab/index.html", { menuLabel: "DREAMWEAVER SONG LAB", statusTarget: true, watcherRequired: true, monitorMode: "required", contentSentinel: "Dreamweaver Song Lab — HALO", fallbackHubVisible: true }),
  directoryRoute("Finish House", "/finish-house/", "finish-house/index.html", { menuLabel: "FINISH HOUSE", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Finish House — From Mix to Master to Market" }),
  directoryRoute("HALO Ledger", "/halo-ledger/", "halo-ledger/index.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "Halo Ledger — Platform Operational Memory", fallbackLabel: "HALO Ledger" }),
  fileRoute("HALO Live", "/halo-live.html", "halo-live.html", { menuLabel: "HALO LIVE", statusTarget: true, featuredWorking: true, fallbackHubVisible: true, contentSentinel: "HALO Live — Global Broadcast Command Center" }),
  fileRoute("HALO Relations", "/halo-relations.html", "halo-relations.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Relations — Human Connection Desk", fallbackLabel: "HALO Relations" }),
  fileRoute("HALO Signal", "/magazine.html", "magazine.html", { menuLabel: "HALO SIGNAL", statusTarget: true, featuredWorking: true, fallbackHubVisible: true, contentSentinel: "HALO SIGNAL — Music, Nightlife & Creator Industry Intelligence" }),
  fileRoute("HALO X", "/halo-x.html", "halo-x.html", { menuLabel: "DJ HALO X", statusTarget: true, featuredWorking: true, fallbackHubVisible: true, contentSentinel: "DJ HALO X — Founders Control Room" }),
  directoryRoute("I AM Social", "/iam-social/", "iam-social/index.html", { statusTarget: true, fallbackHubVisible: true, monitorMode: "required", contentSentinel: "I AM Social — HALO", fallbackLabel: "I AM Social" }),
  directoryRoute("Mixes", "/mixes/", "mixes/index.html", { menuLabel: "HALO X MIXES", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO X Mixes — Inside the Mix" }),
  directoryRoute("Music", "/music/", "music/index.html", { menuLabel: "ALL MUSIC", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Music — Every Release in One Place" }),
  fileRoute("Outreach Desk", "/outreach.html", "outreach.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Outreach Desk — Getting the record to the right people", fallbackLabel: "Outreach Desk" }),
  fileRoute("Partner Trust", "/partner-trust.html", "partner-trust.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "Partner Trust Team · HALO", fallbackLabel: "Partner Trust" }),
  directoryRoute("Radio", "/radio/", "radio/index.html", { menuLabel: "HALO RADIO", statusTarget: true, fallbackHubVisible: true, contentSentinel: "Halo Radio — Creator-owned signal" }),
  directoryRoute("Release House", "/release-house/", "release-house/index.html", { menuLabel: "RELEASE HOUSE", statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO Release House — Finish and Release Your First Song" }),
  directoryRoute("Signal Network", "/signal-network/", "signal-network/index.html", { aliases: ["/signal"], statusTarget: true, fallbackHubVisible: true, monitorMode: "required", contentSentinel: "Signal Network — HALO Music World", fallbackLabel: "Signal Network" }),
  directoryRoute("Song Catalog", "/song-catalog/", "song-catalog/index.html", { menuLabel: "SONG CATALOG", statusTarget: true, watcherRequired: true, monitorMode: "required", contentSentinel: "Song Catalog | HALO" }),
  directoryRoute("Support", "/support/", "support/index.html", { menuLabel: "FEEDBACK DESK", statusTarget: true, fallbackHubVisible: true, contentSentinel: "Feedback Desk — HALO World" }),
  directoryRoute("Upload Pipeline", "/upload-pipeline/", "upload-pipeline/index.html", { statusTarget: true, fallbackHubVisible: true, watcherRequired: true, monitorMode: "required", contentSentinel: "Upload Pipeline | HALO", fallbackLabel: "Upload Pipeline" }),
  fileRoute("VIP Launchpad", "/vip_launchpad.html", "vip_launchpad.html", { statusTarget: true, fallbackHubVisible: true, contentSentinel: "HALO MUSIC WORLD // VIP BETA LAUNCHPAD", fallbackLabel: "VIP Launchpad" }),
  directoryRoute("When the World Goes Dark", "/when-the-world-goes-dark/", "when-the-world-goes-dark/index.html", { statusTarget: true, fallbackHubVisible: true, monitorMode: "required", contentSentinel: "When The World Goes Dark — Owen Anthony", fallbackLabel: "When The World Goes Dark" }),
  directoryRoute("YouTube Studio", "/youtube-studio/", "youtube-studio/index.html", { statusTarget: true, fallbackHubVisible: true, watcherRequired: true, monitorMode: "required", contentSentinel: "YouTube Source Box — HALO", fallbackLabel: "YouTube Studio" })
]);

export const MENU_ROUTE_REGISTRY = Object.freeze(
  PUBLIC_ROUTE_REGISTRY
    .filter(route => route.menuLabel)
    .map(route => ({ name: route.name, route: route.route, file: route.file, menuLabel: route.menuLabel }))
);

export const ROUTE_LEDGER_REGISTRY = Object.freeze(
  PUBLIC_ROUTE_REGISTRY.filter(route => route.statusTarget)
);

export const SATELLITE_STATUS_TARGETS = Object.freeze(
  ROUTE_LEDGER_REGISTRY.map(({
    name,
    route,
    file,
    menuLabel,
    featuredWorking,
    fallbackHubVisible,
    watcherRequired,
    monitorMode,
    contentSentinel,
    fallbackLabel
  }) => ({
    name,
    route,
    file,
    menuLabel,
    featuredWorking,
    fallbackHubVisible,
    watcherRequired,
    monitorMode,
    contentSentinel,
    fallbackLabel
  }))
);

export const FEATURED_WORKING_ROUTE_TARGETS = Object.freeze(
  SATELLITE_STATUS_TARGETS
    .filter(route => route.featuredWorking)
    .map(({ name, route, fallbackLabel }) => ({ name, route, fallbackLabel }))
);

export const FALLBACK_HUB_ROUTE_TARGETS = Object.freeze(
  SATELLITE_STATUS_TARGETS
    .filter(route => route.fallbackHubVisible)
    .map(({ name, route, fallbackLabel }) => ({ name, route, fallbackLabel }))
);

export const CANONICAL_ROUTE_ALIAS_ENTRIES = Object.freeze(
  PUBLIC_ROUTE_REGISTRY.flatMap(({ route, aliases }) => aliases.map(from => ({ from, to: route })))
);

export const CANONICAL_ROUTE_ALIASES = new Map(
  CANONICAL_ROUTE_ALIAS_ENTRIES.map(({ from, to }) => [from, to])
);

export function canonicalizeRoutePath(rawPathname = "/") {
  const rawValue = String(rawPathname || "").trim();
  if (!rawValue) return "/";

  let pathname = rawValue;
  try {
    pathname = new URL(rawValue, "https://halo.world").pathname;
  } catch {
    pathname = rawValue.split(/[?#]/)[0] || "/";
  }

  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1 && pathname.endsWith(".html/")) pathname = pathname.slice(0, -1);

  return CANONICAL_ROUTE_ALIASES.get(pathname) || pathname;
}
