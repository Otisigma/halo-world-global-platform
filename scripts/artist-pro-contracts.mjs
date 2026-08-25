import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, styles, script, api, migration, stats, summary, dailyReport, homepage, config] = await Promise.all([
  read("artist-pro/index.html"),
  read("artist-pro/artist-pro.css"),
  read("artist-pro/artist-pro.js"),
  read("netlify/functions/artist-pro.mjs"),
  read("netlify/database/migrations/20260814160000_create-artist-pro-leads.sql"),
  read("netlify/lib/stats.mjs"),
  read("netlify/functions/stats-summary.mjs"),
  read("netlify/lib/halo-x.mjs"),
  read("halo.html"),
  read("netlify.toml")
]);

const checks = [
  [page.includes("Your release deserves more than") && page.includes("One release journey") && page.includes("Bring a real release"), "leads with one focused independent-artist outcome"],
  [page.includes('id="earnings"') && page.includes("A stream can find a fan") && page.includes("not represented here as a currently active payout feature"), "explains the direct-fan earnings direction without presenting roadmap commerce as live"],
  [page.includes("There is not one") && page.includes("250,000 streams") && page.includes("Illustration only"), "presents streaming math as a variable planning illustration rather than a guaranteed rate"],
  [script.includes("updateEarningsIllustration") && script.includes("0.029") && script.includes("0.004"), "keeps the artist earnings comparison interactive and transparent about its assumptions"],
  [page.includes("£</span>49") && page.includes("No payment at application") && page.includes("Cancel monthly"), "publishes a clear founding offer without demanding payment first"],
  [page.includes("IN THE £49 MEMBERSHIP") && page.includes("QUOTED SEPARATELY") && page.includes("No claim on artist royalties"), "separates the repeatable membership from labor and outside costs"],
  [page.includes("PROTECTED BY DESIGN") && page.includes("No secret-sharing") && page.includes("What does HALO keep confidential?"), "publishes a client-readable confidentiality promise without exposing security controls"],
  [page.includes("guaranteed airplay is not") && page.includes("guarantee radio play or press") && page.includes("Final approval always human"), "states commercial and human-control boundaries"],
  [page.includes('id="artistProForm"') && page.includes('name="releaseStage"') && page.includes('name="primaryGoal"') && page.includes('name="consent"') && page.includes("founding service is £49 per month"), "collects qualification details and explicit founding-offer acknowledgement"],
  [script.includes('fetch("/api/artist-pro"') && script.includes("artist_pro_application_submit") && script.includes("artist_pro_application_success"), "submits applications and records measurable funnel events"],
  [api.includes("verifyRequestOrigin") && api.includes("MAX_BODY_BYTES") && api.includes("Retry-After") && api.includes("cleanEmail") && api.includes("Accept the founding offer terms"), "protects the public application endpoint and requires offer acknowledgement"],
  [api.includes("isOwner(user)") && api.includes("Owner access is required") && api.includes("ORDER BY"), "keeps the lead pipeline owner-only"],
  [migration.includes("halo_artist_pro_leads") && migration.includes("consent_at") && migration.includes("CHECK (status IN") && migration.includes("email TEXT NOT NULL UNIQUE"), "persists consented applications in Netlify Database"],
  [stats.includes('"open_artist_pro"') && stats.includes('"artist_pro_application_success"') && summary.includes("completedApplication"), "adds Artist Pro conversion reporting to HALO analytics"],
  [dailyReport.includes("artistProLeadsToday") && dailyReport.includes("artistProAwaitingReview"), "places new Artist Pro applications in the owner daily report"],
  [homepage.includes('href="/artist-pro/"') && homepage.includes("BUILD MY NEXT RELEASE") && homepage.includes("One release. One command system."), "makes Artist Pro the main artist pathway from HALO World"],
  [config.includes('from = "/artist-pro"') && config.includes('to = "/artist-pro/"'), "keeps the Artist Pro URL canonical"],
  [page.includes("/accessibility.css") && page.includes("/site-monitor.js") && page.includes('class="skip-link"') && styles.includes("@media (max-width: 760px)") && styles.includes("prefers-reduced-motion") && styles.includes(":focus"), "supports monitored, mobile, focus, and reduced-motion visitors"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Artist Pro contracts: ${checks.length}/${checks.length} checks passed.`);
