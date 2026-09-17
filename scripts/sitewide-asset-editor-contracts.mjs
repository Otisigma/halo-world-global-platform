import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const [
  halo,
  concierge,
  hubPage,
  hubScript,
  netlify,
  songCatalog,
  campaignStudio,
  artworkManager,
  singleCoverLab,
  releaseHouse,
  artistsIndex,
  artistsScript,
  mixes
] = await Promise.all([
  read("halo.html"),
  read("album-concierge/index.html"),
  read("asset-editor/index.html"),
  read("asset-editor/asset-editor.js"),
  read("netlify.toml"),
  read("song-catalog/index.html"),
  read("campaign-studio/campaign-studio.js"),
  read("artwork-manager.html"),
  read("halo_agent_console_single_cover_lab.html"),
  read("release-house/release-house.js"),
  read("artists/index.html"),
  read("artists/artists.js"),
  read("mixes/index.html")
]);

function runBootCheck(scriptSource, search) {
  const listeners = new Map();
  const editorContext = {
    hidden: true,
    textContent: "",
    classList: { toggle() {} }
  };
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
      if (id === "editorContext") return editorContext;
      if (id === "songCatalogFrame") return songCatalogFrame;
      if (id === "releaseHouseFrame") return releaseHouseFrame;
      return null;
    }
  };
  const windowObject = {
    location: { origin: "https://example.test", search },
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
  return {
    songCatalogFrame,
    releaseHouseFrame,
    songPanel,
    releasePanel,
    editorContext
  };
}

let releaseTabBootWorks = true;
try {
  const runtime = runBootCheck(hubScript, "?tab=release");
  assert.equal(runtime.releasePanel.hidden, false);
  assert.match(runtime.releaseHouseFrame.src, /\/release-house\//);
} catch {
  releaseTabBootWorks = false;
}

let campaignSurfaceBootWorks = true;
try {
  const runtime = runBootCheck(hubScript, "?surface=campaign-visual-asset");
  assert.equal(runtime.songPanel.hidden, false);
  assert.match(runtime.songCatalogFrame.src, /\/song-catalog\//);
  assert.equal(runtime.editorContext.hidden, false);
  assert.match(runtime.editorContext.textContent, /Campaign Studio/);
} catch {
  campaignSurfaceBootWorks = false;
}

const checks = [
  [halo.includes('href="/asset-editor/"') && halo.includes("SITEWIDE ASSET EDITOR"), "HALO main navigation links to the shared asset editor hub"],
  [concierge.includes('href="/asset-editor/"'), "Album Concierge links to the same shared asset editor hub"],
  [hubPage.includes('id="songCatalogFrame"') && hubPage.includes('id="releaseHouseFrame"') && hubScript.includes('"/release-house/"'), "the hub shells both Song Catalog and Release House editors"],
  [hubPage.includes("image artwork assets") && hubPage.includes("song/track details") && hubPage.includes("release title + description fields"), "the hub explicitly covers artwork, songs, and release metadata editing"],
  [hubPage.includes('id="editorContext"') && hubScript.includes("surfaceMap") && hubScript.includes("setEditorContext"), "the hub exposes source-aware context for surface-specific edit launches"],
  [hubScript.includes('parentOrigin') && hubScript.includes('halo-song-catalog-height') && hubScript.includes('event.source'), "the hub uses shared editor shell state and embedded song-catalog messaging"],
  [releaseTabBootWorks, "the hub initializes release-tab runtime behavior when opened with ?tab=release"],
  [campaignSurfaceBootWorks, "the hub initializes the songs workspace and context label when opened from a campaign artwork surface"],
  [songCatalog.includes('/asset-editor/?surface=song-catalog-artwork') && songCatalog.includes('/asset-editor/?surface=song-catalog-version-artwork'), "Song Catalog exposes edit entry points for album artwork and version cover art"],
  [campaignStudio.includes('/asset-editor/?surface=campaign-visual-asset'), "Campaign Studio exposes an edit entry point for the visual asset override"],
  [artworkManager.includes('/asset-editor/?surface=artwork-manager'), "Artwork Manager exposes an edit entry point to the shared hub"],
  [singleCoverLab.includes('/asset-editor/?surface=single-cover-lab'), "Single Cover Lab exposes an edit entry point to the shared hub"],
  [releaseHouse.includes('/asset-editor/?surface=release-house-artwork') && releaseHouse.includes('/asset-editor/?surface=release-house-metadata'), "Release House exposes shared editor entry points for artwork and metadata rooms"],
  [artistsIndex.includes('/asset-editor/?surface=artists-release-artwork') && artistsScript.includes('/asset-editor/?surface=artists-release-artwork'), "Artists surfaces expose artwork edit entry points in both the form and page preview"],
  [mixes.includes('/asset-editor/?surface=mixes-artwork'), "Mixes exposes an edit entry point for artwork-linked upload flows"],
  [netlify.includes('from = "/asset-editor/"') && netlify.includes('to = "/asset-editor/index.html"'), "the canonical /asset-editor/ route is served through Netlify redirects"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Sitewide asset editor contracts: ${checks.length}/${checks.length} checks passed.`);
