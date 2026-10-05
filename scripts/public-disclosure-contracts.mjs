import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// Surface kinds:
// - "exact":      string phrases match the raw file content (case- and punctuation-sensitive).
// - "normalized": string phrases match normalized copy (case, punctuation, and whitespace insensitive).
// - "mixed":      string phrases match normalized copy; { exact } entries match the raw file content.
// Forbidden claims always run against normalized copy so formatting changes cannot hide them.
const SURFACE_KINDS = new Set(["exact", "normalized", "mixed"]);

const OWNERSHIP_STATEMENTS = [
  "Owen Anthony’s music is owned by Halo Music.",
  "Other artist-uploaded content remains the uploader’s property unless an explicit split or ownership agreement is configured on HALO.",
  "Uploading alone transfers no rights.",
  "HALO software and technical infrastructure are proprietary."
];
const OWNERSHIP_POLICY_BLOCK = OWNERSHIP_STATEMENTS.join(" ");
const COPYRIGHT_PROMPT = "℗ sound-recording rights holder and year / © composition or artwork rights holder and year; enter confirmed rights holders for this release";
const NO_RIGHTS_TRANSFER = "Uploading alone transfers no rights.";

// Disclosure families that must appear exactly once on a surface, regardless of which approved wording is used.
const MUSIC_OWNERSHIP_DISCLOSURE = {
  label: "Owen Anthony music ownership disclosure",
  pattern: /(?:owen anthony s music is owned|halo music owns owen anthony s music|halo music s ownership claim covers owen anthony s music)/g
};
const UPLOADER_OWNERSHIP_DISCLOSURE = {
  label: "uploader ownership disclosure",
  pattern: /(?:artist uploaded (?:music and )?content remains?|artist uploads remain uploader owned)/g
};

const RESTRICTED_IMPLEMENTATION_PHRASES = [
  "with no paid ai call",
  "five specialist agents",
  "model weights",
  "spectral choices",
  "simulated room telemetry",
  "full set history"
];

// Forbidden claims table. Patterns run against normalized copy.
const FORBIDDEN_CLAIMS = [
  {
    id: "blanket-upload-ownership",
    description: "does not claim blanket upload ownership",
    pattern: /\bhalo (?:music )?(?:owns|takes ownership of|retains ownership of|acquires|claims) (?:all |any |these |the )?(?:uploaded (?:music|files|content|tracks)|artist uploads|uploads)\b|\b(?:uploaded (?:music|files|content|tracks)|these files|artist uploads) (?:are|is|become|becomes) (?:owned by|the property of) halo\b/
  },
  {
    id: "upload-transfers-rights",
    description: "does not imply that uploading transfers rights",
    pattern: /\b(?:uploading|uploads?|submitting|submissions?) (?:to halo )?(?:automatically )?(?:transfers?|assigns?|grants?|conveys?) (?:all |full |exclusive |your |the )?(?:rights|ownership|copyrights?)\b/
  },
  {
    id: "catalog-wide-halo-ownership",
    description: "does not extend Halo Music ownership beyond Owen Anthony’s music",
    pattern: /\bhalo music owns (?:all|any|every|the entire|the full|the whole)\b|\bhalo (?:music )?owns (?:all |every )?(?:artist|creator) (?:music|content|releases)\b/
  },
  ...RESTRICTED_IMPLEMENTATION_PHRASES.map(phrase => ({
    id: `restricted:${phrase}`,
    description: `does not disclose restricted implementation language: ${phrase}`,
    pattern: new RegExp(escapeRegExp(normalizeCopy(phrase)))
  }))
];
const OWNERSHIP_FORBIDDEN = ["blanket-upload-ownership", "upload-transfers-rights", "catalog-wide-halo-ownership"];
const RESTRICTED_FORBIDDEN = RESTRICTED_IMPLEMENTATION_PHRASES.map(phrase => `restricted:${phrase}`);

const OWNERSHIP_POLICY_CONTRACT = {
  required: [OWNERSHIP_POLICY_BLOCK],
  uniqueRequired: [...OWNERSHIP_STATEMENTS, MUSIC_OWNERSHIP_DISCLOSURE, UPLOADER_OWNERSHIP_DISCLOSURE],
  forbidden: OWNERSHIP_FORBIDDEN
};

// Surface contract table. Each public disclosure surface is declared once.
const SURFACE_CONTRACTS = [
  {
    path: "dreamweaver/index.html",
    kind: "normalized",
    required: ["proprietary halo technology", "capabilities and outcomes, not confidential methods"],
    uniqueRequired: [],
    forbidden: [...RESTRICTED_FORBIDDEN, ...OWNERSHIP_FORBIDDEN],
    notes: "Dreamweaver describes proprietary capabilities and outcomes without confidential methods."
  },
  ...["dreamweaver/dreamweaver.js", "campaign-studio/index.html", "campaign-studio/campaign-studio.js"].map(path => ({
    path,
    kind: "normalized",
    required: [],
    uniqueRequired: [],
    forbidden: [...RESTRICTED_FORBIDDEN, ...OWNERSHIP_FORBIDDEN],
    notes: "Public Dreamweaver and campaign surfaces must not expose restricted implementation language."
  })),
  ...["halo.html", "creators/index.html", "dj-deck.html"].map(path => ({
    path,
    kind: "normalized",
    ...OWNERSHIP_POLICY_CONTRACT,
    notes: "Displays the full ownership policy once, in order."
  })),
  {
    path: "release-house/release-house.js",
    kind: "mixed",
    ...OWNERSHIP_POLICY_CONTRACT,
    required: [
      ...OWNERSHIP_POLICY_CONTRACT.required,
      { exact: `placeholder: "${COPYRIGHT_PROMPT}"` },
      "© 2026 Halo Music (Owen Anthony composition) / ℗ 2026 Halo Music (Owen Anthony recording)"
    ],
    notes: "Release metadata keeps the exact release-specific rights-holder prompt and scopes example ownership to Owen Anthony."
  },
  {
    path: "release-house/index.html",
    kind: "normalized",
    required: [
      "Artist-uploaded music and content remain 100% the uploader’s property by default",
      "explicitly configured and agreed on this site",
      "Halo Music owns Owen Anthony’s music only",
      "platform technology rights are separate"
    ],
    uniqueRequired: [NO_RIGHTS_TRANSFER, MUSIC_OWNERSHIP_DISCLOSURE, UPLOADER_OWNERSHIP_DISCLOSURE],
    forbidden: OWNERSHIP_FORBIDDEN,
    checks: [
      {
        description: "states that uploading transfers no rights inside the “Your music remains yours.” ownership promise",
        test: ({ raw }) => {
          const section = raw.match(/<section\b[^>]*aria-labelledby="ownershipTitle"[^>]*>([\s\S]*?)<\/section>/)?.[1] || "";
          const promise = [...section.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)]
            .map(([, article]) => normalizeCopy(article))
            .find(article => containsPhrase(article, normalizeCopy("Your music remains yours.")));
          return Boolean(promise)
            && containsPhrase(promise, normalizeCopy(NO_RIGHTS_TRANSFER))
            && containsPhrase(promise, normalizeCopy("Halo Music owns Owen Anthony’s music only"));
        }
      }
    ],
    notes: "The Release House no-rights-transfer disclosure is explicitly enforced within the ownership section."
  },
  {
    path: "sync-hub/index.html",
    kind: "normalized",
    required: [
      "Owen Anthony music for sync discussions",
      "Halo Music owns Owen Anthony’s music only",
      "rights must be confirmed for each track and intended use",
      "no license is granted until written approval"
    ],
    uniqueRequired: [MUSIC_OWNERSHIP_DISCLOSURE],
    forbidden: OWNERSHIP_FORBIDDEN,
    notes: "Sync copy is scoped to Owen Anthony music and requires written approval before licensing."
  },
  {
    path: "asset-inventory/index.html",
    kind: "normalized",
    required: ["confirm master, publishing, contributor, and clearance status for each release and intended use"],
    uniqueRequired: ["Halo Music ownership applies only to Owen Anthony music"],
    forbidden: OWNERSHIP_FORBIDDEN,
    notes: "Asset inventory scopes Halo Music ownership to Owen Anthony music and confirms rights per release."
  }
];

function normalizeCopy(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholePhrasePattern(phrase) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, "gu");
}

function containsPhrase(text, phrase) {
  return countPhrase(text, phrase) > 0;
}

function countPhrase(text, phrase) {
  return (text.match(wholePhrasePattern(phrase)) || []).length;
}

function describeEntry(entry) {
  if (typeof entry === "string") return `"${entry}"`;
  if (entry.exact) return `exact "${entry.exact}"`;
  return entry.label;
}

function countEntry(surface, entry) {
  if (entry.exact) return surface.raw.split(entry.exact).length - 1;
  if (entry.pattern) return (surface.normalized.match(entry.pattern) || []).length;
  if (surface.kind === "exact") return surface.raw.split(entry).length - 1;
  return countPhrase(surface.normalized, normalizeCopy(entry));
}

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

// Guard the normalizer itself so formatting tolerance cannot silently drift.
const NORMALIZATION_CASES = [
  ["Owen Anthony’s music", "owen anthony's   MUSIC"],
  ["Artist-uploaded content", "artist uploaded content"],
  ["100% the uploader’s property", "100 the uploader's property"],
  ["Uploading alone transfers no rights.", "uploading alone — transfers no rights"]
];
for (const [left, right] of NORMALIZATION_CASES) {
  check(normalizeCopy(left) === normalizeCopy(right), `normalization treats "${left}" and "${right}" as equivalent`);
}
check(!containsPhrase(normalizeCopy("Uploading alone transfers no rightsholders"), normalizeCopy(NO_RIGHTS_TRANSFER)), "phrase matching respects word boundaries");

// Validate the contract tables before running them so misconfiguration cannot produce a false pass.
const forbiddenIds = new Set(FORBIDDEN_CLAIMS.map(({ id }) => id));
check(forbiddenIds.size === FORBIDDEN_CLAIMS.length, "forbidden claim ids are unique");
check(new Set(SURFACE_CONTRACTS.map(({ path }) => path)).size === SURFACE_CONTRACTS.length, "each surface is declared once");
for (const contract of SURFACE_CONTRACTS) {
  check(SURFACE_KINDS.has(contract.kind), `${contract.path} declares a supported kind`);
  const entries = [...contract.required, ...contract.uniqueRequired];
  check(contract.kind !== "normalized" || entries.every(entry => !entry.exact), `${contract.path} only uses exact entries on exact or mixed surfaces`);
  check(contract.kind !== "exact" || entries.every(entry => !entry.pattern), `${contract.path} only uses normalized patterns on normalized or mixed surfaces`);
  check(contract.forbidden.every(id => forbiddenIds.has(id)), `${contract.path} references known forbidden claims`);
}

const surfaces = await Promise.all(SURFACE_CONTRACTS.map(async contract => {
  const raw = await readFile(resolve(root, contract.path), "utf8");
  return { ...contract, raw, normalized: normalizeCopy(raw) };
}));

for (const surface of surfaces) {
  for (const entry of surface.required) {
    check(countEntry(surface, entry) >= 1, `${surface.path} displays required disclosure ${describeEntry(entry)}`);
  }
  for (const entry of surface.uniqueRequired) {
    const count = countEntry(surface, entry);
    check(count === 1, `${surface.path} states ${describeEntry(entry)} exactly once (found ${count})`);
  }
  for (const id of surface.forbidden) {
    const claim = FORBIDDEN_CLAIMS.find(candidate => candidate.id === id);
    const match = surface.normalized.match(claim.pattern);
    check(!match, `${surface.path} ${claim.description}${match ? ` (found "${match[0]}")` : ""}`);
  }
  for (const { description, test } of surface.checks || []) {
    check(test(surface), `${surface.path} ${description}`);
  }
}

console.log(`Public disclosure contracts: ${checks}/${checks} checks passed across ${surfaces.length} surfaces.`);
