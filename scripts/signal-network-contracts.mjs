import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration, redirects] = await Promise.all([
  read("signal-network/index.html"),
  read("signal-network/signal-network.js"),
  read("signal-network/signal-network.css"),
  read("netlify/functions/signal-network.mjs"),
  read("netlify/database/migrations/20260829150000_create_signal_command_center.sql"),
  read("public/_redirects")
]);

const checks = [
  [page.includes('id="command-center"') && page.includes("signal-network.js") && page.includes("signal-network.css"), "ships the interactive Signal Command Center"],
  [page.includes("Discover collaborators") && page.includes("Your signal queue") && page.includes("Campaign tracker") && page.includes("Private messages") && page.includes("Live network map"), "exposes all five requested member workspaces"],
  [page.includes('/identity.js') && page.includes('id="signalAuthDialog"'), "uses the shared Netlify Identity membership flow"],
  [script.includes('view: "discover"') && script.includes('post("signal"') && script.includes('post("message"'), "connects discovery, signal, and private message actions"],
  [script.includes("requestAnimationFrame(drawMap)") && script.includes("regionPosition") && script.includes("activeNow"), "renders animated aggregate regional presence"],
  [api.includes('config = { path: "/api/signal-network" }') && api.includes("ensureMembership") && api.includes("await verifyRequestOrigin"), "protects the API with membership and same-origin validation"],
  [api.includes("Signal limit reached") && api.includes("Message limit reached") && api.includes('body.action === "block"') && api.includes('["block", "unblock", "report"].includes(body.action)'), "adds rate limiting and member safety controls"],
  [api.includes("p.map_visible = TRUE") && api.includes("GROUP BY p.region_code, p.region_label"), "keeps map data opt-in and aggregate-only"],
  [migration.includes("halo_signal_profiles") && migration.includes("halo_signal_requests") && migration.includes("halo_signal_conversations") && migration.includes("halo_signal_messages"), "persists profiles, requests, conversations, and messages in Netlify Database"],
  [migration.includes("halo_signal_blocks") && migration.includes("halo_signal_reports") && migration.includes("CHECK (member_a_id < member_b_id)"), "enforces safety and unique conversation pairs at the database layer"],
  [styles.includes("@media (max-width: 760px)") && styles.includes("prefers-reduced-motion") && styles.includes("signal-skeleton"), "supports mobile, reduced motion, and loading states"],
  [redirects.includes("/signal /signal-network/ 301"), "routes the short Signal URL to the live workspace"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Signal Network contracts: ${checks.length}/${checks.length} checks passed.`);
