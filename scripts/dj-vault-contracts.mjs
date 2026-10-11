import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDjVaultHandler } from "../netlify/functions/dj-vault.mjs";
import { VOTE_LIMIT, VOTE_STORAGE_KEY, applyVaultRoute, createVaultView, createVoteStore } from "../dj-vault/dj-vault.js";
import { VAULT_CARD_VARIANTS, availableKeys, baseVotes, filterAndSortTracks, keyOrder, trackAnchor } from "../dj-vault/vault-card.js";

const id = "11111111-1111-4111-8111-111111111111";
const pack = "22222222-2222-4222-8222-222222222222";
const track = { id, title: '<img src=x onerror="alert(1)">', artist: "<script>evil</script>",
  bpm: 140, musical_key: "8A", price_pence: 499, delivery_format: "wav", preview_type: "clip", rarity: "test_press",
  preview_pack_id: pack, preview_stem: "drums", delivery_pack_id: pack, delivery_stem: "full" };
function fixture({ user = { id: "member", user_metadata: { role: "admin" } }, role, entitled = false,
  paid = true, amount = 499, unavailable = false, allowed = true, hidden = false } = {}) {
  const state = { writes: [], blobReads: [], paymentCalls: [], orders: [], granted: entitled, visibility: hidden ? "hidden" : "public",
    assets: {
      preview: { status: "private", rightsAttested: true, exists: true, blobKey: "preview/", chunkCount: 2, byteSize: 6 },
      delivery: { status: "private", rightsAttested: true, exists: true, blobKey: "delivery/", chunkCount: 2, byteSize: 6 }
    } };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    if (unavailable) throw new Error("DB offline");
    if (query.includes("halo_dj_vault_roles WHERE")) return role ? [{ role }] : [];
    if (query.includes("halo_dj_vault_rate_limit")) return [{ allowed }];
    if (query.includes("SELECT t.*")) {
      assert.ok(query.includes("t.visibility = 'public'") && query.includes("t.visibility = 'members'"));
      for (const name of ["preview", "delivery"]) {
        assert.ok(query.includes(`JOIN halo_stem_files ${name}`) && query.includes(`JOIN halo_stem_packs ${name}_pack`));
        assert.ok(query.includes(`${name}_pack.status = 'private'`) && query.includes(`${name}_pack.rights_attested = TRUE`));
        assert.ok(query.includes(`${name}.blob_key <> ''`) && query.includes(`${name}.chunk_count > 0`) && query.includes(`${name}.byte_size > 0`));
      }
      if (Object.values(state.assets).some(a => a.status !== "private" || !a.rightsAttested || !a.exists || !a.blobKey || a.chunkCount <= 0 || a.byteSize <= 0)) return [];
      return state.visibility === "hidden" || (state.visibility === "members" && !values[1]) ? [] : [{ ...track, entitled: state.granted }];
    }
    if (query.includes("SELECT * FROM halo_dj_vault_tracks")) {
      assert.equal(values[0], id);
      return state.visibility === "hidden" || (state.visibility === "members" && !values[1]) ? [] : [track];
    }
    if (query.includes("SELECT track_id FROM halo_dj_vault_entitlements")) {
      assert.equal(values[0], user.id, "entitlements must use authenticated identity, never body memberId");
      return state.granted ? [{ track_id: id }] : [];
    }
    if (query.includes("SELECT revoked_at")) return [];
    if (query.includes("SELECT p.id")) return [
      { id: pack, stem_type: "drums", content_type: "audio/mpeg", duration_seconds: 30, blob_key: "preview/" },
      { id: pack, stem_type: "full", content_type: "audio/wav", duration_seconds: 180, blob_key: "delivery/" }
    ];
    if (query.includes("SELECT f.*")) {
      assert.ok(query.includes("p.status = 'private'") && query.includes("p.status = 'archived'") && query.includes("p.rights_attested = TRUE"));
      const asset = state.assets[values[1] === "drums" ? "preview" : "delivery"];
      if (!asset.exists || !asset.rightsAttested || !(asset.status === "private" || (values[2] && asset.status === "archived"))) return [];
      return [{ blob_key: asset.blobKey, chunk_count: asset.chunkCount, content_type: "audio/wav", byte_size: asset.byteSize }];
    }
    if (query.includes("SELECT * FROM halo_dj_vault_orders")) return state.orders.filter(o => o.stripe_session_id === values[0] && o.member_id === values[1] && o.track_id === values[2]);
    state.writes.push({ query, values });
    if (query.includes("INSERT INTO halo_dj_vault_orders")) state.orders.push({ id: values[0], member_id: values[1], track_id: values[2], price_pence: values[3] });
    if (query.includes("UPDATE halo_dj_vault_orders SET stripe_session_id")) state.orders.find(o => o.id === values[1]).stripe_session_id = values[0];
    if (query.includes("WITH paid")) state.granted = true;
    if (query.includes("WITH routed")) return [{ track_id: id }];
    if (query.includes("WITH granted")) { state.granted = true; return [{ track_id: id }]; }
    return [];
  } };
  const handler = createDjVaultHandler({
    getDatabase: async () => db, getUser: async () => user,
    membershipFor: async () => ({ member_id: user.id }), siteOrigin: "https://halo.example",
    store: { async get(key) { state.blobReads.push(key); return new Uint8Array(key.endsWith("000") ? [1, 2, 3] : [4, 5, 6]).buffer; } },
    stripeRequest: async (path, body) => {
      state.paymentCalls.push(path);
      if (body) {
        assert.equal(body.get("line_items[0][price_data][unit_amount]"), "499");
        return { id: "cs_test_vault", url: "https://checkout.stripe.com/c/pay" };
      }
      const order = state.orders[0];
      return { payment_status: paid ? "paid" : "unpaid", status: "complete", mode: "payment",
        currency: "gbp", amount_total: amount, client_reference_id: order.id, metadata: { order_id: order.id } };
    }
  });
  return { handler, state };
}
function request(action, body, options = {}) {
  const mutation = body !== undefined;
  return new Request(`https://halo.example/api/dj-vault/${action}`, {
    method: mutation ? (action === "routing" ? "PATCH" : "POST") : "GET",
    headers: { ...(mutation ? { Origin: "https://halo.example", "Content-Type": "application/json" } : {}), ...options.headers },
    ...(mutation ? { body: JSON.stringify(body) } : {}), ...options
  });
}
const routeBody = { trackId: id, title: "Extended mix", artist: "Artist", accessTier: "dj_vault",
  visibility: "members", bpm: 140, musicalKey: "8A", pricePence: 499, deliveryFormat: "wav",
  previewType: "clip", previewPackId: pack, previewStem: "drums", deliveryPackId: pack, deliveryStem: "full" };

let f = fixture({ user: null });
assert.equal((await f.handler(request("tracks"))).status, 200);
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 401);
assert.equal((await f.handler(request("download?trackId=" + id))).status, 401);
assert.equal(f.state.writes.length, 0);
f = fixture();
assert.equal((await f.handler(request("routing", routeBody))).status, 403, "user metadata cannot self-assign privileges");
assert.equal((await f.handler(request("checkout", { trackId: id, role: "admin" }))).status, 403);
assert.equal(f.state.writes.length, 0);
f = fixture({ role: "dj" });
assert.equal((await f.handler(request("routing", routeBody))).status, 403);
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 403);
assert.equal((await f.handler(request("download?trackId=" + id))).status, 403);
assert.equal(f.state.blobReads.length, 0);
assert.equal((await f.handler(request("checkout", { trackId: id }, { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } }))).status, 403);
assert.equal((await f.handler(request("checkout", { trackId: id }, { headers: { "Content-Type": "application/json" } }))).status, 403);
assert.equal((await f.handler(request("checkout", { trackId: "bad" }))).status, 400);
assert.equal((await f.handler(request("checkout", { trackId: id, padding: "x".repeat(9000) }))).status, 413);
const checkout = await f.handler(request("checkout", { trackId: id, memberId: "victim", pricePence: 1 }));
assert.equal(checkout.status, 200);
assert.equal(f.state.orders[0].member_id, "member");
assert.equal(f.state.orders[0].price_pence, 499);
assert.equal(f.state.granted, false, "checkout creation must not grant access");
assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_other_account" }))).status, 404);
assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault" }))).status, 200);
assert.equal(f.state.granted, true);
const download = await f.handler(request("download?trackId=" + id));
assert.equal(download.headers.get("cache-control"), "private, no-store");
assert.match(download.headers.get("content-disposition"), /^attachment/);
assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
assert.ok(f.state.blobReads.every(key => key.startsWith("delivery/")));
for (const invalid of [{ paid: false }, { amount: 1 }]) {
  f = fixture({ role: "dj", ...invalid });
  await f.handler(request("checkout", { trackId: id }));
  assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault", paid: true }))).status, 409);
  assert.equal(f.state.granted, false);
}
for (const source of ["preview", "delivery"]) {
  for (const invalid of [{ status: "archived" }, { status: "public" }, { exists: false },
    { rightsAttested: false }, { blobKey: "" }, { chunkCount: 0 }, { byteSize: 0 }]) {
    f = fixture({ role: "dj" });
    Object.assign(f.state.assets[source], invalid);
    assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, [], `${source} must not be sold when ${JSON.stringify(invalid)}`);
    const rejected = await f.handler(request("checkout", { trackId: id }));
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).message, /source assets are unavailable/);
    assert.equal(f.state.orders.length, 0, "invalid assets must not create an order");
    assert.equal(f.state.paymentCalls.length, 0, "invalid assets must not create a Stripe session");

    f = fixture({ role: "dj" });
    assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 200);
    Object.assign(f.state.assets[source], invalid);
    assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault" }))).status, 409);
    assert.equal(f.state.granted, false, "assets invalidated after checkout must not grant entitlement");
    assert.ok(!f.state.writes.some(w => w.query.includes("WITH paid")), "failed confirmation must not mark the order paid");
  }
}
f = fixture({ role: "dj", entitled: true });
f.state.assets.preview.status = "archived";
f.state.assets.delivery.status = "archived";
const archivedDownload = await f.handler(request("download?trackId=" + id));
assert.equal(archivedDownload.status, 200, "existing entitlements retain archived private delivery");
assert.deepEqual([...new Uint8Array(await archivedDownload.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 200, "existing entitlement must not create a new purchase");
assert.equal(f.state.orders.length, 0);
assert.equal(f.state.paymentCalls.length, 0);
for (const invalid of [{ status: "public" }, { exists: false }, { rightsAttested: false }]) {
  f = fixture({ role: "dj", entitled: true });
  Object.assign(f.state.assets.delivery, invalid);
  assert.equal((await f.handler(request("download?trackId=" + id))).status, 404);
  assert.equal(f.state.blobReads.length, 0, "entitlements must not bypass private delivery or rights attestation");
}
f = fixture({ role: "selector" });
assert.equal((await f.handler(request("routing", routeBody))).status, 200);
assert.ok(f.state.writes.at(-1).values.includes("white_label"), "routing defaults rarity to white_label");
assert.equal((await f.handler(request("routing", { ...routeBody, rarity: "selector_exclusive" }))).status, 200);
assert.ok(f.state.writes.at(-1).values.includes("selector_exclusive"));
assert.equal((await f.handler(request("routing", { ...routeBody, rarity: "<b>mythic</b>" }))).status, 400, "unknown rarity labels are rejected");
assert.equal((await f.handler(request("routing", { ...routeBody, previewStem: "full" }))).status, 400);
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 403);
f = fixture({ role: "admin" });
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 200);
f = fixture({ role: "dj", allowed: false });
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 429);
assert.equal(f.state.paymentCalls.length, 0);
f = fixture({ hidden: true });
assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, []);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
f = fixture({ user: null });
const catalog = await (await f.handler(request("tracks"))).json();
assert.equal(catalog.tracks[0].title, track.title);
assert.equal(catalog.tracks[0].rarity, "test_press");
assert.ok(!JSON.stringify(catalog).includes("delivery_pack_id") && !JSON.stringify(catalog).includes("blob_key"));
f.state.visibility = "members";
assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, []);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
f.state.visibility = "public";
const preview = await f.handler(request("preview?trackId=" + id, undefined, { headers: { Range: "bytes=2-4" } }));
assert.equal(preview.status, 206);
assert.equal(preview.headers.get("content-range"), "bytes 2-4/6");
assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())], [3, 4, 5]);
assert.ok(f.state.blobReads.every(key => key.startsWith("preview/")));
for (const range of ["bytes=9-", "bytes=-0", "bytes=4-2", "bytes=1-2,4-5", "bytes=-"]) {
  assert.equal((await f.handler(request("preview?trackId=" + id, undefined, { headers: { Range: range } }))).status, 416);
}
f = fixture({ unavailable: true });
assert.equal((await f.handler(request("tracks"))).status, 503);
assert.equal((await f.handler(request("no-such-route"))).status, 404);
assert.equal((await f.handler(request("tracks", {}))).status, 405);

// Lightweight DOM fixture matches the repository's dependency-free UI contracts.
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.value = "newest"; this.textContent = ""; }
  set innerHTML(_) { throw new Error("Unsafe HTML injection"); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrolled = options; }
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
  querySelectorAll(tag) { return this.children.flatMap(child => [ ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag) ]); }
}
function uiFixture({ mode = "tracks", authorized = false, failure = false, storage = null } = {}) {
  const nodes = Object.fromEntries(["vault-grid", "vault-status", "vault-retry", "vault-more", "vault-sort", "vault-rarity", "vault-bpm", "vault-key", "vault-login", "vault-auth", "vault-email", "vault-password", "vault-confirm"].map(name => [name, new Node("div")]));
  for (const name of ["vault-rarity", "vault-bpm", "vault-key"]) nodes[name].value = "all";
  nodes["vault-auth"].append(new Node("button"));
  const state = { nodes, requests: [], destinations: [], history: [], mode, authorized, failure };
  const view = createVaultView({
    storage, history: { replaceState: (...args) => state.history.push(args) },
    document: { getElementById: name => nodes[name], createElement: tag => new Node(tag) },
    location: { get search() { return state.search || ""; }, assign: url => state.destinations.push(url) },
    identity: { login: async (...args) => { state.credentials = args; state.authorized = true; } },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.failure) return Response.json({}, { status: 500 });
      if (url.endsWith("/session")) return Response.json({ authenticated: state.authorized, authorized: state.authorized });
      if (url.endsWith("/checkout")) return Response.json({ checkoutUrl: "javascript:alert(1)" });
      if (url.endsWith("/confirm")) return Response.json({}, { status: 404 });
      return Response.json(state.mode === "malformed" ? { success: false, tracks: [] }
        : { success: true, tracks: state.tracks || (state.mode === "empty" ? [] : state.mode === "crate" ? crate : catalog.tracks), nextOffset: null });
    }
  });
  return { view, state };
}
let ui = uiFixture();
const loading = ui.view.load();
assert.equal(ui.state.nodes["vault-status"].textContent, "Loading vault…");
assert.equal(ui.state.nodes["vault-grid"].attributes["aria-busy"], "true");
await loading;
const grid = ui.state.nodes["vault-grid"];
assert.equal(grid.attributes["aria-busy"], "false");
assert.equal(grid.querySelectorAll("h2")[0].textContent, track.title, "metadata must render as text");
assert.equal(grid.querySelectorAll("button")[0].disabled, true, "anonymous acquisition is disabled");
assert.equal(grid.querySelectorAll("audio")[0].preload, "none");
assert.equal(grid.querySelectorAll("span").find(n => n.className === "vault-price").textContent, "£4.99");
assert.equal(grid.children[0].className, "vault-bin");
assert.equal(grid.children[0].attributes["aria-label"], "Crate 01");
const card = grid.querySelector("article");
assert.equal(card.className, "vault-card vault-card--test-press");
assert.equal(card.attributes["data-rarity"], "test_press");
assert.equal(card.querySelector("p").textContent, VAULT_CARD_VARIANTS.test_press.stamp);
assert.equal(card.querySelectorAll("div").find(n => n.className === "vault-card__sleeve").attributes["aria-hidden"], "true");
assert.equal(card.querySelectorAll("p").find(n => n.className === "vault-card__index").textContent, "HALO-111111");
assert.deepEqual(card.querySelectorAll("li").map(n => n.textContent), ["Test Press", "BPM 140", "KEY 8A", "WAV"]);
await ui.state.nodes["vault-login"].listeners.click();
assert.equal(ui.state.nodes["vault-auth"].hidden, false);
assert.equal(ui.state.nodes["vault-email"].focused, true);
ui.state.nodes["vault-email"].value = "dj@example.test";
ui.state.nodes["vault-password"].value = "test-only-password";
await ui.state.nodes["vault-auth"].listeners.submit({ preventDefault() {} });
assert.deepEqual(ui.state.credentials, ["dj@example.test", "test-only-password"]);
assert.equal(ui.state.nodes["vault-password"].value, "");
for (const [options, pattern] of [[{ mode: "empty" }, /No DJ Vault/], [{ failure: true }, /unavailable/], [{ mode: "malformed" }, /Invalid vault response/]]) {
  ui = uiFixture(options);
  await ui.view.load();
  assert.match(ui.state.nodes["vault-status"].textContent, pattern);
  assert.equal(ui.state.nodes["vault-grid"].children.length, 0);
  assert.equal(ui.state.nodes["vault-retry"].hidden, options.mode === "empty");
}
ui = uiFixture({ authorized: true });
await ui.view.load();
const acquire = ui.state.nodes["vault-grid"].querySelectorAll("button")[0];
assert.equal(acquire.disabled, false);
await acquire.listeners.click();
assert.equal(ui.state.destinations.length, 0, "unsafe checkout destinations must not navigate");
ui.state.authorized = false;
await ui.view.load();
assert.equal(ui.state.nodes["vault-grid"].querySelectorAll("button")[0].disabled, true, "session loss disables acquisition");
ui = uiFixture({ authorized: true });
ui.state.search = `?session_id=cs_invalid&trackId=${id}`;
await ui.view.load();
assert.equal(ui.state.nodes["vault-grid"].children.length, 1, "failed confirmation must not block browsing");
assert.match(ui.state.nodes["vault-status"].textContent, /Payment confirmation needs attention/);
assert.equal(ui.state.nodes["vault-confirm"].hidden, false);
ui.state.nodes["vault-sort"].listeners.change();
assert.match(ui.state.nodes["vault-status"].textContent, /Payment confirmation needs attention/, "filters keep payment errors visible");
await ui.state.nodes["vault-confirm"].listeners.click();
assert.equal(ui.state.nodes["vault-grid"].children.length, 1);

const crate = [
  { id: "a1", title: "Newest", bpm: 174, musicalKey: "12B", pricePence: 299, rarity: "white_label", deliveryFormat: "wav" },
  { id: "b2", title: "Mid", bpm: 124, musicalKey: "8A", pricePence: 249, rarity: "selector_exclusive", deliveryFormat: "flac" },
  { id: "c3", title: "Oldest", bpm: 128, musicalKey: "2a", pricePence: 499, rarity: "bogus", deliveryFormat: "wav" }
];
const titles = options => filterAndSortTracks(crate, options).map(t => t.title);
assert.deepEqual(titles({ sort: "newest" }), ["Newest", "Mid", "Oldest"]);
assert.deepEqual(titles({ sort: "bpm" }), ["Mid", "Oldest", "Newest"]);
assert.deepEqual(titles({ sort: "key" }), ["Oldest", "Mid", "Newest"], "keys sort in Camelot order");
assert.deepEqual(titles({ sort: "price" }), ["Mid", "Newest", "Oldest"]);
assert.deepEqual(titles({ sort: "price-desc" }), ["Oldest", "Newest", "Mid"]);
assert.deepEqual(titles({ sort: "rarity" }), ["Mid", "Newest", "Oldest"], "unknown rarity falls back to white_label");
assert.deepEqual(titles({ rarity: "white_label" }), ["Newest", "Oldest"]);
assert.deepEqual(titles({ bpm: "120-129" }), ["Mid", "Oldest"]);
assert.deepEqual(titles({ bpm: "160-plus", key: "12b" }), ["Newest"]);
assert.deepEqual(filterAndSortTracks([{ title: "Padded", musicalKey: " 8a " }], { key: "8A" }).map(t => t.title), ["Padded"]);
assert.deepEqual(titles({ bpm: "not-a-range" }), ["Newest", "Mid", "Oldest"]);
assert.deepEqual(availableKeys(crate), ["2A", "8A", "12B"]);
assert.equal(keyOrder("Fm"), Infinity);
ui = uiFixture({ mode: "crate" });
await ui.view.load();
assert.deepEqual(ui.state.nodes["vault-key"].children.map(n => n.value), ["all", "2A", "8A", "12B"]);
assert.ok(ui.state.nodes["vault-key"].children.every(n => n.tag === "option"), "key options are built with text-safe DOM nodes");
ui.state.nodes["vault-rarity"].value = "selector_exclusive";
ui.state.nodes["vault-rarity"].listeners.change();
assert.deepEqual(ui.state.nodes["vault-grid"].querySelectorAll("h2").map(n => n.textContent), ["Mid"]);
assert.match(ui.state.nodes["vault-status"].textContent, /Showing 1 of 3.*Sign in with verified DJ access/);
ui.state.nodes["vault-rarity"].value = "test_press";
ui.state.nodes["vault-rarity"].listeners.change();
assert.equal(ui.state.nodes["vault-grid"].children.length, 0);
assert.match(ui.state.nodes["vault-status"].textContent, /No editions match/);
ui.state.nodes["vault-rarity"].value = "all";
ui.state.nodes["vault-sort"].value = "bpm";
ui.state.nodes["vault-sort"].listeners.change();
assert.deepEqual(ui.state.nodes["vault-grid"].querySelectorAll("h2").map(n => n.textContent), ["Mid", "Oldest", "Newest"]);
assert.match(ui.state.nodes["vault-status"].textContent, /^3 editions loaded\./, "unfiltered sorting reports the full count");
assert.equal(ui.state.nodes["vault-grid"].querySelectorAll("article")[2].querySelectorAll("button")[0].disabled, true, "filters never unlock acquisition");

ui = uiFixture({ mode: "crate" });
ui.state.tracks = [...crate, { ...crate[0], id: "d4", title: "Fourth pressing", bpm: 110 }];
await ui.view.load();
const bins = ui.state.nodes["vault-grid"].children;
assert.deepEqual(bins.map(bin => bin.attributes["aria-label"]), ["Crate 01", "Crate 02"]);
assert.deepEqual(bins.map(bin => bin.querySelectorAll("article").length), [3, 1]);
assert.deepEqual(ui.state.nodes["vault-grid"].querySelectorAll("h2").map(n => n.textContent), ["Newest", "Mid", "Oldest", "Fourth pressing"]);
ui.state.nodes["vault-sort"].value = "bpm";
ui.state.nodes["vault-sort"].listeners.change();
assert.deepEqual(ui.state.nodes["vault-grid"].querySelectorAll("h2").map(n => n.textContent), ["Fourth pressing", "Mid", "Oldest", "Newest"], "crate boundaries preserve global sort order");
ui.state.nodes["vault-rarity"].value = "selector_exclusive";
ui.state.nodes["vault-rarity"].listeners.change();
assert.equal(ui.state.nodes["vault-grid"].children.length, 1, "filters rebuild crates without empty bins");
assert.equal(ui.state.nodes["vault-grid"].querySelectorAll("article").length, 1);

// Community voting + quick-jump layer.
const memoryStorage = (seed = {}) => ({ data: { ...seed }, getItem(key) { return this.data[key] ?? null; }, setItem(key, value) { this.data[key] = String(value); } });
const byClass = (node, tag, className) => node.querySelectorAll(tag).find(n => n.className === className);
{
  const storage = memoryStorage();
  ui = uiFixture({ mode: "crate", storage });
  ui.state.tracks = crate.map((t, index) => ({ ...t, votes: [2, 7, "<b>9</b>"][index] }));
  await ui.view.load();
  const cards = ui.state.nodes["vault-grid"].querySelectorAll("article");
  for (const card of cards) {
    assert.ok(byClass(card, "span", "vault-vote__count"), "every card shows a vote count");
    assert.ok(byClass(card, "button", "vault-vote__up"), "every card has an upvote control");
    assert.ok(byClass(card, "button", "vault-vote__jump"), "every card has a jump control");
    assert.match(card.querySelectorAll("button")[0].textContent, /^Acquire /, "acquire remains the primary card action");
    assert.equal(card.querySelectorAll("button").filter(b => b.type === "button").length, 3);
  }
  assert.deepEqual(cards.map(card => byClass(card, "span", "vault-vote__count").textContent), ["2", "7", "0"], "server counts are integers only");
  assert.equal(cards[0].id, "vault-track-a1");
  const up = byClass(cards[0], "button", "vault-vote__up");
  assert.equal(up.attributes["aria-pressed"], "false");
  up.listeners.click();
  assert.equal(byClass(cards[0], "span", "vault-vote__count").textContent, "3", "upvote increments the displayed count");
  assert.equal(up.attributes["aria-pressed"], "true");
  assert.equal(up.textContent, "▲ Upvoted");
  assert.match(up.attributes["aria-label"], /Remove upvote: Newest \(3 votes\)/);
  assert.deepEqual(JSON.parse(storage.data[VOTE_STORAGE_KEY]), ["a1"], "vote state persists");
  ui.state.nodes["vault-sort"].value = "votes";
  ui.state.nodes["vault-sort"].listeners.change();
  assert.deepEqual(ui.state.nodes["vault-grid"].querySelectorAll("h2").map(n => n.textContent), ["Mid", "Newest", "Oldest"], "most upvoted ranking includes local votes");

  const again = uiFixture({ mode: "crate", storage });
  again.state.tracks = ui.state.tracks;
  await again.view.load();
  const restored = again.state.nodes["vault-grid"].querySelector("article");
  assert.equal(byClass(restored, "span", "vault-vote__count").textContent, "3", "persisted vote is restored");
  byClass(restored, "button", "vault-vote__up").listeners.click();
  assert.equal(byClass(restored, "span", "vault-vote__count").textContent, "2", "a second click removes the vote");
  assert.deepEqual(JSON.parse(storage.data[VOTE_STORAGE_KEY]), []);

  ui = uiFixture({ mode: "crate", storage });
  ui.state.search = "?utm=crate";
  await ui.view.load();
  const target = ui.state.nodes["vault-grid"].querySelectorAll("article")[1];
  byClass(target, "button", "vault-vote__jump").listeners.click();
  assert.deepEqual(ui.state.history.at(-1), [null, "", "/dj-vault/?utm=crate&track=b2"], "jump writes a shareable track cue");
  assert.equal(target.scrolled.behavior, "auto", "jump falls back to instant scroll without motion preference support");
  assert.equal(target.focused, true, "jump focuses the edition when it has no preview");
  assert.match(ui.state.nodes["vault-status"].textContent, /Cued Mid/);

  ui = uiFixture();
  ui.state.search = `?track=${id}`;
  await ui.view.load();
  const cuedCard = ui.state.nodes["vault-grid"].querySelector("article");
  assert.equal(cuedCard.querySelector("audio").focused, true, "a ?track= cue focuses that edition's preview on load");
  assert.equal(cuedCard.querySelector("audio").paused, undefined, "cueing never autoplays");
  byClass(cuedCard, "button", "vault-vote__jump").listeners.click();
  assert.equal(ui.state.destinations.length, 0, "jump never navigates away from the vault");
}
{
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const store = createVoteStore(broken);
  assert.equal(store.toggle("a1"), true, "votes still work when storage is blocked");
  assert.equal(store.has("a1"), true);
  const tampered = createVoteStore(memoryStorage({ [VOTE_STORAGE_KEY]: JSON.stringify(["ok-1", "<img>", 5, "x".repeat(65)]) }));
  assert.equal(tampered.has("ok-1"), true);
  assert.equal(tampered.has("<img>"), false, "tampered vote IDs are discarded");
  assert.equal(createVoteStore(memoryStorage({ [VOTE_STORAGE_KEY]: "{not json" })).has("a1"), false);
  assert.equal(store.toggle("../bad"), false, "invalid IDs are never stored");
  assert.equal(baseVotes({ votes: -3 }), 0);
  assert.equal(baseVotes({ votes: 1.5 }), 0);
  assert.equal(trackAnchor('"><script>'), "vault-track-script");
  const bounded = memoryStorage();
  const capped = createVoteStore(bounded);
  for (let index = 0; index <= VOTE_LIMIT; index += 1) capped.toggle(`t${index}`);
  assert.equal(JSON.parse(bounded.data[VOTE_STORAGE_KEY]).length, VOTE_LIMIT, "the vote ledger stays bounded");
  assert.equal(capped.has("t0"), false, "the oldest vote is evicted first");
  assert.equal(createVoteStore(bounded).has(`t${VOTE_LIMIT}`), true, "the newest vote survives a reload");
}

const migration = await readFile(new URL("../netlify/database/migrations/20261011040000_dj_vault.sql", import.meta.url), "utf8");
assert.match(migration, /PRIMARY KEY \(member_id, track_id\)/);
assert.match(migration, /stripe_session_id TEXT UNIQUE/);
assert.match(migration, /FOREIGN KEY \(delivery_pack_id, delivery_stem\) REFERENCES halo_stem_files/);
assert.match(migration, /CHECK \(preview_pack_id <> delivery_pack_id OR preview_stem <> delivery_stem\)/);
assert.match(migration, /halo_dj_vault_rate_limit/);
const rarityMigration = await readFile(new URL("../netlify/database/migrations/20261011060000_dj_vault_rarity.sql", import.meta.url), "utf8");
assert.match(rarityMigration, /ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'white_label'/);
for (const rarity of Object.keys(VAULT_CARD_VARIANTS)) assert.ok(rarityMigration.includes(`'${rarity}'`), `${rarity} must be allowed by the schema`);
const html = await readFile(new URL("../dj-vault/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../dj-vault/dj-vault.css", import.meta.url), "utf8");
assert.match(html, /aria-live="polite"/);
assert.match(html, /name="viewport"/);
assert.doesNotMatch(html, /onclick=/);
assert.match(css, /prefers-reduced-motion/);
assert.match(html, /<body class="dj-vault-room" data-route="dj-vault">/);
{
  const classes = new Set();
  const body = { classList: { add: name => classes.add(name) }, dataset: {} };
  assert.equal(applyVaultRoute({ body }), true, "vault route markers are applied at runtime");
  assert.ok(classes.has("dj-vault-room"), "runtime restores the room class if the shell strips it");
  assert.equal(body.dataset.route, "dj-vault", "runtime sets the route marker");
  assert.equal(applyVaultRoute({}), false, "missing body is tolerated");
}
assert.match(html, /<section class="vault-console" aria-labelledby="vault-console-title">/);
assert.ok(html.indexOf('id="vault-status"') < html.indexOf('class="vault-archive-label"'), "live status remains in the command station");
assert.match(css, /\.dj-vault-room, \[data-route="dj-vault"\] \{[\s\S]*?background: radial-gradient/);
for (const [, list] of css.matchAll(/([^{}]+)\{/g)) {
  const selectors = list.split(",").map(selector => selector.trim());
  for (const selector of selectors.filter(item => item.includes(".dj-vault-room"))) {
    const routed = selector.replaceAll(".dj-vault-room", '[data-route="dj-vault"]');
    assert.ok(selectors.includes(routed), `${selector} must also match the route marker as ${routed}`);
  }
}
assert.doesNotMatch(css, /(?:^|\n)(?::root|body|header|main|input|button|select|p|a|\*|:focus-visible)\s*[{,]/, "room styling must not target global elements");
assert.match(css, /\.dj-vault-room :focus-visible, \[data-route="dj-vault"\] :focus-visible/);
assert.match(css, /\[data-route="dj-vault"\] \.skip-link:focus/);
assert.match(css, /@media \(max-width: 600px\)/);
for (const path of ["../halo.html", "../music/index.html"]) {
  const page = await readFile(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(page, /dj-vault-room|data-route="dj-vault"|dj-vault\/dj-vault\.css/, `${path} must not activate the room theme`);
}
for (const control of ["vault-sort", "vault-rarity", "vault-bpm", "vault-key"]) assert.match(html, new RegExp(`<label for="${control}">`));
for (const variant of ["test-press", "promo-copy", "vault-only", "selector-exclusive"]) assert.match(css, new RegExp(`\\.vault-card--${variant}`));
assert.match(html, /<option value="votes">Most upvoted<\/option>/);
for (const selector of [".vault-vote {", ".vault-vote__count {", '.vault-vote__up[aria-pressed="true"]', ".vault-vote button:hover"]) assert.ok(css.includes(selector), `${selector} styles the selector console`);
console.log("DJ Vault permission, payment, private delivery, and UI contracts passed");
