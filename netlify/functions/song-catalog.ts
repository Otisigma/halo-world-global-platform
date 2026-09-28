import { db } from "../../db/index.js";
import { dreamweaverSongReviews, songs, songVersions } from "../../db/schema.js";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";
import { buildDreamweaverSatellite } from "../../lib/route-registry.js";

const MAX_BODY_BYTES = 80_000;
const RIGHTS_STATUSES = new Set(["needs_review", "cleared", "disputed"]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanEnum(value, allowed, fallback) {
  const current = String(value || "").trim().toLowerCase();
  return allowed.has(current) ? current : fallback;
}

function serializeSong(song, versions) {
  return {
    id: song.id,
    title: song.title,
    artistName: song.artistName,
    albumTitle: song.albumTitle || "",
    genre: song.genre || "",
    isrc: song.isrc || "",
    upc: song.upc || "",
    rightsStatus: song.rightsStatus || "needs_review",
    saleStatus: song.saleStatus || "unlisted",
    salePriceCents: song.salePriceCents || 0,
    explicitLyrics: Boolean(song.explicitLyrics),
    metadataScore: song.metadataScore || 0,
    metadataStatus: song.metadataStatus || "needs_review",
    metadataIssues: Array.isArray(song.metadataIssues) ? song.metadataIssues : [],
    reviewedAt: song.reviewedAt?.toISOString() || "",
    updatedAt: song.updatedAt?.toISOString() || "",
    pipelineStatus: song.pipelineStatus || "uploaded",
    sourceUploadSurface: song.sourceUploadSurface || "",
    pipelineUpdatedAt: song.pipelineUpdatedAt?.toISOString() || "",
    dreamweaverSatellite: buildDreamweaverSatellite(song.id),
    versions: versions.map(version => ({
      id: version.id,
      versionType: version.versionType,
      label: version.label,
      destination: version.destination,
      audioUrl: version.audioUrl || "",
      masteringStatus: version.masteringStatus || "needs_review",
      targetLufs: version.targetLufs || -14,
      truePeakDbtp: version.truePeakDbtp || -1,
      resolvedArtworkUrl: version.resolvedArtworkUrl || "",
      customArtworkUrl: version.customArtworkUrl || "",
      inheritsArtwork: Boolean(version.inheritsArtwork),
    })),
  };
}

export default async function handler(request) {
  if (request.method === "GET") {
    return json({ songs: [] });
  }
  return json({ message: "Unsupported" }, 405);
}
