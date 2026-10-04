import {
  CREATOR_SEEDS, LISTING_SEEDS, ORBIT_TIERS, LISTING_TYPES,
  formatListingPrice, safeAssetUrl
} from "../lib/creator-marketplace.js";
import { HaloAIService } from "../lib/halo-ai-service.js";
import { createAuthorHeader, recordStudioSpark } from "../lib/creator-social.js";

const FOLLOW_KEY = "halo.creator-demo.follows.v1";
const ADVISORY_DISCLOSURE = "Local-rules advisory only: no actual audio analysis or AI provider is used. Stem checks inspect sample metadata, not audio files. Rights and split checks are not legal verification.";

export function readDemoFollows(storage, creators = CREATOR_SEEDS) {
  try {
    const stored = JSON.parse(storage?.getItem(FOLLOW_KEY) || "[]");
    const validIds = new Set(creators.map(creator => creator.id));
    return { ids: new Set(Array.isArray(stored) ? stored.filter(id => validIds.has(id)) : []), available: true };
  } catch {
    return { ids: new Set(), available: false };
  }
}

export function saveDemoFollows(storage, ids) {
  try {
    if (!storage) return false;
    storage.setItem(FOLLOW_KEY, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}

export function filterDemoCreators(creators, search = "", genre = "") {
  const query = search.trim().toLocaleLowerCase();
  return creators.filter(creator => (!genre || creator.genres.includes(genre)) &&
    [creator.displayName, creator.bio, creator.location, ...creator.roles, ...creator.genres]
      .join(" ").toLocaleLowerCase().includes(query));
}

export function profileListings(creator, listings = LISTING_SEEDS) {
  return listings.filter(listing => listing.creatorId === creator.id &&
    creator.featuredListings.includes(listing.id));
}

export function initBriefComposer({ document: doc = globalThis.document, Observer = globalThis.MutationObserver } = {}) {
  const byId = id => doc.getElementById(id);
  const form = byId("project");
  const brief = byId("collaborationBrief");
  const kind = byId("briefKind");
  if (!form || !brief || !kind) return;
  const choices = [["briefAudio", "audio"], ["briefVisuals", "visual"], ["briefReview", "review"]];
  const sync = () => {
    byId("briefCounter").textContent = `${brief.value.length} / 4000`;
    for (const [id, value] of choices) byId(id).setAttribute("aria-pressed", String(kind.value === value));
  };
  const syncAuthor = () => {
    byId("briefAuthorName").textContent = byId("passName")?.textContent || "Your artist name";
    byId("briefAuthorInitial").textContent = byId("passInitial")?.textContent || "H";
  };
  for (const [id, value] of choices) byId(id).addEventListener("click", () => {
    kind.value = value;
    sync();
  });
  brief.addEventListener("input", sync);
  kind.addEventListener("change", sync);
  form.addEventListener("reset", () => queueMicrotask(sync));
  // The authenticated client owns these pass values; never substitute the local demo identity.
  if (Observer) {
    const observer = new Observer(syncAuthor);
    for (const id of ["passName", "passInitial"]) {
      const target = byId(id);
      if (target) observer.observe(target, { childList: true, characterData: true, subtree: true });
    }
  }
  syncAuthor();
  sync();
  return { sync, syncAuthor };
}

export function initCreatorDiscovery({
  document: doc = globalThis.document,
  storage,
  creators = CREATOR_SEEDS,
  listings = LISTING_SEEDS,
  tiers = ORBIT_TIERS,
  recordSpark = recordStudioSpark,
  aiService = typeof HaloAIService === "function" ? new HaloAIService() : HaloAIService
} = {}) {
  const byId = id => doc.getElementById(id);
  if (!byId("demoCreators")) return;
  let storageAvailable = true;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storageAvailable = false; }
  }
  const loaded = readDemoFollows(storage, creators);
  storageAvailable = storageAvailable && loaded.available && Boolean(storage);
  const followed = loaded.ids;
  const followControls = new Map();
  const dialog = byId("demoProfileDialog");
  let lastOpener;
  let profileVersion = 0;

  function node(tag, text, className) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function button(text, onClick, className = "button button-outline") {
    const control = node("button", text, className);
    control.type = "button";
    control.addEventListener("click", onClick);
    return control;
  }

  function notify(message) {
    byId("demoDiscoveryStatus").textContent = message;
    byId("demoProfileStatus").textContent = message;
  }

  function avatar(creator, className = "demo-avatar") {
    const initials = creator.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("");
    const element = node("div", initials, className);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function badge(creator) {
    return node("span", creator.verified ? "✓ Verified · sample only" : "Sample creator", "sample-badge");
  }

  function authorHeader(creator) {
    const header = createAuthorHeader(doc, {
      displayName: creator.displayName,
      handle: `sample-${creator.id}`,
      label: "Sample showcase"
    });
    header.className += " demo-author-header";
    const title = header.querySelector("strong");
    title.textContent = creator.displayName;
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "3");
    return header;
  }

  function tags(creator) {
    const list = node("ul", undefined, "demo-tags");
    for (const genre of creator.genres) list.append(node("li", genre));
    list.setAttribute("aria-label", "Genres");
    return list;
  }

  function followButton(creator) {
    const control = button("", () => {
      if (followed.has(creator.id)) followed.delete(creator.id);
      else {
        followed.add(creator.id);
        recordSpark("follow");
      }
      const saved = saveDemoFollows(storage, followed);
      storageAvailable = saved;
      syncFollows(creator.id);
      notify(`${followed.has(creator.id) ? "Following" : "Unfollowed"} ${creator.displayName} in this demo only. ${saved ? "Saved on this browser; no real account or follower count changed." : "Browser storage is unavailable; this choice lasts only for this page visit."} Local studio progress only — Orbits placement and permissions stay unchanged.`);
    });
    control.setAttribute("aria-label", `Follow ${creator.displayName} in the demo only`);
    if (!followControls.has(creator.id)) followControls.set(creator.id, new Set());
    followControls.get(creator.id).add(control);
    syncFollows(creator.id);
    return control;
  }

  function syncFollows(id) {
    for (const control of followControls.get(id) || []) {
      control.textContent = followed.has(id) ? "Following · demo" : "Follow · demo";
      control.setAttribute("aria-pressed", String(followed.has(id)));
    }
  }

  function tierLabel(creator) {
    return tiers.find(tier => tier.id === creator.tier)?.label || "Unassigned orbit";
  }

  function sampleMetrics(creator) {
    return node("p", `${Number(creator.followers).toLocaleString("en-US")} sample followers · ${Number(creator.following).toLocaleString("en-US")} sample following`, "demo-metrics");
  }

  function renderCreators() {
    // Keep only the open profile's controls when rebuilding the filtered grid.
    for (const controls of followControls.values()) {
      for (const control of controls) if (!dialog.contains(control)) controls.delete(control);
    }
    const matches = filterDemoCreators(creators, byId("demoSearch").value, byId("demoGenre").value);
    byId("demoResultCount").textContent = `${matches.length} of ${creators.length} sample creators`;
    byId("demoCreators").replaceChildren(...matches.map(creator => {
      const card = node("article", undefined, "demo-creator-card");
      const cover = node("div", undefined, "demo-card-cover");
      cover.append(node("span", tierLabel(creator), "demo-tier-label"));
      const body = node("div", undefined, "demo-card-body");
      body.append(authorHeader(creator), badge(creator), node("p", creator.roles.join(" / "), "demo-roles"),
        tags(creator), node("p", creator.bio, "demo-bio"),
        node("p", `${creator.location} · ${creator.availability}`, "demo-location"), sampleMetrics(creator));
      const actions = node("div", undefined, "demo-card-actions");
      const open = button("Explore profile ↗", () => openProfile(creator, open), "button button-gold");
      actions.append(open, followButton(creator));
      body.append(actions);
      card.append(cover, body);
      return card;
    }));
    if (!matches.length) byId("demoCreators").append(node("p", "No sample creators match. Try a different sound or reset the filters.", "empty-state"));
  }

  function renderOrbits() {
    byId("demoOrbitTiers").replaceChildren(...tiers.map((tier, index) => {
      const orbit = node("article", undefined, "demo-orbit-tier");
      orbit.append(node("p", `ORBIT / 0${index + 1}`, "eyebrow"), node("h3", tier.label),
        node("p", tier.description, "demo-orbit-description"));
      const constellation = node("div", undefined, "demo-constellation");
      const members = creators.filter(creator => creator.tier === tier.id);
      for (const creator of members) {
        const open = button("", () => openProfile(creator, open), "demo-orbit-creator");
        open.setAttribute("aria-label", `Explore ${creator.displayName}, sample ${tier.label} creator`);
        open.append(avatar(creator, "demo-orbit-avatar"), node("span", creator.displayName));
        constellation.append(open);
      }
      if (!members.length) constellation.append(node("p", "Open orbit — no sample creators placed here yet.", "demo-orbit-empty"));
      orbit.append(constellation, node("p", `${members.length} sample ${members.length === 1 ? "creator" : "creators"}`, "demo-metrics"));
      return orbit;
    }));
  }

  function listingCard(listing) {
    const card = node("article", undefined, "demo-listing-card");
    const type = LISTING_TYPES.find(item => item.id === listing.listingType)?.label || listing.listingType;
    card.append(node("p", `${type} / sample listing`, "eyebrow"), node("h4", listing.title),
      node("p", listing.description), node("p", `${listing.format} · ${listing.licenseType}`),
      node("p", `${formatListingPrice(listing)} · illustrative price only`, "demo-listing-price"));
    const preview = safeAssetUrl(listing.assetPreviewUrl);
    if (preview) {
      const link = node("a", "Open sample asset preview ↗", "text-link");
      link.href = preview;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    } else {
      card.append(node("p", "No audio or downloadable preview is supplied for this sample.", "demo-caption"));
    }
    card.append(button("Request listing · demo", () => notify(`Demo unavailable: “${listing.title}” is illustrative and is not for sale. No request, payment, license or download has been created.`)),
      node("p", "Demo unavailable for purchase or licensing.", "demo-caption"));
    return card;
  }

  function advisoryPanel(creator) {
    const panel = node("section", undefined, "demo-advisory");
    panel.setAttribute("aria-label", "HALO AI local advisory demo");
    panel.append(node("p", "HALO AI / local advisory demo", "eyebrow"), node("h3", "A clearer next step."),
      node("p", ADVISORY_DISCLOSURE, "demo-caption"));
    const output = node("div", undefined, "demo-advisory-output");
    output.setAttribute("role", "status");
    const review = button("Review sample release readiness", async () => {
      const version = profileVersion;
      review.disabled = true;
      output.replaceChildren(node("p", "Checking illustrative project metadata…"));
      try {
        const result = await aiService.reviewProject({
          title: creator.featuredRelease.title,
          completion: 72,
          stems: [{ name: "Drums", format: "WAV", validated: true }],
          requiredStems: ["Drums", "Vocals"],
          splits: [{ name: creator.displayName, share: 100, confirmed: false }],
          rightsConfirmed: false,
          listingType: profileListings(creator, listings)[0]?.listingType || LISTING_TYPES[0]?.id
        });
        if (version !== profileVersion || !dialog.open) return;
        output.replaceChildren(
          node("p", `${result.score}/100 · ${result.status} · sample readiness`, "demo-readiness"),
          node("p", result.summary),
          node("p", `Stem metadata: ${result.stemValidation.valid ? "checks passed" : "needs attention"}. Missing: ${result.stemValidation.missing.join(", ") || "none"}.`),
          node("p", `Split confirmation: ${result.splitVerification.status}. Rights remain unconfirmed in this sample.`));
        const groups = [
          ["Insights", result.insights],
          ["Stem metadata issues", result.stemValidation.issues],
          ["Next steps", result.nextSteps],
          ["Advisory council recommendations", result.councilReview.recommendations]
        ];
        for (const [heading, items] of groups) {
          if (!items.length) continue;
          output.append(node("h4", heading));
          const list = node("ul");
          for (const item of items) list.append(node("li", item));
          output.append(list);
        }
        const suggestedType = LISTING_TYPES.find(type => type.id === result.suggestedListingType)?.label || result.suggestedListingType;
        output.append(node("p", result.councilReview.summary),
          node("p", `Illustrative price suggestion: ${typeof result.suggestedPrice === "number" ? formatListingPrice({ price: result.suggestedPrice, currency: "USD" }) : "not available"} · ${suggestedType || "listing type pending"}. Not a valuation or offer.`),
          node("p", `Source: ${result.source}. ${ADVISORY_DISCLOSURE}`, "demo-caption"));
      } catch {
        if (version === profileVersion && dialog.open) output.replaceChildren(node("p", "The local demo advisory is unavailable. No audio, rights, splits or project data were submitted."));
      } finally {
        review.disabled = false;
      }
    }, "button button-gold");
    panel.append(review, output);
    return panel;
  }

  function openProfile(creator, opener) {
    profileVersion++;
    lastOpener = opener;
    for (const controls of followControls.values()) {
      for (const control of controls) if (dialog.contains(control)) controls.delete(control);
    }
    const heading = node("div", undefined, "demo-profile-heading");
    const identity = node("div", undefined, "demo-profile-identity");
    const author = authorHeader(creator);
    const title = author.querySelector("strong");
    title.id = "demoProfileTitle";
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "2");
    identity.append(author, badge(creator), node("p", creator.roles.join(" / "), "demo-roles"),
      tags(creator), node("p", `${creator.location} · ${creator.availability}`, "demo-location"));
    heading.append(identity);
    const about = node("div", undefined, "demo-profile-about");
    about.append(node("p", creator.bio), sampleMetrics(creator),
      node("p", `${tierLabel(creator)} · illustrative orbit placement`, "demo-tier-label"), followButton(creator));
    const handoff = node("section", undefined, "demo-handoff");
    handoff.append(node("h3", "Take the next step — with real tools."),
      node("p", "These links open existing HALO workspaces, not this sample creator’s inbox, projects, metrics or releases. Message opens Signal’s private messaging command center; sign in and connect with a real member to start a conversation. Collaborate opens your own studio to find real opt-in creators and create a brief. There is no demo inbox. No message is sent, invitation created or demo content transferred.", "demo-caption"));
    const actions = node("div", undefined, "demo-card-actions");
    const studioOpen = byId("workspace")?.hidden === false;
    for (const [label, href] of [
      ["Message · Signal handoff", "/signal-network/#command-center"],
      ["Collaborate · studio handoff", `/creator-network/#${studioOpen ? "collaboration" : "locked"}`],
      ["View Signal Network ↗", "/signal-network/"],
      ["View releases · Release House ↗", "/release-house/"]
    ]) {
      const link = node("a", label, "button button-outline");
      link.href = href;
      link.setAttribute("aria-describedby", "demoHandoffExplanation");
      link.addEventListener("click", () => dialog.close());
      actions.append(link);
    }
    handoff.querySelector("p").id = "demoHandoffExplanation";
    handoff.append(actions);
    const release = node("section", undefined, "demo-featured-release");
    release.append(node("p", "Featured release / illustrative concept", "eyebrow"),
      node("h3", creator.featuredRelease.title), node("p", creator.featuredRelease.description),
      node("p", "Sample release concept only — no playable master or real release claim.", "demo-caption"));
    const featured = node("section", undefined, "demo-featured-listings");
    featured.append(node("h3", "Featured sample listings."));
    const grid = node("div", undefined, "demo-listing-grid");
    const items = profileListings(creator, listings);
    grid.append(...items.map(listingCard));
    if (!items.length) grid.append(node("p", "No featured sample listings in this orbit yet.", "empty-state"));
    featured.append(grid);
    byId("demoProfileContent").replaceChildren(heading, about, handoff, release, featured, advisoryPanel(creator));
    byId("demoProfileStatus").textContent = "";
    if (!dialog.open) dialog.showModal();
    byId("demoProfileClose").focus();
  }

  byId("demoProfileClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    profileVersion++;
    lastOpener?.focus();
  });
  byId("demoFilters").addEventListener("submit", event => event.preventDefault());
  byId("demoFilters").addEventListener("reset", event => {
    event.preventDefault();
    byId("demoSearch").value = "";
    byId("demoGenre").value = "";
    renderCreators();
  });
  byId("demoSearch").addEventListener("input", renderCreators);
  byId("demoGenre").addEventListener("change", renderCreators);
  for (const genre of [...new Set(creators.flatMap(creator => creator.genres))].sort()) {
    const option = node("option", genre);
    option.value = genre;
    byId("demoGenre").append(option);
  }
  renderCreators();
  renderOrbits();
  if (!storageAvailable) notify("Browser storage is unavailable. Demo follows still work for this page visit only.");
  return { openProfile, renderCreators, followed };
}

if (globalThis.document) {
  initCreatorDiscovery();
  initBriefComposer();
}
