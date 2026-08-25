import OpenAI from "openai";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { HALO_DJ_MIXING_DOCTRINE } from "../lib/dj-mixing-doctrine.mjs";

const MAX_BODY_BYTES = 96_000;
const HOURLY_REQUEST_LIMIT = 24;
const MODES = new Set(["listening", "club", "chill"]);
const CURVES = new Set(["journey", "build", "steady", "wave", "double-peak", "emotional", "sunset", "afterhours"]);
const PHASES = new Set(["opening", "build", "peak", "release", "close"]);

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
}

function score(value, fallback = 5) {
  return Math.max(1, Math.min(10, Number(value) || fallback));
}

function cleanTrack(track) {
  return {
    id: String(track?.id || "").slice(0, 100),
    title: String(track?.title || "Untitled").slice(0, 160),
    artist: String(track?.artist || "Unknown").slice(0, 160),
    bpm: Math.max(40, Math.min(240, Number(track?.bpm) || 120)),
    key: String(track?.key || "--").slice(0, 4),
    genre: String(track?.genre || "Unknown").slice(0, 80),
    energy: score(track?.energy),
    danceability: score(track?.danceability),
    emotionalIntensity: score(track?.emotionalIntensity),
    darkness: score(track?.darkness),
    warmth: score(track?.warmth),
    vocalDensity: score(track?.vocalDensity),
    percussionDensity: score(track?.percussionDensity),
    bassWeight: score(track?.bassWeight),
    melodicDensity: score(track?.melodicDensity),
    atmosphere: score(track?.atmosphere),
    energyRole: ["warm-up", "builder", "driver", "peak", "release", "closer"].includes(track?.energyRole) ? track.energyRole : "builder",
    sonicWeather: String(track?.sonicWeather || "balanced, groove-led, open arrangement").slice(0, 240),
    signatureMoment: String(track?.signatureMoment || "").slice(0, 160),
    platform: String(track?.platform || "Library").slice(0, 80)
  };
}

async function audienceMemory(db, memberId, mode) {
  const rows = await db.sql`
    SELECT track_id,
      SUM(CASE WHEN signal IN ('love', 'vote', 'lift') THEN intensity ELSE 0 END)::int AS positive,
      SUM(CASE WHEN signal = 'skip' THEN intensity ELSE 0 END)::int AS negative,
      COUNT(*)::int AS observations
    FROM halo_dj_audience_signals
    WHERE member_id = ${memberId}
      AND mode = ${mode}
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY track_id
    ORDER BY (SUM(CASE WHEN signal IN ('love', 'vote', 'lift') THEN intensity ELSE 0 END)
      - SUM(CASE WHEN signal = 'skip' THEN intensity ELSE 0 END)) DESC,
      COUNT(*) DESC
    LIMIT 8
  `;
  return rows.map(row => ({
    trackId: row.track_id,
    affinity: Number(row.positive || 0) - Number(row.negative || 0),
    observations: Number(row.observations || 0)
  }));
}

export default async function aiDjHandler(request) {
  if (request.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "POST" });
  }

  try {
    verifyRequestOrigin(request);
  } catch {
    return jsonResponse({ message: "Cross-origin AI requests are not accepted" }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ message: "AI DJ request is too large" }, 413);
  }

  let db;
  let user;
  try {
    [db, user] = await Promise.all([getDatabase(), getUser()]);
  } catch (error) {
    console.error("AI DJ membership check failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Cloud AI membership could not be verified" }, 503);
  }

  if (!user?.id) {
    return jsonResponse({ message: "Sign in to use cloud AI. HALO's local set analysis remains available." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: "Request body must be valid JSON" }, 400);
  }

  const tracks = Array.isArray(body.tracks) ? body.tracks.slice(0, 60).map(cleanTrack).filter(track => track.id) : [];
  const loadedIds = new Set([body.decks?.A?.id, body.decks?.B?.id]);
  const candidates = tracks.filter(track => !loadedIds.has(track.id));
  if (!candidates.length) {
    return jsonResponse({ message: "At least one unloaded candidate track is required" }, 422);
  }

  try {
    await ensureMembership(db, user);
    const acceptedRows = await db.sql`
      INSERT INTO halo_ai_usage_events (member_id, feature)
      SELECT ${user.id}, 'ai_dj'
      WHERE (
        SELECT COUNT(*)
        FROM halo_ai_usage_events
        WHERE member_id = ${user.id}
          AND feature = 'ai_dj'
          AND created_at >= NOW() - INTERVAL '1 hour'
      ) < ${HOURLY_REQUEST_LIMIT}
      RETURNING id
    `;
    if (acceptedRows.length === 0) {
      return jsonResponse(
        { message: "Cloud AI has reached its hourly session limit. Local set analysis remains available." },
        429,
        { "Retry-After": "3600" }
      );
    }
  } catch (error) {
    console.error("AI DJ usage control failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Cloud AI usage could not be verified" }, 503);
  }

  const mode = MODES.has(body.mode) ? body.mode : "listening";
  let memory = [];
  try {
    memory = await audienceMemory(db, user.id, mode);
  } catch (error) {
    console.error("AI DJ audience memory failed", error instanceof Error ? error.message : "unknown error");
  }

  const context = {
    mode,
    personaId: ["halo", "butterfly", "romy"].includes(body.personaId) ? body.personaId : "halo",
    energyCurve: CURVES.has(body.energyCurve) ? body.energyCurve : "journey",
    setPhase: PHASES.has(body.setPhase) ? body.setPhase : "opening",
    sessionId: String(body.sessionId || "").slice(0, 100),
    intent: ["lift", "hold", "reset", "peak"].includes(body.intent) ? body.intent : "lift",
    decks: {
      A: cleanTrack(body.decks?.A),
      B: cleanTrack(body.decks?.B)
    },
    playing: {
      A: Boolean(body.decks?.A?.playing),
      B: Boolean(body.decks?.B?.playing)
    },
    elapsedSeconds: Math.max(0, Math.min(3600, Number(body.elapsedSeconds) || 0)),
    crossfader: Math.max(0, Math.min(100, Number(body.crossfader) || 50)),
    crowd: {
      score: Math.max(0, Math.min(100, Number(body.crowd?.score) || 0)),
      motion: Math.max(0, Math.min(100, Number(body.crowd?.motion) || 0)),
      density: Math.max(0, Math.min(100, Number(body.crowd?.density) || 0)),
      response: Math.max(0, Math.min(100, Number(body.crowd?.response) || 0))
    },
    queue: Array.isArray(body.queue) ? body.queue.slice(0, 20).map(String) : [],
    transitionHistory: Array.isArray(body.transitionHistory) ? body.transitionHistory.slice(-6).map(value => String(value).slice(0, 40)) : [],
    audienceMemory: memory,
    candidates
  };

  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are HALO DJ, a calm, human-level music curator, set architect, historian, and four-person booth crew. Every resident persona uses HALO BREATH, but expresses it differently: DJ HALO is club-responsive and can use peak-time or experimental routes; DJ BUTTERFLY is emotional, melodic, and patient; DJ ROMY is spacious, atmospheric, and willing to let records nearly play out. Do not mix because you can; mix only because the moment demands it. Adapt completely to mode: Listening Party protects discovery, storytelling, full hooks, patience, and fan participation; Club protects groove, tension, release, bass, and dancefloor trust; Chill protects warmth, space, harmonic continuity, and unobtrusive long-form flow. Evaluate the current phase and energy curve across a three-track horizon. Select exactly one available candidate unless the right decision is to hold the current song or create silence. Never invent a track ID. Return concise JSON only.\n\n${HALO_DJ_MIXING_DOCTRINE}`
        },
        {
          role: "user",
          content: JSON.stringify(context)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "dj_transition",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              trackId: { type: "string" },
              decision: { type: "string", enum: ["mix", "hold", "silence"] },
              fit: { type: "integer", minimum: 1, maximum: 99 },
              transitionBars: { type: "integer", enum: [0, 8, 16, 24, 32] },
              effectMove: { type: "string", enum: ["bass", "hats", "vocals"] },
              transitionStyle: { type: "string", enum: ["long-blend", "phrase-blend", "vocal-handoff", "drum-handoff", "breakdown-bridge", "bass-swap", "percussion-bridge", "filter-sweep", "delay-throw", "echo-out", "atmospheric-bridge", "drop-swap", "silence", "hold"] },
              crossfaderCurve: { type: "string", enum: ["smooth", "linear", "early-reveal", "late-cut"] },
              vocalHandoff: { type: "boolean" },
              vocalRevealBars: { type: "integer", enum: [0, 8, 16, 24, 32] },
              bridgeElement: { type: "string", enum: ["drums", "bass", "percussion-loop", "atmosphere", "vocal-memory", "incoming-groove"] },
              transitionCharacter: { type: "string", enum: ["storytelling", "club", "chill", "peak-time", "experimental"] },
              breathPlan: {
                type: "object",
                additionalProperties: false,
                properties: {
                  release: { type: "string" },
                  breath: { type: "string" },
                  discovery: { type: "string" },
                  anticipation: { type: "string" },
                  reveal: { type: "string" }
                },
                required: ["release", "breath", "discovery", "anticipation", "reveal"]
              },
              tensionPlan: { type: "string" },
              signatureMotif: { type: "string", enum: ["none", "hay-lo-swell"] },
              signatureMotifReason: { type: "string" },
              variationNote: { type: "string" },
              summary: { type: "string" },
              brief: { type: "string" },
              whyThisTrack: { type: "string" },
              whyNow: { type: "string" },
              transitionReason: { type: "string" },
              feelingNext: { type: "string" },
              sonicWeather: { type: "string" },
              protectMoment: { type: "string" },
              doNotMixReasons: {
                type: "array",
                maxItems: 4,
                items: { type: "string" }
              },
              setArc: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    trackId: { type: "string" },
                    role: { type: "string", enum: ["warm-up", "builder", "driver", "peak", "release", "closer"] },
                    energyTarget: { type: "number", minimum: 1, maximum: 10 },
                    purpose: { type: "string" }
                  },
                  required: ["trackId", "role", "energyTarget", "purpose"]
                }
              },
              assistantTeam: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    role: { type: "string", enum: ["Music director", "Mix engineer", "Crowd reader", "Quality control"] },
                    feedback: { type: "string" }
                  },
                  required: ["name", "role", "feedback"]
                }
              }
            },
            required: ["trackId", "decision", "fit", "transitionBars", "effectMove", "transitionStyle", "crossfaderCurve", "vocalHandoff", "vocalRevealBars", "bridgeElement", "transitionCharacter", "breathPlan", "tensionPlan", "signatureMotif", "signatureMotifReason", "variationNote", "summary", "brief", "whyThisTrack", "whyNow", "transitionReason", "feelingNext", "sonicWeather", "protectMoment", "doNotMixReasons", "setArc", "assistantTeam"]
          }
        }
      }
    });

    const recommendation = JSON.parse(completion.choices[0]?.message?.content || "{}");
    if (!candidates.some(track => track.id === recommendation.trackId)) {
      return jsonResponse({ message: "AI recommendation did not match an available track" }, 502);
    }

    const selectedTrack = candidates.find(track => track.id === recommendation.trackId);
    const activeTrack = context.playing.B && !context.playing.A ? context.decks.B : context.decks.A;
    const decisionId = crypto.randomUUID();
    const sessionRows = context.sessionId ? await db.sql`
      SELECT id FROM halo_dj_intelligence_sessions WHERE id = ${context.sessionId} AND member_id = ${user.id} LIMIT 1
    ` : [];
    const ownedSessionId = sessionRows[0]?.id || null;
    try {
      await db.sql`
        INSERT INTO halo_dj_decisions (
          id, member_id, session_id, from_track_id, to_track_id, mode, intent, decision_type,
          fit, transition_style, transition_bars, energy_before, energy_after,
          why_track, why_now, transition_reason, feeling_next, sonic_weather, set_arc
        ) VALUES (
          ${decisionId}, ${user.id}, ${ownedSessionId}, ${activeTrack.id}, ${selectedTrack.id},
          ${context.mode}, ${context.intent}, ${recommendation.decision}, ${recommendation.fit},
          ${recommendation.transitionStyle}, ${recommendation.transitionBars}, ${activeTrack.energy},
          ${selectedTrack.energy}, ${recommendation.whyThisTrack}, ${recommendation.whyNow},
          ${recommendation.transitionReason}, ${recommendation.feelingNext},
          ${JSON.stringify({ description: recommendation.sonicWeather, protectMoment: recommendation.protectMoment, doNotMixReasons: recommendation.doNotMixReasons, bridgeElement: recommendation.bridgeElement, transitionCharacter: recommendation.transitionCharacter, breathPlan: recommendation.breathPlan })}::jsonb,
          ${JSON.stringify(recommendation.setArc)}::jsonb
        )
      `;
    } catch (error) {
      console.error("AI DJ decision memory failed", error instanceof Error ? error.message : "unknown error");
    }

    return jsonResponse({ ...recommendation, decisionId });
  } catch (error) {
    console.error("AI DJ analysis failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Cloud AI analysis is unavailable" }, 503);
  }
}

export const config = {
  path: "/api/ai-dj"
};
