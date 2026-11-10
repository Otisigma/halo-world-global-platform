import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reports } from "../reports/report-data.js";

const [page, studio, magazine, magazineScript, haloPage] = await Promise.all([
  readFile(new URL("../reports/index.html", import.meta.url), "utf8"),
  readFile(new URL("../reports/report-studio.js", import.meta.url), "utf8"),
  readFile(new URL("../magazine.html", import.meta.url), "utf8"),
  readFile(new URL("../magazine.js", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8")
]);

assert.equal(reports.length, 2);
assert.equal(new Set(reports.map(report => report.id)).size, reports.length);
for (const report of reports) {
  assert.match(report.id, /^HALO-TECH-\d{3}$/);
  assert.ok(report.slug && report.title && report.subtitle && report.summary && report.status);
  assert.ok(report.sections.length >= 3);
  assert.ok(report.sources.length && report.limitations.length);
  for (const section of report.sections) {
    assert.ok(section.heading && section.paragraphs.length);
  }
  for (const source of report.sources) assert.match(source.url, /^(\/docs\/|https:\/\/github\.com\/)/);
}
assert.ok(reports[0].sections.some(section => section.paragraphs.join(" ").includes("recreate the original DAW folder layout")));
assert.ok(reports[0].sections.some(section => section.paragraphs.join(" ").includes("human declaration")));
assert.ok(reports[0].sections.some(section => section.paragraphs.join(" ").includes("200 MiB") && section.paragraphs.join(" ").includes("2 GiB")));
assert.ok(reports[1].sections.some(section => section.paragraphs.join(" ").includes("not a public certification badge")));
assert.ok(reports[1].sections.some(section => section.paragraphs.join(" ").includes("one-read-per-owner-per-minute")));
assert.ok(reports[1].sections.some(section => section.paragraphs.join(" ").includes("100 MiB")));
assert.match(page, /Print \/ save PDF/);
assert.match(page, /Download report JSON/);
assert.match(page, /Share report/);
assert.match(page, /\/music\//);
assert.match(page, /\/magazine\.html/);
assert.match(page, /\/song-catalog\//);
assert.match(studio, /createObjectURL/);
assert.match(studio, /navigator\.share/);
assert.match(studio, /textContent/);
assert.doesNotMatch(studio, /innerHTML|GoogleGenAI|API_KEY|generateContent/);
for (const id of ["halo-project-handover", "halo-master-observation"]) {
  assert.ok(magazine.includes(`data-open-article="${id}"`));
  assert.ok(magazineScript.includes(`"${id}"`));
}
assert.match(magazine, /href="\/reports\/"/);
assert.match(magazine, /href="\/music\/">Listen &amp; shop releases/);
assert.match(haloPage, /href="\/magazine\.html"/);

console.log(`Editorial studio contracts passed: ${reports.length} sourced, bounded reports and magazine links.`);
