import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseDelimited, parseMonth, parseNumber, parseStreamReport, platformFor
} from "../netlify/lib/stream-reports.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// --- Low-level parsing -------------------------------------------------------
assert.deepEqual(parseDelimited('a,b\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
assert.deepEqual(parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]], "TSV is detected from the header");
assert.deepEqual(parseDelimited("a;b\n1;2\n\n"), [["a", "b"], ["1", "2"]], "semicolon files and blank lines");
assert.equal(parseNumber("1,234"), 1234);
assert.equal(parseNumber("$12.50"), 12.5);
assert.equal(parseNumber("(3.20)"), -3.2);
assert.equal(parseNumber("0,0042"), 0.0042);
assert.equal(parseNumber("12,5"), 12.5);
assert.equal(parseNumber("1.234,56"), 1234.56);
assert.equal(parseNumber("1,234,567"), 1234567);
assert.ok(Number.isNaN(parseNumber("")));
assert.equal(parseMonth("2026-09"), "2026-09-01");
assert.equal(parseMonth("2026-09-30"), "2026-09-01");
assert.equal(parseMonth("Sep 2026"), "2026-09-01");
assert.equal(parseMonth("09/2026"), "2026-09-01");
assert.equal(parseMonth("25/09/2026"), "2026-09-01");
assert.equal(parseMonth("202609"), "2026-09-01");
assert.equal(parseMonth("not a date"), "");
assert.equal(platformFor("Spotify"), "spotify");
assert.equal(platformFor("iTunes / Apple Music"), "apple_music");
assert.equal(platformFor("TikTok"), "tiktok");
assert.equal(platformFor("Facebook / Instagram"), "meta");
assert.equal(platformFor("YouTube (Content ID)"), "youtube");
assert.equal(platformFor("Napster"), "other");
assert.equal(platformFor("", "spotify"), "spotify");

// --- DistroKid-style TSV -----------------------------------------------------
const distrokid = [
  "Reporting Date\tSale Month\tStore\tArtist\tTitle\tISRC\tUPC\tQuantity\tTeam Percentage\tSong/Album\tCountry of Sale\tSongwriter Royalties Withheld\tEarnings (USD)",
  "2026-11-01\t2026-09\tSpotify\tOwen Anthony\tHere We Go Again\tGB-ABC-26-00001\t123\t1200\t100\tSong\tGB\t0\t3.60",
  "2026-11-01\t2026-09\tSpotify\tOwen Anthony\tHere We Go Again\tGBABC2600001\t123\t300\t100\tSong\tGB\t0\t0.90",
  "2026-11-01\t2026-09\tApple Music\tOwen Anthony\tHere We Go Again\tGBABC2600001\t123\t500\t100\tSong\tUS\t0\t3.50",
  "2026-11-01\t2026-09\tTikTok\tOwen Anthony\tMorning Sun\tGBABC2600002\t123\t\"4,000\"\t100\tSong\tUS\t0\t0.40",
  "2026-11-01\t2026-10\tiTunes Downloads\tOwen Anthony\tMorning Sun\tGBABC2600002\t123\t2\t100\tDownload\tUS\t0\t1.40",
  "2026-11-01\t2026-10\tSpotify\tOwen Anthony\t\t\t123\tabc\t100\tSong\tUS\t0\t0"
].join("\n");
const dk = parseStreamReport(distrokid, { source: "distrokid" });
assert.equal(dk.error, undefined, dk.error);
assert.equal(dk.stats.rowsRead, 6);
assert.equal(dk.stats.rowsSkipped, 1, "rows with no track or play count are skipped");
assert.equal(dk.stats.totalStreams, 6000);
assert.equal(dk.stats.totalDownloads, 2, "download rows are counted separately from plays");
assert.equal(dk.stats.totalEarnings, 9.8);
assert.equal(dk.stats.currency, "USD", "USD is read from the earnings column header");
assert.equal(dk.stats.periodStart, "2026-09-01");
assert.equal(dk.stats.periodEnd, "2026-10-01");
const spotifyLine = dk.lines.find(line => line.platform === "spotify" && line.isrc === "GBABC2600001");
assert.equal(spotifyLine.streams, 1500, "rows for the same track, platform, country and month are combined; ISRC formatting is normalised");
assert.ok(dk.lines.some(line => line.platform === "tiktok" && line.streams === 4000));

// --- TuneCore-style CSV with a title block above the header ------------------
const tunecore = [
  "TuneCore Sales Report",
  "",
  "Sales Period,Posted Date,Store Name,Country Of Sale,Artist,Release Title,Song Title,ISRC,# Units Sold,Total Earned,Currency",
  "Sep 2026,2026-11-05,Amazon Music Unlimited,DE,Anna Jayne,Quiet,Carved Our Own Quiet Space,,250,1.10,EUR",
  "Sep 2026,2026-11-05,Deezer,FR,Anna Jayne,Quiet,Carved Our Own Quiet Space,,100,0.40,EUR"
].join("\n");
const tc = parseStreamReport(tunecore, { source: "tunecore" });
assert.equal(tc.error, undefined, tc.error);
assert.equal(tc.stats.totalStreams, 350);
assert.equal(tc.stats.currency, "EUR");
assert.deepEqual(tc.stats.platforms.sort(), ["amazon_music", "deezer"]);
assert.equal(tc.lines[0].trackTitle, "Carved Our Own Quiet Space", "the song title is used rather than the release title");

// --- Spotify for Artists export without a store or date column ---------------
const s4a = "song,listeners,streams,saves,release_date\nHere We Go Again,800,2400,90,2026-06-01\nMorning Sun,10,25,1,2026-01-01";
const sp = parseStreamReport(s4a, { source: "spotify_for_artists", fallbackMonth: "2026-10" });
assert.equal(sp.error, undefined, sp.error);
assert.equal(sp.stats.totalStreams, 2425);
assert.deepEqual(sp.stats.platforms, ["spotify"]);
assert.equal(sp.stats.periodStart, "2026-10-01", "the chosen month is used when the export has no period column");

// --- Rejections ----------------------------------------------------------------
assert.match(parseStreamReport("Title,Quantity\nA,1", { source: "distrokid" }).error, /store or platform column/);
assert.match(parseStreamReport("Store,Title\nSpotify,A", { source: "distrokid" }).error, /streams, plays or quantity/);
assert.match(parseStreamReport("Store,Title,Quantity", { source: "distrokid" }).error, /no data rows/);
assert.match(parseStreamReport("a,b\n1,2", { source: "made_up" }).error, /where this report came from/);

// --- API and page wiring -------------------------------------------------------
const [api, migration, page, script] = await Promise.all([
  read("netlify/functions/stream-reports.mjs"),
  read("netlify/database/migrations/20261121060000_create_stream_reports.sql"),
  read("stream-reports/index.html"),
  read("stream-reports/stream-reports.js")
]);
assert.match(api, /path: "\/api\/stream-reports"/);
assert.match(api, /if \(!user\?\.id\) return json\(\{ message: "Sign in/, "reports require sign-in");
assert.match(api, /verifyRequestOrigin\(request\)/, "uploads and deletes check the request origin");
assert.match(api, /WHERE id = \$\{id\} AND member_id = \$\{memberId\}/, "artists can only delete their own reports");
assert.match(api, /file_sha256 = \$\{sha256\}/, "the same file is never imported twice");
assert.match(api, /period_start <= .* AND period_end >=/, "overlapping reports from the same source are refused");
assert.doesNotMatch(api, /fetch\(/, "no outside platform is fetched or crawled");
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS halo_stream_reports_member_file_idx/);
assert.match(migration, /ON DELETE CASCADE/);
assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE)\s/im, "the migration never removes data");
assert.match(page, /src="\/stream-reports\/stream-reports\.js"/);
assert.match(page, /never added to the totals above/, "dashboard exports are kept apart from distributor totals");
assert.doesNotMatch(script, /innerHTML/, "report contents are rendered as text only");

console.log("stream report contracts passed");
