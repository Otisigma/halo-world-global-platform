import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const companion = await readFile(new URL("../halo-companion.js", import.meta.url), "utf8");
const companionFunction = await readFile(new URL("../netlify/functions/halo-companion.mjs", import.meta.url), "utf8");

assert.match(companion, /Voice \+ guidance options/);
assert.match(companion, /halo-companion-settings\.v1/);
assert.match(companion, /halo-artist-journey-state\.v1/);
assert.match(companion, /voiceEnabled: false/);
assert.match(companion, /<option value="concise">Concise<\/option><option value="detailed">Detailed<\/option>/);
assert.match(companion, /<option value="proactive">Proactive<\/option><option value="manual">Manual<\/option>/);
assert.match(companion, /<option value="full-site">Full-site<\/option><option value="deck-only">Deck-only<\/option>/);
assert.match(companion, /speechSynthesis/);
assert.match(companion, /SpeechSynthesisUtterance/);
assert.match(companion, /halo:artist-journey-update/);
assert.match(companion, /Replay latest guidance|Speak guidance/);

assert.match(companionFunction, /companionOptions/);
assert.match(companionFunction, /guidanceDetail/);
assert.match(companionFunction, /promptMode/);
assert.match(companionFunction, /guidanceScope/);
assert.match(companionFunction, /voiceStyle/);
assert.match(companionFunction, /keep the reply to one or two short sentences/);

console.log("HALO companion contracts: voice settings, journey sync, speech fallback, and response options are wired.");
