import { CATALOG_ENDPOINT, fetchCatalog, createPreview, rankPreview, exportSnapshot, exportCSV } from "./catalog-data.js";

const releases = document.getElementById("releases");
const dashboard = document.getElementById("dashboard");
const metrics = document.getElementById("metrics");
const creatorMetrics = document.getElementById("creator-metrics");
const trackRows = document.getElementById("track-rows");
const status = document.getElementById("status");
const search = document.getElementById("search");
const refresh = document.getElementById("refresh");
const palette = document.getElementById("palette");
const sort = document.getElementById("sort");
const summary = document.getElementById("summary");
const source = document.getElementById("source");
const inventory = document.getElementById("inventory");
const nomination = document.getElementById("nomination");
const nominate = document.getElementById("nominate");
const clearNomination = document.getElementById("clear-nomination");
const draft = document.getElementById("draft");
const reset = document.getElementById("reset");
const jsonButton = document.getElementById("export-json");
const csvButton = document.getElementById("export-csv");
const preview = createPreview();
let catalog = [];
let loading = false;
let unavailable = false;
let fetchedAt = "";
const metric = value => value === null ? "Not reported" : String(value);

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function snapshotTotal(rows, key) {
  if (rows.length === 0) return "0";
  const reported = rows.filter(row => row[key] !== null);
  if (reported.length === 0) return "Not reported";
  const total = reported.reduce((sum, row) => sum + row[key], 0);
  return `${total}${reported.length < rows.length ? ` (${reported.length}/${rows.length} entries reporting)` : ""}`;
}

function renderDashboard(artistNames) {
  metrics.replaceChildren();
  creatorMetrics.replaceChildren();
  trackRows.replaceChildren();
  const addMetric = (label, value, detail) => {
    const card = element("article", "metric-card", "");
    card.append(element("h3", "", label), element("p", "metric-value", value), element("p", "metadata", detail));
    metrics.append(card);
  };
  const addCreatorMetric = (label, value, provenance) => {
    const row = element("tr", "", "");
    const heading = element("th", "", label);
    heading.scope = "row";
    row.append(heading, element("td", "", value), element("td", "", provenance));
    creatorMetrics.append(row);
  };
  addMetric("Returned snapshot entries", String(catalog.length), "Public chart entries in this response; the endpoint returns up to 50.");
  addMetric("Distinct listed artist names", String(artistNames.size), "Unique public artist-name strings in this snapshot, not creator accounts.");
  addMetric("Public chart votes", snapshotTotal(catalog, "votes"), "Sum of reported public votes across returned entries; not user or adoption totals.");
  addMetric("Creator accounts / adoption", "Not reported", "No public creator-account or adoption aggregate is included in this snapshot.");
  addCreatorMetric("Distinct listed artist names", String(artistNames.size),
    `Unique non-placeholder artist names across ${catalog.length} returned snapshot entries; not a count of people or accounts.`);
  addCreatorMetric("Creator accounts / adoption", "Not reported",
    "Account-level membership and adoption data are not included or queried by this public satellite.");
  addCreatorMetric("Rights / ownership models", "Not reported",
    "No verified public rights-model aggregate is provided; no legal or ownership tier is inferred.");

  if (catalog.length === 0) {
    const row = element("tr", "", "");
    const cell = element("td", "", "No public chart entries in this snapshot.");
    cell.colSpan = 6;
    row.append(cell);
    trackRows.append(row);
    return;
  }
  for (const release of catalog) {
    const row = element("tr", "", "");
    const heading = element("th", "", release.title);
    heading.scope = "row";
    row.append(heading, element("td", "", release.artist),
      element("td", "", "Not reported — no verified public rights model."),
      element("td", "", ""), element("td", "", "Not reported — event and time-window labels are absent."));
    const destination = row.children[3];
    if (release.distributorDestination) {
      const link = element("a", "", "Open public distributor destination");
      link.href = release.distributorDestination;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      destination.append(link);
    } else {
      destination.textContent = "Not reported — no validated public destination in the snapshot.";
    }
    row.append(element("td", "", "Published chart entry"));
    trackRows.append(row);
  }
}

function render(focusId) {
  if (loading || unavailable) return;
  const query = search.value.trim().toLowerCase();
  const ranked = rankPreview(catalog, preview, sort.value);
  const visible = ranked.filter(row => [row.title, row.artist, ...row.genres]
    .some(value => value.toLowerCase().includes(query)));
  releases.replaceChildren();
  for (const row of visible) {
    const card = element("article", "release", "");
    const seed = [...row.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3;
    const visual = element("div", `visual visual-${seed}`, "HALO");
    visual.setAttribute("aria-hidden", "true");
    card.append(element("p", "rank", `Preview #${row.previewRank} · Public #${metric(row.publicRank)}`),
      visual, element("h3", "", row.title), element("p", "artist", row.artist));
    card.append(element("p", "metadata", row.genres.join(" / ") || "Genre not listed"));
    card.append(element("p", "metadata", row.releaseDate || "Release date not listed"));
    card.append(element("p", "metadata", `Public votes: ${metric(row.votes)} · Preview total: ${metric(row.previewVotes)}`));
    card.append(element("p", "metadata", `Public signal: ${metric(row.signalScore)} · Preview signal: ${metric(row.previewSignal)}`));
    card.append(element("p", "metadata", "Recorded outbound clicks and kit opens: Not reported — event and time-window labels are absent from this snapshot."));
    const vote = element("button", "vote", row.previewVote ? "Remove preview vote" : "Add preview vote");
    vote.type = "button";
    vote.disabled = row.votes === null || row.signalScore === null;
    vote.setAttribute("aria-pressed", String(row.previewVote));
    vote.setAttribute("aria-label", `${vote.textContent}: ${row.title} — ${row.artist}`);
    vote.addEventListener("click", () => {
      preview.toggleVote(catalog, row.id);
      render(row.id);
    });
    card.append(vote);
    card.append(element("p", "study-label", "Local visual study · not official artwork"));
    releases.append(card);
    if (row.id === focusId) vote.focus();
  }
  inventory.replaceChildren();
  for (const row of ranked) {
    const tr = element("tr", "", "");
    for (const value of [`${row.previewRank} / ${metric(row.publicRank)}`, `${row.title} — ${row.artist}`,
      row.genres.join(" / ") || "Not listed", row.releaseDate || "Not listed",
      `${metric(row.votes)} / ${metric(row.previewVotes)}`, preview.nomination() === row.id ? "Draft only" : "—"]) {
      tr.append(element("td", "", value));
    }
    inventory.append(tr);
  }
  const artistNames = new Set(catalog.map(row => row.artist).filter(name => name && name !== "Unknown artist"));
  const publicRanks = catalog.map(row => row.publicRank).filter(value => value !== null);
  summary.textContent = catalog.length
    ? `${catalog.length} returned chart entries · ${artistNames.size} distinct listed artist names · ${snapshotTotal(catalog, "votes")} public chart votes · Recorded outbound clicks and kit opens: Not reported because event/time-window labels are absent · Best public rank: ${publicRanks.length ? Math.min(...publicRanks) : "Not reported"} · ${ranked.filter(row => row.previewVote).length} preview votes`
    : "No public chart entries in this snapshot.";
  renderDashboard(artistNames);
  const selected = catalog.find(row => row.id === preview.nomination());
  draft.textContent = selected
    ? `Unsaved nomination draft: ${selected.title} — ${selected.artist}. Not submitted / no artist verification in this satellite.`
    : "No unsaved nomination draft.";
  clearNomination.disabled = !selected;
  reset.disabled = catalog.length === 0;
  jsonButton.disabled = csvButton.disabled = catalog.length === 0;
  status.textContent = catalog.length === 0
    ? "No public chart entries are available yet."
    : visible.length === 0 ? "No releases match your search."
      : `${visible.length} of ${catalog.length} public entries · preview votes — not submitted to HALO`;
}

async function load() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  search.disabled = true;
  sort.disabled = true;
  nomination.disabled = nominate.disabled = clearNomination.disabled = true;
  reset.disabled = jsonButton.disabled = csvButton.disabled = true;
  dashboard.setAttribute("aria-busy", "true");
  preview.clear();
  catalog = [];
  fetchedAt = "";
  nomination.replaceChildren(element("option", "", "Choose a track"));
  nomination.children[0].value = "";
  nomination.value = "";
  inventory.replaceChildren();
  metrics.replaceChildren();
  creatorMetrics.replaceChildren();
  trackRows.replaceChildren();
  summary.textContent = "No public snapshot loaded.";
  draft.textContent = "No unsaved nomination draft.";
  source.textContent = `Source: ${CATALOG_ENDPOINT} · Fetching; previous preview cleared`;
  releases.setAttribute("aria-busy", "true");
  releases.replaceChildren();
  status.textContent = "Connecting to the public chart…";
  try {
    catalog = await fetchCatalog();
    fetchedAt = new Date().toISOString();
    source.textContent = `Source: ${CATALOG_ENDPOINT} · Fetched ${fetchedAt} · Public signal snapshot`;
    for (const row of catalog) {
      const option = element("option", "", `${row.title} — ${row.artist}`);
      option.value = row.id;
      nomination.append(option);
    }
    nomination.disabled = catalog.length === 0;
    unavailable = false;
    loading = false;
    render();
  } catch {
    catalog = [];
    unavailable = true;
    source.textContent = `Source: ${CATALOG_ENDPOINT} · No current snapshot`;
    status.textContent = "Public chart unavailable. Core is unchanged. Use Refresh to try again.";
  } finally {
    loading = false;
    refresh.disabled = false;
    search.disabled = false;
    sort.disabled = false;
    releases.setAttribute("aria-busy", "false");
    dashboard.setAttribute("aria-busy", "false");
  }
}

search.addEventListener("input", render);
sort.addEventListener("change", render);
refresh.addEventListener("click", load);
nomination.addEventListener("change", () => {
  nominate.disabled = loading || unavailable || !catalog.some(row => row.id === nomination.value);
});
nominate.addEventListener("click", () => {
  preview.nominate(catalog, nomination.value);
  render();
});
clearNomination.addEventListener("click", () => {
  preview.nominate(catalog, "");
  render();
});
reset.addEventListener("click", () => {
  preview.clear();
  nomination.value = "";
  nominate.disabled = true;
  render();
});

function download(format) {
  if (loading || unavailable || !catalog.length) return;
  const snapshot = exportSnapshot(catalog, preview, sort.value, fetchedAt);
  const content = format === "csv" ? exportCSV(snapshot) : JSON.stringify(snapshot, null, 2);
  let url;
  let link;
  try {
    url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
    link = element("a", "", "");
    link.href = url;
    link.download = `halo-chart-preview.${format}`;
    document.body.append(link);
    link.click();
  } catch {
    status.textContent = "Download unavailable. Try again in a browser that supports file downloads.";
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
jsonButton.addEventListener("click", () => download("json"));
csvButton.addEventListener("click", () => download("csv"));
palette.addEventListener("change", () => {
  document.body.className = ["aurora", "ember", "mono"].includes(palette.value) ? palette.value : "aurora";
});
load();
