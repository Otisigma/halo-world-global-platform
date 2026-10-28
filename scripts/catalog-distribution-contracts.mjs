import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { SMART_LINK_HOSTS, validateSmartLink } from "../netlify/lib/release-house-submission.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [helper, api, client, world, styles] = await Promise.all([
  read("distribution-links.js"), read("netlify/functions/release-catalog.mjs"),
  read("music/music.js"), read("music-world.html"), read("music/music.css")
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
console.log("Catalog distribution contracts passed");
