import { ORBIT_TIERS, SEEDED_CREATORS, filterSeededCreators } from "/lib/halo-creator-seed.js";
import { layoutOrbits } from "/lib/halo-orbits.js";
import { HaloAIService, parseStemLines } from "/lib/halo-ai-service.js";

const byId = id => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

function node(tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content || "";
  if (className) element.className = className;
  return element;
}

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

const tierLabel = id => ORBIT_TIERS.find(tier => tier.id === id)?.label || "Public Signal";

function link(label, href) {
  const anchor = node("a", label);
  anchor.href = href;
  return anchor;
}

export function renderVerifiedCreators(creators) {
  const container = byId("verifiedCreators");
  if (!container) return;
  container.replaceChildren(...creators.map(creator => {
    const card = node("article", "", "creator-profile-card verified-card");
    card.id = `creator-${creator.id}`;
    const top = node("div", "", "verified-card__top");
    top.append(node("span", creator.displayName.replace(/^DJ\s+/i, "").charAt(0), "verified-avatar"),
      node("span", `✓ Verified · ${creator.verification}`, "verified-badge"));
    const tags = node("p", [...creator.roles, ...creator.genres, ...creator.languages].join(" · "), "profile-tags");
    card.append(top, node("h3", creator.displayName), node("p", `@${creator.handle} · ${creator.lane}`, "verified-handle"),
      node("p", creator.bio), tags,
      node("p", `${creator.bpmMin}–${creator.bpmMax} BPM · ${tierLabel(creator.orbitTier)}`),
      link("Open studio", creator.homeRoute),
      link("Signal Feed", `/signal/?creator=${encodeURIComponent(creator.handle)}`));
    return card;
  }));
  if (!creators.length) container.append(node("p", "No verified residents match this filter.", "empty-state"));
}

function focusOrbit(item) {
  const detail = byId("orbitDetail");
  detail.replaceChildren(node("p", item.tierLabel, "eyebrow"), node("h3", item.displayName),
    node("p", item.summary || item.bio || ""));
  if (item.handle) detail.append(link("View on Signal Feed", `/signal/?creator=${encodeURIComponent(item.handle)}`));
}

export function renderOrbits() {
  const mesh = byId("orbitMesh");
  if (!mesh) return;
  const audience = { id: "public-listeners", displayName: "Signal listeners", orbitTier: "public",
    summary: "Fans and listeners reacting in the Signal Feed." };
  const passes = { id: "public-passes", displayName: "Opt-in Creator Passes", orbitTier: "public",
    summary: "Members who chose public discovery. Invite them to a brief to bring them closer." };
  const layout = layoutOrbits([...SEEDED_CREATORS, audience, passes], { size: 640 });
  const defs = svg("defs");
  const glow = svg("radialGradient", { id: "orbitCore" });
  glow.append(svg("stop", { offset: "0%", "stop-color": "#f0d59f", "stop-opacity": ".55" }),
    svg("stop", { offset: "100%", "stop-color": "#d6ad69", "stop-opacity": "0" }));
  defs.append(glow);
  const rings = layout.rings.map(ring => {
    const group = svg("g", { class: `orbit-ring orbit-ring--${ring.id}` });
    group.append(svg("circle", { cx: layout.center, cy: layout.center, r: ring.radius, fill: ring.ring === 0 ? "url(#orbitCore)" : "none" }));
    const label = svg("text", { x: layout.center, y: layout.center - ring.radius - 8, "text-anchor": "middle", class: "orbit-ring-label" });
    label.textContent = ring.label.toUpperCase();
    group.append(label);
    return group;
  });
  const nodes = layout.nodes.map(item => {
    const group = svg("g", { class: `orbit-node orbit-node--${item.tier}`, tabindex: 0, role: "button",
      transform: `translate(${item.x} ${item.y})`, "aria-label": `${item.displayName}, ${item.tierLabel}` });
    group.append(svg("circle", { r: item.verified ? 26 : 18 }));
    const initial = svg("text", { "text-anchor": "middle", dy: ".35em" });
    initial.textContent = item.verified ? item.displayName.replace(/^DJ\s+/i, "").charAt(0) : "•";
    const name = svg("text", { "text-anchor": "middle", y: item.verified ? 44 : 34, class: "orbit-node-name" });
    name.textContent = item.displayName;
    group.append(initial, name);
    group.addEventListener("click", () => focusOrbit(item));
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusOrbit(item); }
    });
    return group;
  });
  mesh.replaceChildren(defs, ...rings, ...nodes);
  byId("orbitLegend").replaceChildren(...layout.rings.map(ring => {
    const item = node("li", "", `orbit-legend__item orbit-legend__item--${ring.id}`);
    item.append(node("strong", ring.label), node("span", `${ring.count} in orbit`), node("small", ring.summary));
    return item;
  }));
}

function guardianProject(form) {
  const data = Object.fromEntries(new FormData(form));
  return {
    title: data.title, artist: data.artist, bpm: Number(data.bpm), musicalKey: data.musicalKey, isrc: data.isrc,
    hasMaster: form.elements.hasMaster.checked, hasArtwork: form.elements.hasArtwork.checked,
    stems: parseStemLines(data.stems), splitPolicy: data.splitPolicy,
    splits: [{ party: data.partyA, share: Number(data.shareA) }, { party: data.partyB, share: Number(data.shareB) }]
  };
}

function checkItem(passed, label, detail) {
  const item = node("li", "", passed ? "is-pass" : "is-fail");
  item.append(node("span", passed ? "✓" : "!", "check-mark"), node("span", detail ? `${label} — ${detail}` : label));
  return item;
}

export function initGuardian(service = new HaloAIService()) {
  const form = byId("guardianForm");
  if (!form) return;
  let latest = null;
  async function run() {
    latest = await service.review(guardianProject(form));
    const { health } = latest;
    byId("guardianScore").textContent = String(health.score);
    byId("guardianGrade").textContent = `Health score · ${health.grade}`;
    byId("guardianNext").textContent = health.nextAction;
    byId("guardianChecks").replaceChildren(...health.checks.map(check => checkItem(check.passed, check.label, `${check.weight} pts`)));
    byId("guardianStems").replaceChildren(...health.stems.stems.map(stem => checkItem(stem.passed, stem.name, stem.issues.join(" "))),
      ...health.stems.issues.map(issue => checkItem(false, issue)));
    byId("guardianSplits").textContent = health.splits.passed
      ? `Verified ${health.splits.policy} split · ${health.splits.parties.map(p => `${p.party} ${p.share}%`).join(" / ")}`
      : health.splits.issues.join(" ");
    byId("guardianSplits").className = health.splits.passed ? "is-pass" : "is-fail";
    byId("councilTicket").textContent = "";
  }
  form.addEventListener("submit", event => { event.preventDefault(); run(); });
  byId("councilReview").addEventListener("click", async () => {
    if (!latest) await run();
    const { council } = latest;
    byId("councilTicket").textContent = `${council.status === "queued" ? "Queued" : "Blocked"} · ${council.id} · ${council.lanes.join(" / ")} — ${[council.message, ...council.blockers].join(" ")}`;
  });
  run();
}

renderVerifiedCreators(filterSeededCreators());
byId("publicFilters")?.addEventListener("submit", event => {
  renderVerifiedCreators(filterSeededCreators(Object.fromEntries(new FormData(event.currentTarget))));
});
renderOrbits();
initGuardian();
