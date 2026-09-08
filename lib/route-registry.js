const directoryRoute = (name, route, file, options = {}) => ({
  name,
  route,
  file,
  aliases: [`${route.slice(0, -1)}`, `${route}index.html`, ...(options.aliases || [])],
  menuLabel: options.menuLabel || null
});

const fileRoute = (name, route, file, options = {}) => {
  const basename = route.replace(/\.html$/, "");
  return {
    name,
    route,
    file,
    aliases: [basename, `${basename}/`, ...(options.aliases || [])],
    menuLabel: options.menuLabel || null
  };
};

export const CANONICAL_HOME_ROUTE = "/halo";

export const PUBLIC_ROUTE_REGISTRY = Object.freeze([
  {
    name: "HALO",
    route: CANONICAL_HOME_ROUTE,
    file: "halo.html",
    aliases: ["/", "/halo/", "/halo.html"],
    menuLabel: null
  },
  directoryRoute("Album Concierge", "/album-concierge/", "album-concierge/index.html", { menuLabel: "CREATE YOUR ALBUM" }),
  directoryRoute("Ambassadors", "/ambassadors/", "ambassadors/index.html"),
  directoryRoute("Artist Economy", "/artist-economy/", "artist-economy/index.html"),
  directoryRoute("Artist Pro", "/artist-pro/", "artist-pro/index.html", { menuLabel: "ARTIST PRO" }),
  fileRoute("Artist Team", "/artist-team.html", "artist-team.html"),
  directoryRoute("Artists", "/artists/", "artists/index.html", { menuLabel: "ARTIST ROOMS + CHARTS" }),
  directoryRoute("Campaign Studio", "/campaign-studio/", "campaign-studio/index.html", { menuLabel: "CAMPAIGN STUDIO" }),
  directoryRoute("Creator Freedom", "/creator-freedom/", "creator-freedom/index.html", { menuLabel: "CREATOR FREEDOM" }),
  directoryRoute("Creator World", "/creators/", "creators/index.html", { menuLabel: "CREATOR WORLD" }),
  fileRoute("Creator Gear Guide", "/creators/gear-guide.html", "creators/gear-guide.html"),
  fileRoute("DJ Deck", "/dj-deck.html", "dj-deck.html", { menuLabel: "LIVE DJ DECK" }),
  directoryRoute("Dreamweaver", "/dreamweaver/", "dreamweaver/index.html", { menuLabel: "DREAMWEAVER EXPERIENCE" }),
  directoryRoute("Dreamweaver Lab", "/dreamweaver-lab/", "dreamweaver-lab/index.html", { menuLabel: "DREAMWEAVER SONG LAB" }),
  directoryRoute("Finish House", "/finish-house/", "finish-house/index.html", { menuLabel: "FINISH HOUSE" }),
  directoryRoute("HALO Ledger", "/halo-ledger/", "halo-ledger/index.html"),
  fileRoute("HALO Live", "/halo-live.html", "halo-live.html", { menuLabel: "HALO LIVE" }),
  fileRoute("HALO Relations", "/halo-relations.html", "halo-relations.html"),
  fileRoute("HALO Signal", "/magazine.html", "magazine.html", { menuLabel: "HALO SIGNAL" }),
  fileRoute("HALO X", "/halo-x.html", "halo-x.html", { menuLabel: "DJ HALO X" }),
  directoryRoute("I AM Social", "/iam-social/", "iam-social/index.html"),
  directoryRoute("Mixes", "/mixes/", "mixes/index.html", { menuLabel: "HALO X MIXES" }),
  directoryRoute("Music", "/music/", "music/index.html", { menuLabel: "ALL MUSIC" }),
  fileRoute("Outreach Desk", "/outreach.html", "outreach.html"),
  fileRoute("Partner Trust", "/partner-trust.html", "partner-trust.html"),
  directoryRoute("Radio", "/radio/", "radio/index.html", { menuLabel: "HALO RADIO" }),
  directoryRoute("Release House", "/release-house/", "release-house/index.html", { menuLabel: "RELEASE HOUSE" }),
  directoryRoute("Signal Network", "/signal-network/", "signal-network/index.html", { aliases: ["/signal"] }),
  directoryRoute("Song Catalog", "/song-catalog/", "song-catalog/index.html", { menuLabel: "SONG CATALOG" }),
  directoryRoute("Support", "/support/", "support/index.html", { menuLabel: "FEEDBACK DESK" }),
  directoryRoute("Upload Pipeline", "/upload-pipeline/", "upload-pipeline/index.html"),
  fileRoute("VIP Launchpad", "/vip_launchpad.html", "vip_launchpad.html"),
  directoryRoute("When the World Goes Dark", "/when-the-world-goes-dark/", "when-the-world-goes-dark/index.html"),
  directoryRoute("YouTube Studio", "/youtube-studio/", "youtube-studio/index.html")
]);

export const MENU_ROUTE_REGISTRY = Object.freeze(
  PUBLIC_ROUTE_REGISTRY
    .filter(route => route.menuLabel)
    .map(route => ({ name: route.name, route: route.route, file: route.file, menuLabel: route.menuLabel }))
);

export const SATELLITE_STATUS_TARGETS = Object.freeze(
  MENU_ROUTE_REGISTRY.map(({ name, route }) => ({ name, route }))
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
