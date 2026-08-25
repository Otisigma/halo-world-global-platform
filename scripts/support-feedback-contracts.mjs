import assert from "node:assert/strict";
import { cleanSupportCategory, cleanSupportStatus, cleanSupportText } from "../netlify/functions/support-feedback.mjs";

assert.equal(cleanSupportCategory(" FEATURE "), "feature");
assert.equal(cleanSupportCategory("billing"), "");
assert.equal(cleanSupportStatus("in_progress"), "in_progress");
assert.equal(cleanSupportStatus("deleted"), "");
assert.equal(cleanSupportText("  signal   with space  ", 80), "signal with space");
assert.equal(cleanSupportText("abcdef", 4), "abcd");

console.log("HALO support feedback contracts: 6/6 checks passed.");
