import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const [halo, concierge, hubPage, hubScript, netlify] = await Promise.all([
  read("halo.html"),
  read("album-concierge/index.html"),
  read("asset-editor/index.html"),
  read("asset-editor/asset-editor.js"),
  read("netlify.toml")
]);

function runReleaseTabBootCheck(scriptSource) {
  const listeners = new Map();
  const songCatalogFrame = {
    id: "songCatalogFrame",
    src: "",
    style: {},
    contentWindow: {},
    dataset: {},
    classList: { toggle() {} }
  };
  const releaseHouseFrame = {
    id: "releaseHouseFrame",
    src: "",
    style: {},
    dataset: {},
    classList: { toggle() {} }
  };
  const songPanel = {
    id: "songCatalogPanel",
    hidden: false,
    dataset: {},
    classList: { toggle() {} }
  };
  const releasePanel = {
    id: "releaseMetadataPanel",
    hidden: true,
    dataset: {},
    classList: { toggle(_name, active) { this.active = Boolean(active); }, active: false }
  };
  const makeTab = (tabTarget) => ({
    dataset: { tabTarget },
    attributes: {},
    classList: { toggle() {} },
    tabIndex: 0,
    focus() {},
    addEventListener(type, handler) {
      this.listeners = this.listeners || {};
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  });
  const songTab = makeTab("songCatalogPanel");
  const releaseTab = makeTab("releaseMetadataPanel");
  const tabButtons = [songTab, releaseTab];
  const panels = [songPanel, releasePanel];
  const document = {
    querySelectorAll(selector) {
      if (selector === ".tab-button") return tabButtons;
      if (selector === ".editor-panel") return panels;
      return [];
    },
    getElementById(id) {
      if (id === "songCatalogFrame") return songCatalogFrame;
      if (id === "releaseHouseFrame") return releaseHouseFrame;
      return null;
    }
  };
  const windowObject = {
    location: { origin: "https://example.test", search: "?tab=release" },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    }
  };
  vm.runInNewContext(scriptSource, {
    document,
    window: windowObject,
    URL,
    URLSearchParams
  });
  assert.equal(releasePanel.hidden, false);
  assert.match(releaseHouseFrame.src, /\/release-house\//);
}

let releaseTabBootWorks = true;
try {
  runReleaseTabBootCheck(hubScript);
} catch {
  releaseTabBootWorks = false;
}

const checks = [
  [halo.includes('href="/asset-editor/"') && halo.includes("SITEWIDE ASSET EDITOR"), "HALO main navigation links to the shared asset editor hub"],
  [concierge.includes('href="/asset-editor/"'), "Album Concierge links to the same shared asset editor hub"],
  [hubPage.includes('id="songCatalogFrame"') && hubPage.includes('id="releaseHouseFrame"') && hubScript.includes('"/release-house/"'), "the hub shells both Song Catalog and Release House editors"],
  [hubPage.includes("image artwork assets") && hubPage.includes("song/track details") && hubPage.includes("release title + description fields"), "the hub explicitly covers artwork, songs, and release metadata editing"],
  [hubScript.includes('parentOrigin') && hubScript.includes('halo-song-catalog-height') && hubScript.includes('event.source'), "the hub uses shared editor shell state and embedded song-catalog messaging"],
  [releaseTabBootWorks, "the hub initializes release-tab runtime behavior when opened with ?tab=release"],
  [netlify.includes('from = "/asset-editor/"') && netlify.includes('to = "/asset-editor/index.html"'), "the canonical /asset-editor/ route is served through Netlify redirects"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Sitewide asset editor contracts: ${checks.length}/${checks.length} checks passed.`);
