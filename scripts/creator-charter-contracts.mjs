import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanCharterText, cleanPrinciple } from "../netlify/functions/creator-charter.mjs";

const [migration, api, page, client, styles, halo, creators, magazine] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260819120000_create-creator-freedom-charter.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/creator-charter.mjs", import.meta.url), "utf8"),
  readFile(new URL("../creator-freedom/index.html", import.meta.url), "utf8"),
  readFile(new URL("../creator-freedom/creator-freedom.js", import.meta.url), "utf8"),
  readFile(new URL("../creator-freedom/creator-freedom.css", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8"),
  readFile(new URL("../creators/index.html", import.meta.url), "utf8"),
  readFile(new URL("../magazine.html", import.meta.url), "utf8")
]);

assert.equal(cleanPrinciple("1"), 1);
assert.equal(cleanPrinciple(7), 7);
assert.equal(cleanPrinciple(8), null);
assert.equal(cleanCharterText("  freedom   with responsibility  "), "freedom with responsibility");
assert.match(migration, /halo_creator_charter_acknowledgments/);
assert.match(migration, /halo_creator_charter_responses/);
assert.match(migration, /halo_creator_charter_votes/);
assert.match(api, /verifyRequestOrigin/);
assert.match(api, /Join or sign in to participate/);
assert.match(api, /path: "\/api\/creator-charter"/);
assert.match(page, /THE SEVEN-POINT/);
assert.match(page, /The purpose of the Charter Room/);
assert.match(page, /Affirm the Creator Freedom Charter/);
assert.match(client, /creator_charter_affirmed/);
assert.match(client, /creator_charter_vote/);
assert.match(styles, /--signal: #ee4d2d/);
assert.match(halo, /CREATOR FREEDOM/);
assert.match(creators, /\/creator-freedom\//);
assert.match(magazine, /Creator Freedom/);

console.log("HALO Creator Freedom contracts: 20/20 checks passed.");
