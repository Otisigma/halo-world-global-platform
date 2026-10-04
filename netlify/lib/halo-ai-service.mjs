const LIMITATIONS = [
  "Metadata checklist only: no audio was listened to or analyzed.",
  "Recorded rights status and allocations are not legal verification or release approval.",
  "The current rights schema does not record participant split consent. Project acceptance and collection registration are not split consent."
];
const TASKS = Object.freeze({
  stems: "Link an active stem pack and upload the needed separated stems; a full mix alone is not a stem handoff.",
  listening: "Arrange a human listening review for sound quality, timing and transitions.",
  allocations: "Record explicit allocations for the relevant rights pool totaling 100%; there is no mandatory 50/50 split.",
  consent: "Obtain each contributor's explicit consent to the allocations and document it with a human-reviewed agreement.",
  rights: "Have a qualified human review ownership, restrictions and unresolved rights status.",
  brief: "Agree on the creative brief and next handoff with the collaborators."
});

export class StudioGuardianError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Bounds bytes actually read, not only the caller's Content-Length declaration.
export async function readBoundedText(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new StudioGuardianError(413, "Request is too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export class HaloAIService {
  constructor({ db, memberId, apiKey = "", fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
    this.db = db;
    this.memberId = memberId;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1, Math.min(8000, timeoutMs));
  }

  async analyzeProjectHealth(projectId) {
    const { db, memberId } = this;
    const projects = await db.sql`
      SELECT p.id, p.owner_member_id, p.kind, p.stem_pack_id, p.rights_work_id,
        (p.brief <> '') AS has_brief
      FROM halo_creator_projects p
      WHERE p.id = ${projectId} AND (
        p.owner_member_id = ${memberId} OR EXISTS (
          SELECT 1 FROM halo_creator_participants cp
          WHERE cp.project_id = p.id AND cp.member_id = ${memberId} AND cp.status = 'accepted'
        )
      )
    `;
    const project = projects[0];
    if (!project) throw new StudioGuardianError(404, "Project not found or access unavailable");
    // Recheck asset ownership: linked assets must not expose another owner's private metadata.
    const [packs, files, works, participants] = await Promise.all([
      db.sql`SELECT status, rights_attested FROM halo_stem_packs
        WHERE id = ${project.stem_pack_id} AND member_id = ${project.owner_member_id}`,
      db.sql`SELECT f.stem_type, f.byte_size, f.chunk_count FROM halo_stem_files f
        JOIN halo_stem_packs s ON s.id = f.pack_id
        WHERE s.id = ${project.stem_pack_id} AND s.member_id = ${project.owner_member_id}`,
      db.sql`SELECT work_type, rights_status, restrictions FROM halo_artist_rights_works
        WHERE id = ${project.rights_work_id} AND owner_member_id = ${project.owner_member_id}`,
      db.sql`SELECT rp.participant_name, rp.role, rp.share_bps, rp.collection_status
        FROM halo_artist_rights_participants rp
        JOIN halo_artist_rights_works w ON w.id = rp.work_id
        WHERE w.id = ${project.rights_work_id} AND w.owner_member_id = ${project.owner_member_id}
        ORDER BY rp.id LIMIT 201`
    ]);
    const pack = packs[0], work = works[0];
    const stemTypes = files.filter(file => file.stem_type !== "full" &&
      Number(file.byte_size) > 0 && Number(file.chunk_count) > 0).map(file => file.stem_type).sort();
    const allocations = participants.slice(0, 200).map(row => ({
      participantName: row.participant_name, role: row.role,
      shareBps: Number(row.share_bps), collectionStatus: row.collection_status
    }));
    const sum = role => allocations.filter(item => item.role === role).reduce((total, item) => total + item.shareBps, 0);
    const masterShareBps = sum("master_owner"), compositionShareBps = sum("songwriter");
    const relevantRole = work?.work_type === "composition" ? "songwriter" : "master_owner";
    const allocationComplete = Boolean(work) && participants.length <= 200 &&
      allocations.some(item => item.role === relevantRole) && sum(relevantRole) === 10000 &&
      ["master_owner", "songwriter"].every(role => !allocations.some(item => item.role === role) || sum(role) === 10000);
    const checklist = [
      { id: "stems", status: project.kind !== "audio" ? "not_applicable" :
        pack?.status === "private" && stemTypes.length > 0 ? "pass" : "blocker",
      message: project.kind !== "audio" ? "Stem handoff is not required for this non-audio opportunity." :
        pack?.status === "private" && stemTypes.length > 0 ? `${stemTypes.length} separated stem file records found; completeness and sound quality require human review.` : TASKS.stems },
      { id: "allocations", status: allocationComplete ? "pass" : "blocker",
        message: allocationComplete ? "Recorded allocations total 100% in each tracked ownership pool; consent is still unverified." : TASKS.allocations },
      { id: "consent", status: "blocker", message: TASKS.consent },
      { id: "rights", status: !work || ["incomplete", "hold", "disputed"].includes(work.rights_status) ? "blocker" : "review",
        message: TASKS.rights },
      { id: "listening", status: project.kind === "audio" ? "review" : "not_applicable", message: TASKS.listening },
      { id: "brief", status: project.has_brief ? "pass" : "review", message: TASKS.brief }
    ];
    const blockers = checklist.filter(item => item.status === "blocker").map(({ id, message }) => ({ id, message }));
    const applicable = checklist.filter(item => item.status !== "not_applicable");
    const score = Math.round(100 * applicable.filter(item => item.status === "pass").length / applicable.length);
    const summary = `Metadata checklist coverage: ${score}/100, not an audio quality or legal readiness score. ` +
      (blockers.length ? "Resolve the recorded handoff and agreement blockers before progressing." : "The metadata checklist still needs human review.");
    const ownsProject = memberId === project.owner_member_id;
    return {
      projectId: project.id, provider: "checklist", status: blockers.length ? "blocked" : "needs_review",
      score, summary,
      audioInsights: [LIMITATIONS[0], checklist.find(item => item.id === "stems").message],
      actionableNextSteps: applicable.filter(item => item.status !== "pass").map(item => item.message),
      metrics: { stemCount: stemTypes.length, stemTypes, stemPackStatus: pack?.status || null,
        rightsAttested: pack?.rights_attested === true, rightsStatus: work?.rights_status || null,
        restrictionCount: work?.restrictions?.length || 0,
        allocations: ownsProject ? allocations : [], allocationVisibility: ownsProject ? "owner" : "redacted",
        allocationsTruncated: participants.length > 200, masterShareBps, compositionShareBps, consent: "not_recorded" },
      checklist, blockers, limitations: [...LIMITATIONS]
    };
  }

  async reservePaidRequest() {
    // Atomic bucket increments work across cold starts and concurrent function instances.
    // Member-denied requests must not consume shared capacity. Global denial stays fail-closed.
    for (const [key, limit] of [[`member:${this.memberId}`, 6], ["global", 60]]) {
      const rows = await this.db.sql`
        INSERT INTO halo_studio_guardian_usage (scope_key, bucket_start, request_count)
        VALUES (${key}, date_trunc('hour', NOW()), 1)
        ON CONFLICT (scope_key, bucket_start) DO UPDATE
        SET request_count = halo_studio_guardian_usage.request_count + 1
        WHERE halo_studio_guardian_usage.request_count < ${limit}
        RETURNING request_count
      `;
      if (!rows.length) return false;
    }
    return true;
  }

  async geminiPriorities(health, allowed) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Provider timeout"));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await this.fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "Prioritize the supplied studio checklist tasks. Return task identifiers only. Metadata is not audio analysis or legal verification. Never remove blockers or prescribe equal ownership. Do not infer consent." }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({
              tasks: allowed, blockers: health.blockers.map(item => item.id),
              stemCount: health.metrics.stemCount, rightsStatus: health.metrics.rightsStatus,
              masterShareBps: health.metrics.masterShareBps, compositionShareBps: health.metrics.compositionShareBps,
              consent: "not_recorded"
            }) }] }],
            generationConfig: {
              temperature: 0, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 },
              responseMimeType: "application/json",
              responseSchema: { type: "OBJECT", required: ["priorities"], properties: {
                priorities: { type: "ARRAY", minItems: 1, maxItems: 6, items: { type: "STRING", enum: allowed } }
              } }
            }
          })
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("Provider unavailable"); }
        const envelope = JSON.parse(await readBoundedText(response, 16384));
        if (envelope.promptFeedback?.blockReason || envelope.candidates?.length !== 1 ||
          envelope.candidates[0].finishReason !== "STOP") throw new Error("Invalid provider response");
        const parts = envelope.candidates[0].content?.parts;
        if (!Array.isArray(parts) || parts.length !== 1 || typeof parts[0].text !== "string") throw new Error("Invalid provider response");
        const result = JSON.parse(parts[0].text);
        if (!result || Array.isArray(result) || Object.keys(result).length !== 1 ||
          !Array.isArray(result.priorities) || result.priorities.length < 1 || result.priorities.length > 6 ||
          result.priorities.some(id => typeof id !== "string" || !allowed.includes(id)) ||
          new Set(result.priorities).size !== result.priorities.length) throw new Error("Invalid provider response");
        return result.priorities;
      })()]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async runStudioCouncilSession(projectId) {
    const health = await this.analyzeProjectHealth(projectId);
    const allowed = health.checklist.filter(item => !["pass", "not_applicable"].includes(item.status)).map(item => item.id);
    let priorities = allowed, provider = "checklist", fallbackReason = "not_configured";
    if (this.apiKey) {
      try {
        if (await this.reservePaidRequest()) {
          priorities = await this.geminiPriorities(health, allowed);
          provider = "gemini";
          fallbackReason = null;
        } else fallbackReason = "rate_limited";
      } catch {
        fallbackReason = "unavailable";
      }
    }
    // Model output only orders vetted tasks; all local blockers and authority remain intact.
    const tasks = [...new Set([...health.blockers.map(item => item.id), ...priorities, ...allowed])];
    const council = [
      { agentName: "Technical reviewer", role: "technical_metadata", content: `${LIMITATIONS[0]} ${health.audioInsights[1]}` },
      { agentName: "Rights reviewer", role: "rights_and_consent", content: `${TASKS.consent} ${LIMITATIONS[1]}` },
      { agentName: "Collaboration reviewer", role: "creative_handoff", content: TASKS.brief }
    ];
    const recommendedActions = tasks.map(id => TASKS[id]);
    return {
      projectId: health.projectId, provider, model: provider === "gemini" ? "gemini-2.5-flash" : null,
      status: health.status, summary: health.summary, health,
      council, finalVerdict: `${health.summary} ${LIMITATIONS[1]}`, recommendedActions,
      voices: council.map(({ agentName, content }) => ({ role: agentName, message: content })),
      recommendations: recommendedActions, fallbackReason, limitations: [...LIMITATIONS]
    };
  }
}

export function createStudioGuardianHandler({
  getDatabase, getUser, ensureMembership, verifyRequestOrigin,
  env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000
}) {
  const json = (body, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
  return async request => {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    try {
      const origin = request.headers.get("Origin");
      if (!origin || origin !== new URL(request.url).origin ||
        request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ message: "Cross-origin action rejected" }, 403);
      try {
        if (await verifyRequestOrigin(request) === false) return json({ message: "Cross-origin action rejected" }, 403);
      } catch { return json({ message: "Cross-origin action rejected" }, 403); }
      const user = await getUser(request);
      if (!user?.id) return json({ message: "Sign in to use Studio Guardian" }, 401);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
        return json({ message: "Use a JSON request body" }, 415);
      }
      if (Number(request.headers.get("Content-Length")) > 4096) return json({ message: "Request is too large" }, 413);
      let body;
      try { body = JSON.parse(await readBoundedText(request, 4096)); }
      catch (error) {
        if (error instanceof StudioGuardianError) throw error;
        return json({ message: "Request body must be valid JSON" }, 400);
      }
      if (!body || Array.isArray(body) || typeof body !== "object" ||
        Object.keys(body).some(key => !["action", "projectId"].includes(key)) ||
        !["health", "council"].includes(body.action) || typeof body.projectId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(body.projectId)) return json({ message: "Choose an action and a valid project ID" }, 400);
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      if (!membership?.member_id) return json({ message: "Membership is required" }, 403);
      const service = new HaloAIService({ db, memberId: membership.member_id, apiKey: env.GEMINI_API_KEY || "", fetchImpl, timeoutMs });
      if (body.action === "health") {
        const health = await service.analyzeProjectHealth(body.projectId);
        return json({ health, provider: health.provider });
      }
      const review = await service.runStudioCouncilSession(body.projectId);
      return json({ review, provider: review.provider });
    } catch (error) {
      return error instanceof StudioGuardianError
        ? json({ message: error.message }, error.status)
        : json({ message: "Studio Guardian is temporarily unavailable" }, 503);
    }
  };
}
