import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../when-the-world-goes-dark/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../when-the-world-goes-dark/world-dark.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../when-the-world-goes-dark/world-dark.css", import.meta.url), "utf8");
const pulseFunction = readFileSync(new URL("../netlify/functions/world-dark-pulse.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../netlify/database/migrations/20260820200000_launch-when-world-dark-campaign.sql", import.meta.url), "utf8");

assert.match(page, /The Last Light Network/);
assert.match(page, /When The World Goes Dark/);
assert.match(page, /data-signal="stay"/);
assert.match(page, /release-kit\.html\?audience=dj/);
assert.match(script, /\/api\/when-the-world-goes-dark\/pulse/);
assert.match(script, /prefers-reduced-motion/);
assert.match(styles, /focus-visible/);
assert.match(pulseFunction, /halo_world_dark_pulses/);
assert.match(pulseFunction, /verifyRequestOrigin/);
assert.match(migration, /current_release_id = 'when-the-world-goes-dark'/);
assert.match(migration, /ON CONFLICT \(id\) DO UPDATE/);

console.log("World dark campaign contracts passed");
