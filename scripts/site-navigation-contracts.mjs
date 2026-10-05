import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const normalizeCopy = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const [navigationScript, navigationStyles, musicStyles] = await Promise.all([
  read("mobile-navigation.js"),
  read("mobile-navigation.css"),
  read("music/music.css")
]);

const networkHomepage = await read("halo.html");
const networkSection = networkHomepage.match(/<section id="halo-network"[\s\S]*?<\/section>/)?.[0];
assert.ok(networkSection, "the public homepage must feature HALO Network");
assert.match(networkSection, /aria-labelledby="halo-network-title"/);
assert.match(networkSection, /id="halo-network-title"/);
assert.match(networkSection, /md:grid-cols-2/, "network entry points must adapt to mobile screens");
for (const network of ["creator", "signal"]) {
  assert.match(networkSection, new RegExp(`href="/${network}-network/"`), `${network} network must be accessible from the homepage`);
  assert.match(networkSection, new RegExp(`data-stat-event="open_${network}_network"`));
  assert.match(networkHomepage, new RegExp(`route: '/${network}-network/'`), `${network} network must participate in menu route status checks`);
  assert.match(networkHomepage, new RegExp(`href="/${network}-network/" data-stat-event="open_${network}_network" data-stat-target="header"`), `${network} network must be accessible from the main menu`);
  await read(`${network}-network/index.html`);
}

// --- Minimal DOM double -----------------------------------------------------------
// Supports compound selectors (#id, .class, [attr], [attr="value"]) joined by commas,
// which is everything the delegated navigation engine queries.
const parseCompound = selector => {
  const parts = { id: null, classes: [], attrs: [] };
  const pattern = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let consumed = "";
  for (const match of selector.matchAll(pattern)) {
    consumed += match[0];
    if (match[1]) parts.id = match[1];
    else if (match[2]) parts.classes.push(match[2]);
    else parts.attrs.push([match[3], match[4]]);
  }
  if (consumed !== selector) throw new Error(`Unsupported selector in fake DOM: ${selector}`);
  return parts;
};

const matches = (element, selectorList) => selectorList.split(",").map(part => part.trim()).some(selector => {
  const { id, classes, attrs } = parseCompound(selector);
  if (id && element.getAttribute("id") !== id) return false;
  if (!classes.every(name => element.classList.contains(name))) return false;
  return attrs.every(([name, value]) => value === undefined ? element.hasAttribute(name) : element.getAttribute(name) === value);
});

class FakeClassList {
  constructor(element) { this.element = element; }
  get tokens() { return (this.element.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  set tokens(list) { this.element.setAttribute("class", list.join(" ")); }
  contains(token) { return this.tokens.includes(token); }
  add(token) { if (!this.contains(token)) this.tokens = [...this.tokens, token]; }
  remove(token) { this.tokens = this.tokens.filter(existing => existing !== token); }
  toggle(token) {
    if (this.contains(token)) { this.remove(token); return false; }
    this.add(token);
    return true;
  }
}

class FakeElement {
  constructor(tag, attributes = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.classList = new FakeClassList(this);
    this.parentNode = null;
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  closest(selector) {
    for (let current = this; current && current instanceof FakeElement; current = current.parentNode) {
      if (matches(current, selector)) return current;
    }
    return null;
  }
  *descendants() {
    for (const child of this.children) { yield child; yield* child.descendants(); }
  }
}

const el = (tag, attributes, children) => new FakeElement(tag, attributes, children);

const createEnvironment = () => {
  const body = el("body");
  const html = el("html", {}, [body]);
  const listeners = new Map();
  const document = {
    documentElement: html,
    body,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    getElementById(id) { return [...html.descendants()].find(node => node.getAttribute("id") === id) || null; },
    querySelector(selector) { return [...html.descendants()].find(node => matches(node, selector)) || null; },
    querySelectorAll(selector) { return [...html.descendants()].filter(node => matches(node, selector)); },
    createElement: tag => el(tag)
  };
  const mediaQuery = () => ({ matches: false, addEventListener() {} });
  const window = {
    matchMedia: mediaQuery,
    navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    setTimeout() {}
  };
  const context = vm.createContext({
    window,
    document,
    MutationObserver: class { observe() {} disconnect() {} },
    Date,
    Number,
    JSON
  });
  vm.runInContext(navigationScript, context, { filename: "mobile-navigation.js" });

  const dispatch = (type, event) => {
    let prevented = false;
    const payload = { ...event, preventDefault() { prevented = true; } };
    (listeners.get(type) || []).forEach(handler => handler(payload));
    return { prevented };
  };
  return {
    body,
    click: target => dispatch("click", { target }),
    keydown: key => dispatch("keydown", { key, target: body })
  };
};

// --- Delegated mobile menu toggle survives late-loaded headers -----------------------
{
  const env = createEnvironment();
  // Header partial arrives after the script ran: direct binding would have found null.
  const icon = el("span");
  const toggle = el("button", { "data-action": "toggle-menu", "aria-expanded": "false" }, [icon]);
  const drawerLink = el("a", { href: "/music/" });
  const drawer = el("nav", { id: "mainNav", class: "nav-drawer" }, [drawerLink]);
  const header = el("header", { class: "main-header" }, [toggle, drawer]);
  const outside = el("main");
  env.body.replaceChildren(header, outside);

  const result = env.click(icon);
  assert.ok(result.prevented, "menu toggle clicks must be handled by the delegated listener");
  assert.ok(drawer.classList.contains("is-active"), "data-action=toggle-menu must open #mainNav even when the header loads late");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  env.click(drawerLink);
  assert.ok(drawer.classList.contains("is-active"), "clicks inside the drawer must keep it open");

  env.click(outside);
  assert.ok(!drawer.classList.contains("is-active"), "clicking outside must close the open nav drawer");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  env.click(toggle);
  env.keydown("Escape");
  assert.ok(!drawer.classList.contains("is-active"), "Escape must close the open nav drawer");
}

// --- #menuToggle + .nav-drawer fallback and innerHTML replacement ---------------------
{
  const env = createEnvironment();
  const render = () => {
    const toggle = el("button", { id: "menuToggle" });
    const drawer = el("div", { class: "nav-drawer" });
    env.body.replaceChildren(el("header", { class: "main-header" }, [toggle, drawer]));
    return { toggle, drawer };
  };
  const first = render();
  env.click(first.toggle);
  assert.ok(first.drawer.classList.contains("is-active"), "#menuToggle must open a .nav-drawer when #mainNav is absent");

  // Simulate the header being re-rendered with innerHTML: new nodes, no rebinding.
  const second = render();
  env.click(second.toggle);
  assert.ok(second.drawer.classList.contains("is-active"), "re-rendered menu toggles must keep working without rebinding");
  env.click(second.toggle);
  assert.ok(!second.drawer.classList.contains("is-active"), "a second toggle click must close the drawer");
  assert.equal(second.toggle.getAttribute("aria-expanded"), "false");
}

// --- Delegated dropdown toggles --------------------------------------------------------
{
  const env = createEnvironment();
  const siblingTrigger = el("button", { "data-action": "toggle-dropdown", "aria-expanded": "false" });
  const siblingMenu = el("ul", { class: "dropdown-menu" }, [el("li")]);
  const controlledTrigger = el("button", { "data-action": "toggle-dropdown", "aria-controls": "catalogMenu", "aria-expanded": "false" });
  const controlledMenu = el("ul", { id: "catalogMenu", class: "dropdown-menu" });
  const outside = el("main");
  env.body.replaceChildren(
    el("nav", {}, [el("div", {}, [siblingTrigger, siblingMenu]), controlledTrigger]),
    controlledMenu,
    outside
  );

  env.click(siblingTrigger);
  assert.ok(siblingMenu.classList.contains("show"), "toggle-dropdown must open its next sibling menu");
  assert.equal(siblingTrigger.getAttribute("aria-expanded"), "true");

  env.click(siblingMenu.children[0]);
  assert.ok(siblingMenu.classList.contains("show"), "clicks inside an open dropdown must keep it open");

  env.click(controlledTrigger);
  assert.ok(controlledMenu.classList.contains("show"), "toggle-dropdown must open the aria-controls target");
  assert.ok(!siblingMenu.classList.contains("show"), "opening one dropdown must close the others");
  assert.equal(siblingTrigger.getAttribute("aria-expanded"), "false");

  env.click(outside);
  assert.ok(!controlledMenu.classList.contains("show"), "clicking outside must close open dropdowns");
  assert.equal(controlledTrigger.getAttribute("aria-expanded"), "false");
}

// --- Source-level contracts --------------------------------------------------------------
assert.match(navigationScript, /\[data-action="toggle-menu"\], #menuToggle/, "menu toggles must be matched by delegation, not direct binding");
assert.match(navigationScript, /\[data-action="toggle-dropdown"\]/, "dropdown toggles must be matched by delegation");
assert.doesNotMatch(navigationScript, /getElementById\("menuToggle"\)\??\.addEventListener|querySelector\("#menuToggle"\)\??\.addEventListener/, "menu toggles must not be bound directly");

// --- Layering: navigation stack sits above the floating player bar -------------------------
const zIndexOf = (source, selectorPattern) => {
  const match = source.match(new RegExp(`${selectorPattern}[^{]*\\{[^}]*?z-index:\\s*(\\d+)`));
  assert.ok(match, `expected a z-index for ${selectorPattern}`);
  return Number(match[1]);
};
const playerBarZ = zIndexOf(musicStyles, "\\.halo-player-bar\\s");
const musicHeaderZ = zIndexOf(musicStyles, "\\n\\.site-header\\s");
const sharedNavZ = zIndexOf(navigationStyles, "\\.main-header,\\s*\\.nav-drawer,\\s*#mainNav\\s*");
assert.ok(musicHeaderZ > playerBarZ, "the music header must stack above .halo-player-bar");
assert.ok(sharedNavZ > playerBarZ, ".main-header / .nav-drawer must stack above .halo-player-bar");
assert.match(musicStyles, /\.halo-player-bar \{ position: fixed;/, "the floating player bar must stay fixed and functional");

// --- Business Hub / Sovereign Label OS in the main site navigation -----------------------
{
  const { BUSINESS_HUB_ROUTE, MENU_ROUTE_REGISTRY, PUBLIC_ROUTE_REGISTRY } = await import("../lib/route-registry.js");
  const [mainSite, netlifyConfig, serverSource] = await Promise.all([read("halo.html"), read("netlify.toml"), read("server.js")]);

  assert.equal(BUSINESS_HUB_ROUTE, "/artist/dashboard");
  const hubRoute = PUBLIC_ROUTE_REGISTRY.find(({ route }) => route === BUSINESS_HUB_ROUTE);
  assert.ok(hubRoute, "the route registry must map /artist/dashboard");
  assert.equal(hubRoute.file, "artist-economy/index.html", "/artist/dashboard must reuse the existing Artist Economy workspace");
  assert.ok(MENU_ROUTE_REGISTRY.some(({ route, menuLabel }) => route === BUSINESS_HUB_ROUTE && menuLabel === "BUSINESS HUB"), "Business Hub must be a monitored main-menu route");
  assert.match(netlifyConfig, /from = "\/artist\/dashboard"\s+to = "\/artist-economy\/index\.html"\s+status = 200/, "Netlify must render /artist/dashboard directly with a 200 rewrite");
  assert.match(serverSource, /app\.get\("\/artist\/dashboard",[\s\S]*?path\.join\("artist-economy", "index\.html"\)/, "the local server must render /artist/dashboard");

  const quickAccess = mainSite.match(/<section className="halo-menu-status-group halo-menu-status-group-working"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(quickAccess, /<a href="\/artist\/dashboard" className="halo-menu-status-button halo-menu-business-hub"/, "BUSINESS HUB must be pinned in the 00 All working menu");
  assert.match(quickAccess, /BUSINESS HUB/);
  const buildLane = mainSite.match(/<section className="halo-menu-lane halo-menu-lane-build"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(buildLane, /<a href="\/artist\/dashboard" className="halo-menu-business-hub"[^>]*data-signal="FINANCIAL OS"/, "the Build lane must lead with the highlighted Business Hub card");
  assert.match(buildLane, /renderMenuStatusBadge\('\/artist\/dashboard', 'Business Hub'\)/);
  assert.match(mainSite, /\{ route: '\/artist\/dashboard', label: 'BUSINESS HUB' \}/, "Business Hub must receive live menu status");
  assert.match(mainSite, /MENU_FILE_BACKED_ROUTES = new Set\(\['\/artist\/dashboard'\]\)/, "menu status lookups must not append a slash to /artist/dashboard");

  for (const route of ["/music/", "/radio/", "/artist-pro/", "/campaign-studio/", "/song-catalog/", "/finish-house/", "/magazine.html", "/support/"]) {
    assert.match(mainSite, new RegExp(`<a href="${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `existing main-menu item ${route} must still render`);
  }
  assert.match(mainSite, /menuStatusGroupedTargets\.working\.map\(target =>/, "status-driven working items must still render");

  assert.match(navigationStyles, /\.halo-menu-status-button\.halo-menu-business-hub,\s*\.halo-menu-lane > a\.halo-menu-business-hub \{[^}]*border: 1px solid rgba\(242, 255, 98, \.6\)/, "Business Hub needs the neon-gold border");
  assert.match(navigationStyles, /a\.halo-menu-business-hub:hover[\s\S]*?border-color: #f2ff62;[\s\S]*?transform: translateY\(-2px\)/, "Business Hub needs the neon-gold hover state");
  assert.match(navigationStyles, /a\.halo-menu-business-hub:focus-visible \{\s*outline: 2px solid #f2ff62/, "Business Hub needs a visible keyboard focus ring");
  assert.match(navigationStyles, /prefers-reduced-motion[\s\S]*\.halo-menu-business-hub:hover/, "Business Hub hover lift must respect reduced motion");
}

// --- Public sync licensing destination --------------------------------------------------
{
  const { MENU_ROUTE_REGISTRY, PUBLIC_ROUTE_REGISTRY } = await import("../lib/route-registry.js");
  const [mainSite, netlifyConfig, page, client] = await Promise.all([
    read("halo.html"), read("netlify.toml"), read("sync-hub/index.html"), read("sync-hub/sync-hub.js")
  ]);
  assert.equal(PUBLIC_ROUTE_REGISTRY.find(({ route }) => route === "/sync-hub/")?.file, "sync-hub/index.html");
  assert.ok(MENU_ROUTE_REGISTRY.some(({ route }) => route === "/sync-hub/"), "the sync hub must remain in the main menu registry");
  assert.match(mainSite, /<a href="\/sync-hub\/"[^>]*data-signal="SYNC LICENSING"/);
  assert.match(mainSite, /\{ route: '\/sync-hub\/', label: 'SYNC LICENSING' \}/);
  assert.match(netlifyConfig, /from = "\/sync-hub\/"\s+to = "\/sync-hub\/index\.html"\s+status = 200/);
  assert.match(page, /HALO BUSINESS HUB/);
  for (const field of ["company", "email", "mediaType", "territory", "budget", "notes"]) {
    assert.match(page, new RegExp(`name="${field}"`), `${field} must be in the inquiry form`);
  }
  assert.match(page, /<audio id="audition" controls/);
  assert.match(client, /player\.src = src/, "available stems must update the audio source");
  assert.match(client, /no request has been sent/, "the submission state must not claim to deliver an unsent inquiry");
}

// --- Public asset inventory destination -------------------------------------------------
{
  const { MENU_ROUTE_REGISTRY, PUBLIC_ROUTE_REGISTRY } = await import("../lib/route-registry.js");
  const [mainSite, netlifyConfig, page, creatorsPage, releasePage, releaseScript, syncPage] = await Promise.all([
    read("halo.html"), read("netlify.toml"), read("asset-inventory/index.html"), read("creators/index.html"),
    read("release-house/index.html"), read("release-house/release-house.js"), read("sync-hub/index.html")
  ]);
  assert.equal(PUBLIC_ROUTE_REGISTRY.find(({ route }) => route === "/asset-inventory/")?.file, "asset-inventory/index.html");
  assert.ok(MENU_ROUTE_REGISTRY.some(({ route, menuLabel }) => route === "/asset-inventory/" && menuLabel === "ASSET INVENTORY"), "the asset inventory must remain in the main menu registry");
  const buildLane = mainSite.match(/<section className="halo-menu-lane halo-menu-lane-build"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(buildLane, /<a href="\/asset-inventory\/"[^>]*data-signal="ASSET INVENTORY"/, "the Build lane must link the asset inventory");
  assert.match(buildLane, /renderMenuStatusBadge\('\/asset-inventory\/', 'Asset Inventory'\)/);
  assert.match(mainSite, /\{ route: '\/asset-inventory\/', label: 'ASSET INVENTORY' \}/, "the asset inventory must receive live menu status");
  assert.match(netlifyConfig, /from = "\/asset-inventory\/"\s+to = "\/asset-inventory\/index\.html"\s+status = 200/);
  assert.match(page, /href="\/asset-inventory\/asset-inventory\.css"/);
  assert.match(page, /href="\/halo"/, "the asset inventory must link back to HALO");
  for (const heading of [
    "Inventory of Built Assets",
    "Fair Asset Valuation",
    "Fair Pricing Model for End Users"
  ]) {
    assert.match(page, new RegExp(`<h2 id="[^"]+">${heading}`), `${heading} section must render`);
  }
  for (const asset of [
    "HALO Platform Ecosystem", "Custom Software Infrastructure &amp; Web IP", "HALO Artist Economy / Livelihood System",
    "HALO Business Hub &amp; One-Stop Sync Portal", "Interactive Fan &amp; Commerce Tools", "SERENA AI Integration",
    "Owen Anthony Music Catalog", "Owen Anthony Master &amp; Publishing Rights", "Stems for Owen Anthony Releases"
  ]) {
    assert.ok(page.includes(asset), `built asset "${asset}" must be listed`);
  }
  for (const source of [mainSite, creatorsPage].map(normalizeCopy)) {
    assert.ok(source.includes(normalizeCopy("Other artist-uploaded content remains the uploader’s property unless an explicit split or ownership agreement is configured on HALO.")), "public ownership copy must preserve uploader rights unless explicitly agreed");
    assert.ok(source.includes(normalizeCopy("Owen Anthony’s music is owned by Halo Music.")), "public ownership copy must identify Owen Anthony music ownership");
    assert.ok(source.includes(normalizeCopy("Uploading alone transfers no rights.")), "uploading must not transfer rights");
    assert.ok(source.includes(normalizeCopy("HALO software and technical infrastructure are proprietary.")), "platform IP must remain separate from upload ownership");
  }
  const normalizedReleasePage = normalizeCopy(releasePage);
  assert.ok(normalizedReleasePage.includes(normalizeCopy("artist-uploaded music and content")), "release ownership copy must state the uploader-owned default");
  assert.ok(normalizedReleasePage.includes(normalizeCopy("100% the uploader’s property by default")), "release ownership copy must state the default share");
  assert.ok(normalizedReleasePage.includes(normalizeCopy("explicitly configured and agreed on this site")), "release ownership changes must be explicitly configured and agreed");
  assert.ok(normalizedReleasePage.includes(normalizeCopy("Halo Music owns Owen Anthony’s music only")), "release copy must limit Halo Music ownership to Owen Anthony music");
  assert.ok(normalizedReleasePage.includes(normalizeCopy("Uploading alone transfers no rights")), "uploading must not transfer rights in the Release House");
  for (const source of [mainSite, creatorsPage, releasePage]) {
    assert.doesNotMatch(source, /Anson Wilshire/i, "public ownership copy must not expose the technology rights holder’s personal name");
  }
  const normalizedPage = normalizeCopy(page);
  assert.ok(normalizedPage.includes(normalizeCopy("platform’s technology/IP rights holder")), "platform technology ownership must be distinguished from artist uploads");
  assert.ok(normalizedPage.includes(normalizeCopy("Halo Music ownership applies only to Owen Anthony music")), "asset inventory must limit Halo Music ownership to Owen Anthony music");
  assert.ok(normalizedPage.includes(normalizeCopy("confirm master, publishing, contributor, and clearance status for each release and intended use")), "asset inventory rights must be confirmed per release and use");
  const normalizedSyncPage = normalizeCopy(syncPage);
  assert.ok(normalizedSyncPage.includes(normalizeCopy("Owen Anthony music for sync discussions")), "sync copy must not imply catalog-wide Halo ownership");
  assert.ok(normalizedSyncPage.includes(normalizeCopy("rights must be confirmed for each track and intended use")), "sync rights must be confirmed for each track and use");
  assert.ok(normalizedSyncPage.includes(normalizeCopy("no license is granted until written approval")), "sync copy must require written approval before licensing");
  assert.ok(normalizeCopy(releaseScript).includes(normalizeCopy("© 2026 Halo Music (Owen Anthony composition) / ℗ 2026 Halo Music (Owen Anthony recording)")), "release metadata must scope music ownership to Owen Anthony");
  for (const value of ["$35,000–$60,000", "$50,000–$120,000", "$15,000–$35,000", "$100,000–$215,000"]) {
    assert.ok(page.includes(value), `valuation ${value} must be listed`);
  }
  for (const tier of ["Basic Tier", "HALO Pro", "HALO Studio / Label", "$19 <small>/ month", "$180 / year", "$69 <small>/ month", "$680 / year"]) {
    assert.ok(page.includes(tier), `pricing detail ${tier} must be listed`);
  }
  for (const benefit of ["Rights Passport", "Income Ledger", "transaction fee", "Priority sync placement", "copilot", "Split automation", "White-label pitching pages"]) {
    assert.ok(page.includes(benefit), `pricing benefit ${benefit} must be listed`);
  }
}

console.log("Site navigation contracts passed.");
