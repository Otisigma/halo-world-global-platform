import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const songStore = getStore({ name: "halo-dreamweaver-songs", consistency: "strong" });
const allowedTypes = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm"]);
const maxChunkBytes = 4 * 1024 * 1024;
const maxUploadBytes = 128 * 1024 * 1024;
const model = "gpt-5.4-mini";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanUploadId(value) {
  const uploadId = cleanText(value, 80);
  return /^[a-z0-9-]{16,80}$/i.test(uploadId) ? uploadId : "";
}

function normalizeAudioType(value, fileName = "") {
  const contentType = cleanText(value, 80).split(";")[0].toLowerCase();
  const aliases = { "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "application/ogg": "audio/ogg" };
  if (aliases[contentType]) return aliases[contentType];
  if (allowedTypes.has(contentType)) return contentType;
  if (/\.wav$/i.test(fileName)) return "audio/wav";
  if (/\.mp3$/i.test(fileName)) return "audio/mpeg";
  if (/\.(m4a|mp4)$/i.test(fileName)) return "audio/mp4";
  if (/\.aac$/i.test(fileName)) return "audio/aac";
  if (/\.ogg$/i.test(fileName)) return "audio/ogg";
  if (/\.webm$/i.test(fileName)) return "audio/webm";
  return contentType;
}

function safeNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sanitizeEvidence(input) {
  const evidence = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    durationSeconds: safeNumber(evidence.durationSeconds, 0, 21600),
    sampleRate: Math.round(safeNumber(evidence.sampleRate, 8000, 384000)),
    channels: Math.round(safeNumber(evidence.channels, 1, 16, 1)),
    estimatedBpm: Math.round(safeNumber(evidence.estimatedBpm, 40, 240)),
    estimatedKey: cleanText(evidence.estimatedKey, 30),
    keyConfidence: safeNumber(evidence.keyConfidence, 0, 1),
    averageRms: safeNumber(evidence.averageRms, 0, 1),
    peak: safeNumber(evidence.peak, 0, 1),
    crestFactorDb: safeNumber(evidence.crestFactorDb, 0, 60),
    dynamicRangeDb: safeNumber(evidence.dynamicRangeDb, 0, 60),
    stereoWidth: safeNumber(evidence.stereoWidth, 0, 2),
    spectralCentroidHz: safeNumber(evidence.spectralCentroidHz, 0, 30000),
    zeroCrossingRate: safeNumber(evidence.zeroCrossingRate, 0, 1),
    sectionEnergy: Array.isArray(evidence.sectionEnergy)
      ? evidence.sectionEnergy.slice(0, 12).map(item => safeNumber(item, 0, 1))
      : []
  };
}

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    fileName: row.file_name,
    durationSeconds: Number(row.duration_seconds || 0),
    analysis: row.analysis_evidence || {},
    creativePackage: row.creative_package || {},
    status: row.status,
    errorMessage: row.error_message || "",
    artworkUrl: row.artwork_key ? `/api/dreamweaver-song-lab?projectId=${encodeURIComponent(row.id)}&asset=artwork` : "",
    model: row.model || "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

const packageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sonicSummary: { type: "string" },
    confidenceNote: { type: "string" },
    moodWords: { type: "array", minItems: 4, maxItems: 8, items: { type: "string" } },
    genreInfluences: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
    structureNotes: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    mixNotes: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    audience: { type: "string" },
    playlistPositioning: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    lyricThemes: { type: "array", minItems: 0, maxItems: 6, items: { type: "string" } },
    visualDirection: {
      type: "object",
      additionalProperties: false,
      properties: {
        concept: { type: "string" },
        palette: { type: "array", minItems: 4, maxItems: 6, items: { type: "string" } },
        typography: { type: "string" },
        symbols: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
        coverPrompt: { type: "string" }
      },
      required: ["concept", "palette", "typography", "symbols", "coverPrompt"]
    },
    campaign: {
      type: "object",
      additionalProperties: false,
      properties: {
        tagline: { type: "string" },
        releaseCopy: { type: "string" },
        shortCaptions: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
        rollout: { type: "array", minItems: 5, maxItems: 7, items: { type: "string" } },
        videoConcepts: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
        radioPitch: { type: "string" }
      },
      required: ["tagline", "releaseCopy", "shortCaptions", "rollout", "videoConcepts", "radioPitch"]
    },
    factualLimits: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }
  },
  required: ["sonicSummary", "confidenceNote", "moodWords", "genreInfluences", "structureNotes", "mixNotes", "audience", "playlistPositioning", "lyricThemes", "visualDirection", "campaign", "factualLimits"]
};

function fallbackPackage(song) {
  const bpm = Math.round(Number(song.analysis_evidence?.estimatedBpm || 0));
  const key = song.analysis_evidence?.estimatedKey || "unconfirmed key";
  return {
    sonicSummary: `${song.title} presents as a ${bpm || "tempo-unconfirmed"} BPM recording in ${key}, with its strongest creative signal coming from the measured energy contour and dynamics.`,
    confidenceNote: "This package uses automated waveform measurements. Confirm tempo, key, lyrics, credits, and genre language before publishing.",
    moodWords: ["cinematic", "focused", "textural", "forward", "independent"],
    genreInfluences: ["artist-defined contemporary", "cinematic release music"],
    structureNotes: ["Use the measured energy rise to identify the strongest opening hook.", "Compare the quietest and loudest sections before selecting the campaign excerpt.", "Confirm section names by listening; waveform energy alone cannot identify verses or choruses."],
    mixNotes: ["Check the loudest peak for unwanted clipping.", "Listen on headphones and small speakers before release.", "Treat automated dynamics and brightness readings as directional, not mastering certification."],
    audience: "Listeners drawn to artist-led releases with a strong visual world and a clear emotional premise.",
    playlistPositioning: ["Independent discovery", "Late-night listening", "Cinematic mood", "Artist story playlists"],
    lyricThemes: song.lyrics ? ["Use the supplied lyrics to confirm the central promise and recurring image."] : [],
    visualDirection: {
      concept: "A suspended signal becoming visible: one tactile object emerging through atmosphere, grain, and controlled light.",
      palette: ["ink black", "aged ivory", "signal green", "burnished gold", "smoke grey"],
      typography: "Editorial serif title paired with restrained technical microtype.",
      symbols: ["signal line", "threshold", "halo", "torn paper"],
      coverPrompt: `Original square album cover for ${song.title}; tactile editorial collage, dark atmospheric field, one luminous signal, aged paper grain, no logos, no imitation of any artist.`
    },
    campaign: {
      tagline: "The signal becomes a world.",
      releaseCopy: `${song.title} enters HALO through Dreamweaver: a release shaped from its own dynamics, atmosphere, and artist-provided story.`,
      shortCaptions: ["Hear the signal before the story settles.", "One song. One world taking shape.", "Built from the wave, finished by the artist."],
      rollout: ["Reveal the cover detail.", "Post the strongest measured energy moment.", "Share one artist note about the song's origin.", "Release a vertical visualizer excerpt.", "Open the full-listen destination."],
      videoConcepts: ["Waveform light crossing a dark room.", "Tactile collage assembled in rhythm.", "A single performance frame interrupted by lyric fragments."],
      radioPitch: `${song.title} is an artist-led release with a measured sonic profile and an original Dreamweaver visual campaign.`
    },
    factualLimits: ["Credits and ownership were not inferred from audio.", "Sample and clearance status were not determined.", "Tempo, key, and structure remain automated estimates until reviewed by a person."]
  };
}

async function generatePackage(song) {
  const fallback = fallbackPackage(song);
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are Dreamweaver Song Lab inside HALO. Build an original, artist-controlled release package using only supplied waveform measurements and artist-entered context. Treat tempo, key, structure, genre, and mood as estimates. Never invent credits, ownership, samples, clearances, release history, audience metrics, lyric content, or external facts. Do not imitate a named living artist's visual style or branding. Give useful, specific creative direction without claiming mastering certification. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            song: { title: song.title, artistName: song.artist_name, creativeBrief: song.creative_brief, suppliedLyrics: song.lyrics },
            waveformEvidence: song.analysis_evidence,
            requiredDisclaimer: "Waveform analysis is directional and factual music metadata must be confirmed by the artist."
          })
        }
      ],
      response_format: { type: "json_schema", json_schema: { name: "dreamweaver_song_package", strict: true, schema: packageSchema } }
    });
    return { package: JSON.parse(completion.choices[0]?.message?.content || "null") || fallback, usedFallback: false };
  } catch (error) {
    console.error("Dreamweaver package generation failed", error instanceof Error ? error.message : "unknown error");
    return { package: fallback, usedFallback: true };
  }
}

async function generateArtwork(song, creativePackage) {
  try {
    const openai = new OpenAI();
    const prompt = [
      "Create an original square album cover. Do not include logos, signatures, watermarks, celebrity likenesses, or imitate any named artist or existing album campaign.",
      `Title context: ${song.title}. Artist context: ${song.artist_name || "independent artist"}.`,
      creativePackage.visualDirection?.coverPrompt || creativePackage.visualDirection?.concept || "Atmospheric editorial artwork.",
      `Palette: ${(creativePackage.visualDirection?.palette || []).join(", ")}.`,
      "Leave intentional negative space for optional typography; do not render readable text."
    ].join("\n");
    const result = await openai.images.generate({ model: "gpt-image-1", prompt, size: "1024x1024", quality: "low" });
    const base64 = result.data?.[0]?.b64_json;
    if (!base64) return null;
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) return null;
    const artworkKey = `${song.member_id}/${song.id}/artwork.png`;
    await songStore.set(artworkKey, bytes, { metadata: { contentType: "image/png" } });
    return { artworkKey, artworkContentType: "image/png" };
  } catch (error) {
    console.error("Dreamweaver artwork generation failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function processProject(projectId) {
  const db = getDatabase();
  const rows = await db.sql`SELECT * FROM halo_dreamweaver_songs WHERE id = ${projectId} LIMIT 1`;
  const song = rows[0];
  if (!song) return;
  try {
    await db.sql`UPDATE halo_dreamweaver_songs SET status = 'analyzing', error_message = '', updated_at = NOW() WHERE id = ${projectId}`;
    const generated = await generatePackage(song);
    const artwork = await generateArtwork(song, generated.package);
    await db.sql`
      UPDATE halo_dreamweaver_songs
      SET creative_package = ${JSON.stringify(generated.package)}::jsonb,
        artwork_key = ${artwork?.artworkKey || ''},
        artwork_content_type = ${artwork?.artworkContentType || ''},
        status = 'ready', model = ${generated.usedFallback ? 'fallback' : model}, updated_at = NOW()
      WHERE id = ${projectId}
    `;
  } catch (error) {
    console.error("Dreamweaver project processing failed", error instanceof Error ? error.message : "unknown error");
    await db.sql`
      UPDATE halo_dreamweaver_songs
      SET status = 'failed', error_message = 'The creative package stopped before completion. Your upload remains private.', updated_at = NOW()
      WHERE id = ${projectId}
    `;
  }
}

async function uploadChunk(request, db, user) {
  if (!user?.id) return json({ message: "Sign in to upload a song" }, 401);
  const membership = await ensureMembership(db, user);
  const form = await request.formData().catch(() => null);
  const chunk = form?.get("chunk");
  const uploadId = cleanUploadId(form?.get("uploadId"));
  const chunkIndex = Number.parseInt(form?.get("chunkIndex"), 10);
  const chunkCount = Number.parseInt(form?.get("chunkCount"), 10);
  if (!(chunk instanceof File) || !uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 0 || chunkIndex >= chunkCount || chunkCount < 1 || chunkCount > 64) {
    return json({ message: "This upload chunk is invalid" }, 400);
  }
  if (!chunk.size || chunk.size > maxChunkBytes) return json({ message: "This upload chunk is too large" }, 413);
  const blobPrefix = `${membership.member_id}/${uploadId}/parts/`;
  const key = `${blobPrefix}${String(chunkIndex).padStart(3, "0")}`;
  await songStore.set(key, await chunk.arrayBuffer(), { metadata: { contentType: normalizeAudioType(chunk.type, chunk.name) } });
  return json({ message: "Song chunk uploaded", chunkIndex });
}

async function finalizeProject(request, context, db, user) {
  if (!user?.id) return json({ message: "Sign in to analyze a song" }, 401);
  const membership = await ensureMembership(db, user);
  const body = await request.json().catch(() => null);
  if (!body || body.action !== "analyze") return json({ message: "Choose a supported Song Lab action" }, 400);
  const uploadId = cleanUploadId(body.uploadId);
  const fileName = cleanText(body.fileName, 180);
  const contentType = normalizeAudioType(body.contentType, fileName);
  const chunkCount = Math.max(1, Math.min(64, Number.parseInt(body.chunkCount, 10) || 0));
  const byteSize = Math.round(safeNumber(body.byteSize, 1, maxUploadBytes));
  const title = cleanText(body.title, 140);
  if (!uploadId || !title || !fileName || !allowedTypes.has(contentType) || !body.rightsAttested) return json({ message: "Add the song details and confirm you may use this audio" }, 422);
  const blobPrefix = `${membership.member_id}/${uploadId}/parts/`;
  const stored = await songStore.list({ prefix: blobPrefix });
  if (stored.blobs.length !== chunkCount) return json({ message: "The song upload is incomplete" }, 409);
  const evidence = sanitizeEvidence(body.analysis);
  const rows = await db.sql`
    INSERT INTO halo_dreamweaver_songs (
      id, member_id, title, artist_name, file_name, blob_prefix, chunk_count, content_type, byte_size,
      duration_seconds, rights_attested, creative_brief, lyrics, analysis_evidence, status
    ) VALUES (
      ${randomUUID()}, ${membership.member_id}, ${title}, ${cleanText(body.artistName, 140)}, ${fileName}, ${blobPrefix},
      ${chunkCount}, ${contentType}, ${byteSize}, ${evidence.durationSeconds}, TRUE,
      ${cleanText(body.creativeBrief, 1200)}, ${cleanText(body.lyrics, 8000)}, ${JSON.stringify(evidence)}::jsonb, 'queued'
    ) RETURNING *
  `;
  const project = rows[0];
  const work = processProject(project.id);
  if (context?.waitUntil) context.waitUntil(work);
  else await work;
  return json({ project: serialize(project), message: "Dreamweaver analysis started" }, 202);
}

async function readProjects(request, db, user) {
  if (!user?.id) return json({ projects: [] });
  const membership = await ensureMembership(db, user);
  const url = new URL(request.url);
  const projectId = cleanText(url.searchParams.get("projectId"), 80);
  const rows = projectId
    ? await db.sql`SELECT * FROM halo_dreamweaver_songs WHERE id = ${projectId} AND member_id = ${membership.member_id} LIMIT 1`
    : await db.sql`SELECT * FROM halo_dreamweaver_songs WHERE member_id = ${membership.member_id} ORDER BY created_at DESC LIMIT 20`;
  if (projectId && !rows[0]) return json({ message: "Song Lab project not found" }, 404);
  if (projectId && url.searchParams.get("asset") === "artwork") {
    const project = rows[0];
    if (!project.artwork_key) return json({ message: "Artwork is not ready" }, 404);
    const artwork = await songStore.get(project.artwork_key, { type: "arrayBuffer" });
    if (!artwork) return json({ message: "Artwork is not available" }, 404);
    if (request.method === "HEAD") return new Response(null, { headers: { "Content-Type": project.artwork_content_type, "Cache-Control": "private, no-store", "Content-Length": String(artwork.byteLength) } });
    return new Response(artwork, { headers: { "Content-Type": project.artwork_content_type, "Cache-Control": "private, no-store", "Content-Length": String(artwork.byteLength), "Content-Disposition": `inline; filename="dreamweaver-${project.id}.png"`, "X-Content-Type-Options": "nosniff" } });
  }
  return projectId ? json({ project: serialize(rows[0]) }) : json({ projects: rows.map(serialize) });
}

export default async function dreamweaverSongLabHandler(request, context) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD, POST" });
  try {
    const db = getDatabase();
    const user = await getUser().catch(() => null);
    if (["GET", "HEAD"].includes(request.method)) return readProjects(request, db, user);
    if (!(await verifyRequestOrigin(request))) return json({ message: "Cross-origin Song Lab updates are not accepted" }, 403);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadChunk(request, db, user);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 24 * 1024) return json({ message: "The analysis request is too large" }, 413);
    return finalizeProject(request, context, db, user);
  } catch (error) {
    console.error("Dreamweaver Song Lab request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Dreamweaver Song Lab is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/dreamweaver-song-lab" };
