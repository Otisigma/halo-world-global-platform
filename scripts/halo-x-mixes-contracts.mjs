import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [page, script, styles, halo, radio, deck, api, paymentLink, migration, uploadMigration, readinessMigration, reviewApi, uploadHelper] = await Promise.all([
  readFile(resolve(root, "mixes/index.html"), "utf8"),
  readFile(resolve(root, "mixes/mixes.js"), "utf8"),
  readFile(resolve(root, "mixes/mixes.css"), "utf8"),
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "radio/index.html"), "utf8"),
  readFile(resolve(root, "dj-deck.html"), "utf8"),
  readFile(resolve(root, "netlify/functions/mixes.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/payment-link.mjs"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260818120000_connect-mixes-to-sales.sql"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260818150000_create-mix-upload-desk.sql"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260818190000_require-paid-mix-readiness.sql"), "utf8"),
  readFile(resolve(root, "netlify/functions/mix-reviews.mjs"), "utf8"),
  readFile(resolve(root, "upload-progress.js"), "utf8")
]);

const checks = [
  [page.includes("DJ HALO X presents") && page.includes("Road to the Worlds"), "establishes the Inside the Mix series and first-season identity"],
  [page.includes("Watch the series") && page.includes("HALO Mix Cloud") && page.includes("OWN THE"), "connects watch, stream, and edition actions"],
  [page.includes("permission to distribute") && page.includes("authorized streams"), "states the rights boundary for downloadable editions"],
  [script.includes('/api/mixes?limit=12&station=longplay') && script.includes('/api/videos'), "loads the existing mix and HALO TV catalogs"],
  [script.includes('/api/payment-link') && script.includes("checkoutUrl"), "uses the existing secure checkout destination"],
  [page.includes('id="mixUploadForm"') && page.includes('name="productionRoute"') && page.includes('name="rightsAttested"'), "provides a designated authenticated creator upload desk"],
  [page.includes('name="clientSaleEnabled" type="checkbox"') && !page.includes('name="clientSaleEnabled" type="checkbox" checked'), "keeps ordinary uploads available without forcing paid-edition requirements"],
  [script.includes('uploadSource: "creator_desk"') && script.includes("clientSaleEnabled") && script.includes("audioDuration"), "uploads creator audio with sales and production choices"],
  [script.includes("uploadAudioAsset(file, \"master\",") && (script.includes("mixUploadProgress.firstElementChild.style.width") || script.includes("mixUploadUi.progress")) && script.includes("uploadHelper.uploadChunkedFile"), "keeps the DJ upload desk progress bar live while chunks upload"],
  [script.includes("data-delete-mix") && script.includes("deleteMix(") && api.includes('payload.action === "delete"') && api.includes("DELETE FROM halo_mixes") && api.includes("member_id = ${membership.member_id}"), "allows only the owning artist to delete uploaded mixes and stored audio"],
  [script.includes('"audio/mp3": "audio/mpeg"') && script.includes('"video/mp4": "audio/mp4"') && api.includes("normalizeAudioContentType"), "normalizes browser-specific audio MIME types on both sides of the upload"],
  [script.includes("salesStatus") && script.includes("data-mix-artwork") && script.includes("renderEdition"), "keeps remix artwork visible and reflects the mastering and rights gate"],
  [page.includes('/upload-progress.js') && script.includes("uploadHelper.uploadChunkedFile") && script.includes("mixUploadUi"), "uses the shared upload helper to show live mix upload progress"],
  [api.includes("halo_mix_release_plans") && api.includes("salesPageUrl") && api.includes('uploadSource === "creator_desk"'), "creates the remix mastering brief and stable sales-page handoff automatically"],
  [api.includes('productionRoute === "halo_mixed"') && api.includes("rightsAttested"), "separates creator-finished remixes from the HALO mixing package"],
  [paymentLink.includes("STRIPE_CREATOR_MIX_PAYMENT_LINK_URL") && paymentLink.includes("STRIPE_HALO_MIX_PAYMENT_LINK_URL") && paymentLink.includes("client_reference_id"), "routes cleared mixes to the appropriate Stripe payment link"],
  [paymentLink.includes("STRIPE_SECRET_KEY") && paymentLink.includes("price_data") && paymentLink.includes("rights_clearance_status"), "creates price-specific Stripe Checkout sessions behind server-enforced readiness gates"],
  [page.includes("Paid edition information") && page.includes('name="price"') && page.includes('id="editionReadiness"'), "collects a price and explains every paid-mix prerequisite"],
  [script.includes("Approved master") && script.includes("Complete product information") && script.includes("Confirmed rights or clearances"), "shows the live paid-mix readiness checklist"],
  [readinessMigration.includes("product_info_complete") && readinessMigration.includes("master_approved") && readinessMigration.includes("rights_clearance_status"), "persists all paid-mix readiness decisions"],
  [reviewApi.includes("rights_credits") && reviewApi.includes("release_readiness") && reviewApi.includes("sale_ready"), "turns final quality approval into a synchronized commerce decision"],
  [migration.includes("artwork_url") && migration.includes("sales_status") && migration.includes("halo_mix_release_plans_mix_idx"), "persists remix artwork, credits, and sales state"],
  [uploadMigration.includes("production_route") && uploadMigration.includes("client_sale_enabled") && uploadMigration.includes("mixing_fee_included"), "persists creator sales and mixing-package choices"],
  [script.includes("state.playlistIndex += 1") && script.includes('audio.addEventListener("ended"'), "plays the complete generated takeover queue"],
  [script.includes("episode-empty") && script.includes("mix-empty") && script.includes("Promise.allSettled"), "keeps useful empty and partial-failure states"],
  [styles.includes("prefers-reduced-motion") && styles.includes("@media (max-width: 680px)"), "supports reduced motion and narrow screens"],
  [halo.includes('href="/mixes/"') && radio.includes('href="/mixes/"') && deck.includes('href="/mixes/"'), "links the destination from the world, radio, and DJ deck"],
  [deck.includes('id="mixOperations"') && deck.includes("Mix upload desk") && deck.includes("Original comparison") && deck.includes("Visual mix studio") && deck.includes("Quality room") && deck.includes("Paid mix readiness") && deck.includes("Mix cloud"), "keeps the complete mix operations rack on the DJ desk"],
  [deck.includes('href="/mixes/#upload"') && deck.includes('href="/mixes/#visual-studio"') && deck.includes('href="/mixes/#quality"') && deck.includes('href="/mixes/#editions"') && deck.includes('href="/mixes/#library"'), "connects every rack operation to its Mixes workspace"],
  [deck.includes('{ id: "mixOperations", label: "Mix operations rack" }') && deck.includes('id="packageFocusMode"') && deck.includes("[elements.focusMode, elements.packageFocusMode]"), "keeps the rack collapsible and recoverable from desk-only mode on every screen size"],
  [script.includes('data-delete-mix') && api.includes('payload.action === "delete"') && api.includes("member_id = ${membership.member_id}") && api.includes("Mix deleted"), "lets artists delete their own mix uploads with ownership enforcement"],
  [deck.includes('id="mixReleaseProgress"') && deck.includes("HaloUploadProgress") && uploadHelper.includes("uploadChunkedFile"), "shows live upload progress for DJ deck mix publishing"]
];

const failures = checks.filter(([condition]) => !condition);
if (failures.length) {
  failures.forEach(([, message]) => console.error(`FAIL: ${message}`));
  process.exitCode = 1;
} else {
  console.log(`HALO X Mixes contracts: ${checks.length}/${checks.length} checks passed.`);
}
