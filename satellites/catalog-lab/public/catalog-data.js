export const CATALOG_ENDPOINT = "https://halo-world-global-platform.netlify.app/api/catalog/chart";

const text = value => typeof value === "string" ? value.trim().slice(0, 300) : "";
const count = value => typeof value === "number" && Number.isFinite(value) && value >= 0
  ? Math.min(Math.floor(value), 1e12) : null;

export function validateDistributorDestination(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 500 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    const hosts = ["distrokid.com", "hyperfollow.com", "ffm.to", "lnk.to", "found.ee", "linktr.ee"];
    const host = url.hostname.toLowerCase();
    if (!/^https:\/\//i.test(raw) || url.protocol !== "https:" || url.username || url.password || url.port
      || /^https:\/\/[^/?#]*:/i.test(raw)
      || !hosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))
      || ((host === "distrokid.com" || host.endsWith(".distrokid.com")) && !url.pathname.startsWith("/hyperfollow/"))) return "";
    return url.href.length <= 500 ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeCatalog(payload) {
  if (!payload || !Array.isArray(payload.releases)) {
    throw new Error("Invalid public chart response");
  }
  const seen = new Set();
  // This fixed endpoint enforces eligibility server-side but does not serialize that flag.
  return Object.freeze(payload.releases
    .filter(row => {
      if (!row || typeof row !== "object" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text(row.id))
        || text(row.id).length > 96 || row.status !== "published"
        || (row.isChartEligible !== undefined && row.isChartEligible !== true)
        || (row.isLiveVisible !== undefined && row.isLiveVisible !== true)
        || seen.has(text(row.id))) return false;
      seen.add(text(row.id));
      return true;
    })
    .slice(0, 50)
    .map(row => {
      const date = text(row.releaseDate);
      return Object.freeze({
        id: text(row.id),
        title: text(row.title) || "Untitled release",
        artist: text(row.artist) || "Unknown artist",
        genres: Object.freeze(Array.isArray(row.genres) ? row.genres.map(text).filter(Boolean).slice(0, 5) : []),
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date)
          && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : "",
        publicRank: count(row.rank) > 0 ? count(row.rank) : null,
        votes: count(row.votes),
        signalScore: count(row.signalScore),
        recentListens: count(row.chartActivity?.recentListens),
        recentOpens: count(row.chartActivity?.recentOpens),
        distributorDestination: row.status === "published" && row.isLiveVisible === true
          ? validateDistributorDestination(row.distributionUrl) : ""
      });
    }));
}

export async function fetchCatalog(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(CATALOG_ENDPOINT, {
    method: "GET",
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok || response.redirected) throw new Error("Public chart unavailable");
  return normalizeCatalog(await response.json());
}

export function createPreview() {
  const votes = new Set();
  let nomination = null;
  return {
    hasVote: id => votes.has(id),
    toggleVote(rows, id) {
      if (!rows.some(row => row.id === id && row.votes !== null && row.signalScore !== null)) return false;
      if (votes.has(id)) votes.delete(id);
      else votes.add(id);
      return true;
    },
    nominate(rows, id) {
      nomination = rows.some(row => row.id === id) ? id : null;
    },
    nomination: () => nomination,
    clear() { votes.clear(); nomination = null; }
  };
}

export function rankPreview(rows, preview, sort = "signal") {
  const metrics = sort === "votes" ? ["previewVotes", "previewSignal", "releaseDate"]
    : sort === "newest" ? ["releaseDate", "previewSignal", "previewVotes"]
      : ["previewSignal", "previewVotes", "releaseDate"];
  return rows.map(row => ({
    ...row,
    previewVote: preview.hasVote(row.id),
    previewVotes: row.votes === null ? null : row.votes + Number(preview.hasVote(row.id)),
    previewSignal: row.signalScore === null ? null : row.signalScore + 5 * Number(preview.hasVote(row.id))
  })).sort((a, b) => {
    for (const metric of metrics) {
      const av = a[metric];
      const bv = b[metric];
      if (av === bv) continue;
      if (av === null || av === "") return 1;
      if (bv === null || bv === "") return -1;
      return av < bv ? 1 : -1;
    }
    return a.id.localeCompare(b.id);
  }).map((row, index) => ({ ...row, previewRank: index + 1 }));
}

export function exportSnapshot(rows, preview, sort, fetchedAt) {
  return {
    source: CATALOG_ENDPOINT,
    fetchedAt,
    scope: "Public chart snapshot only; preview votes — not submitted to HALO; nomination not submitted / no artist verification in this satellite",
    sort: ["signal", "votes", "newest"].includes(sort) ? sort : "signal",
    releases: rankPreview(rows, preview, sort).map(row => ({
      id: row.id, title: row.title, artist: row.artist, genres: [...row.genres],
      releaseDate: row.releaseDate, publicRank: row.publicRank, votes: row.votes,
      signalScore: row.signalScore, recentListens: row.recentListens, recentOpens: row.recentOpens,
      previewRank: row.previewRank, previewVote: row.previewVote,
      previewVotes: row.previewVotes, previewSignal: row.previewSignal,
      unsavedNomination: preview.nomination() === row.id
    }))
  };
}

export function csvCell(value) {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/u.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

export function exportCSV(snapshot) {
  const keys = ["id", "title", "artist", "genres", "releaseDate", "publicRank", "votes",
    "signalScore", "recentListens", "recentOpens", "previewRank", "previewVote",
    "previewVotes", "previewSignal", "unsavedNomination"];
  const headers = [...keys, "source", "fetchedAt", "scope", "sort"];
  return [headers.map(csvCell).join(","), ...snapshot.releases.map(row =>
    [...keys.map(key => key === "genres" ? row.genres.join(" / ") : row[key]),
      snapshot.source, snapshot.fetchedAt, snapshot.scope, snapshot.sort].map(csvCell).join(",")
  )].join("\r\n");
}
