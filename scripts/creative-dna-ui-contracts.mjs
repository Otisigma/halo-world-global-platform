import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  DIMENSIONS, element, mountTagEditor, mountCreativeDNAEditor, mountDNAVisitor,
  localSuggestions, renderDNASummary, safeReleaseURL
} from "../creator-network/creative-dna.js";

// Minimal DOM exercises real handlers without adding a framework or dependency.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.isConnected = true;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async fire(type, fields = {}) {
    for (const handler of this.listeners[type] || []) await handler({ preventDefault() {}, target: this, ...fields });
  }
  focus() { document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire("close"); }
}
const body = new Node("body");
globalThis.document = { body, activeElement: null, createElement: tag => new Node(tag) };
globalThis.window = { location: { origin: "https://halo.test" }, confirm: () => true };
const walk = node => [node, ...node.children.flatMap(walk)];
const find = (root, predicate) => walk(root).find(predicate);
const text = root => walk(root).map(node => node.textContent).join(" ");
const terms = Object.keys(DIMENSIONS).flatMap(dimension => Array.from({ length: 10 }, (_, i) => ({
  id: `${dimension}:tag-${i}`, dimension, key: `tag-${i}`, label: `${dimension} tag ${i}`, aliases: i === 0 ? ["atmospheric"] : []
})));
const root = new Node("div");
let changes = 0;
const tags = mountTagEditor(root, { terms, onChange: () => changes++ });
for (let i = 0; i < 8; i++) assert.equal(tags.add(`sonic:tag-${i}`), true);
assert.equal(tags.add("sonic:tag-8"), false, "Owner cap enforced per dimension");
assert.equal(tags.add("invalid"), false);
assert.equal(tags.add("sonic:tag-0"), false, "No duplicate chips");
assert.equal(tags.add("mood:tag-0"), true, "Other dimensions remain available");
assert.equal(changes, 9);
const remove = find(root, node => node.attributes["aria-label"] === "Remove sonic tag 0");
await remove.fire("click");
assert.equal(tags.values().includes("sonic:tag-0"), false);
assert.equal(document.activeElement.tagName, "select", "Removing a chip restores keyboard focus");
assert.equal(tags.add("sonic:tag-8"), true);
assert.ok(localSuggestions("Atmospheric", terms).length);
assert.equal(localSuggestions("", terms).length, 0);
assert.ok(!localSuggestions("Atmospheric", terms, ["sonic:tag-0"]).some(term => term.id === "sonic:tag-0"));
renderDNASummary(root, { creativeStatement: "<script>literal</script>", workflowNotes: "private secret", termIds: ["mood:tag-0"] }, terms);
assert.ok(text(root).includes("<script>literal</script>"));
assert.ok(!text(root).includes("private secret"), "Reusable visitor summary omits workflow notes");
assert.equal(safeReleaseURL("javascript:alert(1)"), null);
assert.equal(safeReleaseURL("data:text/html,private"), null);
assert.equal(safeReleaseURL(null), null);
assert.equal(safeReleaseURL(""), null);
assert.equal(safeReleaseURL("http://example.test/x"), null);
assert.equal(safeReleaseURL("/music/"), "https://halo.test/music/");

const record = {
  profile: { publicProfileId: "public-id", discoverable: true },
  dna: { creativeStatement: "Saved", creativeGoals: "", workflowNotes: "", revision: 4, termIds: [], visibility: "private" },
  terms
};
let failure, saveCalls = [], gets = 0, held, discard = false;
const editorRoot = new Node("div");
const editor = mountCreativeDNAEditor(editorRoot, {
  confirmDiscard: () => discard,
  async request(query, payload) {
    if (!payload) { gets++; return structuredClone(record); }
    saveCalls.push(payload);
    if (held) return held;
    if (failure) throw failure;
    return { dna: { ...payload, revision: 5 } };
  }
});
await editor.load();
const tune = find(editorRoot, node => node.tagName === "button");
tune.focus();
await tune.fire("click");
const dialog = body.children.at(-1), form = find(dialog, node => node.tagName === "form");
const statement = find(form, node => node.name === "creativeStatement");
assert.equal(statement.value, "Saved");
assert.equal(document.activeElement, statement);
statement.value = "Unsaved statement";
await statement.fire("input");
failure = Object.assign(new Error("Statement rejected"), { fields: { creativeStatement: "Try another statement" } });
await form.fire("submit");
assert.equal(statement.value, "Unsaved statement", "Failed save retains edits");
assert.equal(dialog.open, true);
assert.equal(statement.attributes["aria-invalid"], "true", "Field error is accessible");
assert.equal(saveCalls.at(-1).expectedRevision, 4);
failure = Object.assign(new Error("Conflict"), { status: 409 });
await form.fire("submit");
assert.ok(text(dialog).includes("newer version"));
assert.equal(statement.value, "Unsaved statement", "Revision conflict retains edits");
await dialog.fire("cancel");
assert.equal(dialog.open, true, "Escape honors unsaved confirmation");
await editor.load();
assert.equal(gets, 2, "Saved Creator Pass reloads owner metadata");
assert.equal(statement.value, "Unsaved statement", "Reload does not overwrite dirty form");
discard = true;
await dialog.fire("cancel");
assert.equal(dialog.open, false);
assert.equal(document.activeElement, tune, "Close restores focus");
await tune.fire("click");
statement.value = "Changed";
await statement.fire("input");
failure = null;
await form.fire("submit");
assert.equal(dialog.open, false, "Successful save closes modal");
assert.ok(text(editorRoot).includes("Changed"));
await tune.fire("click");
let resolveSave;
held = new Promise(resolve => { resolveSave = resolve; });
statement.value = "Before request";
await statement.fire("input");
const pendingSave = form.fire("submit");
statement.value = "During request";
await statement.fire("input");
resolveSave({ dna: { ...saveCalls.at(-1), revision: 6 } });
await pendingSave;
assert.equal(dialog.open, true);
assert.equal(statement.value, "During request", "Edits entered during save remain dirty");
assert.ok(text(dialog).includes("newer edits"));
held = null;
editor.clear();
assert.equal(dialog.open, false);
assert.equal(statement.value, "", "Logout removes private fields");
assert.equal(tune.disabled, true);
assert.ok(!text(editorRoot).includes("Changed"));
let ownerResolve;
const staleEditor = mountCreativeDNAEditor(new Node("div"), { request: () => new Promise(resolve => { ownerResolve = resolve; }) });
const pendingOwner = staleEditor.load();
staleEditor.clear();
ownerResolve(record);
await pendingOwner;
assert.equal(body.children.at(-1).open, undefined);

const visitorCalls = [];
let profileResolve;
const visitor = mountDNAVisitor({
  signedIn: () => true,
  request: (query, payload) => {
    visitorCalls.push({ query, payload });
    if (payload) return Promise.resolve({ message: "Invitation recorded" });
    return new Promise(resolve => { profileResolve = resolve; });
  }
});
const pendingProfile = visitor.open("first", terms);
visitor.clear();
profileResolve({ profile: { displayName: "Stale member", dna: { creativeStatement: "Old" } } });
await pendingProfile;
const visitorDialog = body.children.at(-1);
assert.ok(!text(visitorDialog).includes("Stale member"), "Closed visitor ignores stale response");
const newProfile = visitor.open("public-id", terms);
profileResolve({
  profile: { publicProfileId: "public-id", displayName: "Current creator", canInvite: true,
    artistSlug: "../private", dna: { creativeStatement: "Hello", workflowNotes: "Never reveal" } },
  projects: [{ id: "own", title: "Own project" }],
  releases: [{ title: "Unsafe", url: "javascript:alert(1)" }, { title: "Published", url: "/music/" }]
});
await newProfile;
assert.ok(text(visitorDialog).includes("Current creator"));
assert.ok(!text(visitorDialog).includes("Never reveal"));
assert.ok(!text(visitorDialog).includes("Visit artist room"));
assert.ok(!find(visitorDialog, node => node.tagName === "a" && node.textContent === "Unsafe"));
await visitorDialog.fire("close");
assert.ok(text(visitorDialog).includes("Current creator"), "Queued close from previous profile cannot erase a reopened dialog");
const invite = find(visitorDialog, node => node.textContent === "Invite to project");
const projectSelect = find(visitorDialog, node => node.tagName === "select");
projectSelect.value = "own";
await invite.fire("click");
assert.deepEqual(visitorCalls.at(-1).payload, { action: "invite", projectId: "own", publicProfileId: "public-id" });

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const source = await read("creator-network/discover/discover.js");
const context = {
  URLSearchParams, AbortController, dnaRequest: () => {}, DIMENSIONS,
  element, renderDNASummary, mountDNAVisitor
};
vm.createContext(context);
vm.runInContext(source.replace(/^import .+;\s*/gm, "").replace(/\bexport /g, ""), context);
const { readFilters, filterQuery, createDiscoveryController } = context;
const parsed = readFilters("?q=drums&role=Producer&term=sonic:tag-0&term=sonic:tag-0&bpm=125");
assert.equal(parsed.bpm, "125");
assert.equal(parsed.termIds.length, 1);
assert.equal(filterQuery(parsed).get("q"), "drums");
assert.equal(readFilters("?bpm=2").bpm, "");
assert.equal(readFilters(`?${Array.from({ length: 20 }, (_, i) => `term=sonic:tag-${i}`).join("&")}`).termIds.length, 12);
const pending = [], renders = [];
let clears = 0;
const discovery = createDiscoveryController({
  request: (query, payload, signal) => new Promise((resolve, reject) => pending.push({ query, signal, resolve, reject })),
  render: data => renders.push(data), clear: () => clears++
});
const first = discovery.search(parsed);
const second = discovery.search(readFilters("?q=voice"));
assert.equal(pending[0].signal.aborted, true);
pending[1].resolve({ creators: [{ publicProfileId: "b" }], terms, nextCursor: "page-2", total: 3 });
await second;
pending[0].resolve({ creators: [{ publicProfileId: "stale" }] });
await first;
assert.equal(renders.at(-1).creators[0].publicProfileId, "b", "New filters reject late old results");
const more = discovery.more();
assert.equal(new URLSearchParams(pending[2].query).get("cursor"), "page-2");
pending[2].resolve({ creators: [{ publicProfileId: "b" }, { publicProfileId: "c" }], nextCursor: null });
await more;
assert.equal(renders.at(-1).creators.length, 2, "Server pagination appends without duplicates");
await discovery.more();
assert.equal(pending.length, 3, "No invented client pages after server cursor ends");
const members = discovery.search(parsed);
discovery.invalidate();
pending[3].resolve({ creators: [{ publicProfileId: "member-only" }] });
await members;
assert.ok(!renders.at(-1).creators.some(creator => creator.publicProfileId === "member-only"), "Auth generation blocks late member-only data");
assert.ok(clears >= 4);
const failureRequest = discovery.search(parsed);
pending[4].reject(new Error("Offline"));
await failureRequest;
assert.equal(renders.at(-1).error, "Offline");

// Mount the actual discovery page to verify history and identity event wiring.
const nodes = Object.fromEntries([
  "dnaSearch", "dnaResults", "curatedCreators", "curatedFallback", "resultCount",
  "dnaMore", "discoveryStatus", "dnaFacets", "facetStatus", "discoverySignIn"
].map(id => [id, new Node(id === "dnaSearch" ? "form" : "div")]));
const searchInputs = Object.fromEntries(["q", "role", "genre", "language", "bpm"].map(name => {
  const input = new Node("input");
  input.name = name;
  return [name, input];
}));
nodes.dnaSearch.elements = { namedItem: name => searchInputs[name] };
nodes.dnaFacets.querySelector = selector => {
  const dimension = selector.match(/data-dimension="([^"]+)"/)?.[1];
  return find(nodes.dnaFacets, node => node.dataset.dimension === dimension);
};
document.getElementById = id => nodes[id];
const location = { href: "https://halo.test/creator-network/discover/?q=drums", origin: "https://halo.test", pathname: "/creator-network/discover/", search: "?q=drums" };
const history = [], windowEvents = {}, mountPending = [], visitorEvents = [];
let scheduled, identityEvent;
const browser = {
  location,
  history: {
    pushState(state, title, value) { updateURL(value); history.push(location.href); },
    replaceState(state, title, value) { updateURL(value); }
  },
  addEventListener(type, listener) { windowEvents[type] = listener; }
};
function updateURL(value) {
  const url = new URL(value, location.href);
  location.href = url.href;
  location.search = url.search;
}
context.document = document;
context.window = browser;
context.URL = URL;
context.setTimeout = handler => { scheduled = handler; return 1; };
context.clearTimeout = () => { scheduled = undefined; };
context.dnaRequest = (query, payload, signal) => new Promise(resolve => mountPending.push({ query, signal, resolve }));
context.mountDNAVisitor = () => ({
  open(id) { visitorEvents.push(`open:${id}`); },
  clear() { visitorEvents.push("clear"); }
});
context.mountDiscovery();
assert.equal(searchInputs.q.value, "drums", "Initial URL hydrates form");
mountPending[0].resolve({ creators: [{ publicProfileId: "one", displayName: "First" }], terms, total: 1 });
await new Promise(resolve => setImmediate(resolve));
searchInputs.q.value = "voice";
await nodes.dnaSearch.fire("input", { target: searchInputs.q });
assert.equal(nodes.dnaResults.children.length, 0, "Debounce clears old results immediately");
assert.equal(mountPending.length, 1, "Typing is debounced");
scheduled();
assert.ok(history.at(-1).includes("q=voice"));
assert.equal(new URLSearchParams(mountPending[1].query).get("q"), "voice");
mountPending[1].resolve({ creators: [{ publicProfileId: "two", displayName: "Second" }], terms });
await new Promise(resolve => setImmediate(resolve));
updateURL("?q=drums&profile=one");
windowEvents.popstate();
assert.equal(searchInputs.q.value, "drums", "Back/forward hydrates prior filters");
mountPending[2].resolve({ creators: [{ publicProfileId: "one", displayName: "First" }], terms });
await new Promise(resolve => setImmediate(resolve));
assert.ok(visitorEvents.includes("open:one"), "Profile deep-link opens a real visitor controller");
const identityReady = windowEvents["halo-identity-ready"];
let resolveIdentity;
const fakeIdentity = {
  onAuthChange(listener) { identityEvent = listener; },
  getUser: () => new Promise(resolve => { resolveIdentity = resolve; })
};
identityReady({ detail: fakeIdentity });
assert.equal(nodes.dnaResults.children.length, 0, "Auth transition clears member-capable data before getUser completes");
resolveIdentity({ id: "signed-in" });
await new Promise(resolve => setImmediate(resolve));
mountPending[3].resolve({ creators: [{ publicProfileId: "members", displayName: "Members only" }], terms });
await new Promise(resolve => setImmediate(resolve));
assert.ok(text(nodes.dnaResults).includes("Members only"));
const logout = identityEvent();
assert.equal(nodes.dnaResults.children.length, 0, "Logout removes member-only cards synchronously");
assert.equal(nodes.dnaFacets.children.length, 0, "Logout clears associated facets synchronously");
resolveIdentity(null);
await logout;
mountPending[4].resolve({ creators: [], terms });
await new Promise(resolve => setImmediate(resolve));
assert.ok(text(nodes.discoveryStatus).includes("No shared Creative DNA"));
await nodes.dnaSearch.fire("reset");
assert.equal(searchInputs.q.value, "");
assert.equal(location.search, "", "Reset clears URL filters and profile deep-link");
mountPending[5].resolve({ creators: [], terms, curated: [{ display_name: "Curated seed" }], directoryUnavailable: true });
await new Promise(resolve => setImmediate(resolve));
assert.equal(nodes.curatedFallback.hidden, false);
assert.ok(text(nodes.curatedCreators).includes("invitations unavailable"), "Fallback cannot masquerade as live invitations");

for (const path of ["creator-network/creative-dna.js", "creator-network/discover/discover.js"]) {
  assert.doesNotMatch(await read(path), /innerHTML|insertAdjacentHTML|localStorage/);
}
assert.match(source, /popstate/);
assert.match(source, /controller\.invalidate\(\)/);
const html = await read("creator-network/discover/index.html");
for (const script of ["identity.js", "stats.js", "site-monitor.js", "accessibility.js", "halo-hud.js"]) assert.ok(html.includes(script));
assert.ok(html.includes('role="search"'));
assert.match(await read("creator-network/network.css"), /prefers-reduced-motion/);
console.log("Creative DNA UI contracts passed: editor retention, conflicts, focus/chip caps, visitor safety, auth races, URL filters and pagination.");
