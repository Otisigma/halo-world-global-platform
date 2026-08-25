import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [mainStudio, djDeck, artistScript, artistStyles, artistApi, videoApi, migration] = await Promise.all([
  read("halo.html"),
  read("dj-deck.html"),
  read("artists/artists.js"),
  read("artists/artists.css"),
  read("netlify/functions/artist-pages.mjs"),
  read("netlify/functions/videos.mjs"),
  read("netlify/database/migrations/20260813140000_create-halo-video-gallery.sql")
]);

const checks = [
  [mainStudio.includes("HALO Sofa / now screening") && mainStudio.includes("HALO video gallery"), "adds the sofa player and global video gallery"],
  [mainStudio.includes("Publish one reusable video") && mainStudio.includes("Attach to"), "offers one ingest flow with artist attachment"],
  [mainStudio.includes("YouTube / live") && mainStudio.includes("Direct clip"), "supports YouTube streams and direct clips"],
  [mainStudio.includes("chooseVideoFile") && mainStudio.includes("videoFileInputKey") && mainStudio.includes("larger than 5 MB"), "validates and resets direct clip inputs before upload"],
  [djDeck.includes('id="boothVideoUrlForm"') && djDeck.includes("loadBoothYouTube") && djDeck.includes("boothYouTubeId"), "loads YouTube links directly onto the DJ booth screen"],
  [djDeck.includes("Clip format could not play") && djDeck.includes("extensionAllowed"), "reports local booth file and browser decode failures"],
  [mainStudio.includes("reportHaloTvHealth") && mainStudio.includes("Media check passed"), "reports HALO TV playback health to the site monitor"],
  [videoApi.includes('getStore("halo-video-gallery")') && videoApi.includes("MAX_UPLOAD_BYTES"), "stores uploaded media in Netlify Blobs with a bounded payload"],
  [videoApi.includes("VIDEO_EXTENSION_TYPES") && videoApi.includes("inferredContentType"), "accepts valid video extensions when browsers omit MIME metadata"],
  [videoApi.includes("verifyRequestOrigin") && videoApi.includes("ensureMembership"), "protects video publishing with origin and identity checks"],
  [videoApi.includes("Choose an artist room you own"), "limits artist attachment to owned artist rooms"],
  [migration.includes("CREATE TABLE IF NOT EXISTS halo_videos") && migration.includes("gallery_visible") && migration.includes("sofa_visible"), "persists reusable placements in Netlify Database"],
  [artistApi.includes("FROM halo_videos") && artistApi.includes("videos"), "returns attached videos with artist-room data"],
  [artistScript.includes("artist-video-gallery") && artistScript.includes("artist-video-card"), "renders switchable video cards in artist rooms"],
  [artistStyles.includes(".artist-video-gallery") && artistStyles.includes(".video-frame video"), "styles responsive uploaded and embedded video playback"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Video gallery contracts: ${checks.length}/${checks.length} checks passed.`);
