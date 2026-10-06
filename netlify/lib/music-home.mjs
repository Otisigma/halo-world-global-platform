import { ensureMembership } from "./halo-x.mjs";
import { loadCreatorPass } from "./creator-pass.mjs";
import { loadVisibleDNA } from "./creative-dna.mjs";
import { getCreatorPassEntitlements } from "../../lib/creator-pass.js";
import { defaultMusicHomeConfig, normalizeMusicHomeConfig, getMusicHomeUnlocks,
  MAX_CUSTOM_VIDEO_BYTES, validateCustomVideo } from "../../lib/music-home.js";

const memberPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...responseHeaders, ...headers } });
const backgroundUrl = id => `/api/music-home?creator=${encodeURIComponent(id)}&asset=background`;
const backgroundKey = id => `background/${id}`;
const premium = pass => getCreatorPassEntitlements(pass).customArtistRoom;

class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function readBoundedBody(request, limit) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new RequestError("Invalid Content-Length.");
  }
  if (declared !== null && Number(declared) > limit) throw new RequestError("Request body is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError("Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (declared !== null && Number(declared) !== size) throw new RequestError("Content-Length does not match uploaded bytes.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function loadMusicHomeMilestones(db, memberId) {
  const [stems, splits] = await Promise.all([
    db.sql`
      SELECT COUNT(*) AS stem_uploads FROM halo_stem_files file
      JOIN halo_stem_packs pack ON pack.id = file.pack_id
      WHERE pack.member_id = ${memberId} AND pack.status = 'private'
        AND pack.rights_attested = TRUE AND pack.rights_attested_at IS NOT NULL
    `,
    db.sql`
      SELECT COUNT(*) AS completed_splits FROM halo_artist_rights_works work
      WHERE work.owner_member_id = ${memberId} AND work.rights_status = 'cleared'
        AND EXISTS (
          SELECT 1 FROM halo_creator_projects project
          WHERE project.owner_member_id = ${memberId} AND project.rights_work_id = work.id
        )
        AND EXISTS (
          SELECT 1 FROM halo_artist_rights_participants participant
          WHERE participant.work_id = work.id
          GROUP BY participant.work_id
          HAVING (work.work_type = 'recording'
              AND SUM(participant.share_bps) FILTER (WHERE participant.role = 'master_owner') = 10000)
            OR (work.work_type = 'composition'
              AND SUM(participant.share_bps) FILTER (WHERE participant.role = 'songwriter') = 10000
              AND (COUNT(*) FILTER (WHERE participant.role = 'publisher') = 0
                OR SUM(participant.share_bps) FILTER (WHERE participant.role = 'publisher') = 10000))
        )
    `
  ]);
  const count = value => {
    const number = Number(value || 0);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return { stemUploads: count(stems[0]?.stem_uploads), completedSplits: count(splits[0]?.completed_splits) };
}

function strictConfig(input, context) {
  const keys = Object.keys(defaultMusicHomeConfig(context.creatorId));
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key)) ||
      typeof input.theme !== "string" || typeof input.backgroundMode !== "string" ||
      typeof input.selectedBackgroundUrl !== "string" || !Array.isArray(input.layoutModules) ||
      !Array.isArray(input.unlockedBadges) || input.unlockedBadges.length > 3) {
    throw new RequestError("Invalid Music Home configuration.");
  }
  try { return normalizeMusicHomeConfig(input, context, { strict: true }); }
  catch (error) { throw new RequestError(error.message); }
}

export function createMusicHomeHandler({ getDatabase, getUser, verifyRequestOrigin, getStore,
  membershipFor = ensureMembership, passFor = loadCreatorPass }) {
  async function load(db, memberId) {
    const [homes, profiles, pass, milestones] = await Promise.all([
      db.sql`SELECT config, custom_background_url FROM halo_music_homes WHERE member_id = ${memberId} LIMIT 1`,
      db.sql`SELECT display_name, bio, roles, discoverable FROM halo_creator_profiles WHERE member_id = ${memberId} LIMIT 1`,
      passFor(db, memberId), loadMusicHomeMilestones(db, memberId)
    ]);
    const customBackgroundUrl = homes[0]?.custom_background_url === backgroundUrl(memberId) && premium(pass)
      ? backgroundUrl(memberId) : "";
    const context = { creatorId: memberId, pass, milestones, customBackgroundUrl };
    const config = normalizeMusicHomeConfig(homes[0]?.config, context);
    return { context, config, profile: profiles[0], creatorPass: {
      ...pass, creatorId: memberId, displayName: profiles[0]?.display_name || "", roles: profiles[0]?.roles || [],
      entitlements: getCreatorPassEntitlements(pass)
    } };
  }

  function privatePayload(home) {
    return { config: home.config, creatorPass: home.creatorPass, milestones: home.context.milestones,
      unlocks: getMusicHomeUnlocks(home.context.milestones), customBackgroundUrl: home.context.customBackgroundUrl };
  }

  async function save(db, memberId, config, customUrl, requirePremium = false) {
    // The SQL gate closes the pass-expiry window between the blob write and persistence.
    const rows = await db.sql`
      INSERT INTO halo_music_homes (member_id, config, custom_background_url)
      SELECT ${memberId}, ${JSON.stringify(config)}::jsonb, ${customUrl}
      WHERE ${requirePremium} = FALSE OR EXISTS (
        SELECT 1 FROM halo_creator_passes pass WHERE pass.member_id = ${memberId}
          AND pass.subscription_tier = 'PREMIUM'
          AND ((pass.subscription_status = 'active' AND pass.subscription_expires_at > clock_timestamp())
            OR (pass.subscription_status = 'trialing' AND pass.trial_ends_at > clock_timestamp()
              AND (pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > clock_timestamp())))
      )
      ON CONFLICT (member_id) DO UPDATE SET
        config = EXCLUDED.config, custom_background_url = EXCLUDED.custom_background_url, updated_at = NOW()
      RETURNING member_id
    `;
    if (!rows.length) throw new RequestError("An active Premium Creator Pass is required.", 403);
  }

  async function serveAsset(request, db, memberId, home, owner) {
    if (!premium(home.context.pass) || home.config.backgroundMode !== "CUSTOM_UPLOAD" ||
        home.context.customBackgroundUrl !== backgroundUrl(memberId)) return json({ message: "Background not found." }, 404);
    const store = getStore({ name: "halo-music-home", consistency: "strong" });
    const stored = await store.get(backgroundKey(memberId), { type: "arrayBuffer" });
    if (!stored || stored.byteLength > MAX_CUSTOM_VIDEO_BYTES) return json({ message: "Background not found." }, 404);
    const bytes = new Uint8Array(stored);
    try { validateCustomVideo(bytes, "video/mp4"); }
    catch { return json({ message: "Background not found." }, 404); }
    // Recheck after blob I/O; current configuration and privacy also govern access.
    const current = await load(db, memberId);
    if (!premium(current.context.pass) || current.config.backgroundMode !== "CUSTOM_UPLOAD" ||
        current.context.customBackgroundUrl !== backgroundUrl(memberId) ||
        (!current.profile?.discoverable && !owner)) return json({ message: "Background not found." }, 404);
    let start = 0, end = bytes.length - 1, status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const invalid = () => json({ message: "Invalid byte range." }, 416, { "Content-Range": `bytes */${bytes.length}` });
      if (!match || (!match[1] && !match[2])) return invalid();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return invalid();
        start = Math.max(0, bytes.length - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return invalid();
        end = Math.min(end, bytes.length - 1);
      }
      status = 206;
    }
    return new Response(request.method === "HEAD" ? null : bytes.subarray(start, end + 1), {
      status, headers: { ...responseHeaders, "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) }
    });
  }

  return async function musicHomeHandler(request) {
    if (!["GET", "POST", "HEAD"].includes(request.method)) return json({ message: "Method not allowed." }, 405, { Allow: "GET, HEAD, POST" });
    try {
      const url = new URL(request.url);
      const creator = url.searchParams.get("creator");
      const asset = url.searchParams.get("asset");
      if (creator !== null && !memberPattern.test(creator)) throw new RequestError("Invalid creator ID.");
      if (asset !== null && (asset !== "background" || !creator)) throw new RequestError("Invalid asset.");
      if (request.method === "HEAD" && !asset) return json({ message: "Method not allowed." }, 405, { Allow: "GET, POST" });
      if (request.method === "POST" && (creator !== null || asset !== null)) throw new RequestError("Save your own Music Home without query parameters.");
      const user = await getUser();
      if (!creator && !user?.id) return json({ message: "Sign in to open your Music Home." }, 401);
      if (request.method === "POST" && !(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified." }, 403);
      const db = await getDatabase();
      const membership = user?.id ? await membershipFor(db, user) : null;
      const memberId = creator || membership?.member_id;
      if (!memberId || !memberPattern.test(memberId)) return json({ message: "Sign in to open your Music Home." }, 401);
      const owner = membership?.member_id === memberId;
      const home = await load(db, memberId);
      if (creator && !home.profile?.discoverable && !owner) return json({ message: "Music Home not found." }, 404);
      if (asset) return await serveAsset(request, db, memberId, home, owner);
      if (request.method === "GET") {
        if (!creator) return json(privatePayload(home));
        const releases = await db.sql`
          SELECT campaign.id, campaign.title
          FROM halo_release_campaigns campaign JOIN halo_artist_pages page ON page.slug = campaign.artist_slug
          WHERE page.owner_member_id = ${memberId} AND page.status = 'published'
            AND campaign.status = 'published' AND campaign.visibility = 'public'
          ORDER BY campaign.release_date DESC NULLS LAST, campaign.id LIMIT 24
        `;
        return json({ config: home.config, profile: { displayName: home.profile?.display_name || "", bio: home.profile?.bio || "" },
          milestones: home.context.milestones, modules: {
            SOVEREIGN_VAULT: releases.map(row => ({ id: row.id, title: row.title,
              description: "Published release", url: `/music/?song=${encodeURIComponent(row.id)}` })),
            // Intentional empty modules: no verified public Signal source is wired here,
            // and Creator Network briefs have no explicit public visibility column.
            SIGNAL_FEED: [], COLLAB_BRIEFS: [],
            CREATIVE_DNA: await loadVisibleDNA(db, memberId, membership?.member_id, "home")
          } });
      }
      const mime = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (mime === "video/mp4") {
        if (!premium(home.context.pass)) return json({ message: "An active Premium Creator Pass is required." }, 403);
        const bytes = await readBoundedBody(request, MAX_CUSTOM_VIDEO_BYTES);
        try { validateCustomVideo(bytes, mime); }
        catch (error) { throw new RequestError(error.message); }
        const store = getStore({ name: "halo-music-home", consistency: "strong" });
        await store.set(backgroundKey(memberId), bytes.buffer, { metadata: { memberId, contentType: "video/mp4" } });
        const latest = await load(db, memberId);
        if (!premium(latest.context.pass)) return json({ message: "An active Premium Creator Pass is required." }, 403);
        const customUrl = backgroundUrl(memberId);
        const config = normalizeMusicHomeConfig({ ...latest.config, backgroundMode: "CUSTOM_UPLOAD", selectedBackgroundUrl: customUrl },
          { ...latest.context, customBackgroundUrl: customUrl });
        await save(db, memberId, config, customUrl, true);
      } else if (mime === "application/json") {
        const bytes = await readBoundedBody(request, 16 * 1024);
        let body;
        try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch { throw new RequestError("Request body must be valid JSON."); }
        if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "config")) throw new RequestError("Provide only a config object.");
        const config = strictConfig(body.config, home.context);
        await save(db, memberId, config, home.context.customBackgroundUrl,
          config.backgroundMode === "CUSTOM_UPLOAD" || config.isSovereignModeActive);
      } else return json({ message: "Use application/json or video/mp4." }, 415);
      return json(privatePayload(await load(db, memberId)));
    } catch (error) {
      if (error instanceof RequestError) return json({ message: error.message }, error.status);
      return json({ message: "Music Home is temporarily unavailable." }, 503);
    }
  };
}
