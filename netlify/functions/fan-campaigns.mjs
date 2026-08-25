import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 32_000;
const PROMOTION_FIELDS = new Set(["eyebrow", "headline", "caption", "storyTitle", "storySubtitle", "callToAction", "hashtags"]);
const PARTY_THEME_FIELDS = new Set(["atmosphere", "accent", "celebration", "motion", "roomNote"]);
const HOST_PERSONAS = new Set(["halo", "butterfly", "romy"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function slugify(value) {
  return cleanText(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 78);
}

function cleanDateTime(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function cleanTrackIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, 80)).filter(Boolean))].slice(0, 20);
}

function cleanPromotion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => PROMOTION_FIELDS.has(key))
      .map(([key, item]) => [key, cleanText(item, key === "caption" ? 2200 : 300)])
  );
}

function cleanPartyTheme(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const theme = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => PARTY_THEME_FIELDS.has(key))
      .map(([key, item]) => [key, cleanText(item, key === "roomNote" ? 300 : 40)])
  );
  if (!["midnight", "sunset", "butterfly", "electric"].includes(theme.atmosphere)) theme.atmosphere = "midnight";
  if (!["confetti", "streamers", "starlight", "none"].includes(theme.celebration)) theme.celebration = "confetti";
  if (!["full", "gentle", "reduced"].includes(theme.motion)) theme.motion = "gentle";
  if (!/^#[0-9a-f]{6}$/i.test(theme.accent || "")) theme.accent = "#d5ef5a";
  return theme;
}

function cleanPersonaId(value) {
  const id = cleanText(value, 96).toLowerCase();
  return HOST_PERSONAS.has(id) ? id : "halo";
}

function cleanPreflightId(value) {
  const id = cleanText(value, 36).toLowerCase();
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

function defaultPromotion({ title, trackCount, voteGoal, rewardTitle }) {
  const count = Number(trackCount) || 0;
  return {
    eyebrow: "HALO LISTENING PARTY",
    headline: `${count} tracks. One release. You decide.`,
    caption: `${title} is open. Listen to all ${count} tracks, vote for the one that deserves the release, and help the community reach ${voteGoal} votes. When the goal lands, every voter unlocks ${rewardTitle.toLowerCase()}.`,
    storyTitle: "YOU CHOOSE THE RELEASE",
    storySubtitle: `${count} tracks · ${voteGoal} vote community unlock`,
    callToAction: "Listen. Vote. Unlock the mix.",
    hashtags: "#HALOListeningParty #FanSelected #NewMusic"
  };
}

function serializeTrack(row) {
  return {
    id: Number(row.id),
    sourceTrackId: row.source_track_id || "",
    title: row.title,
    artist: row.artist_name,
    description: row.description || "",
    genre: row.genre || "",
    durationSeconds: Number(row.duration_seconds || 0),
    position: Number(row.position),
    votes: Number(row.votes || 0),
    artworkUrl: row.source_track_id ? `/api/radio/artwork?id=${encodeURIComponent(row.source_track_id)}` : "",
    audioUrl: row.source_track_id ? `/api/radio/audio?id=${encodeURIComponent(row.source_track_id)}` : ""
  };
}

function serializeCampaign(row, tracks, viewerVote = null, owner = false) {
  const totalVotes = tracks.reduce((sum, track) => sum + Number(track.votes || 0), 0);
  const goal = Number(row.vote_goal);
  const now = Date.now();
  const startsAt = new Date(row.starts_at).toISOString();
  const endsAt = new Date(row.ends_at).toISOString();
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || "",
    rewardTitle: row.reward_title,
    rewardDescription: row.reward_description || "",
    voteGoal: goal,
    startsAt,
    endsAt,
    status: row.status,
    promotion: row.promotion || {},
    hostPersonaId: row.host_persona_id || "halo",
    partyTheme: row.party_theme || {},
    preflightId: row.preflight_id || "",
    launchedAt: row.launched_at ? new Date(row.launched_at).toISOString() : null,
    tracks: tracks.map(serializeTrack),
    totalVotes,
    progress: Math.min(100, Math.round((totalVotes / goal) * 100)),
    rewardUnlocked: totalVotes >= goal,
    acceptingVotes: row.status === "published" && now >= new Date(startsAt).valueOf() && now < new Date(endsAt).valueOf(),
    viewerVote: viewerVote ? Number(viewerVote) : null,
    owner
  };
}

async function campaignRows(db, campaignId) {
  return db.sql`
    SELECT track.id, track.source_track_id, track.title, track.artist_name, track.description,
      track.genre, track.duration_seconds, track.position, COUNT(vote.voter_key)::int AS votes
    FROM halo_fan_vote_campaign_tracks track
    LEFT JOIN halo_fan_vote_campaign_votes vote ON vote.campaign_track_id = track.id
    WHERE track.campaign_id = ${campaignId}
    GROUP BY track.id
    ORDER BY track.position
  `;
}

async function loadCampaign(db, slug, user) {
  const rows = await db.sql`SELECT * FROM halo_fan_vote_campaigns WHERE slug = ${slug} LIMIT 1`;
  const campaign = rows[0];
  if (!campaign) return null;

  let membership = null;
  if (user?.id) membership = await ensureMembership(db, user);
  const owner = Boolean(membership && (campaign.owner_member_id === membership.member_id || isOwner(user)));
  if (campaign.status === "draft" && !owner) return null;

  let viewerVote = null;
  if (membership) {
    const voteRows = await db.sql`
      SELECT campaign_track_id FROM halo_fan_vote_campaign_votes
      WHERE campaign_id = ${campaign.id} AND voter_key = ${`member:${membership.member_id}`}
      LIMIT 1
    `;
    viewerVote = voteRows[0]?.campaign_track_id || null;
  }
  return serializeCampaign(campaign, await campaignRows(db, campaign.id), viewerVote, owner);
}

async function loadStudio(db, user) {
  if (!user?.id) return json({ authenticated: false, tracks: [], campaigns: [] });
  const membership = await ensureMembership(db, user);
  const owner = isOwner(user);
  const tracks = owner
    ? await db.sql`
        SELECT id, title, artist_name, description, genre, duration_seconds, created_at
        FROM halo_radio_tracks WHERE status IN ('preview', 'rotation')
        ORDER BY created_at DESC LIMIT 50
      `
    : await db.sql`
        SELECT id, title, artist_name, description, genre, duration_seconds, created_at
        FROM halo_radio_tracks
        WHERE member_id = ${membership.member_id} AND status IN ('preview', 'rotation')
        ORDER BY created_at DESC LIMIT 50
      `;
  const campaigns = await db.sql`
    SELECT slug, title, status, vote_goal, ends_at, updated_at,
      (SELECT COUNT(*)::int FROM halo_fan_vote_campaign_votes vote WHERE vote.campaign_id = campaign.id) AS votes,
      (SELECT COUNT(*)::int FROM halo_fan_vote_campaign_tracks track WHERE track.campaign_id = campaign.id) AS track_count
    FROM halo_fan_vote_campaigns campaign
    WHERE owner_member_id = ${membership.member_id}
    ORDER BY updated_at DESC LIMIT 20
  `;
  return json({
    authenticated: true,
    viewer: { name: membership.display_name },
    tracks: tracks.map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist_name,
      description: track.description || "",
      genre: track.genre || "",
      durationSeconds: Number(track.duration_seconds || 0),
      artworkUrl: `/api/radio/artwork?id=${encodeURIComponent(track.id)}`,
      audioUrl: `/api/radio/audio?id=${encodeURIComponent(track.id)}`
    })),
    campaigns: campaigns.map(campaign => ({
      slug: campaign.slug,
      title: campaign.title,
      status: campaign.status,
      voteGoal: Number(campaign.vote_goal),
      votes: Number(campaign.votes),
      trackCount: Number(campaign.track_count),
      endsAt: new Date(campaign.ends_at).toISOString()
    }))
  });
}

async function createCampaign(db, user, body) {
  if (!user?.id) return json({ message: "Sign in to build a listening-party campaign" }, 401);
  const membership = await ensureMembership(db, user);
  const trackIds = cleanTrackIds(body.trackIds);
  if (trackIds.length < 2) return json({ message: "Choose at least two listening-party tracks" }, 400);

  const eligible = isOwner(user)
    ? await db.sql`
        SELECT id, title, artist_name, description, genre, duration_seconds
        FROM halo_radio_tracks WHERE id = ANY(${trackIds}::text[]) AND status IN ('preview', 'rotation')
      `
    : await db.sql`
        SELECT id, title, artist_name, description, genre, duration_seconds
        FROM halo_radio_tracks
        WHERE id = ANY(${trackIds}::text[]) AND member_id = ${membership.member_id} AND status IN ('preview', 'rotation')
      `;
  if (eligible.length !== trackIds.length) return json({ message: "One or more tracks are not available for this campaign" }, 403);

  const title = cleanText(body.title, 140) || "The First Listening Party";
  const subtitle = cleanText(body.subtitle, 240) || "Hear the full shortlist and choose what HALO releases next.";
  const rewardTitle = cleanText(body.rewardTitle, 140) || "Exclusive 60-minute DJ mix";
  const rewardDescription = cleanText(body.rewardDescription, 500) || "Every participating fan receives access when the community reaches the vote goal.";
  const voteGoal = Math.max(10, Math.min(100000, Number.parseInt(body.voteGoal, 10) || 100));
  const endsAt = cleanDateTime(body.endsAt) || new Date(Date.now() + 7 * 86400000);
  if (endsAt.valueOf() <= Date.now() + 3600000) return json({ message: "Choose a campaign deadline at least one hour from now" }, 400);

  const id = randomUUID();
  const slug = `${slugify(title) || "listening-party"}-${id.slice(0, 6)}`;
  const promotion = defaultPromotion({ title, trackCount: trackIds.length, voteGoal, rewardTitle });
  const hostPersonaId = cleanPersonaId(body.hostPersonaId);
  const partyTheme = cleanPartyTheme(body.partyTheme);
  const preflightId = cleanPreflightId(body.preflightId);
  const byId = new Map(eligible.map(track => [track.id, track]));
  const trackValues = trackIds.map((trackId, index) => {
    const track = byId.get(trackId);
    return [
      track.id, track.title, track.artist_name, track.description || "", track.genre || "",
      Number(track.duration_seconds || 0), index + 1
    ];
  });
  const rows = await db.sql`
    WITH track_input (source_track_id, title, artist_name, description, genre, duration_seconds, position) AS (
      VALUES ${db.sql.values(trackValues)}
    ), inserted_campaign AS (
      INSERT INTO halo_fan_vote_campaigns (
        id, slug, owner_member_id, title, subtitle, reward_title, reward_description, vote_goal, ends_at,
        promotion, host_persona_id, party_theme, preflight_id
      ) VALUES (
        ${id}, ${slug}, ${membership.member_id}, ${title}, ${subtitle}, ${rewardTitle}, ${rewardDescription},
        ${voteGoal}, ${endsAt.toISOString()}, ${JSON.stringify(promotion)}::jsonb, ${hostPersonaId},
        ${JSON.stringify(partyTheme)}::jsonb, ${preflightId}
      )
      RETURNING *
    ), inserted_tracks AS (
      INSERT INTO halo_fan_vote_campaign_tracks (
        campaign_id, source_track_id, title, artist_name, description, genre, duration_seconds, position
      )
      SELECT campaign.id, track.source_track_id, track.title, track.artist_name, track.description,
        track.genre, track.duration_seconds, track.position
      FROM track_input AS track
      CROSS JOIN inserted_campaign AS campaign
      RETURNING campaign_id
    )
    SELECT campaign.*, (SELECT COUNT(*)::int FROM inserted_tracks) AS inserted_track_count
    FROM inserted_campaign AS campaign
  `;
  if (Number(rows[0]?.inserted_track_count || 0) !== trackIds.length) throw new Error("Campaign tracks were not saved together");
  return json({ campaign: serializeCampaign(rows[0], await campaignRows(db, id), null, true), message: "Dreamweaver campaign created" }, 201);
}

async function updateCampaign(db, user, body, status, launch = false) {
  if (!user?.id) return json({ message: "Sign in to update this campaign" }, 401);
  const membership = await ensureMembership(db, user);
  const slug = slugify(body.slug);
  const current = await db.sql`SELECT * FROM halo_fan_vote_campaigns WHERE slug = ${slug} LIMIT 1`;
  if (!current.length) return json({ message: "Campaign not found" }, 404);
  if (current[0].owner_member_id !== membership.member_id && !isOwner(user)) return json({ message: "This campaign belongs to another team" }, 403);

  const title = cleanText(body.title, 140) || current[0].title;
  const subtitle = cleanText(body.subtitle, 240);
  const rewardTitle = cleanText(body.rewardTitle, 140) || current[0].reward_title;
  const rewardDescription = cleanText(body.rewardDescription, 500);
  const voteGoal = Math.max(10, Math.min(100000, Number.parseInt(body.voteGoal, 10) || Number(current[0].vote_goal)));
  const endsAt = cleanDateTime(body.endsAt) || new Date(current[0].ends_at);
  const promotion = cleanPromotion(body.promotion);
  const partyTheme = cleanPartyTheme(body.partyTheme || current[0].party_theme);
  const hostPersonaId = cleanPersonaId(body.hostPersonaId || current[0].host_persona_id);
  const preflightId = cleanPreflightId(body.preflightId) || current[0].preflight_id || null;
  const nextStatus = status || current[0].status;
  if (endsAt.valueOf() <= new Date(current[0].starts_at).valueOf()) return json({ message: "The deadline must follow the campaign start" }, 400);

  const rows = await db.sql`
    UPDATE halo_fan_vote_campaigns SET
      title = ${title}, subtitle = ${subtitle}, reward_title = ${rewardTitle},
      reward_description = ${rewardDescription}, vote_goal = ${voteGoal}, ends_at = ${endsAt.toISOString()},
      promotion = ${JSON.stringify(promotion)}::jsonb, party_theme = ${JSON.stringify(partyTheme)}::jsonb,
      host_persona_id = ${hostPersonaId}, preflight_id = ${preflightId}, status = ${nextStatus},
      launched_at = CASE WHEN ${launch} THEN NOW() ELSE launched_at END, updated_at = NOW()
    WHERE id = ${current[0].id}
    RETURNING *
  `;
  const campaign = serializeCampaign(rows[0], await campaignRows(db, rows[0].id), null, true);
  return json({
    campaign,
    launchPack: launch ? {
      path: `/campaign-studio/?campaign=${encodeURIComponent(campaign.slug)}&view=fan`,
      caption: `${campaign.promotion.caption || campaign.title}\n\n${campaign.promotion.hashtags || "#HALOListeningParty"}`,
      hostPersonaId: campaign.hostPersonaId,
      atmosphere: campaign.partyTheme.atmosphere || "midnight"
    } : null,
    message: launch ? "Listening party launched" : nextStatus === "published" ? "Campaign published" : "Campaign saved"
  });
}

async function vote(db, user, body) {
  const slug = slugify(body.slug);
  const campaignRowsFound = await db.sql`
    SELECT * FROM halo_fan_vote_campaigns
    WHERE slug = ${slug} AND status = 'published' AND starts_at <= NOW() AND ends_at > NOW()
    LIMIT 1
  `;
  const campaign = campaignRowsFound[0];
  if (!campaign) return json({ message: "This campaign is not accepting votes" }, 409);
  const trackId = Number.parseInt(body.trackId, 10);
  const trackRows = await db.sql`
    SELECT id FROM halo_fan_vote_campaign_tracks WHERE id = ${trackId} AND campaign_id = ${campaign.id} LIMIT 1
  `;
  if (!trackRows.length) return json({ message: "Choose a track from this campaign" }, 400);

  let memberId = null;
  let voterKey;
  if (user?.id) {
    const membership = await ensureMembership(db, user);
    memberId = membership.member_id;
    voterKey = `member:${memberId}`;
    const deviceToken = cleanText(body.voterToken, 128);
    if (/^[a-zA-Z0-9-]{20,128}$/.test(deviceToken)) {
      const deviceKey = `device:${createHash("sha256").update(`${campaign.id}:${deviceToken}`).digest("hex")}`;
      await db.sql`
        DELETE FROM halo_fan_vote_campaign_votes
        WHERE campaign_id = ${campaign.id} AND voter_key = ${deviceKey}
      `;
    }
  } else {
    const token = cleanText(body.voterToken, 128);
    if (!/^[a-zA-Z0-9-]{20,128}$/.test(token)) return json({ message: "This browser could not be verified for voting" }, 400);
    voterKey = `device:${createHash("sha256").update(`${campaign.id}:${token}`).digest("hex")}`;
  }

  await db.sql`
    INSERT INTO halo_fan_vote_campaign_votes (campaign_id, campaign_track_id, voter_key, member_id)
    VALUES (${campaign.id}, ${trackId}, ${voterKey}, ${memberId})
    ON CONFLICT (campaign_id, voter_key) DO UPDATE SET
      campaign_track_id = EXCLUDED.campaign_track_id,
      member_id = COALESCE(EXCLUDED.member_id, halo_fan_vote_campaign_votes.member_id),
      updated_at = NOW()
  `;
  return json({ campaign: serializeCampaign(campaign, await campaignRows(db, campaign.id), trackId, false), message: "Your vote is in" });
}

export default async function fanCampaignsHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const slug = slugify(url.searchParams.get("slug"));
      if (!slug) return loadStudio(db, user);
      const campaign = await loadCampaign(db, slug, user);
      return campaign ? json({ campaign }) : json({ message: "Campaign not found" }, 404);
    }

    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ message: "Campaign request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);
    if (body.action === "create") return createCampaign(db, user, body);
    if (body.action === "save") return updateCampaign(db, user, body);
    if (body.action === "publish") return updateCampaign(db, user, body, "published");
    if (body.action === "launch") return updateCampaign(db, user, body, "published", true);
    if (body.action === "close") return updateCampaign(db, user, body, "closed");
    if (body.action === "vote") return vote(db, user, body);
    return json({ message: "Choose a supported campaign action" }, 400);
  } catch (error) {
    console.error("HALO fan campaign request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The fan campaign studio is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/fan-campaigns" };
