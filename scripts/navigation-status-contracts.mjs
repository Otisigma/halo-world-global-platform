import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ROUTE_CONFIG,
  STATUS_PRESETS,
  applyStatusToBadge,
  enforceSingleAmberNode,
  normalizeRoutePath,
  normalizeStatus,
  updateMenuStatuses
} from "../status-controller.js";

const styles = readFileSync(new URL("../status-menu.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../status-controller.js", import.meta.url), "utf8");
const statsPage = readFileSync(new URL("../stats/index.html", import.meta.url), "utf8");

assert.equal(STATUS_PRESETS.WORKING.code, "G");
assert.equal(STATUS_PRESETS.ATTENTION.code, "Y");
assert.equal(STATUS_PRESETS.BROKEN.code, "R");
assert.equal(STATUS_PRESETS.WORKING.color, "#22C55E");
assert.equal(STATUS_PRESETS.ATTENTION.color, "#F59E0B");
assert.equal(STATUS_PRESETS.BROKEN.color, "#EF4444");

assert.equal(normalizeStatus("working"), "WORKING");
assert.equal(normalizeStatus("nonsense"), "BROKEN");
assert.equal(normalizeRoutePath("/music"), "/music/");
assert.equal(normalizeRoutePath("/music-world.html#telemetry"), "/music-world.html");
assert.equal(normalizeRoutePath(""), "/");

const amberNodes = ROUTE_CONFIG.filter(route => normalizeStatus(route.status) === "ATTENTION");
assert.equal(amberNodes.length, 1, "the shipped route config must obey the one-amber-node rule");
assert.equal(amberNodes[0].path, "/dreamweaver/");

const enforced = enforceSingleAmberNode([
  { id: "dreamweaver", path: "/dreamweaver/", status: "ATTENTION", activeTarget: true },
  { id: "radio", path: "/radio/", status: "attention" },
  { id: "catalog", path: "/song-catalog/", status: "ATTENTION", resolvedStatus: "BROKEN" },
  { id: "music", path: "/music/", status: "WORKING" }
]);
assert.deepEqual(enforced.map(route => route.status), ["ATTENTION", "WORKING", "BROKEN", "WORKING"]);
assert.equal(
  enforceSingleAmberNode([{ id: "a", path: "/a/", status: "ATTENTION" }])[0].status,
  "ATTENTION",
  "a single amber node stays amber"
);

// Minimal DOM double so the badge swap is exercised without a browser runtime.
class FakeClassList {
  constructor(initial = []) { this.tokens = new Set(initial); }
  add(...tokens) { tokens.forEach(token => this.tokens.add(token)); }
  remove(...tokens) { tokens.forEach(token => this.tokens.delete(token)); }
  contains(token) { return this.tokens.has(token); }
  get value() { return [...this.tokens].join(" "); }
}

class FakeElement {
  constructor(className = "", attributes = {}) {
    this.classList = new FakeClassList(className.split(" ").filter(Boolean));
    this.attributes = { ...attributes };
    this.children = [];
    this.text = "";
    this.ownerDocument = { createElement: name => new FakeElement(name) };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  append(...nodes) { this.children.push(...nodes); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.children.length ? this.children.map(node => (typeof node === "string" ? node : node.textContent)).join("") : this.text; }
  set className(value) { this.classList = new FakeClassList(String(value).split(" ").filter(Boolean)); }
  querySelector(selector) {
    if (selector !== ".status-badge" && selector !== ".tile-title") return null;
    const token = selector.slice(1);
    return this.children.find(node => node instanceof FakeElement && node.classList.contains(token)) || null;
  }
}

const badge = new FakeElement("status-badge status-working");
applyStatusToBadge(badge, "BROKEN");
assert.ok(badge.classList.contains("status-broken"));
assert.ok(!badge.classList.contains("status-working"));
assert.equal(badge.getAttribute("data-status"), "BROKEN");
assert.equal(badge.textContent, "R BROKEN");

const tileBadge = new FakeElement("status-badge status-working");
const title = new FakeElement("tile-title");
title.textContent = "DREAMWEAVER EXPERIENCE";
const tile = new FakeElement("halo-nav-tile", { href: "/dreamweaver" });
tile.append(tileBadge, title);
const fakeRoot = { querySelectorAll: () => [tile] };

const applied = updateMenuStatuses(ROUTE_CONFIG, fakeRoot);
assert.deepEqual(applied, [{ id: "dreamweaver", path: "/dreamweaver/", status: "ATTENTION" }]);
assert.equal(tile.getAttribute("data-status"), "ATTENTION");
assert.ok(tileBadge.classList.contains("status-attention"));
assert.equal(tileBadge.textContent, "Y ATTENTION");
assert.equal(tileBadge.getAttribute("title"), "DREAMWEAVER EXPERIENCE: ATTENTION");
assert.deepEqual(updateMenuStatuses(ROUTE_CONFIG, null), []);

assert.match(controller, /DOMContentLoaded/, "the controller must run on DOMContentLoaded");
assert.doesNotMatch(controller, /innerHTML/, "badge content must be built with DOM nodes, not raw HTML");

assert.match(styles, /--status-green:\s*#22c55e/i);
assert.match(styles, /--status-amber:\s*#f59e0b/i);
assert.match(styles, /--status-red:\s*#ef4444/i);
assert.match(styles, /\.halo-menu-grid\s*\{/);
assert.match(styles, /\.halo-nav-tile\s*\{/);
assert.match(styles, /border:\s*1px solid var\(--halo-border-card\)/);
assert.match(styles, /\.halo-nav-tile:hover[\s\S]*?transform:\s*translateY\(-2px\)/);
for (const variant of ["status-working", "status-attention", "status-broken"]) {
  assert.match(styles, new RegExp(`\\.${variant}\\s*\\{[\\s\\S]*?box-shadow: 0 0 8px`), `${variant} needs a matching glow`);
}

assert.match(statsPage, /href="\/status-menu\.css"/);
assert.match(statsPage, /type="module" src="\/status-controller\.js"/);
assert.match(statsPage, /class="halo-menu-grid"/);
for (const route of ["/music-world.html", "/music/", "/dreamweaver/", "/radio/"]) {
  assert.match(statsPage, new RegExp(`href="${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="halo-nav-tile"`), `the status map must surface ${route}`);
}
assert.equal((statsPage.match(/status-badge status-attention/g) || []).length, 1, "only one amber node may ship in the markup");

console.log("Navigation status contracts passed");
