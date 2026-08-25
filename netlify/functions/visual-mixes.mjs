import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const packageTypes = new Set(["complete", "logo", "hybrid", "full_visual"]);
const visualStyles = new Set(["cinematic_archive", "nightclub_signal", "luxury_lounge", "dreamscape", "artist_world"]);
const transitions = ["crossfade", "film_dissolve", "light_sweep", "hard_cut", "logo_reveal"];
const colorPattern = /^#[0-9a-f]{6}$/i;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeUrl(value) {
  const input = cleanText(value, 1000);
  if (!input) return "";
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function serializeScene(row) {
  return {
    id: row.id,
    position: Number(row.position),
    startSeconds: Number(row.start_seconds),
    endSeconds: Number(row.end_seconds),
    sourceType: row.source_type,
    sourceVideoId: row.source_video_id || "",
    title: row.title,
    direction: row.direction,
    transitionType: row.transition_type,
    videoTitle: row.video_title || "",
    thumbnailUrl: row.thumbnail_url || ""
  };
}

function serializeProject(row, scenes = []) {
  return {
    id: row.id,
    mixId: row.mix_id,
    mixTitle: row.mix_title || "",
    title: row.title,
    packageType: row.package_type,
    brandName: row.brand_name,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    visualStyle: row.visual_style,
    creativeBrief: row.creative_brief,
    durationSeconds: Number(row.duration_seconds),
    status: row.status,
    sceneCount: Number(row.scene_count),
    sourceVideoCount: Number(row.source_video_count),
    updatedAt: new Date(row.updated_at).toISOString(),
    scenes
  };
}

async function loadStudio(db, membership) {
  const [mixRows, videoRows, projectRows] = await Promise.all([
    db.sql`
      SELECT id, title, duration_seconds, artwork_url, original_artist, remixer_name
      FROM halo_mixes
      WHERE member_id = ${membership.member_id}
      ORDER BY created_at DESC
      LIMIT 60
    `,
    db.sql`
      SELECT id::text, title, thumbnail_url, source_type
      FROM halo_videos
      WHERE owner_member_id = ${membership.member_id} AND status = 'published'
      ORDER BY featured DESC, updated_at DESC
      LIMIT 60
    `,
    db.sql`
      SELECT project.*, mix.title AS mix_title
      FROM halo_visual_mix_projects project
      JOIN halo_mixes mix ON mix.id = project.mix_id
      WHERE project.member_id = ${membership.member_id} AND project.status <> 'archived'
      ORDER BY project.updated_at DESC
      LIMIT 30
    `
  ]);
  const projectIds = projectRows.map(row => row.id);
  const sceneRows = projectIds.length
    ? await db.sql`
        SELECT scene.*, video.title AS video_title, video.thumbnail_url
        FROM halo_visual_mix_scenes scene
        LEFT JOIN halo_videos video ON video.id = scene.source_video_id
        WHERE scene.project_id = ANY(${projectIds}::uuid[])
        ORDER BY scene.project_id, scene.position
      `
    : [];
  const scenesByProject = new Map();
  sceneRows.forEach(row => {
    const scenes = scenesByProject.get(row.project_id) || [];
    scenes.push(serializeScene(row));
    scenesByProject.set(row.project_id, scenes);
  });
  return {
    authenticated: true,
    mixes: mixRows.map(row => ({
      id: row.id,
      title: row.title,
      durationSeconds: Number(row.duration_seconds),
      artworkUrl: row.artwork_url || "",
      originalArtist: row.original_artist || "",
      remixerName: row.remixer_name || ""
    })),
    videos: videoRows.map(row => ({ id: row.id, title: row.title, thumbnailUrl: row.thumbnail_url || "", sourceType: row.source_type })),
    projects: projectRows.map(row => serializeProject(row, scenesByProject.get(row.id) || []))
  };
}

function sceneDirection({ sourceType, packageType, visualStyle, creativeBrief, brandName, position, total }) {
  const movement = position === 0
    ? "Open with a deliberate title reveal and establish the visual language."
    : position === total - 1
      ? "Resolve the hour with a restrained closing mark and enough tail for the final audio decay."
      : "Keep movement musical and leave clean space around the next audio transition.";
  if (sourceType === "source_video") return `Use the selected source video as the hero image. Reframe it to match the ${visualStyle.replaceAll("_", " ")} treatment. ${movement}`;
  if (sourceType === "logo_motion") return `Animate ${brandName || "the supplied identity"} as a venue-safe motion loop using the ${visualStyle.replaceAll("_", " ")} treatment. ${movement}`;
  return `Dreamweaver creates an original ${visualStyle.replaceAll("_", " ")} scene from this brief: ${creativeBrief}. ${movement} Package context: ${packageType.replaceAll("_", " ")}.`;
}

function buildScenes(input, videos) {
  const duration = Math.max(60, input.durationSeconds || 3600);
  const targetSceneLength = input.packageType === "logo" ? 300 : input.packageType === "hybrid" ? 180 : 120;
  const count = Math.max(1, Math.min(96, Math.ceil(duration / targetSceneLength)));
  const scenes = [];
  for (let position = 0; position < count; position += 1) {
    const startSeconds = Math.floor((duration * position) / count);
    const endSeconds = Math.max(startSeconds + 1, Math.floor((duration * (position + 1)) / count));
    const usesSourceVideo = (input.packageType === "hybrid" && position % 3 === 1)
      || (input.packageType === "complete" && position % 3 === 1);
    const selectedVideo = usesSourceVideo && videos.length
      ? videos[Math.floor(position / 3) % videos.length]
      : null;
    const usesLogoMotion = input.packageType === "logo"
      || (input.packageType === "complete" && (position === 0 || position === count - 1 || position % 6 === 3));
    const sourceType = selectedVideo ? "source_video" : usesLogoMotion ? "logo_motion" : "dreamweaver";
    const phase = position === 0 ? "Opening identity" : position === count - 1 ? "Closing signal" : `Movement ${String(position + 1).padStart(2, "0")}`;
    scenes.push({
      id: randomUUID(),
      position,
      startSeconds,
      endSeconds,
      sourceType,
      sourceVideoId: selectedVideo?.id || null,
      title: selectedVideo ? selectedVideo.title : sourceType === "logo_motion" ? `${phase} · logo motion` : `${phase} · Dreamweaver`,
      direction: sceneDirection({ ...input, sourceType, position, total: count }),
      transitionType: position === 0 ? "logo_reveal" : transitions[position % transitions.length]
    });
  }
  return scenes;
}

async function createProject(db, membership, body) {
  const mixId = cleanText(body.mixId, 80);
  const mixRows = await db.sql`
    SELECT id, title, duration_seconds
    FROM halo_mixes
    WHERE id = ${mixId} AND member_id = ${membership.member_id}
    LIMIT 1
  `;
  const mix = mixRows[0];
  if (!mix) return json({ message: "Choose one of your Mix Desk recordings" }, 404);

  const packageType = packageTypes.has(body.packageType) ? body.packageType : "complete";
  const visualStyle = visualStyles.has(body.visualStyle) ? body.visualStyle : "cinematic_archive";
  const title = cleanText(body.title, 140) || `${mix.title} visual edition`;
  const brandName = cleanText(body.brandName, 120);
  const creativeBrief = cleanText(body.creativeBrief, 2000);
  const logoUrl = safeUrl(body.logoUrl);
  const primaryColor = colorPattern.test(body.primaryColor || "") ? body.primaryColor : "#d85f35";
  const secondaryColor = colorPattern.test(body.secondaryColor || "") ? body.secondaryColor : "#d7c6a5";
  if (creativeBrief.length < 8) return json({ message: "Give Dreamweaver a clear visual brief" }, 422);
  if (packageType === "logo" && !brandName && !logoUrl) return json({ message: "Add a brand name or logo URL for the logo edition" }, 422);

  const requestedVideoIds = Array.isArray(body.sourceVideoIds)
    ? [...new Set(body.sourceVideoIds.map(value => cleanText(value, 36)).filter(value => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 60)
    : [];
  const videoRows = requestedVideoIds.length
    ? await db.sql`
        SELECT id::text, title
        FROM halo_videos
        WHERE owner_member_id = ${membership.member_id} AND id::text = ANY(${requestedVideoIds}::text[]) AND status = 'published'
        ORDER BY updated_at DESC
      `
    : [];
  const durationSeconds = Math.max(60, Number(mix.duration_seconds) || 3600);
  const scenes = buildScenes({ packageType, visualStyle, creativeBrief, brandName, durationSeconds }, videoRows);
  const projectId = randomUUID();
  await db.sql`
    INSERT INTO halo_visual_mix_projects (
      id, member_id, mix_id, title, package_type, brand_name, logo_url, primary_color,
      secondary_color, visual_style, creative_brief, duration_seconds, scene_count, source_video_count
    ) VALUES (
      ${projectId}, ${membership.member_id}, ${mix.id}, ${title}, ${packageType}, ${brandName}, ${logoUrl},
      ${primaryColor}, ${secondaryColor}, ${visualStyle}, ${creativeBrief}, ${durationSeconds}, ${scenes.length}, ${videoRows.length}
    )
  `;
  for (const scene of scenes) {
    await db.sql`
      INSERT INTO halo_visual_mix_scenes (
        id, project_id, position, start_seconds, end_seconds, source_type,
        source_video_id, title, direction, transition_type
      ) VALUES (
        ${scene.id}, ${projectId}, ${scene.position}, ${scene.startSeconds}, ${scene.endSeconds}, ${scene.sourceType},
        ${scene.sourceVideoId}, ${scene.title}, ${scene.direction}, ${scene.transitionType}
      )
    `;
  }
  return json({ message: `Dreamweaver mapped ${scenes.length} visual movements across the full mix.`, projectId }, 201);
}

async function markRenderBrief(db, membership, body) {
  const projectId = cleanText(body.projectId, 36);
  const rows = await db.sql`
    UPDATE halo_visual_mix_projects
    SET status = 'render_brief_ready', updated_at = NOW()
    WHERE id::text = ${projectId} AND member_id = ${membership.member_id}
    RETURNING id
  `;
  if (!rows.length) return json({ message: "Visual project not found" }, 404);
  return json({ message: "The full visual render brief is ready for production." });
}

export default async function visualMixesHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const user = await getUser().catch(() => null);
    if (!user?.id) return request.method === "GET" ? json({ authenticated: false, mixes: [], videos: [], projects: [] }) : json({ message: "Sign in to build a visual mix" }, 401);
    const membership = await ensureMembership(db, user);
    if (request.method === "GET") return json(await loadStudio(db, membership));
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin visual mix requests are not accepted" }, 403);
    }
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);
    if (body.action === "mark_render_brief") return markRenderBrief(db, membership, body);
    return createProject(db, membership, body);
  } catch (error) {
    console.error("Visual Mix Studio request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Visual Mix Studio could not complete that request" }, 500);
  }
}

export const config = { path: "/api/visual-mixes" };
