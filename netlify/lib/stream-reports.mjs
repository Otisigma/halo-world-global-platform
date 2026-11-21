// Parses artist-supplied stream reports (distributor statements and Spotify for Artists /
// Apple Music for Artists exports) into per-track, per-platform, per-month totals.
// Numbers come only from the uploaded file — nothing is fetched, scraped or estimated.

export const MAX_REPORT_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 250_000;
export const MAX_AGGREGATED_LINES = 25_000;

export const REPORT_SOURCES = Object.freeze({
  distrokid: { label: "DistroKid", defaultPlatform: "" },
  tunecore: { label: "TuneCore", defaultPlatform: "" },
  cdbaby: { label: "CD Baby", defaultPlatform: "" },
  amuse: { label: "Amuse", defaultPlatform: "" },
  ditto: { label: "Ditto Music", defaultPlatform: "" },
  other_distributor: { label: "Other distributor", defaultPlatform: "" },
  spotify_for_artists: { label: "Spotify for Artists", defaultPlatform: "spotify" },
  apple_music_for_artists: { label: "Apple Music for Artists", defaultPlatform: "apple_music" }
});

export const PLATFORM_LABELS = Object.freeze({
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  amazon_music: "Amazon Music",
  tidal: "TIDAL",
  deezer: "Deezer",
  tiktok: "TikTok",
  meta: "Instagram & Facebook",
  pandora: "Pandora",
  soundcloud: "SoundCloud",
  other: "Other stores"
});

// Store names as they appear in distributor statements → HALO platform keys.
const PLATFORM_PATTERNS = [
  [/spotify/i, "spotify"],
  [/apple|itunes/i, "apple_music"],
  [/youtube|google play/i, "youtube"],
  [/amazon/i, "amazon_music"],
  [/tidal/i, "tidal"],
  [/deezer/i, "deezer"],
  [/tiktok|tik tok|resso|capcut|bytedance/i, "tiktok"],
  [/instagram|facebook|meta\b|meta platforms/i, "meta"],
  [/pandora/i, "pandora"],
  [/soundcloud/i, "soundcloud"]
];

// Column header aliases, compared after lower-casing and collapsing punctuation.
const COLUMN_ALIASES = {
  platform: ["store", "store name", "service", "dsp", "platform", "retailer", "channel", "partner", "outlet", "shop"],
  title: ["title", "song title", "track title", "track", "song", "track name", "song name", "asset title", "product title"],
  artist: ["artist", "artist name", "track artist", "primary artist", "artists"],
  isrc: ["isrc", "isrc code", "track isrc"],
  country: ["country of sale", "country", "territory", "region", "country code", "sale country"],
  month: ["sale month", "sales month", "sales period", "period", "month", "reporting period", "transaction month",
    "activity period", "usage period", "statement period", "date", "sale date", "reporting date", "day"],
  streams: ["streams", "quantity", "units", "units sold", "units sold", "unit", "plays", "total plays", "stream count",
    "quantity sold", "sales", "total streams", "play count", "count"],
  earnings: ["earnings usd", "earnings", "total earned", "net revenue", "revenue", "royalty", "royalties", "amount",
    "net earnings", "payable", "net amount", "earned", "total"],
  currency: ["currency", "currency code", "earnings currency"],
  saleType: ["sale type", "transaction type", "product type", "type", "song album", "usage type", "format"]
};

const normaliseHeader = value => String(value || "")
  .replace(/^﻿/, "")
  .toLowerCase()
  .replace(/[#()\[\]_./\\-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function detectDelimiter(headerLine) {
  const counts = [["\t", 0], [",", 0], [";", 0], ["|", 0]];
  let inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    for (const entry of counts) if (char === entry[0]) entry[1] += 1;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF, and newlines inside quotes.
export function parseDelimited(text, maxRows = MAX_DATA_ROWS + 1) {
  const source = String(text || "").replace(/^﻿/, "");
  const firstLineEnd = source.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd === -1 ? source : source.slice(0, firstLineEnd));
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      if (rows.length > maxRows) break;
      continue;
    }
    field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some(cell => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function findColumns(headerRow) {
  const headers = headerRow.map(normaliseHeader);
  const columns = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    // Exact alias match first, in alias priority order; then a header that starts with an alias.
    let found = -1;
    for (const alias of aliases) {
      found = headers.findIndex((header, index) => header === alias && !Object.values(columns).includes(index));
      if (found !== -1) break;
    }
    if (found === -1) {
      for (const alias of aliases) {
        found = headers.findIndex((header, index) => header.startsWith(`${alias} `) && !Object.values(columns).includes(index));
        if (found !== -1) break;
      }
    }
    if (found !== -1) columns[key] = found;
  }
  return columns;
}

// Accepts "1,234", "1 234", "$12.50", "(3.20)" and "12.5 USD". Returns NaN when there is no number.
export function parseNumber(value) {
  let text = String(value ?? "").trim();
  if (!text) return NaN;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text.replace(/[^0-9.,]/g, "");
  if (!text) return NaN;
  // A single comma with no dot is a decimal comma ("12,5", "0,0042") unless it looks like thousands ("1,234").
  const commaDecimal = !text.includes(".") && /^\d+,\d+$/.test(text) && (!/^\d{1,3},\d{3}$/.test(text) || text.startsWith("0,"));
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else if (commaDecimal) text = text.replace(",", ".");
  else text = text.replace(/,/g, "");
  const number = Number(text);
  if (!Number.isFinite(number)) return NaN;
  return negative ? -number : number;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function monthString(year, month) {
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return "";
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// Returns the first day of the month as YYYY-MM-01, or "" when the value isn't a recognisable date.
export function parseMonth(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let match = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/);
  if (match) return monthString(Number(match[1]), Number(match[2]));
  match = text.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
  if (match) return monthString(Number(match[1]), Number(match[2]));
  match = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (match) return monthString(Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    // Ambiguous day/month order: a first part above 12 must be the day.
    const first = Number(match[1]);
    const second = Number(match[2]);
    return monthString(Number(match[3]), first > 12 ? second : first);
  }
  match = text.match(/([a-z]{3})[a-z]*[\s,-]+(\d{4})/i) || text.match(/(\d{4})[\s,-]+([a-z]{3})/i);
  if (match) {
    const [name, year] = /^\d/.test(match[1]) ? [match[2], match[1]] : [match[1], match[2]];
    return monthString(Number(year), MONTHS[name.toLowerCase()] || 0);
  }
  return "";
}

export function platformFor(storeName, fallback = "") {
  const text = String(storeName || "").trim();
  if (!text) return fallback;
  for (const [pattern, platform] of PLATFORM_PATTERNS) if (pattern.test(text)) return platform;
  return "other";
}

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const normaliseIsrc = value => {
  const isrc = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : "";
};
const DOWNLOAD = /download|purchase|permanent|track sale|album sale/i;

/**
 * @param {string} text file contents
 * @param {{ source: string, fallbackMonth?: string }} options
 * @returns {{ error?: string, lines?: object[], stats?: object }}
 */
export function parseStreamReport(text, { source, fallbackMonth = "" } = {}) {
  const sourceInfo = REPORT_SOURCES[source];
  if (!sourceInfo) return { error: "Choose where this report came from" };
  const rows = parseDelimited(text);
  if (rows.length < 2) return { error: "The file has no data rows. Upload the CSV or TSV export, not a PDF statement." };
  if (rows.length - 1 > MAX_DATA_ROWS) return { error: `Reports can have up to ${MAX_DATA_ROWS.toLocaleString("en-GB")} rows. Split the export by month and upload each part.` };

  // Some exports put a title block above the real header; use the first row that has a play-count column.
  let headerIndex = 0;
  let columns = findColumns(rows[0]);
  for (let index = 1; index < Math.min(rows.length - 1, 10); index += 1) {
    if (columns.streams !== undefined && (columns.title !== undefined || columns.isrc !== undefined)) break;
    const candidate = findColumns(rows[index]);
    if (candidate.streams !== undefined && (candidate.title !== undefined || candidate.isrc !== undefined)) { headerIndex = index; columns = candidate; }
  }
  if (columns.streams === undefined) return { error: "Couldn't find a streams, plays or quantity column in this file." };
  if (columns.title === undefined && columns.isrc === undefined) return { error: "Couldn't find a track title or ISRC column in this file." };
  if (columns.platform === undefined && !sourceInfo.defaultPlatform) {
    return { error: "Couldn't find a store or platform column. Distributor reports need one so streams can be split by platform." };
  }

  const fallback = parseMonth(fallbackMonth);
  const groups = new Map();
  const stats = { rowsRead: 0, rowsSkipped: 0, rowsWithoutMonth: 0, currencies: new Set(), platformsSeen: new Set() };
  const cell = (row, key) => (columns[key] === undefined ? "" : row[columns[key]] ?? "");

  for (const row of rows.slice(headerIndex + 1)) {
    stats.rowsRead += 1;
    const quantity = parseNumber(cell(row, "streams"));
    const isrc = normaliseIsrc(cell(row, "isrc"));
    const title = clean(cell(row, "title"), 200);
    if (!Number.isFinite(quantity) || (!isrc && !title)) { stats.rowsSkipped += 1; continue; }
    const storeName = clean(cell(row, "platform"), 120);
    const platform = platformFor(storeName, sourceInfo.defaultPlatform);
    if (!platform) { stats.rowsSkipped += 1; continue; }
    const month = parseMonth(cell(row, "month")) || fallback;
    if (!month) stats.rowsWithoutMonth += 1;
    const country = clean(cell(row, "country"), 60).toUpperCase();
    const earnings = parseNumber(cell(row, "earnings"));
    const currency = clean(cell(row, "currency"), 3).toUpperCase() || (columns.earnings !== undefined && /usd/.test(normaliseHeader(rows[headerIndex][columns.earnings])) ? "USD" : "");
    if (currency) stats.currencies.add(currency);
    stats.platformsSeen.add(platform);
    const isDownload = DOWNLOAD.test(cell(row, "saleType")) && !/stream/i.test(cell(row, "saleType"));

    const trackKey = isrc || title.toLowerCase();
    const key = [platform, trackKey, country, month].join("\u0000");
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= MAX_AGGREGATED_LINES) return { error: "This report has too many distinct track, store, country and month combinations. Split it by month and upload each part." };
      group = { platform, storeName, isrc, trackTitle: title, artistName: clean(cell(row, "artist"), 200), country, periodMonth: month || null, streams: 0, downloads: 0, earnings: 0 };
      groups.set(key, group);
    }
    if (!group.trackTitle && title) group.trackTitle = title;
    if (isDownload) group.downloads += quantity;
    else group.streams += quantity;
    if (Number.isFinite(earnings)) group.earnings += earnings;
  }

  const lines = [...groups.values()].map(line => ({
    ...line,
    streams: Math.max(0, Math.round(line.streams)),
    downloads: Math.max(0, Math.round(line.downloads)),
    earnings: Math.round(line.earnings * 1_000_000) / 1_000_000
  }));
  if (!lines.length) return { error: "No rows in this file had a track and a play count." };

  const months = lines.map(line => line.periodMonth).filter(Boolean).sort();
  const currencies = [...stats.currencies];
  return {
    lines,
    stats: {
      rowsRead: stats.rowsRead,
      rowsSkipped: stats.rowsSkipped,
      rowsWithoutMonth: stats.rowsWithoutMonth,
      totalStreams: lines.reduce((sum, line) => sum + line.streams, 0),
      totalDownloads: lines.reduce((sum, line) => sum + line.downloads, 0),
      totalEarnings: Math.round(lines.reduce((sum, line) => sum + line.earnings, 0) * 100) / 100,
      hasEarnings: columns.earnings !== undefined,
      currency: currencies.length === 1 ? currencies[0] : currencies.length ? "MIXED" : "",
      periodStart: months[0] || null,
      periodEnd: months.at(-1) || null,
      platforms: [...stats.platformsSeen]
    }
  };
}
