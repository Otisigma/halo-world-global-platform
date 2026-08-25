import OpenAI from "openai";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const goals = new Set(["vocal-handoff", "beat-carry", "room-bridge", "bass-swap", "breakdown-rescue"]);
const textures = new Set(["none", "crowd-air", "hallway", "vinyl-dust", "rain-glass", "warehouse-tail"]);
const uuidPattern = /^[0-9a-f-]{36}$/;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function number(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function trackPayload(value, fallbackLabel) {
  return {
    id: cleanText(value?.id, 100) || fallbackLabel.toLowerCase().replaceAll(" ", "-"),
    title: cleanText(value?.title, 160) || fallbackLabel,
    artist: cleanText(value?.artist, 160) || "Unknown artist",
    bpm: number(value?.bpm, 40, 240, 124),
    key: cleanText(value?.key, 12) || "--",
    vocalDensity: number(value?.vocalDensity, 0, 10, 4),
    bassWeight: number(value?.bassWeight, 0, 10, 6),
    percussionDensity: number(value?.percussionDensity, 0, 10, 6),
    energy: number(value?.energy, 0, 10, 5),
    signatureMoment: cleanText(value?.signatureMoment, 240) || "Protect the central hook before opening the next phrase."
  };
}

function packPayload(row, stems) {
  return {
    id: row.id,
    title: row.title,
    bpm: Number(row.bpm),
    key: row.musical_key || "--",
    genre: row.genre || "",
    mood: row.mood || "",
    stems: stems.filter(stem => stem.pack_id === row.id).map(stem => stem.stem_type)
  };
}

async function authenticatedContext() {
  const [db, user] = await Promise.all([getDatabase(), getUser()]);
  if (!user?.id) return { db, membership: null };
  return { db, membership: await ensureMembership(db, user) };
}

async function ownedPacks(db, memberId) {
  const [packs, stems] = await Promise.all([
    db.sql`
      SELECT id, title, bpm, musical_key, genre, mood
      FROM halo_stem_packs
      WHERE member_id = ${memberId} AND status = 'private'
      ORDER BY updated_at DESC
      LIMIT 80
    `,
    db.sql`
      SELECT file.pack_id, file.stem_type
      FROM halo_stem_files file
      JOIN halo_stem_packs pack ON pack.id = file.pack_id
      WHERE pack.member_id = ${memberId} AND pack.status = 'private'
      ORDER BY file.pack_id, file.stem_type
    `
  ]);
  return packs.map(pack => packPayload(pack, stems));
}

function deterministicBlueprint(outgoing, incoming, goal, texture, packs) {
  const vocalRisk = outgoing.vocalDensity >= 5 && incoming.vocalDensity >= 5;
  const bpmGap = Math.abs(outgoing.bpm - incoming.bpm);
  const compatiblePacks = packs
    .map(pack => ({ ...pack, distance: Math.min(Math.abs(pack.bpm - outgoing.bpm), Math.abs(pack.bpm - incoming.bpm)) }))
    .filter(pack => pack.distance <= 8 && pack.stems.some(stem => ["drums", "music", "fx"].includes(stem)))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3);
  const bridgePack = compatiblePacks.find(pack => pack.stems.includes("fx")) || compatiblePacks[0] || null;
  const useOutgoingBeat = goal !== "bass-swap" && outgoing.percussionDensity >= incoming.percussionDensity;
  const beatSource = useOutgoingBeat ? "outgoing" : "incoming";
  const bars = bpmGap > 8 ? 8 : goal === "room-bridge" ? 32 : 16;
  const leadVocalRule = vocalRisk
    ? `Mute ${outgoing.title} vocals before ${incoming.title} vocals enter; never run both lead vocals together.`
    : `Only one lead vocal owns the foreground; delay the incoming vocal if the outgoing hook is still active.`;
  const phases = [
    {
      barStart: 1,
      barEnd: Math.max(2, Math.floor(bars * 0.25)),
      label: "Protect the record",
      move: `Keep ${outgoing.title} dominant. Hold its beat and signature moment; preview ${incoming.title} without lead vocals.`
    },
    {
      barStart: Math.max(3, Math.floor(bars * 0.25) + 1),
      barEnd: Math.max(4, Math.floor(bars * 0.5)),
      label: "Open the lane",
      move: `Lower outgoing bass or music, keep the ${beatSource} beat continuous, and introduce only percussion or room texture from the incoming side.`
    },
    {
      barStart: Math.max(5, Math.floor(bars * 0.5) + 1),
      barEnd: Math.max(6, Math.floor(bars * 0.75)),
      label: "Vocal handoff",
      move: `${leadVocalRule} Use ${bridgePack ? bridgePack.title : texture.replaceAll("-", " ")} as a short bridge only if the phrase needs cover.`
    },
    {
      barStart: Math.max(7, Math.floor(bars * 0.75) + 1),
      barEnd: bars,
      label: "Land clean",
      move: `Complete the bass swap, remove the outgoing vocal and melody, then reveal ${incoming.title} on its phrase boundary.`
    }
  ];
  const checks = [
    { label: "Lead vocal separation", status: "pass", detail: leadVocalRule },
    { label: "Continuous beat", status: bpmGap <= 8 ? "pass" : "review", detail: bpmGap <= 8 ? `Tempo gap is ${bpmGap.toFixed(1)} BPM.` : `Tempo gap is ${bpmGap.toFixed(1)} BPM; use an 8-bar clean break or bridge.` },
    { label: "Bass ownership", status: "pass", detail: "Only one bassline stays full at a time; swap low end near the phrase midpoint." },
    { label: "Owned collector sounds", status: bridgePack ? "pass" : "review", detail: bridgePack ? `${bridgePack.title} supplies an owned transition layer.` : "Add an owned FX, room, or drum stem to strengthen this transition." },
    { label: "Phrase landing", status: "pass", detail: `The incoming record receives full focus by bar ${bars}.` }
  ];
  const qualityScore = Math.max(55, Math.min(99, 96 - Math.round(bpmGap * 2) - (bridgePack ? 0 : 6) - (vocalRisk ? 2 : 0)));
  return {
    title: `${outgoing.title} → ${incoming.title}`,
    summary: `A ${bars}-bar ${goal.replaceAll("-", " ")} that keeps one lead vocal in front and preserves the beat through the handoff.`,
    bars,
    beatSource,
    leadVocalRule,
    bridgePackId: bridgePack?.id || "",
    bridgePackTitle: bridgePack?.title || "",
    roomTexture: texture,
    phases,
    collectorPicks: compatiblePacks.map(pack => ({ packId: pack.id, title: pack.title, use: pack.stems.includes("fx") ? "transition texture" : pack.stems.includes("drums") ? "beat support" : "music bridge" })),
    safetyChecks: checks,
    qualityScore,
    djNotes: "Listen on headphones, confirm phrase markers, and rehearse the vocal mute before taking this transition live."
  };
}

async function refineBlueprint(base, outgoing, incoming, availablePacks) {
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: "You are HALO Stem Collector, a world-class DJ mix engineer. Improve the clarity and musical specificity of a safe transition blueprint. Hard rules: never overlap two lead vocals; keep exactly one full bassline; preserve phrase boundaries; use only listed owned pack IDs; room sounds may cover a handoff but never mask clipping or bad timing. Do not change bars, beatSource, bridgePackId, phase bar ranges, safety statuses, or qualityScore. Return concise JSON only."
        },
        { role: "user", content: JSON.stringify({ outgoing, incoming, availablePacks, blueprint: base }) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "stem_collector_refinement",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              leadVocalRule: { type: "string" },
              djNotes: { type: "string" }
            },
            required: ["summary", "leadVocalRule", "djNotes"]
          }
        }
      }
    });
    const refined = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return {
      ...base,
      summary: `${cleanText(refined.summary, 460) || base.summary} No lead-vocal overlap.`,
      leadVocalRule: `${cleanText(refined.leadVocalRule, 400) || base.leadVocalRule} Never overlap both lead vocals.`,
      djNotes: cleanText(refined.djNotes, 500) || base.djNotes
    };
  } catch (error) {
    console.warn("HALO Stem Collector used deterministic fallback", error instanceof Error ? error.message : "unknown error");
    return base;
  }
}

function kitPayload(row) {
  return {
    id: row.id,
    title: row.title,
    transitionGoal: row.transition_goal,
    roomTexture: row.room_texture,
    outgoingTrack: row.outgoing_track,
    incomingTrack: row.incoming_track,
    sourcePackIds: row.source_pack_ids,
    blueprint: row.blueprint,
    qualityScore: row.quality_score,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function listKits(db, memberId) {
  const rows = await db.sql`
    SELECT * FROM halo_dj_stem_collector_kits
    WHERE member_id = ${memberId} AND status = 'ready'
    ORDER BY updated_at DESC
    LIMIT 24
  `;
  return rows.map(kitPayload);
}

export default async function stemCollectorHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const { db, membership } = await authenticatedContext();
    if (!membership?.member_id) return json({ authenticated: false, kits: [], message: "Sign in to use the private Stem Collector" }, 401);
    if (request.method === "GET") return json({ authenticated: true, kits: await listKits(db, membership.member_id) });
    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);
    if (body.action === "archive") {
      const kitId = cleanText(body.kitId, 50).toLowerCase();
      if (!uuidPattern.test(kitId)) return json({ message: "Collector kit identity is invalid" }, 400);
      const rows = await db.sql`
        UPDATE halo_dj_stem_collector_kits SET status = 'archived', updated_at = NOW()
        WHERE id = ${kitId} AND member_id = ${membership.member_id} AND status = 'ready'
        RETURNING id
      `;
      return rows.length ? json({ archived: true }) : json({ message: "Collector kit not found" }, 404);
    }
    if (body.action !== "design") return json({ message: "Choose a supported Stem Collector action" }, 400);
    const outgoing = trackPayload(body.outgoingTrack, "Outgoing track");
    const incoming = trackPayload(body.incomingTrack, "Incoming track");
    const goal = goals.has(body.transitionGoal) ? body.transitionGoal : "vocal-handoff";
    const texture = textures.has(body.roomTexture) ? body.roomTexture : "none";
    const packs = await ownedPacks(db, membership.member_id);
    const base = deterministicBlueprint(outgoing, incoming, goal, texture, packs);
    const blueprint = await refineBlueprint(base, outgoing, incoming, packs);
    const id = crypto.randomUUID();
    const title = cleanText(body.title, 160) || blueprint.title;
    const sourcePackIds = blueprint.collectorPicks.map(pack => pack.packId);
    const rows = await db.sql`
      INSERT INTO halo_dj_stem_collector_kits (
        id, member_id, title, transition_goal, room_texture, outgoing_track, incoming_track,
        source_pack_ids, blueprint, quality_score
      ) VALUES (
        ${id}, ${membership.member_id}, ${title}, ${goal}, ${texture}, ${JSON.stringify(outgoing)}::jsonb,
        ${JSON.stringify(incoming)}::jsonb, ${JSON.stringify(sourcePackIds)}::jsonb,
        ${JSON.stringify(blueprint)}::jsonb, ${blueprint.qualityScore}
      ) RETURNING *
    `;
    return json({ kit: kitPayload(rows[0]), message: "Stem Collector transition kit saved" }, 201);
  } catch (error) {
    console.error("HALO Stem Collector request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Stem Collector is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/stem-collector" };
