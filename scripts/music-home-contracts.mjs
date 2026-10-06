import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { CURATED_LOOPS, THEMES, MODULE_TYPES, MAX_CUSTOM_VIDEO_BYTES,
  defaultMusicHomeConfig, getMusicHomeUnlocks, normalizeMusicHomeConfig, validateCustomVideo } from "../lib/music-home.js";
import { moveModule, mountMusicHomeCustomizer } from "../music-home/customizer.js";
import { applySovereignMode, shouldAutoplayBackground, createBackgroundController, mountMusicHome } from "../music-home/home.js";

const creatorId = "creator";
const premium = { subscriptionTier: "PREMIUM", subscriptionStatus: "active", subscriptionExpiresAt: "2099-01-01" };
const customUrl = `/api/music-home?creator=${creatorId}&asset=background`;
const context = { creatorId, pass: premium, milestones: { stemUploads: 5, completedSplits: 1 }, customBackgroundUrl: customUrl };
const defaults = defaultMusicHomeConfig(creatorId);
assert.equal(defaults.schemaVersion, 1);
assert.deepEqual(defaults.layoutModules.map(module => module.type), MODULE_TYPES);
assert.deepEqual(getMusicHomeUnlocks(), { themes: ["GOLD"], backgrounds: ["obsidian-gold-dust"], badges: [] });
assert.deepEqual(getMusicHomeUnlocks({ stemUploads: 1, completedSplits: 0 }).themes, ["GOLD", "BRONZE"]);
assert.deepEqual(getMusicHomeUnlocks({ stemUploads: 5, completedSplits: 0 }).themes, ["GOLD", "BRONZE", "COPPER"]);
assert.deepEqual(getMusicHomeUnlocks(context.milestones).themes, Object.keys(THEMES));
assert.deepEqual(getMusicHomeUnlocks({ stemUploads: "5", completedSplits: Infinity }).themes, ["GOLD"]);
assert.deepEqual(getMusicHomeUnlocks({ stemUploads: -1, completedSplits: 1.5 }).badges, []);
for (const theme of Object.keys(THEMES)) {
  assert.equal(normalizeMusicHomeConfig({ ...defaults, theme }, context, { strict: true }).theme, theme);
}
for (const theme of ["PLATINUM", "COPPER", "BRONZE", "__proto__", "INVALID"]) {
  assert.throws(() => normalizeMusicHomeConfig({ ...defaults, theme }, { ...context, milestones: {} }, { strict: true }));
  assert.equal(normalizeMusicHomeConfig({ ...defaults, theme }, { ...context, milestones: {} }).theme, "GOLD");
}
const reordered = moveModule(defaults.layoutModules, "COLLAB_BRIEFS", -1);
assert.equal(reordered[2].type, "COLLAB_BRIEFS");
assert.deepEqual(reordered.map(module => module.order), [0, 1, 2, 3, 4]);
const legacyModules = defaults.layoutModules.slice(0, 4).map((module, order) => ({ ...module, order, isVisible: order !== 1 }));
const upgradedLegacy = normalizeMusicHomeConfig({ ...defaults, layoutModules: legacyModules }, context, { strict: true });
assert.deepEqual(upgradedLegacy.layoutModules.slice(0, 4), legacyModules, "Existing module order and visibility survive");
assert.deepEqual(upgradedLegacy.layoutModules[4], { id: "CREATIVE_DNA", type: "CREATIVE_DNA", order: 4, isVisible: true });
assert.deepEqual(defaults.layoutModules.map(module => module.type), MODULE_TYPES, "Reordering never mutates saved input");
assert.deepEqual(moveModule(defaults.layoutModules, "PEARL_HALL", -1), defaults.layoutModules);
assert.deepEqual(moveModule(defaults.layoutModules, "INVALID", 1), defaults.layoutModules);
assert.deepEqual(moveModule(defaults.layoutModules, "PEARL_HALL", 99), defaults.layoutModules);
const hidden = reordered.map(module => ({ ...module, isVisible: module.type !== "SIGNAL_FEED" }));
assert.deepEqual(normalizeMusicHomeConfig({ ...defaults, layoutModules: hidden }, context, { strict: true }).layoutModules, hidden);
for (const modules of [
  [], [...defaults.layoutModules, defaults.layoutModules[0]],
  defaults.layoutModules.map(module => ({ ...module, order: 0 })),
  defaults.layoutModules.map(module => ({ ...module, isVisible: "true" })),
  defaults.layoutModules.map(module => ({ ...module, id: "wrong" })),
  [null, ...defaults.layoutModules.slice(1)]
]) {
  assert.throws(() => normalizeMusicHomeConfig({ ...defaults, layoutModules: modules }, context, { strict: true }));
  assert.deepEqual(normalizeMusicHomeConfig({ ...defaults, layoutModules: modules }, context).layoutModules, defaults.layoutModules);
}
const custom = { ...defaults, backgroundMode: "CUSTOM_UPLOAD", selectedBackgroundUrl: customUrl, isSovereignModeActive: true };
assert.equal(normalizeMusicHomeConfig(custom, context, { strict: true }).isSovereignModeActive, true);
for (const pass of [
  null, {}, { entitlements: { customArtistRoom: true } },
  { ...premium, subscriptionStatus: "past_due" },
  { ...premium, subscriptionExpiresAt: "2020-01-01" },
  { ...premium, subscriptionExpiresAt: null }
]) {
  assert.throws(() => normalizeMusicHomeConfig(custom, { ...context, pass }, { strict: true }));
  const safe = normalizeMusicHomeConfig(custom, { ...context, pass });
  assert.equal(safe.backgroundMode, "SOLID_OBSIDIAN");
  assert.equal(safe.selectedBackgroundUrl, "");
  assert.equal(safe.isSovereignModeActive, false);
}
for (const url of ["https://example.com/loop.mp4", "javascript:alert(1)", "//example.com", "/api/music-home?creator=other&asset=background"]) {
  assert.throws(() => normalizeMusicHomeConfig({ ...custom, selectedBackgroundUrl: url }, context, { strict: true }));
}
assert.throws(() => normalizeMusicHomeConfig(custom, { ...context, customBackgroundUrl: "" }, { strict: true }));
assert.throws(() => normalizeMusicHomeConfig({ ...defaults, creatorId: "victim" }, context, { strict: true }));
assert.throws(() => normalizeMusicHomeConfig({ ...defaults, schemaVersion: 2 }, context, { strict: true }));
for (const field of ["theme", "backgroundMode", "selectedBackgroundUrl", "layoutModules", "isSovereignModeActive"]) {
  const incomplete = { ...defaults };
  delete incomplete[field];
  assert.throws(() => normalizeMusicHomeConfig(incomplete, context, { strict: true }), `Missing ${field} is rejected`);
}
assert.deepEqual(normalizeMusicHomeConfig({ ...defaults, unlockedBadges: ["FAKE"], entitlements: { customArtistRoom: true } }, context).unlockedBadges,
  ["FIRST_STEM", "STEM_COLLECTOR", "SPLITS_COMPLETED"]);
for (const loop of CURATED_LOOPS) {
  assert.equal(normalizeMusicHomeConfig({ ...defaults, backgroundMode: "CURATED_LOOP", selectedBackgroundUrl: loop.url }, context, { strict: true }).selectedBackgroundUrl, loop.url);
  const file = new URL(`..${loop.url}`, import.meta.url);
  assert.ok((await stat(file)).size < 100 * 1024, "Bundled loops remain resource optimized");
  assert.equal(validateCustomVideo(new Uint8Array(await readFile(file)), "video/mp4"), true);
}
for (const [bytes, mime] of [
  [new Uint8Array(), "video/mp4"], [new Uint8Array(50), "video/mp4"],
  [new Uint8Array(MAX_CUSTOM_VIDEO_BYTES + 1), "video/mp4"],
  [new Uint8Array(await readFile(new URL(`..${CURATED_LOOPS[0].url}`, import.meta.url))), "text/html"]
]) assert.throws(() => validateCustomVideo(bytes, mime));

class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.style = {}; this.value = ""; }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]);
  }
}
const chrome = [new Element(), new Element()];
const restore = new Element();
const doc = {
  hidden: false,
  querySelectorAll: () => chrome,
  getElementById: () => restore,
  createElement: tag => new Element(tag),
  listeners: new Map(),
  addEventListener(name, callback) { this.listeners.set(name, callback); },
  removeEventListener(name) { this.listeners.delete(name); }
};
applySovereignMode(doc, true);
assert.ok(chrome.every(element => element.hidden));
assert.equal(restore.hidden, false, "Navigation always has an escape hatch");
applySovereignMode(doc, "true");
assert.ok(chrome.every(element => !element.hidden), "Sovereign flag must be a boolean");
assert.equal(restore.hidden, true);
assert.equal(shouldAutoplayBackground(), true);
for (const preferences of [{ reducedMotion: true }, { saveData: true }, { hidden: true }]) assert.equal(shouldAutoplayBackground(preferences), false);
const video = new Element("video"), toggle = new Element("button");
let plays = 0;
video.paused = true;
video.pause = () => { video.paused = true; };
video.play = async () => { plays++; video.paused = false; };
video.load = () => {};
Object.defineProperty(video, "src", { set(value) { video.attributes.src = value; } });
const motion = new Element();
motion.matches = true;
const win = { matchMedia: () => motion, navigator: { connection: { saveData: false } } };
const background = createBackgroundController(video, toggle, doc, win);
background.setSource(CURATED_LOOPS[0].url);
assert.equal(plays, 0, "Reduced-motion backgrounds do not load or autoplay");
assert.equal(video.getAttribute("src"), null);
await toggle.listeners.get("click")();
await Promise.resolve();
assert.equal(plays, 1, "Explicit playback is allowed with reduced motion");
toggle.listeners.get("click")();
assert.equal(video.paused, true);
doc.hidden = true;
doc.listeners.get("visibilitychange")();
assert.equal(video.paused, true);
background.setSource("");
assert.equal(toggle.hidden, true);
assert.equal(video.getAttribute("src"), null);
background.destroy();

globalThis.document = doc;
globalThis.File = class {};
let response = { config: defaults, creatorPass: { entitlements: {} }, milestones: { stemUploads: 0, completedSplits: 0 }, unlocks: getMusicHomeUnlocks() };
globalThis.fetch = async () => ({ ok: true, json: async () => response });
const root = new Element();
const customizer = mountMusicHomeCustomizer(root);
await customizer.load();
let inputs = root.querySelectorAll("input");
assert.equal(inputs.find(input => input.type === "file").disabled, true);
assert.equal(inputs.find(input => input.type === "checkbox").disabled, true, "Standard cannot toggle Sovereign Mode");
const themeOptions = root.querySelectorAll("select")[0].children;
assert.ok(themeOptions.slice(1).every(option => option.disabled));
response = { ...response, config: custom, creatorPass: { entitlements: { customArtistRoom: true } }, milestones: context.milestones, unlocks: getMusicHomeUnlocks(context.milestones), customBackgroundUrl: customUrl };
await customizer.load();
inputs = root.querySelectorAll("input");
assert.equal(inputs.find(input => input.type === "file").disabled, false);
assert.equal(inputs.find(input => input.type === "checkbox").disabled, false);
let resolveFetch;
globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
const pending = customizer.load();
customizer.clear();
resolveFetch({ ok: true, json: async () => response });
await pending;
assert.equal(root.children.length, 0, "Late signed-out requests cannot resurrect editor state");
const shellElements = new Map();
const shellElement = id => {
  if (!shellElements.has(id)) shellElements.set(id, new Element());
  return shellElements.get(id);
};
const shellVideo = shellElement("homeBackground");
shellVideo.pause = () => {};
shellVideo.load = () => {};
shellVideo.play = async () => {};
const shellDoc = {
  ...doc, hidden: false, listeners: new Map(),
  getElementById: shellElement,
  documentElement: { style: { setProperty() {} } }
};
let publicResponse = {
  config: { ...custom, theme: "PLATINUM", layoutModules: hidden },
  profile: { displayName: "<img src=x onerror=alert(1)>", bio: "Artist bio" },
  milestones: context.milestones,
  modules: { SOVEREIGN_VAULT: [{ title: "Published song", url: "//malicious.test" }], COLLAB_BRIEFS: [] }
};
let publicStatus = 200;
const shellWin = {
  ...win, location: { search: "?creator=creator" },
  fetch: async () => ({ ok: publicStatus === 200, json: async () => publicResponse }),
  setInterval: () => 1, clearInterval() {}
};
globalThis.document = shellDoc;
const shell = mountMusicHome(shellDoc, shellWin);
await new Promise(resolve => setImmediate(resolve));
assert.ok(chrome.every(element => element.hidden));
assert.equal(shellElement("homeName").textContent, publicResponse.profile.displayName, "Artist text is never interpreted as HTML");
assert.deepEqual(shellElement("homeModules").children.map(section => section.children[0].textContent),
  ["Pearl Hall milestones", "Published track drops", "Open collaboration briefs", "Creative DNA"]);
assert.ok(shellElement("homeModules").querySelectorAll("a").every(link => !link.href.startsWith("//")), "Off-origin module URLs are not rendered as links");
shellElement("restoreChrome").listeners.get("click")();
assert.ok(chrome.every(element => !element.hidden));
await shell.refresh();
assert.ok(chrome.every(element => !element.hidden), "Refresh respects a visitor's choice to restore navigation");
publicResponse = { ...publicResponse, config: { ...defaults, layoutModules: hidden } };
await shell.refresh();
assert.equal(shellElement("backgroundToggle").hidden, true, "Downgrade removes custom video controls");
publicStatus = 404;
publicResponse = { message: "This Music Home is private." };
await shell.refresh();
assert.equal(shellElement("homeModules").children.length, 0, "A newly private home clears rendered modules");
assert.equal(shellElement("homeName").textContent, "Music Home");
assert.ok(chrome.every(element => !element.hidden));
shell.destroy();
delete globalThis.document;
delete globalThis.File;
delete globalThis.fetch;

const schema = await readFile(new URL("../types/musicHome.ts", import.meta.url), "utf8");
for (const type of [...Object.keys(THEMES), ...MODULE_TYPES]) assert.ok(schema.includes(`'${type}'`));
console.log("Music Home contracts passed: schema, earned unlocks, layout, fail-closed Premium, original MP4 assets, Sovereign Mode, motion controls and editor lifecycle.");
