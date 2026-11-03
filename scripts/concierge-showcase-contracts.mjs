import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createConciergeShowcase, showcaseReleases } from "../album-concierge/showcase.js";

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
function browser(transport) {
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
console.log(`Concierge showcase contracts passed (${checks} groups).`);
