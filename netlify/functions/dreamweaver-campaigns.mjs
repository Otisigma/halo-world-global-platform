import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { generateCampaignPackage, reviewCampaignEvidence } from "../lib/dreamweaver-campaigns.mjs";

const MAX_BODY_BYTES = 24_576;
const templates = new Set(["hook", "story", "invitation"]);
const visualTreatments = new Set(["section", "archive_reel", "collage"]);
const goals = new Set(["awareness", "full_mix_starts", "release_visits", "community_growth"]);
const platforms = new Set(["halo", "tiktok", "instagram", "youtube"]);
const events = new Set(["generated", "copied", "downloaded", "rendered", "publish_ready", "landing", "show_play", "mix_25", "mix_50", "mix_75", "mix_complete"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value) {
  const id = cleanText(value, 80);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

function cleanPlatform(value) {
  const platform = cleanText(value, 24).toLowerCase();
  return platforms.has(platform) ? platform : "halo";
}

function cleanYouTubeUrl(value) {
  try {
    const url = new URL(cleanText(value, 500));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function youtubeSourceType(value) {
  const url = new URL(value);
  if (url.hostname.toLowerCase().replace(/^www\./, "") === "youtu.be" || url.pathname === "/watch") return "video";
  if (url.pathname.startsWith("/shorts/")) return "short";
  if (url.pathname === "/playlist") return "playlist";
  return "channel";
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function pageMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ];
  return decodeHtml(patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean) || "");
}

function xmlValue(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtml(xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

async function loadYouTubeFeed(channelId) {
  if (!/^UC[a-zA-Z0-9_-]{20,30}$/.test(channelId)) return [];
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      headers: { "User-Agent": "HALO-Dreamweaver/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].slice(0, 12).map(match => {
      const entry = match[1];
      const videoId = xmlValue(entry, "yt:videoId");
      return {
        videoId,
        title: cleanText(xmlValue(entry, "title"), 180),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
        thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "",
        publishedAt: cleanText(xmlValue(entry, "published"), 40)
      };
    }).filter(video => video.videoId && video.title);
  } catch {
    return [];
  }
}

async function loadYouTubeContext(source) {
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": "HALO-Dreamweaver/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) return { ...source, title: "", description: "", image: "" };
    const html = (await response.text()).slice(0, 1_500_000);
    const channelId = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,30})"/)?.[1]
      || html.match(/itemprop=["']channelId["'][^>]+content=["'](UC[a-zA-Z0-9_-]{20,30})["']/i)?.[1]
      || "";
    return {
      ...source,
      title: cleanText(pageMeta(html, "og:title") || pageMeta(html, "twitter:title"), 180),
      description: cleanText(pageMeta(html, "og:description") || pageMeta(html, "description"), 500),
      image: cleanText(pageMeta(html, "og:image") || pageMeta(html, "twitter:image"), 1000),
      channelId,
      recentVideos: await loadYouTubeFeed(channelId)
    };
  } catch {
    return { ...source, title: "", description: "", image: "", channelId: "", recentVideos: [] };
  }
}

function serialize(row, metrics = {}) {
  return {
    id: row.id,
    mixId: row.mix_id,
    title: row.title,
    artistName: row.artist_name,
    clipStartSeconds: Number(row.clip_start_seconds || 0),
    clipDurationSeconds: Number(row.clip_duration_seconds || 30),
    template: row.template,
    goal: row.goal,
    destinationUrl: row.destination_url,
    status: row.status,
    package: row.package || {},
    recommendations: row.recommendations || {},
    performanceScore: Number(row.performance_score || 0),
    model: row.model,
    metrics,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null
  };
}

function serializeJob(row, campaign = null) {
  return {
    id: row.id,
    mixId: row.mix_id,
    campaignId: row.campaign_id || null,
    status: row.status,
    stage: row.stage,
    progress: Number(row.progress || 0),
    usedFallback: Boolean(row.used_fallback),
    errorMessage: row.error_message || "",
    request: row.request || {},
    campaign,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

async function aggregateEvents(db, campaignIds) {
  if (!campaignIds.length) return new Map();
  const rows = await db.sql`
    SELECT campaign_id, event_kind, COUNT(*)::int AS count
    FROM halo_dreamweaver_campaign_events
    WHERE campaign_id = ANY(${campaignIds}::text[])
    GROUP BY campaign_id, event_kind
  `;
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.campaign_id)) result.set(row.campaign_id, {});
    result.get(row.campaign_id)[row.event_kind] = Number(row.count || 0);
  }
  return result;
}

async function listCampaigns(db, user, mixId) {
  if (!user?.id) return [];
  const membership = await ensureMembership(db, user);
  const rows = mixId
    ? await db.sql`SELECT * FROM halo_dreamweaver_campaigns WHERE member_id = ${membership.member_id} AND mix_id = ${mixId} ORDER BY updated_at DESC LIMIT 20`
    : await db.sql`SELECT * FROM halo_dreamweaver_campaigns WHERE member_id = ${membership.member_id} ORDER BY updated_at DESC LIMIT 20`;
  const metrics = await aggregateEvents(db, rows.map(row => row.id));
  return rows.map(row => serialize(row, metrics.get(row.id) || {}));
}

async function listJobs(db, membership, mixId) {
  const rows = await db.sql`
    SELECT * FROM halo_dreamweaver_campaign_jobs
    WHERE member_id = ${membership.member_id}
      AND mix_id = ${mixId}
      AND status IN ('queued', 'working')
    ORDER BY updated_at DESC
    LIMIT 3
  `;
  return rows.map(row => serializeJob(row));
}

async function loadJob(db, membership, jobId) {
  const rows = await db.sql`
    SELECT job.*, campaign.id AS completed_campaign_id
    FROM halo_dreamweaver_campaign_jobs AS job
    LEFT JOIN halo_dreamweaver_campaigns AS campaign ON campaign.id = job.campaign_id
    WHERE job.id = ${jobId} AND job.member_id = ${membership.member_id}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  let campaign = null;
  if (rows[0].campaign_id) {
    const campaignRows = await db.sql`SELECT * FROM halo_dreamweaver_campaigns WHERE id = ${rows[0].campaign_id} LIMIT 1`;
    if (campaignRows[0]) campaign = serialize(campaignRows[0], { generated: 1 });
  }
  return serializeJob(rows[0], campaign);
}

async function loadAccessibleMix(db, membership, mixId) {
  const rows = await db.sql`
    SELECT mix.id, mix.title, mix.description, mix.duration_seconds, mix.track_count,
      profile.display_name AS artist_name
    FROM halo_mixes AS mix
    JOIN community_profiles AS profile ON profile.actor_id = mix.actor_id
    WHERE mix.id = ${mixId}
      AND (mix.visibility = 'room' OR mix.member_id = ${membership.member_id})
    LIMIT 1
  `;
  return rows[0] || null;
}

function cleanSourceVideoIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanId).filter(Boolean))].slice(0, 8);
}

function productionPlan(input, videos) {
  const usable = videos.filter(video => video.source_type === "upload");
  const references = videos.map(video => ({
    id: video.id,
    title: video.title,
    sourceType: video.source_type,
    sourceUrl: video.source_type === "upload" ? `/api/videos?media=${video.id}` : video.source_url,
    thumbnailUrl: video.thumbnail_url || ""
  }));
  const cutCount = input.visualTreatment === "collage" ? 6 : input.visualTreatment === "archive_reel" ? 4 : 1;
  return {
    visualTreatment: input.visualTreatment,
    youtubeSource: input.youtubeSource || null,
    sourceVideos: references,
    usableVideoCount: usable.length,
    audioExcerpt: { startSeconds: input.clipStartSeconds, durationSeconds: input.clipDurationSeconds, source: "selected_mix" },
    sequence: Array.from({ length: cutCount }, (_, index) => ({
      order: index + 1,
      sourceVideoId: usable.length ? usable[index % usable.length].id : null,
      startAtSeconds: Math.round(index * input.clipDurationSeconds / cutCount),
      durationSeconds: Math.max(2, Math.round(input.clipDurationSeconds / cutCount)),
      purpose: index === 0 ? "opening_hook" : index === cutCount - 1 ? "full_show_invitation" : "archive_movement"
    })),
    rightsNote: "Only artist-controlled HALO media selected for this campaign is included. Confirm music, image, video, and contributor approvals before publishing."
  };
}

async function updateJob(db, jobId, stage, progress) {
  await db.sql`
    UPDATE halo_dreamweaver_campaign_jobs
    SET status = 'working', stage = ${stage}, progress = ${progress}, updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

async function processCampaignJob(jobId) {
  const db = getDatabase();
  try {
    const claimed = await db.sql`
      UPDATE halo_dreamweaver_campaign_jobs
      SET status = 'working', stage = 'gathering', progress = 16, updated_at = NOW()
      WHERE id = ${jobId} AND status = 'queued'
      RETURNING *
    `;
    const job = claimed[0];
    if (!job) return;
    const input = job.request || {};
    const sourceVideoIds = cleanSourceVideoIds(input.sourceVideoIds);
    const videos = sourceVideoIds.length ? await db.sql`
      SELECT id::text, title, source_type, source_url, thumbnail_url
      FROM halo_videos
      WHERE id::text = ANY(${sourceVideoIds}::text[])
        AND owner_member_id = ${job.member_id}
        AND status = 'published'
      ORDER BY featured DESC, created_at DESC
    ` : [];
    const youtubeSource = await loadYouTubeContext(input.youtubeSource || {});
    input.youtubeSource = youtubeSource;
    await updateJob(db, jobId, "planning", 38);
    const plan = productionPlan(input, videos);
    await updateJob(db, jobId, "writing", 62);
    const generated = await generateCampaignPackage({
      ...input,
      approvedVideoTitles: videos.map(video => video.title),
      youtubeSourceTitle: youtubeSource.title,
      youtubeSourceDescription: youtubeSource.description,
      youtubeRecentVideoTitles: youtubeSource.recentVideos.map(video => video.title)
    });
    await updateJob(db, jobId, "packaging", 88);
    const campaignPackage = { ...generated.package, productionPlan: plan };
    const rows = await db.sql`
      INSERT INTO halo_dreamweaver_campaigns (
        id, member_id, mix_id, title, artist_name, clip_start_seconds, clip_duration_seconds,
        template, goal, destination_url, package, model
      ) VALUES (
        ${input.campaignId}, ${job.member_id}, ${job.mix_id}, ${campaignPackage.campaignTitle}, ${input.artistName},
        ${input.clipStartSeconds}, ${input.clipDurationSeconds}, ${input.template}, ${input.goal}, ${input.destinationUrl},
        ${JSON.stringify(campaignPackage)}::jsonb, ${generated.model}
      ) RETURNING *
    `;
    await db.sql`
      INSERT INTO halo_dreamweaver_campaign_events (campaign_id, event_kind, platform)
      VALUES (${input.campaignId}, 'generated', 'halo')
    `;
    await db.sql`
      UPDATE halo_dreamweaver_campaign_jobs
      SET campaign_id = ${rows[0].id}, status = 'ready', stage = 'ready', progress = 100,
        used_fallback = ${generated.usedFallback}, error_message = '', completed_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId}
    `;
  } catch (error) {
    console.error("Dreamweaver background campaign job failed", error instanceof Error ? error.message : "unknown error");
    await db.sql`
      UPDATE halo_dreamweaver_campaign_jobs
      SET status = 'failed', stage = 'failed', progress = 100,
        error_message = 'Dreamweaver could not finish this build. The saved source material was not published or changed.',
        completed_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId}
    `;
  }
}

async function startGenerate(db, user, body, context) {
  if (!user?.id) return json({ message: "Sign in to create and save a Dreamweaver campaign" }, 401);
  const membership = await ensureMembership(db, user);
  const mixId = cleanText(body.mixId, 80);
  const mix = await loadAccessibleMix(db, membership, mixId);
  if (!mix) return json({ message: "Choose an available Mix Desk recording" }, 404);
  const recentRows = await db.sql`
    SELECT COUNT(*)::int AS count FROM halo_dreamweaver_campaign_jobs
    WHERE member_id = ${membership.member_id} AND created_at >= NOW() - INTERVAL '1 day'
  `;
  if (Number(recentRows[0]?.count || 0) >= 12) return json({ message: "Today's Dreamweaver campaign allowance is complete. Refine an existing package or return tomorrow." }, 429);

  const duration = [15, 30, 45].includes(Number(body.clipDurationSeconds)) ? Number(body.clipDurationSeconds) : 30;
  const maxStart = Math.max(0, Number(mix.duration_seconds || 0) - duration);
  const start = Math.max(0, Math.min(maxStart, Math.round(Number(body.clipStartSeconds) || 0)));
  const template = templates.has(body.template) ? body.template : "hook";
  const visualTreatment = visualTreatments.has(body.visualTreatment) ? body.visualTreatment : "archive_reel";
  const goal = goals.has(body.goal) ? body.goal : "full_mix_starts";
  const headline = cleanText(body.headline, 120);
  const youtubeUrl = cleanYouTubeUrl(body.youtubeUrl);
  if (!youtubeUrl) return json({ message: "Paste a valid YouTube channel, playlist, Short, or video link" }, 422);
  const youtubeType = youtubeSourceType(youtubeUrl);
  let sourceVideoIds = cleanSourceVideoIds(body.sourceVideoIds);
  if (!sourceVideoIds.length) {
    const galleryRows = await db.sql`
      SELECT id::text
      FROM halo_videos
      WHERE owner_member_id = ${membership.member_id}
        AND status = 'published'
        AND (gallery_visible = TRUE OR sofa_visible = TRUE)
      ORDER BY featured DESC, updated_at DESC
      LIMIT 8
    `;
    sourceVideoIds = galleryRows.map(row => row.id);
  }
  const youtubeSourceId = randomUUID();
  await db.sql`
    INSERT INTO halo_youtube_sources (id, member_id, label, source_url, source_type, channel_url, notes)
    VALUES (
      ${youtubeSourceId}, ${membership.member_id}, ${`${mix.artist_name || "HALO artist"} Dreamweaver source`},
      ${youtubeUrl}, ${youtubeType}, ${youtubeType === "channel" ? youtubeUrl : ""},
      'Added automatically from the one-link Dreamweaver campaign flow.'
    )
    ON CONFLICT (member_id, source_url) DO UPDATE SET
      label = EXCLUDED.label,
      source_type = EXCLUDED.source_type,
      channel_url = CASE WHEN EXCLUDED.channel_url = '' THEN halo_youtube_sources.channel_url ELSE EXCLUDED.channel_url END,
      updated_at = NOW()
  `;
  const campaignId = randomUUID();
  const jobId = randomUUID();
  const destinationUrl = `/dreamweaver/?mix=${encodeURIComponent(mix.id)}&campaign=${encodeURIComponent(campaignId)}`;
  const input = {
    campaignId,
    mixTitle: mix.title,
    mixDescription: cleanText(mix.description, 320),
    artistName: mix.artist_name || "HALO artist",
    mixDurationSeconds: Number(mix.duration_seconds || 0),
    trackCount: Number(mix.track_count || 0),
    clipStartSeconds: start,
    clipDurationSeconds: duration,
    template,
    visualTreatment,
    goal,
    headline,
    destinationUrl,
    sourceVideoIds,
    youtubeSource: { url: youtubeUrl, type: youtubeType }
  };
  const rows = await db.sql`
    INSERT INTO halo_dreamweaver_campaign_jobs (id, member_id, mix_id, request)
    VALUES (${jobId}, ${membership.member_id}, ${mix.id}, ${JSON.stringify(input)}::jsonb)
    RETURNING *
  `;
  const work = processCampaignJob(jobId);
  if (context?.waitUntil) context.waitUntil(work);
  else await work;
  return json({ job: serializeJob(rows[0]), message: "Dreamweaver campaign build started" }, 202);
}

async function track(db, body) {
  const campaignId = cleanId(body.campaignId);
  const eventKind = cleanText(body.eventKind, 30);
  if (!campaignId || !events.has(eventKind)) return json({ message: "Campaign event is invalid" }, 422);
  const existing = await db.sql`SELECT id FROM halo_dreamweaver_campaigns WHERE id = ${campaignId} LIMIT 1`;
  if (!existing[0]) return json({ message: "Campaign not found" }, 404);
  const sessionToken = cleanText(body.sessionToken, 128);
  const sessionKey = sessionToken ? createHash("sha256").update(`${campaignId}:${sessionToken}`).digest("hex") : "";
  const countRows = await db.sql`
    SELECT COUNT(*)::int AS count FROM halo_dreamweaver_campaign_events
    WHERE campaign_id = ${campaignId} AND session_key = ${sessionKey} AND created_at >= NOW() - INTERVAL '1 minute'
  `;
  if (Number(countRows[0]?.count || 0) >= 20) return json({ message: "Campaign event rate limit exceeded" }, 429);
  const variant = cleanText(body.variant, 40) || "primary";
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? Object.fromEntries(Object.entries(body.metadata).slice(0, 6).map(([key, value]) => [cleanText(key, 40), cleanText(value, 100)]))
    : {};
  await db.sql`
    INSERT INTO halo_dreamweaver_campaign_events (campaign_id, event_kind, platform, variant, session_key, metadata)
    VALUES (${campaignId}, ${eventKind}, ${cleanPlatform(body.platform)}, ${variant}, ${sessionKey}, ${JSON.stringify(metadata)}::jsonb)
  `;
  return json({ accepted: true }, 202);
}

async function review(db, user, body) {
  if (!user?.id) return json({ message: "Sign in to review campaign performance" }, 401);
  const membership = await ensureMembership(db, user);
  const campaignId = cleanId(body.campaignId);
  const rows = await db.sql`
    SELECT * FROM halo_dreamweaver_campaigns
    WHERE id = ${campaignId} AND member_id = ${membership.member_id}
    LIMIT 1
  `;
  if (!rows[0]) return json({ message: "Campaign not found" }, 404);
  const metricsMap = await aggregateEvents(db, [campaignId]);
  const assessment = await reviewCampaignEvidence(metricsMap.get(campaignId) || {}, rows[0]);
  const updated = await db.sql`
    UPDATE halo_dreamweaver_campaigns
    SET recommendations = ${JSON.stringify(assessment)}::jsonb,
      performance_score = ${assessment.score}, last_reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${campaignId}
    RETURNING *
  `;
  return json({ campaign: serialize(updated[0], metricsMap.get(campaignId) || {}), message: "Gemma performance review completed" });
}

export default async function dreamweaverCampaignsHandler(request, context) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const db = getDatabase();
    const user = await getUser().catch(() => null);
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const mixId = cleanText(params.get("mixId"), 80);
      const jobId = cleanId(params.get("jobId"));
      if (!user?.id) return json(jobId ? { message: "Sign in to read this campaign build" } : { campaigns: [], jobs: [] }, jobId ? 401 : 200);
      const membership = await ensureMembership(db, user);
      if (jobId) {
        const job = await loadJob(db, membership, jobId);
        return job ? json({ job }) : json({ message: "Campaign build not found" }, 404);
      }
      return json({ campaigns: await listCampaigns(db, user, mixId), jobs: mixId ? await listJobs(db, membership, mixId) : [] });
    }
    if (!(await verifyRequestOrigin(request))) return json({ message: "Cross-origin campaign updates are not accepted" }, 403);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ message: "Campaign request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Campaign request must be valid JSON" }, 400);
    if (body.action === "generate" || body.action === "start") return startGenerate(db, user, body, context);
    if (body.action === "track") return track(db, body);
    if (body.action === "review") return review(db, user, body);
    return json({ message: "Choose a supported Dreamweaver campaign action" }, 400);
  } catch (error) {
    console.error("Dreamweaver campaign request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Dreamweaver Campaign Studio is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/dreamweaver-campaigns" };
