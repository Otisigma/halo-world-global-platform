import { CATALOG_ENDPOINT, fetchCatalog, createPreview, rankPreview, exportSnapshot, exportCSV } from "./catalog-data.js";

const releases = document.getElementById("releases");
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
    card.append(element("p", "metadata", `7-day listen clicks: ${metric(row.recentListens)} · Kit opens: ${metric(row.recentOpens)}`));
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
  const total = key => {
    const reported = catalog.filter(row => row[key] !== null);
    return `${reported.reduce((sum, row) => sum + row[key], 0)}${reported.length < catalog.length ? ` (${reported.length}/${catalog.length} entries reporting)` : ""}`;
  };
  const publicRanks = catalog.map(row => row.publicRank).filter(value => value !== null);
  summary.textContent = catalog.length
    ? `${catalog.length} chart entries · ${new Set(catalog.map(row => row.artist)).size} listed artist names · ${total("votes")} public votes · ${total("recentListens")} seven-day listen clicks · ${total("recentOpens")} kit opens · Best public rank: ${publicRanks.length ? Math.min(...publicRanks) : "Not reported"} · ${ranked.filter(row => row.previewVote).length} preview votes`
    : "No public chart entries in this snapshot.";
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
  preview.clear();
  catalog = [];
  fetchedAt = "";
  nomination.replaceChildren(element("option", "", "Choose a track"));
  nomination.children[0].value = "";
  nomination.value = "";
  inventory.replaceChildren();
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
