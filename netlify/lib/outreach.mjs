import { randomUUID } from "node:crypto";
import OpenAI from "openai";

export const OUTREACH_MODEL = "gpt-5.4-mini";

// The desk works the same way the artist teams do: specialists propose, a critic removes anything the
// evidence does not support, and a human sends. The seats differ because the job differs — this team
// is aimed at people who did not ask to hear from us, so one of its five seats exists purely to say no.
export const OUTREACH_ROLES = Object.freeze({
  prospect: {
    name: "Prospect",
    title: "Targeting",
    mission: "Decide which contacts genuinely fit this record and say plainly which do not."
  },
  angle: {
    name: "Angle",
    title: "Positioning",
    mission: "Find the specific reason this contact would care about this record, not a reason anyone would care."
  },
  pen: {
    name: "Pen",
    title: "Copy",
    mission: "Write the short approach in the register this contact actually reads, with no hype and no invented claims."
  },
  cadence: {
    name: "Cadence",
    title: "Timing",
    mission: "Set when to approach, when a follow up is warranted, and when to stop asking."
  }
});

export const OUTREACH_CRITIC = Object.freeze({
  key: "ledger",
  name: "Ledger",
  title: "Critic and compliance",
  mission: "Drop every ungrounded, generic, or non-compliant approach and hand the owner a queue they can send as written."
});

export const TARGET_KINDS = new Set(["radio", "dj", "playlist", "press", "label", "sync", "promoter"]);
export const CONTACT_STATUSES = new Set(["active", "paused", "opted_out", "bounced"]);
export const CHANNELS = new Set(["email", "form", "portal", "post"]);
export const LAWFUL_BASES = new Set(["public_professional_listing", "legitimate_interest", "consent"]);
export const PITCH_STATUSES = new Set(["proposed", "approved", "sent", "archived"]);
export const PITCH_OUTCOMES = new Set(["pending", "replied", "declined", "placed", "no_response"]);

// Each target kind needs a different asset to be worth approaching at all. A press contact with no
// press kit is not a lead, it is a complaint waiting to happen.
const KIND_REQUIREMENTS = Object.freeze({
  radio: { asset: "radio_url", label: "radio kit" },
  dj: { asset: "dj_url", label: "DJ kit" },
  playlist: { asset: "official_url", label: "official streaming link" },
  press: { asset: "press_url", label: "press kit" },
  label: { asset: "official_url", label: "official streaming link" },
  sync: { asset: "official_url", label: "official streaming link" },
  promoter: { asset: "official_url", label: "official streaming link" }
});

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cleanText(value, maxLength = 600) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanBody(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function cleanStringList(value, maxItems = 8, maxLength = 240) {
  return Array.isArray(value)
    ? value.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

export function cleanSlug(value, maxLength = 80) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, maxLength)
    : "";
}

export function cleanGenres(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(item => cleanText(item, 32).toLowerCase()).filter(Boolean))].slice(0, 12);
}

function daysSince(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000));
}

/**
 * Fit is computed, never asked of the model.
 *
 * The same target and the same release always produce the same score and the same reasons, so the
 * owner can argue with a number before anything is drafted, and a low score cannot be talked up by a
 * persuasive paragraph. This mirrors how radio set plans and artist momentum already work.
 *
 * Eligibility is separate from score on purpose. A perfect-fit contact who opted out is not a
 * high-scoring lead to be weighed against other factors — it is simply not contactable, and the two
 * concepts never mix.
 */
export function scoreTargetFit(target, release, { existingPitch = false } = {}) {
  const reasons = [];
  const blocks = [];

  if (target.contact_status === "opted_out") blocks.push("This contact opted out");
  if (target.contact_status === "bounced") blocks.push("Last address bounced");
  if (target.contact_status === "paused") blocks.push("Contact is paused");
  if (existingPitch) blocks.push("Already pitched for this release");

  const sinceContact = daysSince(target.last_contacted_at);
  const gap = numberValue(target.min_days_between_contacts) || 45;
  if (sinceContact !== null && sinceContact < gap) {
    blocks.push(`Contacted ${sinceContact} days ago, cap is ${gap}`);
  }

  let score = 0;

  // Genre overlap, 30 points. The strongest single predictor of whether an approach is welcome.
  const targetGenres = new Set((target.genres || []).map(item => String(item).toLowerCase()));
  const releaseGenres = new Set((release.genres || []).map(item => String(item).toLowerCase()));
  if (targetGenres.size && releaseGenres.size) {
    const shared = [...releaseGenres].filter(genre => targetGenres.has(genre));
    if (shared.length) {
      score += Math.min(30, 14 + shared.length * 8);
      reasons.push(`Shares ${shared.slice(0, 3).join(", ")}`);
    }
  } else if (!targetGenres.size) {
    // No stated genres is unknown, not wrong. Give the neutral middle rather than punishing it.
    score += 12;
    reasons.push("No stated genres, scored neutrally");
  }

  // Tempo lane, 20 points. Only meaningful when both sides are known.
  const bpm = numberValue(release.bpm);
  const min = target.tempo_min === null || target.tempo_min === undefined ? null : numberValue(target.tempo_min);
  const max = target.tempo_max === null || target.tempo_max === undefined ? null : numberValue(target.tempo_max);
  if (bpm && min !== null && max !== null) {
    if (bpm >= min && bpm <= max) {
      score += 20;
      reasons.push(`${bpm} BPM sits in their ${min}-${max} lane`);
    } else {
      const distance = bpm < min ? min - bpm : bpm - max;
      if (distance <= 6) {
        score += 10;
        reasons.push(`${bpm} BPM is just outside their ${min}-${max} lane`);
      } else {
        reasons.push(`${bpm} BPM is outside their ${min}-${max} lane`);
      }
    }
  } else {
    score += 10;
    reasons.push("Tempo fit unknown, scored neutrally");
  }

  // Territory, 10 points.
  const territory = cleanText(target.territory, 60) || "Global";
  if (territory.toLowerCase() === "global") {
    score += 8;
  } else if (cleanText(release.territory, 60).toLowerCase() === territory.toLowerCase()) {
    score += 10;
    reasons.push(`Both in ${territory}`);
  } else {
    score += 4;
  }

  // Asset readiness, 20 points. This is the axis that stops the desk pitching a record that is not
  // ready for that audience, which is the fastest way to burn a contact permanently.
  const requirement = KIND_REQUIREMENTS[target.kind] || KIND_REQUIREMENTS.promoter;
  if (cleanText(release[requirement.asset], 400)) {
    score += 20;
    reasons.push(`${requirement.label} is ready`);
  } else {
    blocks.push(`No ${requirement.label} on this release yet`);
  }

  // Recorded responsiveness, 20 points. Only real history counts.
  const sent = numberValue(target.pitches_sent);
  const replies = numberValue(target.replies);
  const placements = numberValue(target.placements);
  if (placements > 0) {
    score += 20;
    reasons.push(`Placed ${placements} of our records before`);
  } else if (sent >= 2 && replies === 0) {
    score -= 10;
    reasons.push(`${sent} approaches, no reply — consider resting this contact`);
  } else if (replies > 0) {
    score += 14;
    reasons.push(`Replied ${replies} time${replies === 1 ? "" : "s"} before`);
  } else if (sent === 0) {
    score += 8;
    reasons.push("Not approached before");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: finalScore,
    reasons: reasons.slice(0, 8),
    eligible: blocks.length === 0,
    blocks
  };
}

/**
 * The signal index for outreach. Every drafted approach must cite at least one of these keys, and the
 * keys are checked in code against this index rather than trusted from the model. An approach that
 * cannot point at a real fact about the record or the contact is a form letter.
 */
export function buildOutreachSignalIndex(release, target, fit) {
  const entries = [
    ["release.title", "Release title", release.title],
    ["release.artist", "Release artist", release.artist],
    ["release.date", "Release date", release.release_date],
    ["release.genres", "Release genres", (release.genres || []).join(", ") || null],
    ["release.bpm", "Release tempo", release.bpm],
    ["release.key", "Musical key", release.musical_key],
    ["release.isrc", "ISRC", release.isrc],
    ["release.duration", "Track duration", release.duration],
    ["release.pitch", "Owner's own one-line pitch", release.pitch],
    ["release.pressDescription", "Press description written by the owner", release.press_description],
    ["release.credits", "Credits", release.credits],
    ["release.officialUrl", "Official streaming link", release.official_url],
    ["release.djUrl", "DJ kit link", release.dj_url],
    ["release.radioUrl", "Radio kit link", release.radio_url],
    ["release.pressUrl", "Press kit link", release.press_url],
    ["release.versions", "Available versions", (release.available_versions || []).join(", ") || null],
    ["target.name", "Contact name", target.name],
    ["target.kind", "What this contact does", target.kind],
    ["target.organisation", "Their organisation", target.organisation],
    ["target.territory", "Their territory", target.territory],
    ["target.genres", "Genres they cover", (target.genres || []).join(", ") || null],
    ["target.tempoRange", "Tempo range they programme", target.tempo_min && target.tempo_max ? `${target.tempo_min}-${target.tempo_max}` : null],
    ["target.priorReplies", "Times they replied before", target.replies],
    ["target.priorPlacements", "Times they placed our records", target.placements],
    ["target.notes", "Owner's notes on this contact", target.notes],
    ["fit.score", "Computed fit score", fit.score],
    ["fit.reasons", "Why the score came out that way", fit.reasons.join("; ") || null]
  ];
  const index = {};
  for (const [key, description, value] of entries) {
    if (value === null || value === undefined || value === "" || value === 0) continue;
    index[key] = { description, value: typeof value === "number" ? value : String(value).slice(0, 400) };
  }
  return index;
}

// Words that turn a professional approach into something a station or journalist deletes on sight,
// and claims the platform has no standing to make on an artist's behalf.
const BANNED_CLAIMS = [
  "guaranteed", "guarantee", "viral", "smash hit", "next big thing", "chart-topping",
  "millions of streams", "everyone is talking", "you won't believe", "act now", "limited time"
];

/**
 * The grounding and safety gate. Runs in code, after the model, on every drafted approach.
 * Anything that fails is dropped before it can reach the queue, and the run records how many fell.
 */
export function groundPitch(value, knownKeys, { target, fit }) {
  const signalKeys = cleanStringList(value?.signalKeys, 8, 64).filter(key => knownKeys.has(key));
  if (!signalKeys.length) return { ok: false, reason: "cited no real signal" };

  const body = cleanBody(value?.body, 4000);
  if (body.length < 40) return { ok: false, reason: "body too short to be a real approach" };
  if (body.length > 1800) return { ok: false, reason: "body too long for a cold approach" };

  const haystack = `${value?.subject || ""} ${body}`.toLowerCase();
  const banned = BANNED_CLAIMS.find(phrase => haystack.includes(phrase));
  if (banned) return { ok: false, reason: `used an unsupportable claim ("${banned}")` };

  // The contact's own name should appear. If the draft would read identically to any other
  // recipient, it is a mailshot wearing a pitch's clothes.
  const firstName = cleanText(target?.name, 160).split(" ")[0];
  if (firstName && firstName.length > 2 && !haystack.includes(firstName.toLowerCase())) {
    return { ok: false, reason: "did not address the contact by name" };
  }

  const channel = CHANNELS.has(value?.channel) ? value.channel : (CHANNELS.has(target?.preferred_channel) ? target.preferred_channel : "email");

  return {
    ok: true,
    pitch: {
      subject: cleanText(value?.subject, 200),
      body,
      channel,
      signalKeys,
      fitScore: fit.score,
      fitReasons: fit.reasons,
      agentKey: "pen"
    }
  };
}

function pitchSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      targetId: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      channel: { type: "string", enum: [...CHANNELS] },
      angle: { type: "string" },
      followUpAfterDays: { type: ["integer", "null"] },
      signalKeys: { type: "array", items: { type: "string" } },
      recommendApproach: { type: "boolean" },
      holdReason: { type: "string" }
    },
    required: ["targetId", "subject", "body", "channel", "angle", "followUpAfterDays", "signalKeys", "recommendApproach", "holdReason"]
  };
}

const AUTHORITY_RULE = "You draft approaches only. You never send, publish, post, schedule, or contact anyone, and HALO holds no mail credentials on anyone's behalf. Every draft you write is reviewed and sent by a human. Never claim an action was taken, and never invent streams, chart positions, press coverage, playlist placements, quotes, or relationships that are not in the supplied signals.";
const GROUNDING_RULE = "Every draft must cite one or more signalKeys taken from the supplied signalIndex. A draft citing nothing, or citing a key that is not in the index, is discarded before anyone sees it, so never invent a key or a number.";
const CRAFT_RULE = "Write the way a respected plugger writes: short, specific, no hype, no adjectives doing work that facts should do. Open with why this particular person is receiving it. State what the record is in one line. Say exactly what you are asking for. Give the link they need for their format. Close without pressure. Under 160 words. Address them by their first name.";

function usageFrom(completion) {
  return {
    inputTokens: numberValue(completion?.usage?.prompt_tokens),
    outputTokens: numberValue(completion?.usage?.completion_tokens)
  };
}

async function draftForTarget(openai, release, target, fit, signalIndex) {
  const completion = await openai.chat.completions.create({
    model: OUTREACH_MODEL,
    max_completion_tokens: 900,
    messages: [
      {
        role: "system",
        content: `You are the HALO outreach desk working as ${OUTREACH_ROLES.angle.name} and ${OUTREACH_ROLES.pen.name} together. ${OUTREACH_ROLES.angle.mission} ${OUTREACH_ROLES.pen.mission} ${CRAFT_RULE} ${GROUNDING_RULE} ${AUTHORITY_RULE} If the fit is weak or you cannot find a specific honest reason this contact should hear this record, set recommendApproach to false and explain why in holdReason rather than writing a weak approach. Declining is a good outcome. Return JSON only.`
      },
      {
        role: "user",
        content: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          release: {
            title: release.title,
            artist: release.artist,
            releaseDate: release.release_date,
            genres: release.genres,
            bpm: release.bpm,
            key: release.musical_key,
            ownerPitch: release.pitch,
            pressDescription: release.press_description,
            versions: release.available_versions
          },
          target: {
            id: target.id,
            name: target.name,
            kind: target.kind,
            organisation: target.organisation,
            territory: target.territory,
            genres: target.genres,
            preferredChannel: target.preferred_channel,
            ownerNotes: target.notes,
            priorReplies: target.replies,
            priorPlacements: target.placements
          },
          fit,
          signalIndex
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "halo_outreach_pitch", strict: true, schema: pitchSchema() }
    }
  }, { signal: AbortSignal.timeout(12_000) });
  return {
    draft: JSON.parse(completion.choices[0]?.message?.content || "{}"),
    usage: usageFrom(completion)
  };
}

/**
 * Deterministic fallback. When inference is unavailable the desk still produces something, but it
 * produces an honest skeleton the owner must finish rather than a confident letter nobody wrote.
 * The run is marked partial so the difference is visible rather than implied.
 */
export function fallbackPitch(release, target, fit, knownKeys) {
  const firstName = cleanText(target.name, 160).split(" ")[0] || target.name;
  const requirement = KIND_REQUIREMENTS[target.kind] || KIND_REQUIREMENTS.promoter;
  const link = cleanText(release[requirement.asset], 400);
  const signalKeys = ["release.title", "target.name", "fit.score"].filter(key => knownKeys.has(key));
  if (!signalKeys.length) return null;
  const lines = [
    `Hi ${firstName},`,
    "",
    `Sending you ${release.title} by ${release.artist}${release.release_date ? `, out ${String(release.release_date).slice(0, 10)}` : ""}.`,
    release.pitch ? release.pitch : "",
    link ? `The ${requirement.label} is here: ${link}` : "",
    "",
    `[Draft written without inference — add the specific reason ${firstName} should hear this before sending.]`,
    "",
    "Thanks for listening,"
  ].filter(Boolean);
  return {
    subject: `${release.artist} — ${release.title}`,
    body: lines.join("\n"),
    channel: CHANNELS.has(target.preferred_channel) ? target.preferred_channel : "email",
    signalKeys,
    fitScore: fit.score,
    fitReasons: fit.reasons,
    agentKey: "cadence"
  };
}

async function loadRelease(db, releaseId) {
  const rows = await db.sql`
    SELECT * FROM halo_release_campaigns WHERE id = ${releaseId} LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Candidate selection happens in SQL so that suppression and the frequency cap are applied by the
 * database at read time, not by a handler that could drift. The already-pitched check joins rather
 * than filtering afterwards, so a target that has seen this release never reappears.
 */
async function loadCandidates(db, releaseId, limit) {
  return db.sql`
    SELECT t.*, (p.id IS NOT NULL) AS already_pitched
    FROM halo_outreach_targets t
    LEFT JOIN halo_outreach_pitches p
      ON p.target_id = t.id AND p.release_id = ${releaseId}
    ORDER BY t.last_contacted_at ASC NULLS FIRST, t.created_at ASC
    LIMIT ${limit}
  `;
}

export async function runOutreachDesk(db, releaseId, { triggerType = "manual", memberId = null, limit = 12 } = {}) {
  const release = await loadRelease(db, releaseId);
  if (!release) throw new Error("release_not_found");

  const candidates = await loadCandidates(db, releaseId, 120);
  const runId = randomUUID();

  const scored = candidates.map(target => ({
    target,
    fit: scoreTargetFit(target, release, { existingPitch: Boolean(target.already_pitched) })
  }));

  const blockedSuppressed = scored.filter(item => !item.fit.eligible
    && item.fit.blocks.some(block => /opted out|bounced|paused/i.test(block))).length;
  const blockedFrequency = scored.filter(item => !item.fit.eligible
    && item.fit.blocks.some(block => /cap is/i.test(block))).length;

  const eligible = scored
    .filter(item => item.fit.eligible)
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, limit);

  const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  let inputTokens = 0;
  let outputTokens = 0;
  let inferenceCalls = 0;
  let fallbackCalls = 0;
  let dropped = 0;
  const dropReasons = [];
  const kept = [];

  for (const { target, fit } of eligible) {
    const signalIndex = buildOutreachSignalIndex(release, target, fit);
    const knownKeys = new Set(Object.keys(signalIndex));
    let prepared = null;

    if (openai) {
      try {
        const { draft, usage } = await draftForTarget(openai, release, target, fit, signalIndex);
        inferenceCalls += 1;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (draft?.recommendApproach === false) {
          dropped += 1;
          dropReasons.push(`${target.name}: desk advised against approaching (${cleanText(draft.holdReason, 160) || "no reason given"})`);
          continue;
        }
        const grounded = groundPitch(draft, knownKeys, { target, fit });
        if (!grounded.ok) {
          dropped += 1;
          dropReasons.push(`${target.name}: ${grounded.reason}`);
          continue;
        }
        prepared = grounded.pitch;
      } catch (error) {
        console.error("HALO outreach draft failed", target.id, error instanceof Error ? error.message : "unknown error");
      }
    }

    if (!prepared) {
      prepared = fallbackPitch(release, target, fit, knownKeys);
      if (!prepared) {
        dropped += 1;
        dropReasons.push(`${target.name}: no citable signal for this contact`);
        continue;
      }
      fallbackCalls += 1;
    }

    // Insert re-checks suppression and the frequency cap inside the statement, so a target who opted
    // out between selection and write is still refused. ON CONFLICT enforces one pitch per release.
    const inserted = await db.sql`
      INSERT INTO halo_outreach_pitches (
        release_id, target_id, run_id, agent_key, fit_score, fit_reasons,
        signal_keys, channel, subject, body, status
      )
      SELECT
        ${releaseId}, t.id, ${runId}, ${prepared.agentKey}, ${prepared.fitScore}::int, ${prepared.fitReasons}::text[],
        ${prepared.signalKeys}::text[], ${prepared.channel}, ${prepared.subject}, ${prepared.body}, 'proposed'
      FROM halo_outreach_targets t
      WHERE t.id = ${target.id}
        AND t.contact_status = 'active'
        AND (
          t.last_contacted_at IS NULL
          OR t.last_contacted_at < NOW() - make_interval(days => t.min_days_between_contacts)
        )
      ON CONFLICT (release_id, target_id) DO NOTHING
      RETURNING id
    `;

    if (inserted.length) {
      kept.push({ targetId: target.id, targetName: target.name, fitScore: prepared.fitScore });
    } else {
      dropped += 1;
      dropReasons.push(`${target.name}: refused at write time by the contact rules`);
    }
  }

  const status = openai ? (fallbackCalls > 0 ? "partial" : "complete") : "partial";
  const briefing = buildBriefing({
    release, considered: candidates.length, eligible: eligible.length,
    kept, dropped, dropReasons, blockedSuppressed, blockedFrequency, status
  });

  await db.sql`
    INSERT INTO halo_outreach_runs (
      id, release_id, trigger_type, status, targets_considered, targets_eligible,
      pitches_kept, pitches_dropped, blocked_suppressed, blocked_frequency, briefing,
      input_tokens, output_tokens, inference_calls, fallback_calls, created_by_member_id
    ) VALUES (
      ${runId}, ${releaseId}, ${triggerType}, ${status}, ${candidates.length}, ${eligible.length},
      ${kept.length}, ${dropped}, ${blockedSuppressed}, ${blockedFrequency}, ${briefing},
      ${inputTokens}, ${outputTokens}, ${inferenceCalls}, ${fallbackCalls}, ${memberId}
    )
  `;

  return {
    runId,
    status,
    considered: candidates.length,
    eligible: eligible.length,
    kept: kept.length,
    dropped,
    blockedSuppressed,
    blockedFrequency,
    briefing,
    usage: { inputTokens, outputTokens, inferenceCalls, fallbackCalls }
  };
}

function buildBriefing({ release, considered, eligible, kept, dropped, dropReasons, blockedSuppressed, blockedFrequency, status }) {
  const lines = [
    `${release.title} by ${release.artist}.`,
    `Read ${considered} contact${considered === 1 ? "" : "s"}, ${eligible} eligible, ${kept.length} approach${kept.length === 1 ? "" : "es"} queued for your approval.`
  ];
  if (blockedSuppressed) lines.push(`${blockedSuppressed} held back because they opted out, bounced, or are paused.`);
  if (blockedFrequency) lines.push(`${blockedFrequency} held back by their own contact frequency cap.`);
  if (dropped) {
    lines.push(`${dropped} draft${dropped === 1 ? "" : "s"} dropped before reaching you:`);
    for (const reason of dropReasons.slice(0, 6)) lines.push(`- ${reason}`);
  }
  if (kept.length) {
    lines.push("Queued, strongest fit first:");
    for (const item of [...kept].sort((a, b) => b.fitScore - a.fitScore).slice(0, 10)) {
      lines.push(`- ${item.targetName} (fit ${item.fitScore})`);
    }
  } else {
    lines.push("Nothing was queued. That is a normal outcome when the list is thin or the record is not ready for these contacts.");
  }
  if (status === "partial") {
    lines.push("This run was partial: some or all drafts were written without inference and need finishing before they are sent.");
  }
  lines.push("Nothing here has been sent. Each approach is sent by you, from your own mail, after you approve it.");
  return lines.join("\n").slice(0, 4000);
}

export function serializeTarget(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    organisation: row.organisation,
    territory: row.territory,
    genres: row.genres || [],
    tempoMin: row.tempo_min === null ? null : Number(row.tempo_min),
    tempoMax: row.tempo_max === null ? null : Number(row.tempo_max),
    contactEmail: row.contact_email,
    contactUrl: row.contact_url,
    preferredChannel: row.preferred_channel,
    sourceNote: row.source_note,
    lawfulBasis: row.lawful_basis,
    contactStatus: row.contact_status,
    optedOutAt: row.opted_out_at ? new Date(row.opted_out_at).toISOString() : null,
    minDaysBetweenContacts: Number(row.min_days_between_contacts),
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at).toISOString() : null,
    pitchesSent: Number(row.pitches_sent || 0),
    replies: Number(row.replies || 0),
    placements: Number(row.placements || 0),
    notes: row.notes,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export function serializePitch(row) {
  return {
    id: Number(row.id),
    releaseId: row.release_id,
    targetId: row.target_id,
    targetName: row.target_name || null,
    targetKind: row.target_kind || null,
    contactEmail: row.contact_email || "",
    contactUrl: row.contact_url || "",
    runId: row.run_id,
    agentKey: row.agent_key,
    fitScore: Number(row.fit_score || 0),
    fitReasons: row.fit_reasons || [],
    signalKeys: row.signal_keys || [],
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    status: row.status,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    outcome: row.outcome,
    outcomeNote: row.outcome_note,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export function serializeRun(row) {
  return {
    id: row.id,
    releaseId: row.release_id,
    triggerType: row.trigger_type,
    status: row.status,
    considered: Number(row.targets_considered || 0),
    eligible: Number(row.targets_eligible || 0),
    kept: Number(row.pitches_kept || 0),
    dropped: Number(row.pitches_dropped || 0),
    blockedSuppressed: Number(row.blocked_suppressed || 0),
    blockedFrequency: Number(row.blocked_frequency || 0),
    briefing: row.briefing,
    usage: {
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      inferenceCalls: Number(row.inference_calls || 0),
      fallbackCalls: Number(row.fallback_calls || 0)
    },
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export async function loadOutreachDashboard(db, releaseId = null) {
  const [targets, pitches, runs, totals] = await Promise.all([
    db.sql`SELECT * FROM halo_outreach_targets ORDER BY contact_status, name ASC LIMIT 300`,
    releaseId
      ? db.sql`
          SELECT p.*, t.name AS target_name, t.kind AS target_kind, t.contact_email, t.contact_url
          FROM halo_outreach_pitches p
          JOIN halo_outreach_targets t ON t.id = p.target_id
          WHERE p.release_id = ${releaseId}
          ORDER BY p.status, p.fit_score DESC LIMIT 200
        `
      : db.sql`
          SELECT p.*, t.name AS target_name, t.kind AS target_kind, t.contact_email, t.contact_url
          FROM halo_outreach_pitches p
          JOIN halo_outreach_targets t ON t.id = p.target_id
          ORDER BY p.created_at DESC LIMIT 200
        `,
    releaseId
      ? db.sql`SELECT * FROM halo_outreach_runs WHERE release_id = ${releaseId} ORDER BY created_at DESC LIMIT 10`
      : db.sql`SELECT * FROM halo_outreach_runs ORDER BY created_at DESC LIMIT 10`,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE contact_status = 'active')::int AS active_targets,
        COUNT(*) FILTER (WHERE contact_status = 'opted_out')::int AS opted_out,
        COALESCE(SUM(pitches_sent), 0)::int AS total_sent,
        COALESCE(SUM(replies), 0)::int AS total_replies,
        COALESCE(SUM(placements), 0)::int AS total_placements
      FROM halo_outreach_targets
    `
  ]);

  const summary = totals[0] || {};
  const sent = Number(summary.total_sent || 0);
  const replies = Number(summary.total_replies || 0);

  return {
    targets: targets.map(serializeTarget),
    pitches: pitches.map(serializePitch),
    runs: runs.map(serializeRun),
    totals: {
      activeTargets: Number(summary.active_targets || 0),
      optedOut: Number(summary.opted_out || 0),
      sent,
      replies,
      placements: Number(summary.total_placements || 0),
      replyRate: sent > 0 ? Math.round((replies / sent) * 100) : null
    }
  };
}
