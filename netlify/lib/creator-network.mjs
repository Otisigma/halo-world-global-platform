import { randomUUID } from "node:crypto";
import { withCuratedCreators } from "../../lib/creator-directory.js";
import { getCreatorPassEntitlements } from "../../lib/creator-pass.js";
import { planDjResponse } from "../../lib/dj-personas.js";
import { loadCreatorPass } from "./creator-pass.mjs";
import {
  DnaError, bilateralBlock, dnaFallback, dnaInput, dnaOwner, dnaProfile, dnaSearch,
  publicProfileId, readNetworkBody, resolveDnaInvite, saveDna, searchInput
} from "./creative-dna.mjs";

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

function text(value, max, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new Error("Invalid text field");
  }
  return value.trim();
}

function tags(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) throw new Error("Use up to 12 tags");
  return [...new Set(value.map(item => text(item, 80, true)))];
}

function tempo(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!["string", "number"].includes(typeof value) || !Number.isInteger(number) || number < 20 || number > 300) {
    throw new Error("BPM must be an integer from 20 to 300");
  }
  return number;
}

export function profileInput(body) {
  const bpmMin = tempo(body.bpmMin), bpmMax = tempo(body.bpmMax);
  if ((bpmMin === null) !== (bpmMax === null) || (bpmMin !== null && bpmMin > bpmMax)) {
    throw new Error("Provide an ordered BPM range");
  }
  if (body.discoverable != null && typeof body.discoverable !== "boolean") throw new Error("Invalid discovery setting");
  return {
    displayName: text(body.displayName, 100, true), bio: text(body.bio, 2000),
    artistSlug: text(body.artistSlug, 100) || null,
    roles: tags(body.roles), genres: tags(body.genres), languages: tags(body.languages),
    dawSetup: tags(body.dawSetup), bpmMin, bpmMax,
    splitPreference: text(body.splitPreference, 300), discoverable: body.discoverable === true
  };
}

export function projectInput(body) {
  const kind = body.kind || "audio";
  if (!["audio", "visual", "review"].includes(kind)) throw new Error("Invalid opportunity kind");
  const result = {
    title: text(body.title, 180, true), brief: text(body.brief, 4000),
    roleNeeded: text(body.roleNeeded, 80), genre: text(body.genre, 80),
    language: text(body.language, 80), musicalKey: text(body.musicalKey, 20),
    bpm: tempo(body.bpm), kind
  };
  for (const field of ["songId", "songVersionId", "stemPackId", "rightsWorkId"]) {
    result[field] = text(body[field], 100) || null;
  }
  if (result.songVersionId && !result.songId) throw new Error("A version needs its song ID");
  return result;
}

export function canRespond(participant, project, memberId) {
  if (participant.status !== "pending" || project.status !== "open") return false;
  return participant.kind === "invite"
    ? participant.member_id === memberId
    : project.owner_member_id === memberId;
}

async function ownedLinks(db, memberId, input) {
  if (input.artistSlug) {
    const rows = await db.sql`SELECT slug FROM halo_artist_pages WHERE slug = ${input.artistSlug} AND owner_member_id = ${memberId}`;
    if (!rows.length) return false;
  }
  if (input.songId) {
    const rows = await db.sql`SELECT id FROM halo_song_catalog WHERE id = ${input.songId} AND owner_member_id = ${memberId} AND status = 'active'`;
    if (!rows.length) return false;
  }
  if (input.songVersionId) {
    const rows = await db.sql`SELECT id FROM halo_song_versions WHERE id = ${input.songVersionId} AND song_id = ${input.songId} AND status = 'active'`;
    if (!rows.length) return false;
  }
  if (input.stemPackId) {
    const rows = await db.sql`SELECT id FROM halo_stem_packs WHERE id = ${input.stemPackId} AND member_id = ${memberId}`;
    if (!rows.length) return false;
  }
  if (input.rightsWorkId) {
    const rows = await db.sql`SELECT id FROM halo_artist_rights_works WHERE id = ${input.rightsWorkId} AND owner_member_id = ${memberId}`;
    if (!rows.length) return false;
  }
  return true;
}

async function workspace(db, memberId, url) {
  const role = text(url.searchParams.get("role"), 80);
  const genre = text(url.searchParams.get("genre"), 80);
  const language = text(url.searchParams.get("language"), 80);
  const key = text(url.searchParams.get("key"), 20);
  const bpm = tempo(url.searchParams.get("bpm"));
  const [profiles, creators, memberProjects, opportunities, participants, creatorPass] = await Promise.all([
    db.sql`SELECT * FROM halo_creator_profiles WHERE member_id = ${memberId}`,
    db.sql`
      SELECT member_id, display_name, bio, artist_slug, roles, genres, languages, daw_setup,
        bpm_min, bpm_max, split_preference,
        COALESCE(pass.subscription_tier = 'PREMIUM' AND (
          (pass.subscription_status = 'active' AND pass.subscription_expires_at > NOW()) OR
          (pass.subscription_status = 'trialing' AND pass.trial_ends_at > NOW()
            AND (pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > NOW()))
        ), FALSE) AS premium_verified
      FROM halo_creator_profiles c
      LEFT JOIN halo_creator_passes pass USING (member_id)
      WHERE discoverable = TRUE AND member_id <> ${memberId}
        AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
          WHERE (b.member_id = ${memberId} AND b.target_member_id = c.member_id)
            OR (b.member_id = c.member_id AND b.target_member_id = ${memberId}))
        AND (${role} = '' OR ${role} = ANY(roles))
        AND (${genre} = '' OR ${genre} = ANY(genres))
        AND (${language} = '' OR ${language} = ANY(languages))
        AND (${bpm}::int IS NULL OR ${bpm} BETWEEN bpm_min AND bpm_max)
      ORDER BY premium_verified DESC, c.updated_at DESC LIMIT 60
    `,
    db.sql`
      SELECT p.*, c.display_name AS creator_name FROM halo_creator_projects p
      LEFT JOIN halo_creator_profiles c ON c.member_id = p.owner_member_id
      WHERE p.owner_member_id = ${memberId} OR EXISTS (
        SELECT 1 FROM halo_creator_participants cp
        WHERE cp.project_id = p.id AND cp.member_id = ${memberId} AND cp.status = 'accepted'
      )
      ORDER BY p.updated_at DESC
    `,
    db.sql`
      SELECT p.*, c.display_name AS creator_name,
        COALESCE(p.status = 'open' AND NULLIF(BTRIM(p.brief), '') IS NOT NULL
          AND owner_pass.subscription_tier = 'PREMIUM' AND (
            (owner_pass.subscription_status = 'active' AND owner_pass.subscription_expires_at > NOW()) OR
            (owner_pass.subscription_status = 'trialing' AND owner_pass.trial_ends_at > NOW()
              AND (owner_pass.subscription_expires_at IS NULL OR owner_pass.subscription_expires_at > NOW()))
          ), FALSE) AS premium_promoted
      FROM halo_creator_projects p
      LEFT JOIN halo_creator_profiles c ON c.member_id = p.owner_member_id
      LEFT JOIN halo_creator_passes owner_pass ON owner_pass.member_id = p.owner_member_id
      WHERE p.status = 'open' AND p.owner_member_id <> ${memberId}
        AND (${role} = '' OR p.role_needed = ${role})
        AND (${genre} = '' OR p.genre = ${genre})
        AND (${language} = '' OR p.language = ${language})
        AND (${key} = '' OR p.musical_key = ${key})
        AND (${bpm}::int IS NULL OR p.bpm = ${bpm})
        AND NOT EXISTS (
          SELECT 1 FROM halo_creator_participants cp
          WHERE cp.project_id = p.id AND cp.member_id = ${memberId} AND cp.status = 'accepted'
        )
      ORDER BY premium_promoted DESC, p.updated_at DESC LIMIT 100
    `,
    db.sql`
      SELECT cp.*, p.title, p.owner_member_id, p.status AS project_status,
        c.display_name AS participant_name, owner.display_name AS owner_name
      FROM halo_creator_participants cp
      JOIN halo_creator_projects p ON p.id = cp.project_id
      LEFT JOIN halo_creator_profiles c ON c.member_id = cp.member_id
      LEFT JOIN halo_creator_profiles owner ON owner.member_id = p.owner_member_id
      WHERE cp.member_id = ${memberId} OR p.owner_member_id = ${memberId}
      ORDER BY cp.updated_at DESC
    `,
    loadCreatorPass(db, memberId)
  ]);
  const profile = profiles[0] || null;
  const dynamicBriefs = getCreatorPassEntitlements(creatorPass).dynamicBriefSurfacing && profile
    ? opportunities.filter(project =>
      (!project.role_needed || profile.roles?.includes(project.role_needed)) &&
      (!project.genre || profile.genres?.includes(project.genre)) &&
      (!project.language || profile.languages?.includes(project.language)) &&
      (project.bpm == null || (profile.bpm_min != null && profile.bpm_max != null &&
        project.bpm >= profile.bpm_min && project.bpm <= profile.bpm_max))
    ).slice(0, 12).map(project => ({
      ...project,
      personaDraft: planDjResponse({
        type: "collab_request", channel: "post", subjectId: project.id,
        title: project.title, creator: project.creator_name, genre: project.genre,
        bpm: project.bpm, key: project.musical_key
      }).draft
    }))
    : [];
  return {
    memberId, creatorPass, profile,
    creators: withCuratedCreators(creators, { role, genre, language, bpm }),
    projects: [...memberProjects, ...opportunities], participants, dynamicBriefs
  };
}

function publicFilters(url) {
  const role = text(url.searchParams.get("role"), 80);
  const genre = text(url.searchParams.get("genre"), 80);
  const language = text(url.searchParams.get("language"), 80);
  const bpm = tempo(url.searchParams.get("bpm"));
  return { role, genre, language, bpm };
}

async function publicCreators(db, url) {
  const { role, genre, language, bpm } = publicFilters(url);
  const creators = await db.sql`
    SELECT display_name, bio, artist_slug, roles, genres, languages, bpm_min, bpm_max,
      COALESCE(pass.subscription_tier = 'PREMIUM' AND (
        (pass.subscription_status = 'active' AND pass.subscription_expires_at > NOW()) OR
        (pass.subscription_status = 'trialing' AND pass.trial_ends_at > NOW()
          AND (pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > NOW()))
      ), FALSE) AS premium_verified
    FROM halo_creator_profiles c
    LEFT JOIN halo_creator_passes pass USING (member_id)
    WHERE discoverable = TRUE
      AND (${role} = '' OR ${role} = ANY(roles))
      AND (${genre} = '' OR ${genre} = ANY(genres))
      AND (${language} = '' OR ${language} = ANY(languages))
      AND (${bpm}::int IS NULL OR ${bpm} BETWEEN bpm_min AND bpm_max)
    ORDER BY premium_verified DESC, c.updated_at DESC
    LIMIT 48
  `;
  return { creators: withCuratedCreators(creators, { role, genre, language, bpm }) };
}

export function createCreatorNetworkHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      if (request.method === "POST") {
        try {
          if ((await verifyRequestOrigin(request)) === false) return json({ message: "Cross-origin action rejected" }, 403);
        } catch {
          return json({ message: "Cross-origin action rejected" }, 403);
        }
      }
      const url = new URL(request.url);
      const view = url.searchParams.get("view");
      if (request.method === "GET" && ["dna", "dna_search", "dna_profile"].includes(view)) {
        const user = await getUser(request);
        if (view === "dna" && !user?.id) return json({ message: "Sign in to edit Creative DNA" }, 401);
        const id = view === "dna_profile" ? publicProfileId(url.searchParams.get("profile")) : null;
        // Validate even when discovery storage is unavailable; invalid queries never become fallback results.
        const validationUrl = new URL(url);
        if (user?.id) validationUrl.searchParams.delete("cursor");
        const validatedFilters = view === "dna_search" ? searchInput(validationUrl, null) : null;
        let filters;
        try {
          const db = await getDatabase();
          const membership = user?.id ? await ensureMembership(db, user) : null;
          const memberId = membership?.member_id || null;
          if (view === "dna") return json(await dnaOwner(db, memberId));
          if (view === "dna_profile") return json(await dnaProfile(db, memberId, id));
          filters = searchInput(url, memberId);
          return json(await dnaSearch(db, memberId, filters));
        } catch (error) {
          if (error instanceof DnaError || view !== "dna_search") throw error;
          return json(dnaFallback(filters || validatedFilters));
        }
      }
      if (request.method === "GET" && url.searchParams.get("view") === "public") {
        let filters;
        try {
          filters = publicFilters(url);
        } catch (error) {
          return json({ message: error.message }, 400);
        }
        try {
          return json(await publicCreators(await getDatabase(), url));
        } catch {
          return json({ creators: withCuratedCreators([], filters), directoryUnavailable: true });
        }
      }
      const user = await getUser(request);
      if (!user?.id) return json({ message: "Sign in to open Creator Network" }, 401);
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const memberId = membership.member_id;
      if (request.method === "GET") {
        try {
          return json(await workspace(db, memberId, url));
        } catch (error) {
          if (/Invalid text|BPM must/.test(error.message)) return json({ message: error.message }, 400);
          throw error;
        }
      }
      let body, input;
      try {
        body = await readNetworkBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
        if (body.action === "save_dna") input = dnaInput(body);
        else if (body.action === "save_profile") input = profileInput(body);
        else if (body.action === "create_project") input = projectInput(body);
        else if (!["invite", "apply", "respond", "close_project"].includes(body.action)) throw new Error("Unknown action");
        else {
          input = {
            projectId: text(body.projectId, 100, true),
            memberId: text(body.memberId, 100),
            publicProfileId: body.publicProfileId == null ? null : publicProfileId(body.publicProfileId),
            message: text(body.message, 2000), status: text(body.status, 20)
          };
          if (body.action === "invite" && !input.memberId && !input.publicProfileId) throw new Error("Choose a creator");
          if (input.memberId && input.publicProfileId) throw new Error("Choose one creator identifier");
          if (body.action === "respond" && !["accepted", "declined"].includes(input.status)) throw new Error("Choose accept or decline");
        }
      } catch (error) {
        return json({ message: error instanceof SyntaxError ? "Request body must be valid JSON" : error.message }, error instanceof DnaError ? error.status : 400);
      }
      if (body.action === "save_dna") {
        return json(await saveDna(db, memberId, input));
      } else if (body.action === "save_profile") {
        if (!(await ownedLinks(db, memberId, input))) return json({ message: "Linked room must belong to you" }, 403);
        await db.sql`
          INSERT INTO halo_creator_profiles (member_id, artist_slug, display_name, bio, roles, genres, languages,
            daw_setup, bpm_min, bpm_max, split_preference, discoverable)
          VALUES (${memberId}, ${input.artistSlug}, ${input.displayName}, ${input.bio}, ${input.roles},
            ${input.genres}, ${input.languages}, ${input.dawSetup}, ${input.bpmMin}, ${input.bpmMax},
            ${input.splitPreference}, ${input.discoverable})
          ON CONFLICT (member_id) DO UPDATE SET artist_slug = EXCLUDED.artist_slug,
            display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, roles = EXCLUDED.roles,
            genres = EXCLUDED.genres, languages = EXCLUDED.languages, daw_setup = EXCLUDED.daw_setup,
            bpm_min = EXCLUDED.bpm_min, bpm_max = EXCLUDED.bpm_max, split_preference = EXCLUDED.split_preference,
            discoverable = EXCLUDED.discoverable, updated_at = NOW()
        `;
      } else if (body.action === "create_project") {
        if (!(await ownedLinks(db, memberId, input))) return json({ message: "Linked assets must belong to you" }, 403);
        await db.sql`
          INSERT INTO halo_creator_projects (id, owner_member_id, title, brief, role_needed, genre, language,
            bpm, musical_key, kind, song_id, song_version_id, stem_pack_id, rights_work_id)
          VALUES (${randomUUID()}, ${memberId}, ${input.title}, ${input.brief}, ${input.roleNeeded},
            ${input.genre}, ${input.language}, ${input.bpm}, ${input.musicalKey}, ${input.kind},
            ${input.songId}, ${input.songVersionId}, ${input.stemPackId}, ${input.rightsWorkId})
        `;
      } else {
        const rows = await db.sql`SELECT * FROM halo_creator_projects WHERE id = ${input.projectId}`;
        const project = rows[0];
        if (!project) return json({ message: "Opportunity not found" }, 404);
        const ownsProject = project.owner_member_id === memberId;
        if (body.action === "close_project") {
          if (!ownsProject) return json({ message: "Only the project owner can close it" }, 403);
          await db.sql`UPDATE halo_creator_projects SET status = 'closed', updated_at = NOW() WHERE id = ${project.id} AND owner_member_id = ${memberId}`;
        } else if (body.action === "invite" || body.action === "apply") {
          if (project.status !== "open") return json({ message: "Opportunity is closed" }, 409);
          if (body.action === "invite" && !ownsProject) return json({ message: "Only the owner can invite" }, 403);
          const targetId = body.action === "apply" ? memberId : input.publicProfileId
            ? await resolveDnaInvite(db, memberId, input.publicProfileId) : input.memberId;
          if (targetId === project.owner_member_id) return json({ message: "The owner is already part of the project" }, 400);
          if (await bilateralBlock(db, project.owner_member_id, targetId)) return json({ message: "Creator is not available" }, 404);
          if (body.action === "invite") {
            const creators = await db.sql`SELECT member_id FROM halo_creator_profiles WHERE member_id = ${targetId} AND discoverable = TRUE`;
            if (!creators.length) return json({ message: "Creator is not available for discovery" }, 404);
          }
          const created = await db.sql`
            INSERT INTO halo_creator_participants (project_id, member_id, initiated_by, kind, message)
            SELECT id, ${targetId}, ${memberId}, ${body.action === "apply" ? "application" : "invite"}, ${input.message}
            FROM halo_creator_projects WHERE id = ${project.id} AND status = 'open'
              AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
                WHERE (b.member_id = owner_member_id AND b.target_member_id = ${targetId})
                  OR (b.member_id = ${targetId} AND b.target_member_id = owner_member_id))
              AND (${input.publicProfileId === null} OR EXISTS (
                SELECT 1 FROM halo_creator_profiles c JOIN halo_creator_dna d USING(member_id)
                WHERE c.member_id = ${targetId} AND c.discoverable = TRUE AND d.visibility IN ('members', 'public')
              ))
            ON CONFLICT (project_id, member_id) DO NOTHING RETURNING member_id
          `;
          if (!created.length) return json({ message: "Already invited/applied, or opportunity closed" }, 409);
        } else {
          const targetId = input.memberId || memberId;
          const participants = await db.sql`SELECT * FROM halo_creator_participants WHERE project_id = ${project.id} AND member_id = ${targetId}`;
          const participant = participants[0];
          if (!participant || !canRespond(participant, project, memberId)) return json({ message: "This pending request cannot be answered by you" }, 403);
          const updated = await db.sql`
            UPDATE halo_creator_participants SET status = ${input.status}, updated_at = NOW()
            WHERE project_id = ${project.id} AND member_id = ${targetId} AND status = 'pending'
              AND EXISTS (SELECT 1 FROM halo_creator_projects WHERE id = ${project.id} AND status = 'open')
            RETURNING member_id
          `;
          if (!updated.length) return json({ message: "Request has already changed or project closed" }, 409);
        }
      }
      return json({ message: "Creator Network updated" });
    } catch (error) {
      if (error instanceof DnaError) return json({ message: error.message }, error.status);
      console.error("HALO Creator Network failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Creator Network is unavailable. Please try again." }, 500);
    }
  };
}
