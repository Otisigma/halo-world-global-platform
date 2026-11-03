import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createConciergeShowcase, showcaseReleases } from "../album-concierge/showcase.js";
import { conceptTemplates, createConceptDemos, plannedDuration } from "../album-concierge/demos.js";
import { coverMetadata, coverSvg, compileCoverPackage, createCoverBuilder } from "../album-concierge/cover-builder.js";

const sessionId = "10000000-0000-4000-8000-000000000001";
const release = { id: "public-song", title: "<b>Actual Song</b>", artist: "Actual Artist",
  status: "published", isLiveVisible: true, streamUrl: "/assets/test.wav", artwork: "/assets/test.png", pitch: "A public story." };
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }
class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.events = new Map(); this.attributes = {}; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { this.events.set(name, fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
}
function browser(transport, sentinel) {
  const names = ["selector", "releases", "status", "concepts", "concept-status", "player-status", "audio", "stop", "refresh"];
  const elements = Object.fromEntries(names.map(name => [name, new Element()]));
  let played = 0, paused = 0;
  Object.defineProperty(elements.audio, "src", { set: value => elements.audio.setAttribute("src", value) });
  elements.audio.play = async () => { played++; };
  elements.audio.pause = () => { paused++; };
  elements.audio.load = () => {};
  const calls = [];
  const desk = createConciergeShowcase({
    querySelector: selector => elements[selector.slice("[data-showcase-".length, -1)]
  }, {
    sentinel,
    document: { createElement: tag => new Element(tag) },
    fetch: async (path, options) => { calls.push({ path, options }); return transport(path, options); }
  });
  return { elements, desk, calls, played: () => played, paused: () => paused };
}
await check("public catalog validation excludes private/draft rows and rejects forged payloads", async () => {
  const rows = showcaseReleases({ releases: [release, { ...release, status: "draft" }, { ...release, isLiveVisible: false }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "<b>Actual Song</b>");
  assert.throws(() => showcaseReleases({ releases: [{ ...release, id: "../private" }] }));
  assert.throws(() => showcaseReleases({ releases: null }));
  for (const streamUrl of ["/api/stem-vault/audio", "/private/master.wav", "https://audio.example/song.wav?token=private"]) {
    assert.equal(showcaseReleases({ releases: [{ ...release, streamUrl }] })[0].audio, "");
  }
});
await check("real cards, artwork, selection, user-triggered playback and stop work without mutations", async () => {
  const h = browser(async () => Response.json({ releases: [release, { ...release, id: "second-song", title: "Second Song", streamUrl: "" }] }));
  await h.desk.refreshCatalog();
  assert.equal(h.elements.releases.children.length, 2);
  assert.equal(h.elements.releases.children[0].children.find(n => n.tag === "h3").textContent, "<b>Actual Song</b>");
  assert.equal(h.played(), 0);
  const actions = h.elements.releases.children[0].children.at(-1);
  const [placeholder, image] = h.elements.releases.children[0].children;
  assert.equal(placeholder.hidden, true);
  image.events.get("error")();
  assert.equal(placeholder.hidden, false);
  assert.equal(image.hidden, true);
  assert.equal(actions.children[1].href, "/music/?song=public-song");
  await actions.children[0].events.get("click")();
  assert.equal(h.played(), 1);
  assert.equal(h.elements.audio.getAttribute("src"), "/assets/test.wav");
  h.elements.audio.events.get("pause")();
  assert.match(h.elements["player-status"].textContent, /paused/);
  h.elements.audio.events.get("playing")();
  assert.match(h.elements["player-status"].textContent, /playing/);
  h.elements.selector.value = "second-song";
  h.elements.selector.events.get("change")();
  assert.equal(h.elements.releases.children.length, 1);
  assert.equal(h.elements.audio.getAttribute("src"), null);
  assert.equal(h.elements.releases.children[0].children.at(-1).children[0].disabled, true);
  assert.ok(h.calls.every(c => !c.options.body && !c.options.method));
});
await check("Sentinel is registered before Preview and its preflight does not delay the click-authorized play call", async () => {
  let registered, complete;
  const calls = [];
  const sentinel = {
    bind(controller) { registered = controller; },
    preflight(audio) {
      assert.equal(registered?.audio, audio);
      calls.push("preflight");
      return new Promise(resolve => { complete = resolve; });
    }
  };
  const h = browser(async () => Response.json({ releases: [release] }), sentinel);
  assert.ok(registered, "register the selected media before a listener can click");
  await h.desk.refreshCatalog();
  const pending = h.elements.releases.children[0].children.at(-1).children[0].events.get("click")();
  assert.equal(h.played(), 1, "play must run in the click task, before awaiting preflight");
  assert.deepEqual(calls, ["preflight"]);
  complete({ ok: true });
  await pending;
  assert.equal(registered.expectedSource(), "/assets/test.wav");
  registered.onUnavailable();
  assert.equal(registered.expectedSource(), "");
  assert.match(h.elements["player-status"].textContent, /Sentinel could not verify/);
});
await check("empty, failed and stale catalog results expose honest retry states", async () => {
  const empty = browser(async () => Response.json({ releases: [] }));
  await empty.desk.refreshCatalog();
  assert.match(empty.elements.status.textContent, /No public releases/);
  assert.equal(empty.elements.selector.disabled, true);
  const fail = browser(async () => Response.json({}, { status: 503 }));
  await fail.desk.refreshCatalog();
  assert.match(fail.elements.status.textContent, /Could not load/);
  assert.equal(fail.elements.releases.children.length, 0);
  let complete, calls = 0;
  const stale = browser(async () => ++calls === 1
    ? new Promise(resolve => { complete = resolve; }) : Response.json({ releases: [] }));
  const pending = stale.desk.refreshCatalog();
  await stale.desk.refreshCatalog();
  complete(Response.json({ releases: [release] })); await pending;
  assert.equal(stale.elements.releases.children.length, 0);
});
await check("concept vault uses owned API sessions, safe text, genuine links and account-reset guards", async () => {
  const h = browser(async () => Response.json({ sessions: [
    { id: sessionId, generatedTitles: ["<script>Concept</script>"], generatedTheme: "My idea", status: "ready" },
    { id: sessionId, status: "draft" }
  ] }));
  await h.desk.refreshConcepts();
  assert.equal(h.calls[0].path, "/api/album-concierge");
  assert.equal(h.elements.concepts.children.length, 2);
  assert.equal(h.elements.concepts.children[0].children[1].textContent, "<script>Concept</script>");
  assert.equal(h.elements.concepts.children[0].children.at(-1).children[0].href, `/album-concierge/?session=${sessionId}`);
  assert.match(h.elements["concept-status"].textContent, /Ideas only/);
  h.desk.resetConcepts();
  assert.equal(h.elements.concepts.children.length, 0);
  const guest = browser(async () => Response.json({}, { status: 401 }));
  await guest.desk.refreshConcepts();
  assert.match(guest.elements["concept-status"].textContent, /Sign in/);
  let complete;
  const late = browser(async () => new Promise(resolve => { complete = resolve; }));
  const pending = late.desk.refreshConcepts();
  late.desk.resetConcepts();
  complete(Response.json({ sessions: [{ id: sessionId, status: "ready" }] })); await pending;
  assert.equal(late.elements.concepts.children.length, 0);
});
await check("markup uses semantic controls and no hardcoded releases, fake rank or online claims", async () => {
  const [page, css, script] = await Promise.all([
    "album-concierge/index.html", "album-concierge/showcase.css", "album-concierge/showcase.js"
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(page, /data-concierge-showcase aria-labelledby="showcaseTitle"/);
  assert.match(page, /<audio data-showcase-audio controls preload="none"/);
  assert.match(page, /data-showcase-concept-status role="status" aria-live="polite"/);
  assert.doesNotMatch(script, /alert\(|innerHTML|#1 THIS WEEK|Online & Synchronized|Reciprocity|Ball.s in Your Court/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
await check("fictional demo layouts switch complete tracklists without APIs, playback or saved state", async () => {
  const layout = new Element(), status = new Element();
  let focused = false, scrolled = false;
  layout.scrollIntoView = () => { scrolled = true; };
  const buttons = conceptTemplates.map(template => {
    const button = new Element("button"); button.dataset = { demoTemplate: template.id }; return button;
  });
  const root = {
    querySelector: selector => selector === "[data-demo-layout]" ? layout : status,
    querySelectorAll: () => buttons
  };
  const demo = createConceptDemos(root, { document: { createElement: tag => {
    const node = new Element(tag); node.focus = () => { focused = true; }; return node;
  } } });
  assert.equal(layout.hidden, false);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  for (const [index, expectedCount, expectedSeconds] of [[0, 8, 2520], [1, 6, 1680]]) {
    const template = conceptTemplates[index];
    demo.load(template.id);
    const details = layout.children[1];
    const tracks = details.children.find(node => node.tag === "ol");
    assert.equal(tracks.children.length, expectedCount);
    assert.equal(template.tracks.reduce((sum, [, seconds]) => sum + seconds, 0), expectedSeconds);
    assert.equal(details.children[0].textContent, template.title);
    assert.match(status.textContent, /Fictional layout only; nothing saved, purchased, or played/);
    assert.equal(buttons[index].getAttribute("aria-pressed"), "true");
    assert.equal(buttons[1 - index].getAttribute("aria-pressed"), "false");
  }
  assert.equal(plannedDuration(285), "4:45");
  buttons[0].events.get("click")();
  assert.equal(focused, true);
  assert.equal(scrolled, true);
  assert.equal(layout.children[1].children[0].textContent, "Midnight Resonance LP");
  assert.throws(() => demo.load("missing"), /Unknown album concept/);
  const [page, script] = await Promise.all(["album-concierge/index.html", "album-concierge/demos.js"]
    .map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(page, /data-concierge-demos aria-labelledby="demoArchiveTitle"/);
  assert.match(page, /aria-controls="demoLayout" aria-pressed="false"/);
  assert.doesNotMatch(script, /fetch\(|localStorage|sessionStorage|innerHTML|alert\(|\.play\(/);
});
await check("cover builder compiles safe, bounded metadata and the same local SVG into real downloads", async () => {
  const input = { title: '<script>alert("x")</script>', artist: "Artist & Friends", mood: "Deep house",
    location: "Optional place", dedication: "For you\nwith love" };
  const compiled = compileCoverPackage(input);
  assert.equal(compiled.schema, "halo-local-cover-concept");
  assert.equal(compiled.metadata.dedication, "For you with love");
  assert.equal(compiled.artwork.svg, coverSvg(input));
  assert.match(compiled.artwork.svg, /&lt;script&gt;/);
  assert.doesNotMatch(compiled.artwork.svg, /<script|<foreignObject|href=/);
  assert.throws(() => compileCoverPackage({ ...input, title: " " }), /Enter a title/);
  assert.throws(() => coverMetadata({ ...input, artist: "a".repeat(61) }), /valid artist/);
  assert.throws(() => coverMetadata({ ...input, location: "\u0000" }), /valid location/);
  assert.throws(() => coverMetadata({ ...input, title: "\ud800" }), /valid title/);
  assert.match(coverSvg({ ...input, title: "Music \u{1f3b5}" }), /Music/);
  assert.equal(coverMetadata({ ...input, title: "  hello  " }).title, "hello");
  const elements = Object.fromEntries(["form", "preview", "dedication", "status"].map(key => [key, new Element()]));
  elements.form.elements = { namedItem: key => ({ value: input[key] }) };
  elements.form.reportValidity = () => true;
  const blobs = new Map(), revoked = [], anchors = [], timers = [];
  let id = 0;
  const builder = createCoverBuilder({
    querySelector: selector => elements[selector.slice("[data-cover-".length, -1)]
  }, {
    document: { body: { append: anchor => anchors.push(anchor) }, createElement: () => ({
      click() { this.clicked = true; }, remove() { this.removed = true; }
    }) },
    urls: { createObjectURL: blob => { const key = `blob:${++id}`; blobs.set(key, blob); return key; },
      revokeObjectURL: url => revoked.push(url) },
    defer: callback => timers.push(callback)
  });
  assert.equal(await blobs.get(elements.preview.src).text(), compiled.artwork.svg);
  let prevented = false;
  elements.form.events.get("submit")({ preventDefault: () => { prevented = true; }, submitter: { dataset: { coverExport: "package" } } });
  assert.equal(prevented, true);
  assert.equal(anchors[0].download, "halo-cover-concept.json");
  assert.deepEqual(JSON.parse(await blobs.get(anchors[0].href).text()), compiled);
  assert.equal(anchors[0].clicked, true); assert.equal(anchors[0].removed, true);
  builder.download("artwork");
  assert.equal(anchors[1].download, "halo-cover-concept.svg");
  assert.equal(await blobs.get(anchors[1].href).text(), compiled.artwork.svg);
  input.title = "Changed title"; builder.render();
  assert.ok(revoked.includes("blob:1"));
  input.title = ""; builder.download("package");
  assert.equal(anchors.length, 2);
  assert.match(elements.status.textContent, /Could not export/);
  timers.forEach(callback => callback());
  builder.dispose();
  assert.ok(revoked.includes(anchors[0].href));
  const source = await readFile(new URL("../album-concierge/cover-builder.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|innerHTML|alert\(/);
});
console.log(`Concierge showcase contracts passed (${checks} groups).`);
