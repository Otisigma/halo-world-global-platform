import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { SMART_LINK_HOSTS, validateSmartLink } from "../netlify/lib/release-house-submission.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [helper, api, client, world, styles, releasePackSource] = await Promise.all([
  read("distribution-links.js"), read("netlify/functions/release-catalog.mjs"),
  read("music/music.js"), read("music-world.html"), read("music/music.css"),
  read("netlify/functions/release-pack.mjs")
]);
const browser = vm.createContext({ window: {}, URL });
vm.runInContext(helper, browser);
const links = browser.window.HaloDistributionLinks;
const approved = { status: "published", isLiveVisible: true, title: 'Track <name> "one"' };
const smartLink = "https://distrokid.com/hyperfollow/contract/track";
const release = { ...approved, distributionUrl: smartLink };

for (const url of [
  smartLink, ...SMART_LINK_HOSTS.filter(host => host !== "distrokid.com").map(host => `https://${host}/contract`),
  "https://artist.hyperfollow.com/track?ref=halo&source=catalog",
  "https://artist.lnk.to/track", " https://hyperfollow.com/track "
]) {
  const validation = validateSmartLink(url);
  assert.equal(validation.ok, true);
  assert.equal(links.destination({ ...approved, distributionUrl: url }), validation.url);
}
for (const url of [
  "", "javascript:alert(1)", "data:text/html,unsafe", "//hyperfollow.com/track", "/api/release-link?slug=private",
  "http://hyperfollow.com/track", "******hyperfollow.com/track",
  "https://hyperfollow.com:444/track", "https://hyperfollow.com.evil.test/track",
  "https://evilhyperfollow.com/track", "https://hyperfоllow.com/track",
  "https://hyperfollow.com@evil.test/track", "https://distrokid.com/redirect?url=https://evil.test",
  "https://hyperfollow.com\\@evil.test", "https://hyperfollow.com/a\nb",
  `https://hyperfollow.com/${"a".repeat(500)}`, "https://localhost/track", "https://127.0.0.1/track"
]) {
  assert.equal(links.destination({ ...approved, distributionUrl: url }), "", url);
  assert.equal(links.action({ ...approved, distributionUrl: url }), "", url);
  if (url) assert.equal(validateSmartLink(url).ok, false, url);
}
for (const status of ["pending_review", "withdrawn", "draft", "passed", "pending", "", undefined]) {
  assert.equal(links.action({ ...release, status }), "");
}
for (const isLiveVisible of [false, undefined, null]) {
  assert.equal(links.action({ ...release, isLiveVisible }), "");
}
assert.equal(links.action({ ...approved, smartLinkUrl: smartLink, submission: { smartLinkUrl: smartLink } }), "");
assert.equal(links.action({ ...approved, purchaseUrl: smartLink, officialUrl: smartLink, streamUrl: smartLink }), "",
  "the client must not invent a distribution destination from legacy fields");
assert.equal(links.action(null), "");
const markup = links.action(release);
for (const pattern of [
  /Stream \/ DSPs/, /target="_blank"/, /rel="noopener noreferrer"/,
  /data-halo-player="off"/, /aria-label="[^"]*external site, opens in a new tab/,
  /title="[^"]*opens in a new tab/, /Track &lt;name&gt; &quot;one&quot;/,
  /<span aria-hidden="true">↗<\/span>/
]) assert.match(markup, pattern);
assert.doesNotMatch(markup, /<name>/);
assert.match(links.action({ ...release, distributionUrl: "https://hyperfollow.com/track?a=1&b=2" }), /a=1&amp;b=2/);

const publicRow = { id: "public-track", title: "Contract track", status: "published", visibility: "public",
  purchase_url: smartLink, genres: [] };
const rows = [
  publicRow, { ...publicRow, id: "private-track", visibility: "private" },
  { ...publicRow, id: "pending-submission", status: "pending_review", smart_link_url: smartLink },
  { ...publicRow, id: "withdrawn-submission", status: "withdrawn", smart_link_url: smartLink }
];
const context = vm.createContext({
  URL, Response, console, validateSmartLink,
  resolveReleaseArtworkFields: () => ({}), resolveReleaseLicensing: () => ({}),
  normalizeLyricsSource: () => "", cleanDreamweaverSongId: value => value || "",
  getDatabase: () => ({ sql: async strings => {
    const sql = strings.join("?");
    assert.match(sql, /WHERE release\.status = 'published'\s+AND release\.visibility = 'public'/);
    assert.doesNotMatch(sql, /halo_release_house/);
    return rows.filter(row => row.status === "published" && row.visibility === "public");
  } })
});
vm.runInContext(api.replace(/^import .+;\n/gm, "")
  .replace("export default async function", "async function")
  .replace("export const config", "const config"), context);
const response = await context.releaseCatalogHandler(new Request("https://halo.test/api/release-catalog"));
const payload = await response.json();
assert.equal(payload.releases.length, 1);
assert.equal(payload.releases[0].distributionUrl, smartLink);
assert.equal(payload.releases[0].isLiveVisible, true);
for (const row of rows.slice(1)) assert.equal(context.serializeRelease(row).distributionUrl, "");
for (const purchase_url of ["", "javascript:alert(1)", "https://hyperfollow.com.evil.test/track", "https://shop.example.test/track"]) {
  assert.equal(context.serializeRelease({ ...publicRow, purchase_url, smart_link_url: smartLink }).distributionUrl, "");
}
assert.equal(context.serializeRelease({ ...publicRow, purchase_url: "", official_url: smartLink }).distributionUrl, "");
assert.equal((await context.releaseCatalogHandler(new Request("https://halo.test/api/release-catalog", { method: "HEAD" }))).body, null);

const actions = client.match(/function releaseActions\(release, options = \{\}\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(actions);
const ui = vm.createContext({
  window: browser.window, escapeHtml: value => String(value || ""), safeUrl: value => value || "",
  logMusicIssue() {}, resolvedAudio: () => ({}), buyActionLabel: () => "Buy / support", featuredBadge: () => "",
  playTrackButton: () => '<button data-action="play-track">Play</button>'
});
vm.runInContext(actions, ui);
const actionsMarkup = ui.releaseActions(release);
assert.match(actionsMarkup, /data-action="play-track"/);
assert.match(actionsMarkup, /distribution-link/);
assert.doesNotMatch(ui.releaseActions({ ...release, distributionUrl: "" }), /distribution-link/);
assert.match(client, /releaseActions\(release, \{ includeSelect: true \}\)/, "track cards use the shared actions");
assert.match(styles, /\.release-actions \{[^}]*flex-wrap: wrap/);
assert.match(styles, /\.catalog-section :is\(a, button, input, select\):focus-visible/);
assert.match(world, /\.distribution-link:focus-visible/);

const worldUi = vm.createContext({
  window: browser.window, fallbackArtwork: "/fallback.svg", safeHref: value => value || "", releaseDateLabel: () => "",
  resolveTrackArtwork: () => ({}), resolveTrackAudio: () => ({ src: "/preview.mp3" }),
  storefrontStatus: () => "READY", resolveDreamweaverExperienceUrl: () => "",
  formatDuration: () => "", esc: value => String(value || ""), cardStatus: () => "READY",
  renderProductArtwork: () => "", renderProductAction: () => "", externalLinkAttrs: () => "",
  money: () => ""
});
for (const name of ["releaseToTrack", "renderProductPreview", "renderProductCard"]) {
  const source = world.match(new RegExp(`function ${name}\\([^\\n]+`))?.[0];
  assert.ok(source);
  vm.runInContext(source, worldUi);
}
const worldCard = worldUi.renderProductCard(worldUi.releaseToTrack({ ...release, id: "public-track" }));
assert.match(worldCard, /Stream \/ DSPs/);
assert.match(worldCard, /Play preview/);
assert.doesNotMatch(worldUi.renderProductCard(worldUi.releaseToTrack({ ...release, distributionUrl: "" })), /Stream \/ DSPs/);
for (const path of ["music/index.html", "music-upload/index.html", "music-world.html"]) {
  assert.match(await read(path), /<script src="\/distribution-links\.js"><\/script>/);
}

function createReleasePackHarness({ user, allowUpdate = true, status = "published", visibility = "public", purchaseUrl = "" } = {}) {
  const releaseRow = {
    id: "public-track", owner_member_id: "member-1", title: "Contract track", artist: "HALO Artist",
    status, visibility, purchase_url: purchaseUrl, updated_at: new Date(), genres: [], available_versions: []
  };
  const queries = [];
  const context = vm.createContext({
    URL, Response, console, validateSmartLink,
    getUser: async () => user,
    getDatabase: async () => ({ sql: async (strings, ...values) => {
      const query = strings.join("?");
      queries.push({ query, values });
      if (/UPDATE halo_release_campaigns/.test(query)) {
        if (!allowUpdate || values[1] !== releaseRow.id) return [];
        releaseRow.purchase_url = values[0];
        return [{ id: releaseRow.id }];
      }
      if (/SELECT \* FROM halo_release_campaigns/.test(query)) {
        return user?.id && (user.role === "platform-owner" || releaseRow.owner_member_id === "member-1") ? [releaseRow] : [];
      }
      if (/FROM halo_release_campaigns/.test(query)) return [releaseRow];
      if (/COUNT\(\*\)/.test(query)) return [{}];
      return [];
    } }),
    ensureMembership: async () => ({ member_id: "member-1" }),
    isOwner: candidate => candidate?.role === "platform-owner",
    verifyRequestOrigin: request => {
      if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("origin mismatch");
    },
    resolveReleaseArtworkFields: () => ({})
  });
  vm.runInContext(releasePackSource
    .replace(/^import .+;\n/gm, "")
    .replace("export default async function", "async function")
    .replace("export const config", "const config"), context);
  return { context, queries, releaseRow };
}

async function patchDistribution(harness, body, origin = "https://halo.test") {
  const request = new Request("https://halo.test/api/release-pack", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body)
  });
  return harness.context.releasePackHandler(request);
}

const owner = { id: "artist-user" };
const smartDestination = "https://distrokid.com/hyperfollow/contract/track";
const ownerHarness = createReleasePackHarness({ user: owner });
const ownerResponse = await patchDistribution(ownerHarness, { releaseId: "public-track", purchaseUrl: smartDestination });
const ownerPayload = await ownerResponse.json();
assert.equal(ownerResponse.status, 200);
assert.equal(ownerPayload.release.purchaseUrl, smartDestination);
assert.equal(ownerPayload.release.distributionStatus, "public");
assert.equal(ownerPayload.release.distributionSource, "halo_release_campaigns.purchase_url");
assert.deepEqual(ownerPayload.release.distributionVisibility, { releaseStatus: "published", visibility: "public" });
const updateQuery = ownerHarness.queries.find(({ query }) => /UPDATE halo_release_campaigns/.test(query));
assert.ok(updateQuery);
assert.match(updateQuery.query, /SET purchase_url = \?\, updated_at = NOW\(\)/);
assert.match(updateQuery.query, /WHERE id = \?\s+AND \(\? OR owner_member_id = \?\)/);
const updateSetClause = updateQuery.query.match(/SET([\s\S]*?)WHERE/)?.[1] || "";
assert.match(updateSetClause, /^\s*purchase_url = \?, updated_at = NOW\(\)\s*$/);
assert.doesNotMatch(updateSetClause, /status|owner_member_id|rights|visibility|radio|publication/i);
assert.deepEqual(updateQuery.values.slice(0, 2), [smartDestination, "public-track"]);
assert.doesNotMatch(releasePackSource, /\bfetch\s*\(/i, "saving a link must not fetch or scrape it");

const clearHarness = createReleasePackHarness({ user: owner, purchaseUrl: smartDestination });
const clearResponse = await patchDistribution(clearHarness, { releaseId: "public-track", purchaseUrl: "" });
assert.equal(clearResponse.status, 200);
assert.equal((await clearResponse.json()).release.distributionStatus, "missing");
assert.equal(clearHarness.releaseRow.purchase_url, "");

const draftHarness = createReleasePackHarness({ user: owner, status: "draft", visibility: "private" });
const draftResponse = await patchDistribution(draftHarness, { releaseId: "public-track", purchaseUrl: smartDestination });
const draftPayload = await draftResponse.json();
assert.equal(draftResponse.status, 200);
assert.equal(draftPayload.release.distributionStatus, "private");
assert.equal(draftPayload.release.status, "draft");
assert.equal(draftPayload.campaigns[0].distributionStatus, "private");

for (const user of [null, { id: "other-user" }]) {
  const deniedHarness = createReleasePackHarness({ user, allowUpdate: false });
  const denied = await patchDistribution(deniedHarness, { releaseId: "public-track", purchaseUrl: smartDestination });
  assert.ok([401, 404].includes(denied.status));
  assert.equal(deniedHarness.releaseRow.purchase_url, "");
}
const originHarness = createReleasePackHarness({ user: owner });
assert.equal((await patchDistribution(originHarness, { releaseId: "public-track", purchaseUrl: smartDestination }, "https://evil.test")).status, 403);
assert.equal(originHarness.queries.length, 0);

for (const purchaseUrl of [
  "http://hyperfollow.com/track", "https://hyperfollow.com.evil.test/track",
  "https://hyperfollow.com:444/track", "https://distrokid.com/track"
]) {
  const invalidHarness = createReleasePackHarness({ user: owner });
  const invalid = await patchDistribution(invalidHarness, { releaseId: "public-track", purchaseUrl });
  assert.equal(invalid.status, 400, purchaseUrl);
  assert.equal(invalidHarness.queries.length, 0, purchaseUrl);
}
const missingUrlHarness = createReleasePackHarness({ user: owner });
assert.equal((await patchDistribution(missingUrlHarness, { releaseId: "public-track" })).status, 400);
assert.equal(missingUrlHarness.queries.length, 0);

const [artistEditor, catalogDoc] = await Promise.all([
  read("artists/index.html"), read("MUSIC_CATALOG_CONTRACT.md")
]);
assert.match(artistEditor, /Artist listening \/ official link/);
assert.match(artistEditor, /separate from the public catalog’s Stream \/ DSPs destination/);
assert.match(await read("halo.html"), /method: 'PATCH'[\s\S]*purchaseUrl: campaignDraft\.purchaseUrl/);
assert.match(catalogDoc, /halo_release_campaigns\.purchase_url/);
assert.match(catalogDoc, /pending submission's `smart_link_url` is not a/);
console.log("Catalog distribution contracts passed");
