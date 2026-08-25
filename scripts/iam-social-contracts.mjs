import { readFileSync } from "node:fs";

const page = readFileSync("iam-social/index.html", "utf8");
const script = readFileSync("iam-social/iam-social.js", "utf8");
const styles = readFileSync("iam-social/iam-social.css", "utf8");
const api = readFileSync("netlify/functions/iam-social.mjs", "utf8");
const migration = readFileSync("netlify/database/migrations/20260816200000_create-iam-social-connection.sql", "utf8");
const dreamweaver = readFileSync("dreamweaver/index.html", "utf8");
const config = readFileSync("netlify.toml", "utf8");

const checks = [
  [page.includes("One living pool") && page.includes('id="materialList"') && page.includes('id="snippetGrid"'), "presents the artist material flow and reusable snippet pool"],
  [script.includes("/api/iam-social") && script.includes('signal: "reused"') && script.includes("Pull into the pool"), "connects reuse and feedback actions to the secure API"],
  [styles.includes(".snippet-grid") && styles.includes("prefers-reduced-motion") && styles.includes("@media (max-width: 650px)"), "supports responsive and reduced-motion presentation"],
  [api.includes('path: "/api/iam-social"') && api.includes("verifyRequestOrigin") && api.includes("ensureMembership"), "protects the social workspace with membership and origin verification"],
  [api.includes("halo_release_campaigns") && api.includes("halo_artist_activity") && api.includes("halo_videos") && api.includes("halo_dreamweaver_campaigns"), "collects current and archived artist material"],
  [migration.includes("halo_social_snippets") && migration.includes("halo_social_snippet_feedback") && migration.includes("use_count"), "persists reusable language and its feedback loop"],
  [dreamweaver.includes('href="/iam-social/"') && config.includes('from = "/iam-social"'), "links and normalizes the first I AM Social connection"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`I AM Social contracts: ${checks.length}/${checks.length} checks passed.`);
