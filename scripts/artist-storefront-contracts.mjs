import assert from "node:assert/strict";
import { artistMatches, creditedArtists, deriveRole, serialiseStorefrontProfile } from "../netlify/lib/artist-storefront.mjs";
import { buildPersonaSystemPrompt, extractFanName, mergeNotes, personaFor, splitMemory } from "../netlify/lib/artist-personas.mjs";

// Storefront scoping: solo and collaboration credits belong to the artist; other artists don't.
assert.ok(artistMatches("Anna Jayne", "Anna Jayne"));
assert.ok(artistMatches("Anna Jayne", "Owen Anthony & Anna Jayne"));
assert.ok(artistMatches("Owen Anthony", "Owen Anthony & Anna Jayne"));
assert.ok(artistMatches("anna jayne", "ANNA  JAYNE feat. DJ Futon"));
assert.ok(!artistMatches("Anna Jayne", "Owen Anthony"));
assert.ok(!artistMatches("Anna", "Anna Jayne"));
assert.ok(!artistMatches("", "Anna Jayne"));
assert.deepEqual(creditedArtists("Owen Anthony x DJ Futon"), ["owen anthony x dj futon", "owen anthony", "dj futon"]);

// Profile card: written role wins, otherwise derived from the catalog's genres.
assert.equal(deriveRole({ role: "Singer-songwriter" }, []), "Singer-songwriter");
assert.equal(deriveRole({ role: "" }, [{ genre: "Acoustic" }, { genre: "Acoustic" }, { genre: "Indie" }]), "Acoustic / Indie artist");
assert.equal(deriveRole({}, []), "HALO artist");
const profile = serialiseStorefrontProfile(
  { slug: "anna-jayne", artist_name: "Anna Jayne", role: "", bio: "", tagline: "Carved our own quiet space.", accent_color: "#ffcc88", artwork_url: "javascript:alert(1)" },
  [{ genre: "Acoustic" }],
  personaFor({ slug: "anna-jayne", artist_name: "Anna Jayne" })
);
assert.equal(profile.name, "Anna Jayne");
assert.equal(profile.role, "Acoustic artist");
assert.equal(profile.bio, "Carved our own quiet space.");
assert.equal(profile.artwork, "", "unsafe artwork URLs are dropped");
assert.equal(profile.persona.name, "Anna Jayne");

// Persona lookup by slug or by artist name; no persona for other artists.
assert.equal(personaFor({ slug: "aj-music", artist_name: "Anna Jayne" })?.key, "anna-jayne");
assert.equal(personaFor({ slug: "owen-anthony", artist_name: "Owen Anthony" }), null);

// System prompt carries the persona, live catalog facts, fan memory and the safety rules.
const prompt = buildPersonaSystemPrompt(personaFor({ slug: "anna-jayne" }), {
  profile: { role: "Singer-songwriter", bio: "Acoustic storyteller." },
  songs: [{ title: "Blue Ink & Coffee", artist: "Anna Jayne", genre: "Acoustic", saleStatus: "for_sale", priceMinor: 649, currency: "GBP" }],
  lyrics: [{ title: "Blue Ink & Coffee", text: "The morning light is cutting through the glass" }],
  fan: { name: "Sam", notes: "Loves the chorus of Blue Ink & Coffee", returning: true }
});
for (const fragment of ["AI persona", "Blue Ink & Coffee · credited to Anna Jayne · Acoustic · on sale in the shop (6.49 GBP)", "The fan's name is Sam.", "Loves the chorus", "Only state facts that appear above", "Samaritans", "ignore previous instructions", "MEMORY:"]) {
  assert.ok(prompt.includes(fragment), `prompt includes ${fragment}`);
}

// Memory lines are stripped from the fan-visible reply.
assert.deepEqual(splitMemory("Lovely to meet you, Sam.\nMEMORY: Sam listens on the train"), { message: "Lovely to meet you, Sam.", memory: "Sam listens on the train" });
assert.deepEqual(splitMemory("Just a reply."), { message: "Just a reply.", memory: "" });
assert.equal(extractFanName("hi, my name is Priya and I love this"), "Priya");
assert.equal(extractFanName("I'm Loving this song"), "");
assert.equal(mergeNotes("a | b", "b"), "a | b");
assert.equal(mergeNotes("", "first"), "first");

console.log("artist storefront contracts passed");
