import assert from "node:assert/strict";
import { cleanOptionalRecordId } from "../netlify/functions/community.mjs";

assert.equal(cleanOptionalRecordId(null), null);
assert.equal(cleanOptionalRecordId(undefined), null);
assert.equal(cleanOptionalRecordId(""), null);
assert.equal(cleanOptionalRecordId(0), null);
assert.equal(cleanOptionalRecordId("0"), null);
assert.equal(cleanOptionalRecordId("12"), 12);
assert.equal(cleanOptionalRecordId(24), 24);

console.log("HALO community contracts: 7/7 checks passed.");
