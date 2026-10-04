import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSocialStore, sanitizeSocialIdentity, validateIntroMedia, relativeTime,
  createAuthorHeader, createSocialAvatar, getLocalIdentity, recordStudioSpark
} from "../lib/creator-social.js";

let passed = 0;
async function check(name, test) {
  await test(); passed++; console.log(`PASS: ${name}`);
}
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [["halo.creator-social.v1", initial]]);
  return {
    values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  };
}

class Node {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
    this.value = ""; this._text = ""; this.className = "";
    this.classList = { add: name => { this.className += ` ${name}`; } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === "src") this.src = ""; }
  pause() { this.pauseCalls = (this.pauseCalls || 0) + 1; }
  load() { this.loadCalls = (this.loadCalls || 0) + 1; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatchEvent(event) { for (const callback of this.listeners[event.type] || []) callback(event); return true; }
  fire(type, data = {}) { this.dispatchEvent({ type, preventDefault() {}, ...data }); }
}
function all(root, predicate) {
  return [root, ...root.children.flatMap(child => all(child, () => true))].filter(predicate);
}
const doc = { createElement: tag => new Node(tag) };

await check("identity has honest defaults, bounded plain text and no privileged or media fields", () => {
  assert.deepEqual(sanitizeSocialIdentity(null), { displayName: "Your studio", handle: "local-creator", intro: "" });
  for (const value of [[], true, 23, "name", undefined]) assert.deepEqual(sanitizeSocialIdentity(value), sanitizeSocialIdentity(null));
  const identity = sanitizeSocialIdentity({
    displayName: "<img src=x onerror=alert(1)>Ada\u0000\u202e" + "a".repeat(100),
    handle: "@Ada<script>bad()</script> /?#\u0000" + "a".repeat(100),
    intro: "<script>alert(1)</script>" + "b".repeat(500),
    photo: "https://evil.example/a.png", video: "data:video/mp4;base64,x", admin: true, verified: true,
    local: true, previewToken: 0
  });
  assert.equal(identity.displayName.length, 60);
  assert.equal(identity.handle.length, 32);
  assert.equal(identity.intro.length, 280);
  assert.match(identity.handle, /^[a-z0-9_-]+$/);
  assert.doesNotMatch(JSON.stringify(identity), /onerror|https:|data:|admin|verified|previewToken|[\u0000\u202e]/);
  assert.deepEqual(Object.keys(identity), ["displayName", "handle", "intro"]);
  assert.doesNotMatch(sanitizeSocialIdentity({ displayName: "<scr<script>ipt", intro: "<<script>script" }).displayName, /[<>]/);
  assert.doesNotMatch(sanitizeSocialIdentity({ intro: "<<script>script" }).intro, /[<>]/);
});

await check("persisted state is versioned, sanitized and bounded; malicious sparks cannot grant access", () => {
  const storage = memoryStorage(JSON.stringify({
    version: 1, identity: { displayName: "<b>Ada</b>", handle: "ADA!!", intro: "<img onerror=x>Hello", photo: "https://bad.example" },
    sparks: ["follow", "follow", "unlock", "draft", { action: "save" }], isAdmin: true
  }));
  const store = createSocialStore(storage);
  assert.deepEqual(store.get().identity, { displayName: "Ada", handle: "ada", intro: "Hello" });
  assert.deepEqual(store.get().sparks, ["follow", "draft"]);
  store.save({ displayName: "A".repeat(1000), intro: "B".repeat(1000), handle: "x".repeat(1000), photo: "blob:fake" });
  const persisted = [...storage.values.values()][0];
  assert.ok(persisted.length < 1024); assert.doesNotMatch(persisted, /blob:|isAdmin/);
  store.get().identity.displayName = "mutated"; store.get().sparks.push("save");
  assert.notEqual(store.get().identity.displayName, "mutated"); assert.equal(store.get().sparks.length, 2);
});

await check("corrupt, oversized and unsupported persisted values fall back without throwing and reset removes them", () => {
  for (const raw of ["{broken", "[]", "true", "42", '{"version":2}', "x".repeat(4097)]) {
    const storage = memoryStorage(raw); const store = createSocialStore(storage);
    assert.equal(store.get().identity.displayName, "Your studio");
    assert.equal(store.get().persistent, false); assert.match(store.get().status, /session-only/);
    store.save({ displayName: "Session creator" });
    assert.equal(store.get().identity.displayName, "Session creator");
    store.reset(); assert.equal(storage.values.size, 0);
    assert.equal(createSocialStore(storage).get().identity.displayName, "Your studio");
  }
  const store = createSocialStore(memoryStorage('{"version":1,"identity":[],"sparks":"save"}'));
  assert.deepEqual(store.get().sparks, []); assert.equal(store.get().identity.handle, "local-creator");
});

await check("denied reads, quota writes and denied resets preserve session state with honest status", () => {
  const denied = createSocialStore({
    getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); }
  });
  denied.save({ displayName: "Session" }); denied.recordSpark("save");
  assert.equal(denied.get().identity.displayName, "Session"); assert.deepEqual(denied.get().sparks, ["save"]);
  denied.reset(); assert.deepEqual(denied.get().sparks, []); assert.match(denied.get().status, /session only/);
  const quota = createSocialStore({ getItem: () => null, setItem() { throw new Error("quota"); }, removeItem() {} });
  quota.save({ displayName: "Quota creator" }); quota.recordSpark("draft");
  assert.equal(quota.get().identity.displayName, "Quota creator"); assert.equal(quota.get().persistent, false);
  assert.match(quota.get().status, /unavailable or full/);
  const unavailable = createSocialStore();
  unavailable.save({ displayName: "Offline" }); assert.match(unavailable.get().status, /only this session/);
});

await check("studio sparks are unique, limited to three, reloadable and independently resettable", () => {
  const storage = memoryStorage(); const store = createSocialStore(storage);
  store.save({ displayName: "Ada" });
  for (const action of ["payment", "orbit", null, {}, "__proto__"]) assert.equal(store.recordSpark(action), false);
  for (const action of ["follow", "draft", "save"]) {
    assert.equal(store.recordSpark(action), true); assert.equal(store.recordSpark(action), false);
  }
  assert.equal(createSocialStore(storage).get().sparks.length, 3);
  store.resetSparks(); assert.equal(store.get().sparks.length, 0); assert.equal(store.get().identity.displayName, "Ada");
  store.reset(); assert.equal(store.get().identity.displayName, "Your studio"); assert.equal(storage.values.size, 0);
});

await check("media accepts only bounded nonempty supported photo/video files, never SVG or URL input", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    assert.equal(validateIntroMedia({ type, size: 5 * 1024 * 1024 }, "photo").valid, true);
  }
  for (const type of ["video/mp4", "video/webm", "video/ogg"]) {
    assert.equal(validateIntroMedia({ type, size: 25 * 1024 * 1024 }, "video").valid, true);
  }
  for (const file of [null, {}, "https://example.com/a.png", { type: "image/svg+xml", size: 10 },
    { type: "text/html", size: 10 }, { type: "image/png", size: 0 }, { type: "image/png", size: -1 },
    { type: "image/png", size: Infinity }, { type: "image/png", size: "100" },
    { type: "image/png", size: 5 * 1024 * 1024 + 1 }]) assert.equal(validateIntroMedia(file, "photo").valid, false);
  assert.equal(validateIntroMedia({ type: "video/mp4", size: 25 * 1024 * 1024 + 1 }, "video").valid, false);
  assert.equal(validateIntroMedia({ type: "video/mp4", size: 10 }, "photo").valid, false);
  assert.equal(validateIntroMedia({ type: "image/png", size: 10 }, "video").valid, false);
  assert.equal(validateIntroMedia({ type: "image/png", size: 10 }, "other").valid, false);
});

await check("relative timestamps are honest about missing, invalid, old and future dates", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  for (const value of [undefined, null, "", " ", "bad-date", false, {}, NaN, Infinity]) assert.equal(relativeTime(value, now), "");
  assert.equal(relativeTime(now - 30000, now), "less than a minute ago");
  assert.equal(relativeTime(now - 120000, now), "2 minutes ago");
  assert.equal(relativeTime(now - 3600000, now), "1 hour ago");
  assert.equal(relativeTime(now - 172800000, now), "2 days ago");
  assert.equal(relativeTime(now + 120000, now), "in 2 minutes");
  assert.equal(relativeTime(now + 10000, now), "in less than a minute");
  assert.match(relativeTime("2020-10-04T12:00:00Z", now), /years ago/);
  assert.equal(relativeTime(now, NaN), "");
});

await check("author DOM uses text nodes, no invented recency, decorative avatars and valid time semantics", () => {
  const sample = createAuthorHeader(doc, { displayName: "<img onerror=x>Ada", handle: '"><script>x</script>', label: "<b>Sample showcase</b>" });
  assert.equal(all(sample, node => node.tagName === "time").length, 0);
  assert.match(sample.textContent, /Sample showcase/); assert.doesNotMatch(sample.textContent, /ago|<b>/);
  assert.equal(all(sample, node => node.tagName === "strong")[0].textContent, "<img onerror=x>Ada");
  assert.equal(all(createAuthorHeader(doc, { displayName: "<Creator>" }), node => node.tagName === "strong")[0].textContent, "<Creator>");
  assert.equal(all(sample, node => node.tagName === "img" || node.tagName === "script").length, 0);
  const header = createAuthorHeader(doc, { displayName: "Ada", handle: "ada", createdAt: "2026-10-03T12:00:00Z" });
  assert.equal(all(header, node => node.tagName === "time")[0].dateTime, "2026-10-03T12:00:00.000Z");
  assert.equal(createSocialAvatar(doc).attributes["aria-hidden"], "true");
  assert.equal(getLocalIdentity().displayName, "Your studio");
  assert.doesNotThrow(() => recordStudioSpark("follow"));
  assert.equal(recordStudioSpark("follow"), false);
});

await check("welcome lifecycle syncs local avatars, validates media, revokes object URLs and persists text only", async () => {
  const storage = memoryStorage();
  const root = new Node("section");
  const document = new Node("document");
  document.createElement = tag => new Node(tag);
  document.querySelectorAll = () => [root];
  document.readyState = "complete";
  const window = new Node("window");
  const revoked = []; let created = 0; let socialEvents = 0;
  window.URL = { createObjectURL: () => `blob:session-${++created}`, revokeObjectURL: url => revoked.push(url) };
  window.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  document.defaultView = window;
  document.addEventListener("halo-social-change", () => { socialEvents++; });
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = document; globalThis.localStorage = storage;
  try {
    const social = await import(`../lib/creator-social.js?contracts=${Date.now()}`);
    const field = name => all(root, node => node.name === name)[0];
    const button = text => all(root, node => node.tagName === "button" && node.textContent === text)[0];
    const status = () => all(root, node => node.attributes.role === "status")[0].textContent;
    const files = all(root, node => node.type === "file");
    assert.equal(files.length, 2);
    assert.equal(all(root, node => node.type === "url").length, 0);
    assert.match(root.textContent, /not an account profile/); assert.match(root.textContent, /Nothing is uploaded/);
    assert.match(root.textContent, /0\/3 studio sparks/);
    assert.match(root.textContent, /Your studio/);
    assert.match(root.textContent, /never unlock Orbits, access or payment/);
    assert.equal(all(root, node => node.required === true || node.disabled === true).length, 0);
    const initialChildren = root.children.length; social.initSocialWelcome(document);
    assert.equal(root.children.length, initialChildren);
    field("displayName").value = "<b>Ada Studio</b>"; field("handle").value = "ada"; field("intro").value = "<script>x</script>Hello";
    all(root, node => node.tagName === "form")[0].fire("submit");
    assert.equal(social.getLocalIdentity().displayName, "Ada Studio");
    assert.match(root.textContent, /xHello/); assert.ok(socialEvents > 0);
    assert.equal(social.recordStudioSpark("save"), true); assert.equal(social.recordStudioSpark("save"), false);
    assert.match(root.textContent, /1\/3 studio sparks/);
    files[0].files = [{ type: "image/svg+xml", size: 10 }]; files[0].fire("change");
    assert.equal(created, 0); assert.match(status(), /JPEG/);
    social.recordStudioSpark("follow"); assert.match(status(), /JPEG/);
    files[0].files = [{ type: "image/png", size: 100 }]; files[0].fire("change");
    const oldIdentity = social.getLocalIdentity();
    const localAvatar = social.createSocialAvatar(document);
    assert.equal(localAvatar.children[0].src, "blob:session-1");
    const remoteAvatar = social.createSocialAvatar(document, { displayName: "Ada Studio", handle: "ada", photo: "blob:session-1" });
    assert.equal(remoteAvatar.children.length, 0);
    assert.equal(social.createAuthorHeader(document, { displayName: "Other", handle: "other", identity: oldIdentity }).children[0].children.length, 0);
    files[0].fire("change"); assert.deepEqual(revoked, ["blob:session-1"]);
    assert.equal(social.createSocialAvatar(document, oldIdentity).children.length, 0);
    const createObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = () => { throw new Error("preview unavailable"); };
    files[0].fire("change");
    assert.match(status(), /previews are unavailable/);
    assert.equal(social.createSocialAvatar(document).children[0].src, "blob:session-2");
    assert.deepEqual(revoked, ["blob:session-1"]);
    window.URL.createObjectURL = createObjectURL;
    files[1].files = [{ type: "video/mp4", size: 26 * 1024 * 1024 }]; files[1].fire("change");
    assert.equal(created, 2); assert.match(status(), /25 MB/);
    files[1].files = [{ type: "video/webm", size: 100 }]; files[1].fire("change");
    const video = all(root, node => node.tagName === "video")[0];
    assert.equal(video.controls, true); assert.notEqual(video.autoplay, true); assert.equal(video.preload, "metadata");
    social.recordStudioSpark("draft");
    assert.equal(all(root, node => node.tagName === "video")[0], video);
    assert.equal(video.pauseCalls, undefined);
    assert.match(status(), /Session-only preview ready/);
    assert.doesNotMatch([...storage.values.values()].join(""), /blob:|image\/|video\/|photo/);
    button("Clear session media").fire("click");
    assert.equal(video.pauseCalls, 1); assert.equal(video.loadCalls, 1); assert.equal(video.src, "");
    assert.deepEqual(revoked, ["blob:session-1", "blob:session-2", "blob:session-3"]);
    assert.equal(social.getLocalIdentity().displayName, "Ada Studio");
    files[0].fire("change"); files[1].fire("change");
    const pagehideVideo = all(root, node => node.tagName === "video")[0];
    window.fire("pagehide");
    assert.equal(pagehideVideo.pauseCalls, 1); assert.equal(pagehideVideo.loadCalls, 1); assert.equal(pagehideVideo.src, "");
    assert.deepEqual(revoked.slice(-2), ["blob:session-4", "blob:session-5"]);
    assert.equal(all(root, node => node.tagName === "video").length, 0);
    button("Reset studio sparks").fire("click");
    assert.match(root.textContent, /0\/3 studio sparks/); assert.equal(social.getLocalIdentity().displayName, "Ada Studio");
    storage.setItem("halo.creator-social.v1", JSON.stringify({ version: 1, identity: { displayName: "Other tab", handle: "other" }, sparks: ["draft"] }));
    window.fire("storage", { key: "halo.creator-social.v1" });
    assert.equal(social.getLocalIdentity().displayName, "Other tab"); assert.match(root.textContent, /1\/3 studio sparks/);
    files[0].fire("change"); files[1].fire("change");
    button("Clear local identity and sparks").fire("click");
    assert.equal(social.getLocalIdentity().displayName, "Your studio"); assert.equal(storage.values.size, 0);
    assert.deepEqual(revoked.slice(-2), ["blob:session-6", "blob:session-7"]);
    assert.equal(social.createSocialAvatar(document).children.length, 0);
    storage.setItem("halo.creator-social.v1", "{corrupt");
    window.fire("storage", { key: "halo.creator-social.v1" });
    assert.match(status(), /could not be read.*session-only/);
    button("Clear local identity and sparks").fire("click");
    assert.equal(storage.values.size, 0);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

await check("quota failure is visible in the optional welcome and cannot disable access or session milestones", async () => {
  const root = new Node("section"); const document = new Node("document");
  document.createElement = tag => new Node(tag); document.querySelectorAll = () => [root]; document.readyState = "complete";
  const window = new Node("window");
  window.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  document.defaultView = window;
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = document;
  let full = false;
  globalThis.localStorage = { getItem: () => null, setItem() { if (full) throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  try {
    const social = await import(`../lib/creator-social.js?quota-ui=${Date.now()}`);
    all(root, node => node.name === "displayName")[0].value = "Session artist";
    all(root, node => node.tagName === "form")[0].fire("submit");
    assert.equal(social.getLocalIdentity().displayName, "Session artist");
    assert.match(all(root, node => node.attributes.role === "status")[0].textContent, /this browser only/);
    full = true;
    assert.equal(social.recordStudioSpark("follow"), true);
    assert.match(all(root, node => node.attributes.role === "status")[0].textContent, /unavailable or full/);
    for (const action of ["draft", "save"]) assert.equal(social.recordStudioSpark(action), true);
    assert.match(root.textContent, /3\/3 studio sparks/);
    assert.equal(all(root, node => node.required === true || node.disabled === true).length, 0);
    all(root, node => node.tagName === "button" && node.textContent === "Clear local identity and sparks")[0].fire("click");
    assert.equal(social.getLocalIdentity().displayName, "Your studio");
    assert.match(root.textContent, /0\/3 studio sparks/);
    assert.match(all(root, node => node.attributes.role === "status")[0].textContent, /session only/);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

await check("welcome works with denied localStorage getter and no CustomEvent implementation", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  try {
    const social = await import(`../lib/creator-social.js?denied=${Date.now()}`);
    assert.doesNotThrow(() => social.recordStudioSpark("draft"));
    assert.equal(social.recordStudioSpark("draft"), false);
    assert.equal(social.initSocialWelcome({}), undefined);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage;
  }
});

await check("shared stylesheet respects reduced motion and the network runner includes social contracts", async () => {
  const css = await readFile(new URL("../creator-social.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../lib/creator-social.js", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(css, /prefers-reduced-motion: no-preference/); assert.match(css, /:focus-visible/);
  assert.match(css, /--social-accent: #d6ad69/); assert.match(css, /#e9c88e/); assert.match(css, /#090907/);
  assert.doesNotMatch(css, /#(?:b6f2db|171d2b|111521|354967|23493f|d1ffed|293546)/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|FileReader|readAsDataURL|innerHTML|\.autoplay\s*=\s*true/);
  assert.match(pkg.scripts["test:network"], /creator-social-contracts\.mjs/);
});

console.log(`Creator social contracts passed: ${passed}`);
