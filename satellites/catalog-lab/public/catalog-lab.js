import { fetchCatalog } from "./catalog-data.js";

const releases = document.getElementById("releases");
const status = document.getElementById("status");
const search = document.getElementById("search");
const refresh = document.getElementById("refresh");
const palette = document.getElementById("palette");
let catalog = [];
let loading = false;
let unavailable = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function render() {
  if (loading || unavailable) return;
  const query = search.value.trim().toLowerCase();
  const visible = catalog.filter(row => [row.title, row.artist, ...row.genres]
    .some(value => value.toLowerCase().includes(query)));
  releases.replaceChildren();
  for (const row of visible) {
    const card = element("article", "release", "");
    const seed = [...row.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3;
    const visual = element("div", `visual visual-${seed}`, "HALO");
    visual.setAttribute("aria-hidden", "true");
    card.append(visual, element("h2", "", row.title), element("p", "artist", row.artist));
    card.append(element("p", "metadata", row.genres.join(" / ") || "Genre not listed"));
    card.append(element("p", "metadata", row.releaseDate || "Release date not listed"));
    card.append(element("p", "metadata", row.isrc ? `ISRC ${row.isrc}` : "ISRC not listed"));
    card.append(element("p", "study-label", "Local visual study · not official artwork"));
    releases.append(card);
  }
  status.textContent = catalog.length === 0
    ? "No public releases are available yet."
    : visible.length === 0 ? "No releases match your search."
      : `${visible.length} public release${visible.length === 1 ? "" : "s"} · read-only preview`;
}

async function load() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  search.disabled = true;
  releases.setAttribute("aria-busy", "true");
  releases.replaceChildren();
  status.textContent = "Connecting to the public catalog…";
  try {
    catalog = await fetchCatalog();
    unavailable = false;
    loading = false;
    render();
  } catch {
    catalog = [];
    unavailable = true;
    status.textContent = "Public catalog unavailable. Core is unchanged. Use Refresh to try again.";
  } finally {
    loading = false;
    refresh.disabled = false;
    search.disabled = false;
    releases.setAttribute("aria-busy", "false");
  }
}

search.addEventListener("input", render);
refresh.addEventListener("click", load);
palette.addEventListener("change", () => {
  document.body.className = ["aurora", "ember", "mono"].includes(palette.value) ? palette.value : "aurora";
});
load();
