import assert from "node:assert/strict";
import { createDreamweaverFanSignupHandler } from "../netlify/functions/dreamweaver-fan-signups.mjs";

function createFakeDb({ memberships = {} } = {}) {
  const dreamweaverRows = new Map();
  const relationshipRows = new Map();
  const profileRows = new Map();
  let tick = 0;

  const nextIso = () => new Date(Date.UTC(2026, 8, 10, 7, 0, tick++)).toISOString();
  const withDefaults = memberId => {
    const current = profileRows.get(memberId) || {
      member_id: memberId,
      contact_consent: false,
      preferred_channel: "none",
      tags: [],
      relationship_summary: ""
    };
    profileRows.set(memberId, current);
    return current;
  };

  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");

      if (query.includes("INSERT INTO halo_dreamweaver_fan_signups")) {
        const [id, email, firstName, favoritePlatform] = values;
        const consentAt = nextIso();
        const existing = dreamweaverRows.get(email);
        if (existing) {
          const row = { ...existing, first_name: firstName, favorite_platform: favoritePlatform, consent_at: consentAt };
          dreamweaverRows.set(email, row);
          return [{ ...row, inserted: false }];
        }
        const row = {
          id,
          email,
          first_name: firstName,
          favorite_platform: favoritePlatform,
          source: "dreamweaver_satellite",
          unlock_reward: "full_track_doorway",
          consent_at: consentAt
        };
        dreamweaverRows.set(email, row);
        return [{ ...row, inserted: true }];
      }

      if (query.includes("INSERT INTO halo_relationship_signups")) {
        const email = values[0];
        const sourceSignupId = values[1];
        const firstName = values[3];
        const favoritePlatform = values[4];
        const source = values[5];
        const unlockReward = values[6];
        const consentAt = values[8];
        const linkedMemberId = memberships[email] || null;
        const now = nextIso();
        const existing = relationshipRows.get(email);
        if (existing) {
          const row = {
            ...existing,
            source_signup_id: sourceSignupId,
            linked_member_id: existing.linked_member_id || linkedMemberId,
            first_name: firstName,
            favorite_platform: favoritePlatform,
            source,
            unlock_reward: unlockReward,
            consent_at: existing.consent_at && consentAt
              ? (existing.consent_at <= consentAt ? existing.consent_at : consentAt)
              : existing.consent_at || consentAt,
            signup_count: existing.source_signup_id !== sourceSignupId ? existing.signup_count + 1 : existing.signup_count,
            last_signup_at: now,
            updated_at: now,
            status: existing.linked_member_id || linkedMemberId ? "linked_member" : "repeat_signup"
          };
          relationshipRows.set(email, row);
          return [{ linked_member_id: row.linked_member_id }];
        }
        const row = {
          email,
          source_signup_id: sourceSignupId,
          linked_member_id: linkedMemberId,
          first_name: firstName,
          favorite_platform: favoritePlatform,
          source,
          unlock_reward: unlockReward,
          status: linkedMemberId ? "linked_member" : "received",
          signup_count: 1,
          consent_at: consentAt,
          first_signup_at: now,
          last_signup_at: now,
          created_at: now,
          updated_at: now
        };
        relationshipRows.set(email, row);
        return [{ linked_member_id: row.linked_member_id }];
      }

      if (query.includes("INSERT INTO halo_relationship_profiles")) {
        withDefaults(values[0]);
        return [];
      }

      if (query.includes("UPDATE halo_relationship_profiles")) {
        const profile = withDefaults(values[0]);
        if (!profile.tags.includes("dreamweaver")) profile.tags = [...profile.tags, "dreamweaver"];
        if (!profile.relationship_summary) profile.relationship_summary = "Dreamweaver fan signup captured from the public unlock flow.";
        profile.updated_at = nextIso();
        profileRows.set(values[0], profile);
        return [];
      }

      throw new Error(`Unhandled fake query: ${query}`);
    }
  };

  return { db, dreamweaverRows, relationshipRows, profileRows };
}

async function submit(handler, payload) {
  const response = await handler(new Request("https://halo.test/api/dreamweaver-fan-signups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));
  return { response, body: await response.json() };
}

{
  const store = createFakeDb();
  const handler = createDreamweaverFanSignupHandler({ database: async () => store.db, verifyOrigin: () => {} });
  const { response, body } = await submit(handler, {
    email: "fan@example.com",
    firstName: "Fan",
    favoritePlatform: "spotify",
    consent: true
  });
  assert.equal(response.status, 201);
  assert.equal(body.accepted, true);
  const crm = store.relationshipRows.get("fan@example.com");
  assert.equal(crm?.status, "received");
  assert.equal(crm?.signup_count, 1);
}

{
  const store = createFakeDb();
  const handler = createDreamweaverFanSignupHandler({ database: async () => store.db, verifyOrigin: () => {} });
  await submit(handler, {
    email: "fan@example.com",
    firstName: "Fan",
    favoritePlatform: "spotify",
    consent: true
  });
  const firstConsentAt = store.relationshipRows.get("fan@example.com")?.consent_at;
  const { response } = await submit(handler, {
    email: "fan@example.com",
    firstName: "Fan",
    favoritePlatform: "youtube",
    consent: true
  });
  const crm = store.relationshipRows.get("fan@example.com");
  assert.equal(response.status, 200);
  assert.equal(crm?.status, "repeat_signup");
  assert.equal(crm?.signup_count, 1);
  assert.equal(crm?.consent_at, firstConsentAt);
  assert.equal(crm?.favorite_platform, "youtube");
}

{
  const store = createFakeDb({ memberships: { "member@example.com": "member-1" } });
  store.profileRows.set("member-1", {
    member_id: "member-1",
    contact_consent: false,
    preferred_channel: "none",
    tags: [],
    relationship_summary: ""
  });
  const handler = createDreamweaverFanSignupHandler({ database: async () => store.db, verifyOrigin: () => {} });
  const { response } = await submit(handler, {
    email: "member@example.com",
    firstName: "Member",
    favoritePlatform: "apple_music",
    consent: true
  });
  const crm = store.relationshipRows.get("member@example.com");
  const profile = store.profileRows.get("member-1");
  assert.equal(response.status, 201);
  assert.equal(crm?.status, "linked_member");
  assert.equal(crm?.linked_member_id, "member-1");
  assert.equal(profile?.contact_consent, false);
  assert.ok(profile?.tags.includes("dreamweaver"));
  assert.equal(profile?.relationship_summary, "Dreamweaver fan signup captured from the public unlock flow.");
}

console.log("Dreamweaver fan signup API contracts: 3/3 checks passed.");
