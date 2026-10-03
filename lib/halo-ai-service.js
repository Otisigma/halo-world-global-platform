// HaloAIService / Studio Guardian.
// Deterministic local checks run first and are always the source of truth for pass/fail.
// An optional transport (for example a Gemini 2.5 Flash council endpoint) may add advisory
// notes, but it can never approve a release: council review always requires human sign-off.

export const GUARDIAN_ENGINE = Object.freeze({
  local: "halo-studio-guardian/1",
  plannedRemoteModel: "gemini-2.5-flash"
});

export const STEM_RULES = Object.freeze({
  formats: Object.freeze(["wav", "aiff", "aif", "flac"]),
  minSampleRate: 44100,
  minBitDepth: 24,
  durationToleranceSec: 0.5,
  maxStems: 64
});

export const COUNCIL_LANES = Object.freeze(["A&R", "Rights + splits", "Mastering"]);
export const COUNCIL_MIN_SCORE = 70;

const text = (value, max = 180) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

export function parseStemLines(source = "") {
  return String(source).split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, STEM_RULES.maxStems).map(line => {
    const [name = "", sampleRate, bitDepth, durationSec] = line.split(/\s+/);
    return {
      name,
      format: name.includes(".") ? name.split(".").pop().toLowerCase() : "",
      sampleRate: Number(sampleRate),
      bitDepth: Number(bitDepth),
      durationSec: Number(durationSec)
    };
  });
}

export function validateStems(stems = []) {
  const list = Array.isArray(stems) ? stems.slice(0, STEM_RULES.maxStems) : [];
  const issues = [];
  if (!list.length) issues.push("Add at least one stem.");
  const durations = list.map(stem => Number(stem?.durationSec)).filter(Number.isFinite);
  const longest = durations.length ? Math.max(...durations) : 0;
  const seen = new Set();
  const results = list.map(stem => {
    const name = text(stem?.name, 160);
    const format = text(stem?.format || (name.includes(".") ? name.split(".").pop() : ""), 10).toLowerCase();
    const stemIssues = [];
    if (!name) stemIssues.push("Missing file name.");
    else if (seen.has(name.toLowerCase())) stemIssues.push("Duplicate stem name.");
    seen.add(name.toLowerCase());
    if (!STEM_RULES.formats.includes(format)) stemIssues.push(`Use a lossless format (${STEM_RULES.formats.join(", ")}).`);
    if (!(Number(stem?.sampleRate) >= STEM_RULES.minSampleRate)) stemIssues.push(`Sample rate must be at least ${STEM_RULES.minSampleRate} Hz.`);
    if (!(Number(stem?.bitDepth) >= STEM_RULES.minBitDepth)) stemIssues.push(`Bit depth must be at least ${STEM_RULES.minBitDepth}-bit.`);
    const duration = Number(stem?.durationSec);
    if (!(duration > 0)) stemIssues.push("Duration is missing.");
    else if (longest - duration > STEM_RULES.durationToleranceSec) stemIssues.push("Stem is shorter than the session; export from bar 1 to the end.");
    return { name: name || "Unnamed stem", format, passed: stemIssues.length === 0, issues: stemIssues };
  });
  return { passed: results.length > 0 && results.every(stem => stem.passed), stems: results, issues };
}

export function verifySplits(splits = [], { policy = "50/50" } = {}) {
  const list = Array.isArray(splits) ? splits : [];
  const issues = [];
  const parties = list.map(split => ({ party: text(split?.party, 120), share: Number(split?.share) }));
  const names = new Set();
  for (const { party, share } of parties) {
    if (!party) issues.push("Every split needs a named party.");
    else if (names.has(party.toLowerCase())) issues.push(`${party} is listed more than once.`);
    names.add(party.toLowerCase());
    if (!(share > 0 && share <= 100)) issues.push(`${party || "A party"} needs a share between 0 and 100.`);
  }
  const total = Math.round(parties.reduce((sum, { share }) => sum + (Number.isFinite(share) ? share : 0), 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) issues.push(`Shares total ${total}%; they must total 100%.`);
  if (policy === "50/50") {
    if (parties.length !== 2) issues.push("A 50/50 split needs exactly two parties.");
    else if (parties.some(({ share }) => Math.abs(share - 50) > 0.01)) issues.push("Each party must hold exactly 50%.");
  }
  return { passed: parties.length > 0 && issues.length === 0, policy, total, parties, issues: [...new Set(issues)] };
}

export function scoreProjectHealth(project = {}) {
  const stems = validateStems(project.stems);
  const splits = verifySplits(project.splits, { policy: project.splitPolicy || "50/50" });
  const bpm = Number(project.bpm);
  const checks = [
    { id: "metadata", label: "Title, artist, BPM + key", weight: 20,
      passed: Boolean(text(project.title) && text(project.artist) && bpm >= 20 && bpm <= 300 && text(project.musicalKey, 20)) },
    { id: "master", label: "Sale master uploaded", weight: 20, passed: project.hasMaster === true },
    { id: "artwork", label: "Release artwork", weight: 10, passed: project.hasArtwork === true },
    { id: "isrc", label: "ISRC registered", weight: 10, passed: /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i.test(text(project.isrc, 20)) },
    { id: "stems", label: "Stem validation", weight: 20, passed: stems.passed },
    { id: "splits", label: "Split verification", weight: 20, passed: splits.passed }
  ];
  const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const grade = score >= 90 ? "Release ready" : score >= COUNCIL_MIN_SCORE ? "Council ready" : score >= 40 ? "In progress" : "Needs attention";
  const next = checks.find(check => !check.passed);
  return { score, grade, checks, stems, splits, nextAction: next ? `Next: ${next.label}.` : "All Studio Guardian checks passed." };
}

function slug(value) {
  return text(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

export function createCouncilReview(project = {}, health = scoreProjectHealth(project), { now = new Date() } = {}) {
  const blockers = [];
  if (health.score < COUNCIL_MIN_SCORE) blockers.push(`Health score ${health.score} is below ${COUNCIL_MIN_SCORE}.`);
  if (!health.splits.passed) blockers.push("Splits must be verified before council review.");
  const status = blockers.length ? "blocked" : "queued";
  return {
    id: `council-${slug(project.title)}-${health.score}`,
    status,
    lanes: [...COUNCIL_LANES],
    blockers,
    requiresHumanApproval: true,
    requestedAt: now.toISOString(),
    message: status === "queued"
      ? "Queued for the HALO council. A human owner signs off before anything is released."
      : "Fix the blockers, then request council review again."
  };
}

export class HaloAIService {
  constructor({ transport = null } = {}) {
    this.transport = typeof transport === "function" ? transport : null;
  }

  async review(project = {}, options = {}) {
    const health = scoreProjectHealth(project);
    const council = createCouncilReview(project, health, options);
    const result = { engine: GUARDIAN_ENGINE.local, health, council, advisory: null };
    if (!this.transport) return result;
    try {
      const remote = await this.transport({ type: "studio-guardian", model: GUARDIAN_ENGINE.plannedRemoteModel, project, health });
      result.advisory = text(remote?.advisory, 1200) || null;
    } catch {
      result.advisory = null;
    }
    return result;
  }
}
