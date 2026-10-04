import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DJ_PERSONAS, DJ_EVENT_TYPES, DJ_CHANNELS, DJ_MEMORY_LIMIT, SIGNAL_DRAFT_LIMIT, DJ_AI_DISCLOSURE,
  getDjPersona, cleanSlot, normalizeDjEvent, routeDjEvent, markDjActed, djCooldownUntil,
  createDjMemory, rememberDjEvent, recallDjMemory, serializeDjMemory, parseDjMemory,
  composeDjSignalDraft, planDjResponse
} from "../lib/dj-personas.js";
import { CREATOR_SEEDS, ORBIT_TIERS } from "../lib/creator-marketplace.js";
import { postInput } from "../netlify/lib/signal-feed.mjs";

let passed = 0;
function check(name, test) { test(); passed++; console.log(`PASS: ${name}`); }

const [migration, deck, docs, radioDocs] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260812170000_create-radio-dj-personas.sql", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../AI_DJ_PERSONAS.md", import.meta.url), "utf8"),
  readFile(new URL("../RADIO_DJ_PERSONAS.md", import.meta.url), "utf8")
]);

check("registry is the single authoritative source for the three DJs", () => {
  assert.deepEqual(DJ_PERSONAS.map(persona => persona.displayName), ["DJ Halo", "DJ Butterfly", "DJ Romy"]);
  assert.ok(Object.isFrozen(DJ_PERSONAS) && DJ_PERSONAS.every(persona => Object.isFrozen(persona.voice) && Object.isFrozen(persona.stylePack.posts)));
  for (const persona of DJ_PERSONAS) {
    const creator = CREATOR_SEEDS.find(seed => seed.id === persona.id);
    assert.ok(creator, `${persona.id} maps to a creator discovery seed`);
    assert.equal(creator.tier, persona.orbitTier, "Orbit placement matches the marketplace seed");
    assert.ok(ORBIT_TIERS.some(tier => tier.id === persona.orbitTier));
    assert.ok(creator.genres.every(genre => persona.musicSpecialization.genres.includes(genre)), "Persona genres cover the discovery genres");
    for (const alias of [persona.id, persona.radioPersonaId, persona.handle.slice(1), persona.id.toUpperCase()]) {
      assert.equal(getDjPersona(alias), persona, alias);
    }
  }
  assert.equal(getDjPersona("unknown"), null);
  assert.equal(getDjPersona({}), null);
});

check("music lanes stay aligned with radio residents and the live deck", () => {
  for (const persona of DJ_PERSONAS) {
    const { lane, homeRoom, bpmRange, transitionStyles } = persona.musicSpecialization;
    const seed = new RegExp(`'${persona.radioPersonaId}', 'DJ ${persona.radioPersonaId.toUpperCase()}', '[^']*', '${lane}', '${homeRoom}', ${bpmRange[0]}, ${bpmRange[1]}`);
    assert.match(migration, seed, `${persona.displayName} matches its radio resident seed`);
    const deckProfile = deck.match(new RegExp(`${persona.radioPersonaId}: \\{ character: [^}]*styles: \\[([^\\]]+)\\]`));
    assert.ok(deckProfile, `${persona.radioPersonaId} has a deck profile`);
    assert.deepEqual(new Set(transitionStyles), new Set(deckProfile[1].match(/"([^"]+)"/g).map(value => value.slice(1, -1))));
  }
});

check("each persona carries a complete, distinct personality", () => {
  const unique = field => new Set(DJ_PERSONAS.map(field)).size === DJ_PERSONAS.length;
  for (const field of [p => p.archetype, p => p.tagline, p => p.voice.register, p => p.emotionalTone.primary,
    p => p.visualIdentity.imageConcept, p => p.visualIdentity.palette.primary, p => p.stylePack.signOff, p => p.signatureEvent, p => p.handle]) {
    assert.ok(unique(field), "Personas must not share identity fields");
  }
  const allTags = DJ_PERSONAS.flatMap(persona => persona.behaviorTags);
  assert.equal(new Set(allTags).size, allTags.length, "Behaviour tags are persona-specific");
  for (const persona of DJ_PERSONAS) {
    assert.ok(persona.voice.rules.length >= 3 && persona.voice.avoid.length >= 3 && persona.voice.signatureMoves.length >= 3);
    assert.ok(persona.voice.rules.some(rule => /never invent/i.test(rule)), "Every voice forbids invented facts");
    assert.ok(persona.emotionalTone.intensity >= 0 && persona.emotionalTone.intensity <= 1);
    assert.ok(persona.behaviorTags.length >= 4);
    assert.ok(persona.memoryHooks.length >= 2);
    for (const hook of persona.memoryHooks) {
      assert.ok(hook.events.length && hook.events.every(type => DJ_EVENT_TYPES.includes(type)));
      assert.match(hook.recall, /\{memoryTitle\}/);
    }
    assert.equal(persona.visualIdentity.imageUrl, "", "No invented image URLs; concept metadata only");
    assert.ok(persona.visualIdentity.imageAlt.includes(persona.displayName));
    for (const color of Object.values(persona.visualIdentity.palette)) assert.match(color, /^#[0-9a-f]{6}$/);
    assert.deepEqual(Object.keys(persona.eventAffinity).sort(), [...DJ_EVENT_TYPES].sort());
    assert.ok(DJ_CHANNELS.every(channel => persona.cooldownMinutes[channel] > 0));
    assert.equal(persona.eventAffinity[persona.signatureEvent], Math.max(...Object.values(persona.eventAffinity)));
  }
  const intensities = DJ_PERSONAS.map(persona => persona.emotionalTone.intensity);
  assert.ok(intensities[0] > intensities[1] && intensities[1] > intensities[2], "Halo > Butterfly > Romy in intensity");
});

check("style packs are distinct, complete and voice-consistent", () => {
  const allTemplates = DJ_PERSONAS.flatMap(persona => [...persona.stylePack.posts, ...persona.stylePack.comments]);
  assert.equal(new Set(allTemplates.map(template => template.id)).size, allTemplates.length);
  assert.equal(new Set(allTemplates.map(template => template.template)).size, allTemplates.length, "No shared copy between DJs");
  for (const persona of DJ_PERSONAS) {
    for (const pack of [persona.stylePack.posts, persona.stylePack.comments]) {
      assert.ok(pack.some(template => template.events.includes("*") && !template.requires.length), "Always has a fact-free fallback");
      for (const template of pack) {
        const slots = [...template.template.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
        assert.deepEqual(new Set(slots), new Set(template.requires), `${template.id} declares exactly the facts it uses`);
        assert.ok(template.events.every(type => type === "*" || DJ_EVENT_TYPES.includes(type)));
        assert.doesNotMatch(template.template, /https?:|<|>|\$\d|buy now|guarantee/i);
      }
    }
    const copy = [...persona.stylePack.posts, ...persona.stylePack.comments].map(template => template.template).join(" ");
    if (persona.id === "dj-romy") assert.doesNotMatch(copy, /!/, "Romy speaks softly");
    if (persona.id === "dj-halo") for (const template of persona.stylePack.posts) assert.ok((template.template.match(/!/g) || []).length <= 1);
  }
});

check("events are normalised to safe plain-text facts", () => {
  assert.equal(normalizeDjEvent(null), null);
  assert.equal(normalizeDjEvent({ type: "unknown" }), null);
  assert.equal(normalizeDjEvent([]), null);
  const event = normalizeDjEvent({
    type: "release_drop", title: "  <b>Golden</b>\n Hour ", artist: "https://evil.test", creator: "javascript:alert(1)",
    genre: "x".repeat(81), bpm: "126.4", key: "8a", subjectId: "artist:42", threadOwnerId: "halo", extra: "ignored"
  });
  assert.deepEqual(event, { type: "release_drop", channel: "post", subjectId: "artist:42", threadOwnerId: "dj-halo",
    slots: { title: "b Golden /b Hour", bpm: "126", key: "8A" } });
  assert.equal(normalizeDjEvent({ type: "comment_reply" }).channel, "comment");
  assert.equal(normalizeDjEvent({ type: "release_drop", subjectId: "someone@example.com" }).subjectId, "", "No contact details as memory keys");
  assert.equal(normalizeDjEvent({ type: "release_drop", bpm: 999 }).slots.bpm, undefined);
  assert.equal(cleanSlot("{title}"), "title", "Template braces cannot be smuggled in");
  assert.equal(cleanSlot(Infinity), "");
});

check("routing selects by event type, genre, BPM and key", () => {
  const route = event => routeDjEvent(event, { now: 0 });
  assert.equal(route({ type: "release_drop", genre: "Afro House", bpm: 128, key: "8A" }).personaId, "dj-halo");
  assert.equal(route({ type: "remix_request", genre: "Melodic House", bpm: 120, key: "5A" }).personaId, "dj-butterfly");
  assert.equal(route({ type: "late_night_listen", genre: "Soul", bpm: 98 }).personaId, "dj-romy");
  assert.equal(route({ type: "mix_published", genre: "Deep House", bpm: 112, key: "2A" }).personaId, "dj-romy", "Music fit can outweigh event affinity");
  assert.equal(route({ type: "mix_published", genre: "Progressive House", bpm: 121 }).personaId, "dj-butterfly");
  assert.equal(route({ type: "mix_published", genre: "Tech House", bpm: 132 }).personaId, "dj-halo");
  const decision = route({ type: "release_drop", bpm: 126 });
  assert.equal(decision.reason, "best-match");
  assert.equal(decision.ranking.length, 3);
  for (const entry of decision.ranking) assert.deepEqual(Object.keys(entry.breakdown), ["affinity", "genre", "bpm", "key"]);
  assert.deepEqual(route({ type: "nope" }), { personaId: null, reason: "unsupported-event", ranking: [] });
  assert.equal(route({ type: "late_night_listen", genre: "Drum and Bass", bpm: 174, key: "7B" }).personaId, "dj-romy");
  assert.equal(routeDjEvent({ type: "chart_movement", genre: "Jungle", bpm: 175 }, { now: 0, personas: DJ_PERSONAS.slice(2) }).reason, "no-confident-match");
  const first = route({ type: "new_member" });
  assert.deepEqual(first, route({ type: "new_member" }), "Deterministic routing");
});

check("cooldowns hand the event to the next best DJ and expire", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const state = markDjActed({}, "halo", "post", now);
  assert.deepEqual(markDjActed(state, "unknown", "post", now), state);
  const frozen = JSON.stringify(state);
  markDjActed(state, "romy", "post", now);
  assert.equal(JSON.stringify(state), frozen, "Cooldown state is never mutated");
  assert.equal(djCooldownUntil(state, "dj-halo", "post", now + 1000), now + 90 * 60000);
  assert.equal(djCooldownUntil(state, "dj-halo", "comment", now + 1000), null, "Channels cool down independently");
  const event = { type: "release_drop", genre: "Afro House", bpm: 128 };
  const during = routeDjEvent(event, { state, now: now + 60000 });
  assert.notEqual(during.personaId, "dj-halo");
  assert.equal(during.ranking.find(entry => entry.personaId === "dj-halo").eligible, false);
  assert.equal(routeDjEvent(event, { state, now: now + 91 * 60000 }).personaId, "dj-halo");
  let all = {};
  for (const persona of DJ_PERSONAS) all = markDjActed(all, persona.id, "post", now);
  assert.equal(routeDjEvent(event, { state: all, now }).reason, "all-on-cooldown");
});

check("thread replies stay with the DJ who owns the thread", () => {
  const reply = { type: "comment_reply", threadOwnerId: "dj-halo", genre: "Soul", bpm: 96 };
  const decision = routeDjEvent(reply, { now: 0 });
  assert.equal(decision.personaId, "dj-halo");
  assert.equal(decision.reason, "thread-owner");
  const busy = routeDjEvent(reply, { now: 1000, state: markDjActed({}, "halo", "comment", 0) });
  assert.equal(busy.personaId, null, "Another DJ never hijacks a thread");
  assert.equal(busy.reason, "thread-owner-cooldown");
});

check("memory is bounded, PII-free, persona-scoped and recallable", () => {
  let memory = createDjMemory();
  assert.deepEqual(Object.keys(memory.entries), DJ_PERSONAS.map(persona => persona.id));
  const original = serializeDjMemory(memory);
  memory = rememberDjEvent(memory, "dj-butterfly", { type: "remix_request", title: "Metamorphosis", subjectId: "artist-7" }, 1000);
  assert.equal(serializeDjMemory(createDjMemory()), original);
  assert.equal(recallDjMemory(memory, "butterfly", { subjectId: "artist-7" })[0].hook, "collab_journey");
  assert.equal(recallDjMemory(memory, "dj-halo").length, 0, "Memory is scoped to the persona that lived it");
  assert.equal(rememberDjEvent(memory, "dj-halo", { type: "late_night_listen", title: "x", subjectId: "a" }, 1), memory, "Only hooked events are remembered");
  assert.equal(rememberDjEvent(memory, "dj-romy", { type: "late_night_listen", title: "x" }, 1), memory, "No anonymous memories");
  for (let index = 0; index < DJ_MEMORY_LIMIT + 10; index++) {
    memory = rememberDjEvent(memory, "dj-romy", { type: "late_night_listen", title: `Night ${index}`, subjectId: "listener-1" }, index);
  }
  assert.equal(memory.entries["dj-romy"].length, DJ_MEMORY_LIMIT);
  assert.equal(recallDjMemory(memory, "dj-romy", { limit: 1 })[0].title, `Night ${DJ_MEMORY_LIMIT + 9}`, "Most recent first");
  const stored = JSON.parse(serializeDjMemory(memory));
  for (const entry of Object.values(stored.entries).flat()) {
    assert.deepEqual(Object.keys(entry).sort(), ["at", "eventType", "hook", "subjectId", "title"]);
  }
  assert.deepEqual(parseDjMemory("{bad"), createDjMemory());
  assert.deepEqual(parseDjMemory({ version: 2, entries: {} }), createDjMemory());
  const tampered = parseDjMemory({ version: 1, entries: {
    "dj-halo": [{ hook: "release_champion", subjectId: "a", title: "<script>", eventType: "release_drop", at: 1 },
      { hook: "night_regular", subjectId: "a", title: "Wrong persona hook", eventType: "release_drop", at: 1 },
      { hook: "release_champion", subjectId: "a", title: "Kept", eventType: "release_drop", at: 1, email: "x@y.z" }],
    "dj-evil": [{ hook: "x" }]
  } });
  assert.deepEqual(tampered.entries["dj-halo"], [{ hook: "release_champion", subjectId: "a", title: "Kept", eventType: "release_drop", at: 1 }]);
  assert.equal(tampered.entries["dj-evil"], undefined);
});

check("drafts sound like their DJ, use memory and stay demo-only", () => {
  const event = { type: "release_drop", title: "Golden Hour", artist: "Owen Anthony", bpm: 126, genre: "Afro House", subjectId: "artist-1" };
  const drafts = DJ_PERSONAS.map(persona => composeDjSignalDraft(persona.id, event));
  assert.equal(new Set(drafts.map(draft => draft.body)).size, 3, "Same event, three distinct voices");
  for (const [index, draft] of drafts.entries()) {
    const persona = DJ_PERSONAS[index];
    assert.ok(draft.body.endsWith(persona.stylePack.signOff));
    assert.ok(persona.stylePack.posts.some(template => template.id === draft.templateId));
    assert.equal(draft.demo, true);
    assert.equal(draft.requiresHumanApproval, true);
    assert.equal(draft.publishPublic, false, "A draft can never satisfy deliberate public publication by itself");
    assert.equal(draft.aiDisclosure, DJ_AI_DISCLOSURE);
    assert.throws(() => postInput({ kind: draft.kind, body: draft.body, publishPublic: draft.publishPublic }), /deliberate public publication/);
    assert.equal(postInput({ kind: draft.kind, body: draft.body, publishPublic: true }).body, draft.body, "Fits the Signal post contract once a human approves");
    assert.ok(draft.body.length <= SIGNAL_DRAFT_LIMIT);
  }
  const seeds = new Set([0, 1, 2, 3].map(seed => composeDjSignalDraft("halo", event, { seed }).templateId));
  assert.ok(seeds.size > 1, "Seed rotates between matching templates");
  const fallback = composeDjSignalDraft("dj-romy", { type: "chart_movement" });
  assert.equal(fallback.templateId, "romy-generic-1", "Missing facts fall back to fact-free copy");
  assert.doesNotMatch(fallback.body, /\{|\}|undefined/);
  const comment = composeDjSignalDraft("dj-butterfly", { type: "comment_reply", creator: "Ava" });
  assert.equal(comment.channel, "comment");
  assert.match(comment.body, /^Ava, /);
  assert.doesNotMatch(comment.body, /DJ Butterfly 🦋/, "Comments skip the sign-off");
  const hostile = composeDjSignalDraft("dj-halo", { type: "release_drop", title: "<img src=x onerror=alert(1)>", artist: "https://phish.test" });
  assert.doesNotMatch(hostile.body, /<|>|https?:/);
  assert.equal(composeDjSignalDraft("ghost", event), null);
  assert.equal(composeDjSignalDraft("halo", { type: "nope" }), null);
  const memory = rememberDjEvent(null, "dj-halo", { type: "mix_published", title: "First Light", subjectId: "artist-1" }, 1);
  const remembered = composeDjSignalDraft("dj-halo", event, { memory });
  assert.equal(remembered.memoryHook, "release_champion");
  assert.match(remembered.body, /Last time it was “First Light” — the floor remembers\./);
  assert.equal(composeDjSignalDraft("dj-halo", { ...event, subjectId: "artist-2" }, { memory }).memoryHook, "", "Memories are per subject");
  assert.equal(composeDjSignalDraft("dj-halo", { ...event, title: "First Light" }, { memory }).memoryHook, "", "Never recalls the same record as news");
});

check("planning routes, drafts and starts the cooldown in one step", () => {
  const now = Date.parse("2026-10-04T03:00:00Z");
  const plan = planDjResponse({ type: "late_night_listen", title: "Afterglow", genre: "Soul", bpm: 100 }, { now });
  assert.equal(plan.route.personaId, "dj-romy");
  assert.equal(plan.draft.personaId, "dj-romy");
  assert.ok(djCooldownUntil(plan.state, "dj-romy", "post", now + 1));
  const next = planDjResponse({ type: "late_night_listen", title: "Afterglow", genre: "Soul", bpm: 100 }, { now: now + 1, state: plan.state });
  assert.notEqual(next.route.personaId, "dj-romy");
  const none = planDjResponse({ type: "bogus" }, { now, state: plan.state });
  assert.equal(none.draft, null);
  assert.equal(none.state, plan.state);
});

check("documentation describes the persona system and guardrails", () => {
  for (const pattern of [/lib\/dj-personas\.js/, /routeDjEvent/, /cooldown/i, /memory/i, /requires human approval/i, /DJ Halo/, /DJ Butterfly/, /DJ Romy/, /dj-persona-contracts\.mjs/]) {
    assert.match(docs, pattern);
  }
  assert.match(radioDocs, /AI_DJ_PERSONAS\.md/);
});

console.log(`DJ persona contracts passed (${passed} checks): registry, voice, routing, cooldowns, memory and demo-only Signal drafts.`);
