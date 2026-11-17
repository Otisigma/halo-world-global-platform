import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/playlist-art-guide.mjs <existing-output-directory>");
const output = resolve(process.argv[2]);
const escape = text => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const css = await readFile(join(root, "music/playlist-studio.css"), "utf8");
const helper = await readFile(join(root, "music/playlist-track-preview.js"), "utf8");
const sections = [
  ["HALO Music World / Playlist artwork", "Implementation guide for Music World and Obsidian-compatible playlists. Generated from the current source, not a text-only template."],
  ["Integration", "Local, account/shared and Dreamweaver proposal tracklists use createPlaylistTrackPreview. Native buttons support click, Enter and Space. Selection starts at the chosen song and continues in order with content controls, repeat and mix settings. Editing controls remain separate."],
  ["Artwork and privacy", "The existing release-artwork resolver selects covers. Only HTTP(S) URLs without credentials are allowed. Missing or failed images show the labelled HALO placeholder. Unavailable songs reveal no artwork. Titles and artists use textContent, not HTML interpolation."],
  ["Thumbnail CSS", css.split("\n").filter(line => /playlist-track-|prefers-reduced-motion/.test(line)).join("\n")],
  ["Rendering helper / music/playlist-track-preview.js", helper],
  ["Local Signal rewards", "Optional browser-local progress qualifies a UTC day after 30 seconds of foreground, unmuted playback. Three and seven day streaks and 60 minutes unlock cosmetic panel palettes only. Local records are editable, resettable and not verified listening or cryptographic proof. No private recording, stem, account credit or giveaway entry is unlocked. Genuine giveaways need published eligibility rules and server-validated, single-use claims."],
  ["Verification", "Run npm run test:playlists and npm run build. Automated tests cover artwork fallback, safe text, selection, queue continuation, content filters, local streaks and playback counting. These checks do not establish live audible quality or production deployment."]
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HALO Playlist Artwork Guide</title><style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:24px;color:#e2e8f0;background:#0f172a}h1,h2{color:#7dd3fc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1e293b;padding:18px;border-radius:8px}@media print{body{color:#111;background:white}pre{background:#eee}}</style><h1>HALO Playlist Artwork Guide</h1>${sections.map(([title, text]) => `<h2>${escape(title)}</h2><${title.includes("CSS") || title.includes("helper") ? "pre" : "p"}>${escape(text)}</${title.includes("CSS") || title.includes("helper") ? "pre" : "p"}>`).join("")}</html>`;
const pdf = await PDFDocument.create();
pdf.setTitle("HALO Playlist Artwork / Implementation Guide");
const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let page, y;
const newPage = () => {
  page = pdf.addPage([595.28, 841.89]); y = 785;
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(.06, .09, .16) });
  page.drawText(`HALO Music World / ${pdf.getPageCount()}`, { x: 45, y: 28, size: 9, font, color: rgb(.58, .65, .74) });
};
newPage();
for (const [title, text] of sections) {
  if (y < 110) newPage();
  page.drawText(title, { x: 45, y, font: bold, size: 13, color: rgb(.49, .83, .99) }); y -= 25;
  for (const raw of text.split("\n")) {
    let remaining = raw;
    do {
      let end = remaining.length;
      while (end > 0 && font.widthOfTextAtSize(remaining.slice(0, end), 9) > 500) end--;
      if (y < 60) newPage();
      page.drawText(remaining.slice(0, end), { x: 45, y, size: 9, font, color: rgb(.88, .91, .94) });
      y -= 14; remaining = remaining.slice(end);
    } while (remaining);
  }
  y -= 18;
}
await writeFile(join(output, "halo_playlist_art_spec.html"), html);
await writeFile(join(output, "halo_playlist_art_spec.pdf"), await pdf.save());
console.log(`Generated artwork guide HTML and ${pdf.getPageCount()}-page PDF in ${output}`);
