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
  assert.equal(links.validate(url), validation.url);
  assert.equal(links.destination({ ...approved, distributionUrl: url }), validation.url);
}
for (const url of [
  "", "javascript:alert(1)", "data:text/html,unsafe", "//hyperfollow.com/track", "/api/release-link?slug=private",
  "http://hyperfollow.com/track", "******hyperfollow.com/track",
  "https://hyperfollow.com:444/track", "https://hyperfollow.com:443/track", "https:hyperfollow.com/track",
  "https://hyperfollow.com.evil.test/track",
  "https://evilhyperfollow.com/track", "https://hyperfоllow.com/track",
  "https://hyperfollow.com@evil.test/track", "https://distrokid.com/redirect?url=https://evil.test",
  "https://hyperfollow.com\\@evil.test", "https://hyperfollow.com/a\nb",
  `https://hyperfollow.com/${"a".repeat(500)}`, "https://localhost/track", "https://127.0.0.1/track"
]) {
  assert.equal(links.validate(url), "");
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
assert.doesNotMatch(markup, /<input|<textarea/, "public visitor actions remain read-only");
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
    status, visibility, purchase_url: purchaseUrl, updated_at: new Date(), genres: [], available_versions: [],
    rights_status: "cleared", approval_status: "approved", radio_status: "scheduled", stream_url: "/master.wav",
    is_chart_eligible: false, publication_status: "unchanged"
  };
  const queries = [];
  const context = vm.createContext({
    URL, Response, console, validateSmartLink,
    getUser: async () => user,
    getDatabase: async () => ({ sql: async (strings, ...values) => {
      const query = strings.join("?");
      queries.push({ query, values });
      if (/UPDATE halo_release_campaigns/.test(query)) {
        if (!allowUpdate || values[1] !== releaseRow.id || (!values[2] && values[3] !== releaseRow.owner_member_id)) return [];
        releaseRow.purchase_url = values[0];
        return [{ id: releaseRow.id }];
      }
      if (/SELECT \* FROM halo_release_campaigns/.test(query)) {
        return user?.id && (user.role === "platform-owner" || user.id === "artist-user") ? [releaseRow] : [];
      }
      if (/FROM halo_release_campaigns/.test(query)) return [releaseRow];
      if (/COUNT\(\*\)/.test(query)) return [{}];
      return [];
    } }),
    ensureMembership: async () => ({ member_id: user?.id === "artist-user" ? "member-1" : "member-other" }),
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

const visitorPack = createReleasePackHarness({ user: null, purchaseUrl: smartLink });
const visitorRelease = visitorPack.context.serializeRelease(visitorPack.releaseRow, false);
assert.equal(visitorRelease.purchaseUrl, "");
assert.equal(visitorRelease.distributionStatus, "");

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
const initialRelease = structuredClone(ownerHarness.releaseRow);
const ownerResponse = await patchDistribution(ownerHarness, {
  releaseId: "public-track", purchaseUrl: smartDestination,
  status: "draft", visibility: "private", owner_member_id: "attacker", rights_status: "disputed",
  approval_status: "pending", radio_status: "off", stream_url: "/changed.wav", is_chart_eligible: true
});
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
assert.deepEqual(ownerHarness.releaseRow, { ...initialRelease, purchase_url: smartDestination },
  "destination edits preserve every unrelated persisted field even when the request attempts to change them");
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
  const deniedHarness = createReleasePackHarness({ user });
  const denied = await patchDistribution(deniedHarness, { releaseId: "public-track", purchaseUrl: smartDestination });
  assert.ok([401, 404].includes(denied.status));
  assert.equal(deniedHarness.releaseRow.purchase_url, "");
}
const adminHarness = createReleasePackHarness({ user: { id: "admin", role: "platform-owner" } });
assert.equal((await patchDistribution(adminHarness, { releaseId: "public-track", purchaseUrl: smartDestination })).status, 200);
assert.equal(adminHarness.releaseRow.owner_member_id, "member-1", "admin edits do not reassign the owner");
const originHarness = createReleasePackHarness({ user: owner });
assert.equal((await patchDistribution(originHarness, { releaseId: "public-track", purchaseUrl: smartDestination }, "https://evil.test")).status, 403);
assert.equal(originHarness.queries.length, 0);

for (const purchaseUrl of [
  "http://hyperfollow.com/track", "https://hyperfollow.com.evil.test/track",
  "https://hyperfollow.com:444/track", "https://hyperfollow.com:443/track", "https:hyperfollow.com/track",
  "https://distrokid.com/track"
]) {
  const invalidHarness = createReleasePackHarness({ user: owner });
  const invalid = await patchDistribution(invalidHarness, { releaseId: "public-track", purchaseUrl });
  assert.equal(invalid.status, 400, purchaseUrl);
  assert.equal(invalidHarness.queries.length, 0, purchaseUrl);
}
const missingUrlHarness = createReleasePackHarness({ user: owner });
assert.equal((await patchDistribution(missingUrlHarness, { releaseId: "public-track" })).status, 400);
assert.equal(missingUrlHarness.queries.length, 0);

const [artistEditor, catalogDoc, haloEditor] = await Promise.all([
  read("artists/index.html"), read("MUSIC_CATALOG_CONTRACT.md"), read("halo.html")
]);
assert.match(artistEditor, /Artist listening \/ official link/);
assert.match(artistEditor, /separate from the public catalog’s Stream \/ DSPs destination/);
assert.match(haloEditor, /method: 'PATCH'[\s\S]*JSON\.stringify\(\{ releaseId, purchaseUrl \}\)/);
assert.match(haloEditor, /distributionStatus: data\.release\.distributionStatus/);
assert.match(haloEditor, /<div className="release-artwork-frame"[\s\S]*?\{releasePack\.canEdit && catalogCardReleaseId && identityUser\?\.id && <div[\s\S]*?Catalog distribution URL/,
  "only an authorized owner/admin sees the editable URL control directly beneath the selected release artwork");
assert.match(haloEditor, /campaignDraft\?\.id === catalogCardReleaseId[\s\S]*campaignDraft\.purchaseUrl[\s\S]*releasePack\?\.release\?\.purchaseUrl/,
  "the card input hydrates from the selected persisted purchase_url value");
assert.match(releasePackSource, /canEdit = platformOwner \|\| Boolean\(memberId && releaseRow\.owner_member_id === memberId\)/,
  "release-pack edit capability remains owner/admin scoped");
assert.match(haloEditor, /href=\{validatedCatalogCardUrl\} target="_blank" rel="noopener noreferrer"/,
  "editor previews use a client-validated URL and protected external-link attributes");
assert.match(haloEditor, /releasePackRequestRef\.current[\s\S]*data\.release\?\.id !== releaseId/,
  "stale saves cannot update another selected release");
assert.match(haloEditor, /releasePackLoading \|\| !releaseId \|\| releasePack\?\.release\?\.id !== releaseId/,
  "editing and saving are blocked while a different release is loading");
assert.match(haloEditor, /role=\{catalogCardDistributionFeedback\.status === 'error' \? 'alert' : 'status'\}/,
  "saving, saved, and error feedback is announced accessibly");
assert.match(haloEditor, /src="\/distribution-links\.js"/, "the release editor loads shared allowlist validation");
assert.match(haloEditor, /releasePack\.canEdit && catalogCardReleaseId/,
  "anonymous visitors and unrelated members do not receive an editable input");
assert.match(haloEditor, /Saving changes only this URL; it does not change release status, visibility, rights, ownership, or radio state/);
assert.match(catalogDoc, /halo_release_campaigns\.purchase_url/);
assert.match(catalogDoc, /pending submission's `smart_link_url` is not a/);

// Execute the desk's actual handlers, with only transport and React state setters replaced.
function createDeskHarness() {
  const persisted = createReleasePackHarness({ user: owner });
  const calls = [];
  const context = vm.createContext({
    window: { HaloDistributionLinks: links, location: { origin: "https://halo.test" } },
    identityUser: owner, campaignDraft: { id: "public-track", purchaseUrl: smartDestination, title: "Unsaved title" },
    releasePack: { release: { id: "public-track", purchaseUrl: "" }, canEdit: true },
    releasePackLoading: false, distributionSaving: false, campaignSaving: false,
    releasePackRequestRef: { current: 1 }, distributionFeedback: {}, URL, encodeURIComponent,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return patchDistribution(persisted, JSON.parse(options.body));
    }
  });
  for (const [setter, field] of Object.entries({
    setReleasePack: "releasePack", setCampaignDraft: "campaignDraft", setDistributionSaving: "distributionSaving",
    setDistributionFeedback: "distributionFeedback", setReleasePackLoading: "releasePackLoading",
    setReleasePackError: "releasePackError", setCampaignEditorOpen: "campaignEditorOpen",
    setReleasePackNotice: "releasePackNotice", setSocialCaption: "socialCaption", setSelectorDraft: "selectorDraft"
  })) context[setter] = value => { context[field] = typeof value === "function" ? value(context[field]) : value; };
  for (const name of ["applyReleasePackState", "loadReleasePack", "newCampaignDraft", "saveDistributionLink", "updateDistributionLink"]) {
    const handler = haloEditor.match(new RegExp(`          const ${name} = [\\s\\S]*?\\n          };`))?.[0];
    assert.ok(handler, `actual ${name} handler exists`);
    vm.runInContext(handler.replace(`const ${name} =`, `globalThis.${name} =`), context);
  }
  return { context, calls, persisted };
}

const desk = createDeskHarness();
await desk.context.saveDistributionLink();
assert.equal(desk.calls[0].url, "/api/release-pack");
assert.equal(desk.calls[0].options.method, "PATCH");
assert.deepEqual(JSON.parse(desk.calls[0].options.body), { releaseId: "public-track", purchaseUrl: smartDestination });
assert.equal(desk.persisted.releaseRow.purchase_url, smartDestination);
assert.equal(desk.context.distributionFeedback.status, "saved");
assert.equal(desk.context.campaignDraft.title, "Unsaved title", "link saves preserve unsaved campaign edits");
desk.context.updateDistributionLink("");
assert.equal(desk.context.distributionFeedback.message, "");
await desk.context.saveDistributionLink();
assert.equal(desk.persisted.releaseRow.purchase_url, "");
assert.equal(desk.context.campaignDraft.purchaseUrl, "");
assert.match(desk.context.distributionFeedback.message, /cleared/i);

for (const value of ["javascript:alert(1)", "https://evil.test/", "http://hyperfollow.com/a", "******hyperfollow.com/a", "https://hyperfollow.com:443/a", "https://drive.google.com/file/d/master"]) {
  const invalid = createDeskHarness();
  invalid.context.updateDistributionLink(value);
  await invalid.context.saveDistributionLink();
  assert.equal(invalid.calls.length, 0, "invalid URLs must fail before any request");
  assert.equal(invalid.context.distributionFeedback.status, "error");
  assert.equal(invalid.context.campaignDraft.purchaseUrl, value);
}
for (const changes of [{ identityUser: null }, { releasePack: { canEdit: false, release: { id: "public-track" } } },
  { releasePackLoading: true }, { distributionSaving: true }, { campaignSaving: true }]) {
  const blocked = createDeskHarness();
  Object.assign(blocked.context, changes);
  await blocked.context.saveDistributionLink();
  assert.equal(blocked.calls.length, 0, "unauthorized/loading/busy states cannot save");
}
for (const response of [
  new Response(JSON.stringify({ message: "Owner access denied" }), { status: 403 }),
  new Response("not JSON", { status: 502 }),
  new Response(JSON.stringify({ release: { id: "wrong-release", purchaseUrl: smartDestination } })),
  new Response(JSON.stringify({ release: { id: "public-track" } }))
]) {
  const failed = createDeskHarness();
  failed.context.fetch = async () => response;
  await failed.context.saveDistributionLink();
  assert.equal(failed.context.distributionFeedback.status, "error");
  assert.equal(failed.context.distributionSaving, false);
  assert.equal(failed.context.campaignDraft.purchaseUrl, smartDestination, "errors retain the user's value for retry");
}
for (const switchTo of ["existing", "new"]) {
  for (const fails of [false, true]) {
    const race = createDeskHarness();
    let finish;
    race.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = race.context.saveDistributionLink();
    assert.equal(race.context.distributionFeedback.status, "saving", "no success before the server responds");
    race.context.updateDistributionLink("https://lnk.to/should-not-overwrite");
    assert.equal(race.context.campaignDraft.purchaseUrl, smartDestination, "both inputs are locked during saves");
    if (switchTo === "existing") {
      race.context.fetch = async () => new Response(JSON.stringify({
        release: { id: "other-release", purchaseUrl: "", genres: [], availableVersions: [] }, canEdit: true
      }));
      await race.context.loadReleasePack("other-release");
    } else {
      race.context.newCampaignDraft();
    }
    finish(new Response(JSON.stringify(fails ? { message: "Stale failure" } : {
      release: { id: "public-track", purchaseUrl: smartDestination }
    }), { status: fails ? 403 : 200 }));
    await pending;
    assert.equal(race.context.campaignDraft.id, switchTo === "existing" ? "other-release" : "");
    assert.equal(race.context.distributionFeedback.message, "", "stale success/error never appears for another release");
    assert.equal(race.context.distributionSaving, false);
  }
}
const deskMarkup = haloEditor.slice(haloEditor.indexOf('{releasePack.canEdit && identityUser?.id && campaignDraft.id ==='));
assert.match(deskMarkup, /Release promotion desk \/\/ Distributor destination/);
assert.match(deskMarkup, /htmlFor=\{`desk-distribution-\$\{catalogCardReleaseId\}`\}/);
assert.match(deskMarkup, /aria-describedby=\{`desk-distribution-help-[^\n]+desk-distribution-status-/);
assert.match(deskMarkup, /aria-invalid=\{Boolean\(catalogCardPurchaseUrl\.trim\(\) && !validatedCatalogCardUrl\)\}/);
assert.match(deskMarkup, /does not verify distributor status, import metadata, publish or promote this release, alter the Living Chart, or send it to an AI pipeline/);
assert.doesNotMatch(deskMarkup.slice(0, deskMarkup.indexOf('{!campaignDraft.id')), /setTimeout|driveUrl|initialDistrokidUrl/);
console.log("Catalog distribution contracts passed");
