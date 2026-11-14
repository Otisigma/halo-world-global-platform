import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eligibleMilestone, safeCelebrationArtwork, shareMilestone, createMilestoneCelebration } from "../signal-network/milestone-celebration.js";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }
const milestone = {
  kind: "reviewed-radio-rotation", releaseId: "real-release", title: "<b>Real track</b>", artist: "Artist",
  reachedAt: "2026-01-01T12:00:00.000Z", artwork: "/artwork.jpg",
  rank: 1, supporterCount: 20, member_id: "private-supporter"
};
const snapshot = event => ({ roomId: "authorized-room", visibility: "INNER_CIRCLE", milestone: event });

class Element {
  constructor(tag, document) {
    this.tag = tag; this.document = document; this.children = []; this.events = new Map();
    this.attributes = {}; this.style = { setProperty() {} }; this.isConnected = true;
  }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() { this.document.activeElement = this; }
  select() { this.selected = true; }
  dispatch(type, data = {}) { return this.events.get(type)?.(data); }
}
function harness({ enabled = true, reduced = false, privacy = false, storage, blocked = false, safeSpace = false } = {}) {
  const document = new Element("document");
  document.createElement = tag => new Element(tag, document);
  document.documentElement = { classList: { contains: () => safeSpace } };
  const root = document.createElement("section");
  const outside = document.createElement("button"); outside.focus();
  const values = storage || new Map([["halo-radio-celebrations-v1", JSON.stringify({ enabled, seen: [] })]]);
  const window = new Element("window");
  const timers = new Map();
  const motion = new Element("media"); motion.matches = reduced;
  window.matchMedia = () => motion;
  window.navigator = { globalPrivacyControl: privacy };
  window.location = { origin: "https://halo.example" };
  window.setTimeout = (fn, delay) => { timers.set(delay, fn); return delay; };
  window.clearTimeout = id => timers.delete(id);
  window.localStorage = {
    getItem: key => { if (blocked) throw new Error("blocked"); return values.get(key) || null; },
    setItem: (key, value) => { if (blocked) throw new Error("blocked"); values.set(key, value); }
  };
  const ui = createMilestoneCelebration(root, { document, window });
  const [label, notice, dialog] = root.children;
  const [dismiss, confetti, badge, heading, artwork, track, detail, share, shareStatus, linkLabel] = dialog.children;
  return { ui, root, document, window, outside, values, timers, motion, preference: label.children[0],
    notice, dialog, confetti, badge, heading, artwork, track, detail, share, dismiss, shareStatus, linkLabel };
}

await check("eligibility accepts only persisted reviewed-radio events, never rank or telemetry guesses", () => {
  assert.equal(eligibleMilestone(snapshot(milestone)), milestone);
  for (const invalid of [null, {}, { ...milestone, kind: "#1" }, { ...milestone, kind: "listen_complete" },
    { ...milestone, reachedAt: "invalid" }, { ...milestone, reachedAt: "2999-01-01" },
    { ...milestone, releaseId: "../private" }, { ...milestone, title: "" }, { ...milestone, artist: null }]) {
    assert.equal(eligibleMilestone(snapshot(invalid)), null);
  }
  assert.equal(eligibleMilestone({ ...snapshot(milestone), visibility: "UNAUTHORIZED" }), null);
});

await check("poll transition, rerender, dismissal, refresh and room switches deduplicate the persisted event", () => {
  const h = harness();
  h.ui.update(snapshot(null));
  assert.equal(h.dialog.hidden, true);
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.hidden, false);
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.hidden, false);
  h.dismiss.dispatch("click");
  assert.equal(h.dialog.hidden, true);
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.hidden, true);
  const refreshed = harness({ storage: h.values });
  refreshed.ui.update(snapshot(milestone));
  assert.equal(refreshed.dialog.hidden, true);
  refreshed.ui.update(snapshot({ ...milestone, releaseId: "second-release" }));
  assert.equal(refreshed.dialog.hidden, false);
  refreshed.ui.reset();
  assert.equal(refreshed.dialog.hidden, true);
  refreshed.ui.update(snapshot(milestone));
  assert.equal(refreshed.dialog.hidden, true);
});

await check("opt-in is explicit; privacy signals, unavailable/corrupt/full storage fail closed", () => {
  const h = harness({ enabled: false });
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.hidden, true);
  h.preference.checked = true; h.preference.dispatch("change");
  assert.equal(h.dialog.hidden, false);
  h.preference.checked = false; h.preference.dispatch("change");
  assert.equal(h.dialog.hidden, true);
  const full = new Map([["halo-radio-celebrations-v1", JSON.stringify({ enabled: true, seen: Array.from({ length: 200 }, (_, i) => `event-${i}`) })]]);
  for (const config of [{ privacy: true }, { blocked: true }, { storage: new Map([["halo-radio-celebrations-v1", "invalid"]]) }, { storage: full }]) {
    const disabled = harness(config);
    disabled.ui.update(snapshot(milestone));
    assert.equal(disabled.dialog.hidden, true);
  }
  for (const flag of ["doNotTrack", "globalPrivacyControl"]) {
    const disabled = harness();
    disabled.window.navigator[flag] = flag === "doNotTrack" ? "1" : true;
    disabled.ui.update(snapshot(milestone));
    assert.equal(disabled.dialog.hidden, true);
  }
  const failedWrite = harness();
  failedWrite.window.localStorage.setItem = () => { throw new Error("quota"); };
  failedWrite.ui.update(snapshot(milestone));
  assert.equal(failedWrite.dialog.hidden, true);
});

await check("public rendering is text-only, artwork safe, and saved history has no ranks or identities", () => {
  const h = harness();
  h.ui.update(snapshot(milestone));
  assert.equal(h.track.textContent, "<b>Real track</b> — Artist");
  assert.equal(h.artwork.src, "/artwork.jpg");
  assert.equal(h.artwork.alt, "");
  const rendered = JSON.stringify(h.dialog, (key, value) => ["parent", "document"].includes(key) ? undefined : value);
  assert.ok(!rendered.includes("private-supporter") && !rendered.includes("supporterCount"));
  const saved = [...h.values.values()].join("");
  assert.ok(!saved.includes("private-supporter") && !saved.includes("rank") && !saved.includes("Real track"));
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,test", "//evil.example/art", "ftp://example.com/art", "http://example.com/art"]) {
    assert.equal(safeCelebrationArtwork(url), "/assets/releases/halo-premium-placeholder.svg");
  }
  assert.equal(safeCelebrationArtwork("https://example.com/art.jpg"), "https://example.com/art.jpg");
});

await check("non-modal semantics preserve focus/navigation and Escape/button dismissal restores only internal focus", () => {
  const h = harness();
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.attributes.role, "dialog");
  assert.equal(h.dialog.attributes["aria-modal"], "false");
  assert.ok(h.dialog.attributes["aria-label"]);
  assert.equal(h.notice.attributes.role, "status");
  assert.equal(h.confetti.attributes["aria-hidden"], "true");
  assert.equal(h.document.activeElement, h.outside);
  h.share.focus();
  let prevented = false;
  h.document.dispatch("keydown", { key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.timers.size, 0);
  assert.equal(h.document.events.size, 0);
  h.ui.update(snapshot({ ...milestone, releaseId: "next-release" }));
  const elsewhere = h.document.createElement("a"); elsewhere.focus();
  h.dismiss.dispatch("click");
  assert.equal(h.document.activeElement, elsewhere);
  h.ui.destroy();
  assert.equal(h.root.children.length, 0);
  assert.equal(h.window.events.size, 0);
  assert.equal(h.motion.events.size, 0);
});

await check("reduced motion, Safe Space, hidden pages, revocation and storage changes stop presentation/effects", async () => {
  for (const config of [{ reduced: true }, { safeSpace: true }]) {
    const h = harness(config);
    h.ui.update(snapshot(milestone));
    assert.equal(h.dialog.hidden, false);
    assert.equal(h.confetti.hidden, true);
    assert.equal(h.timers.size, 0);
  }
  const h = harness();
  h.document.hidden = true;
  h.ui.update(snapshot(milestone));
  assert.equal(h.dialog.hidden, true);
  h.document.hidden = false;
  h.ui.update(snapshot(milestone));
  assert.equal(h.confetti.hidden, false);
  assert.equal(h.timers.size, 1);
  h.motion.matches = true; h.motion.dispatch("change");
  assert.equal(h.confetti.hidden, true);
  h.ui.update(null);
  assert.equal(h.dialog.hidden, true);
  h.ui.update(snapshot({ ...milestone, releaseId: "new-release" }));
  h.window.dispatch("storage", { key: "halo-radio-celebrations-v1" });
  assert.equal(h.dialog.hidden, true);
  const animated = harness();
  animated.ui.update(snapshot(milestone));
  animated.timers.get(2400)();
  assert.equal(animated.confetti.hidden, true);
  const css = await readFile(new URL("../signal-network/hype-room.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.halo-safe-space-mode .milestone-confetti/);
  assert.match(css, /pointer-events: none/);
});

await check("native share exposes only public metadata; cancellation, copy and manual-link fallback are honest", async () => {
  let payload, copied;
  const native = await shareMilestone(milestone, { origin: "https://halo.example", navigator: { share: async value => { payload = value; } } });
  assert.match(native.message, /Share sheet/);
  assert.deepEqual(Object.keys(payload).sort(), ["text", "title", "url"]);
  assert.equal(payload.url, "https://halo.example/music/?song=real-release");
  assert.ok(!JSON.stringify(payload).includes("private-supporter"));
  const cancelled = await shareMilestone(milestone, { origin: "https://halo.example", navigator: {
    share: async () => { throw Object.assign(new Error(), { name: "AbortError" }); },
    clipboard: { writeText: async () => { assert.fail("Cancelled sharing must not copy"); } }
  } });
  assert.match(cancelled.message, /cancelled/);
  const copy = await shareMilestone(milestone, { origin: "https://halo.example", navigator: {
    share: async () => { throw new Error("unsupported"); }, clipboard: { writeText: async value => { copied = value; } }
  } });
  assert.match(copy.message, /Nothing was posted/);
  assert.match(copied, /reviewed radio rotation/);
  const manual = await shareMilestone(milestone, { origin: "https://halo.example", navigator: {} });
  assert.equal(manual.url, payload.url);
  const h = harness();
  h.ui.update(snapshot(milestone));
  await h.share.dispatch("click");
  assert.equal(h.linkLabel.hidden, false);
  assert.equal(h.linkLabel.children[0].value, payload.url);
  assert.equal(h.linkLabel.children[0].selected, true);
});

await check("late share completion after logout/reset cannot restore previous event content", async () => {
  const h = harness();
  let finish;
  h.window.navigator.share = () => new Promise(resolve => { finish = resolve; });
  h.ui.update(snapshot(milestone));
  const sharing = h.share.dispatch("click");
  h.ui.reset();
  finish();
  await sharing;
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.shareStatus.textContent, "");
  assert.equal(h.linkLabel.hidden, true);
});
console.log(`Milestone celebration contracts: ${checks}/${checks} checks passed.`);
