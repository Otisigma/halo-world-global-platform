import assert from "node:assert/strict";
import { cleanOptionalRecordId } from "../netlify/functions/community.mjs";

assert.equal(cleanOptionalRecordId(null), null);
assert.equal(cleanOptionalRecordId(undefined), null);
assert.equal(cleanOptionalRecordId(""), null);
assert.equal(cleanOptionalRecordId(0), null);
assert.equal(cleanOptionalRecordId("0"), null);
assert.equal(cleanOptionalRecordId("12"), 12);
assert.equal(cleanOptionalRecordId(24), 24);

// Persona type and visibility level guard lists exported indirectly via module-level constants.
// Verify that the module exports the helper functions cleanly (import did not throw).
assert.equal(typeof cleanOptionalRecordId, "function");

console.log("HALO community contracts: 8/8 checks passed.");
