import { randomUUID } from "node:crypto";

// Release House submissions are review requests only. Recording one never creates a
// catalog release, radio track, publication, rights grant, or distribution instruction;
// those continue through the existing upload, rights-clearance, mastering and approval gates.

export const SUBMISSION_PATHWAYS = Object.freeze({
  halo_catalog_review: Object.freeze({
    label: "HALO managed catalog review",
    summary: "Ask the HALO team to review this release for catalog and promotion consideration.",
    boundary: "This is a review request only. It does not transfer, assign or license your master or publishing rights, and it does not authorise HALO to distribute or administer the release. Any distribution or administration arrangement would require a separate written agreement that you review and sign before any such rights are granted."
  }),
  independent_discovery: Object.freeze({
    label: "Independent release discovery listing",
    summary: "You release through your own distributor and ask HALO to consider the release for a discovery listing.",
    boundary: "You keep managing your own distribution. HALO does not distribute this release, collect its royalties, or register identifiers for it, and choosing this pathway does not transfer or license any rights."
  })
});

export const RIGHTS_ATTESTATION = Object.freeze({
  version: "2026-10-rights-control-v1",
  text: "I confirm that, to the best of my knowledge, I own or control the rights needed to submit this recording, its artwork and its metadata to HALO for review, including any permissions needed from co-writers, featured performers, producers and sample owners. I understand that this statement does not transfer any rights to HALO, and that HALO may ask for supporting information or decline the submission."
});

// No counsel-approved submission terms exist yet. Until a reviewed agreement and version
// are added here through code review, the API records terms_version as NULL and rejects
// any client claim of terms acceptance.
export const SUBMISSION_TERMS = Object.freeze({
  status: "counsel_review_required",
  version: null,
  url: null,
  note: "Release House submission terms are awaiting qualified legal review. No terms are presented or accepted with this submission."
});

export const SMART_LINK_HOSTS = Object.freeze(["distrokid.com", "hyperfollow.com", "ffm.to", "lnk.to", "found.ee", "linktr.ee"]);
export const SMART_LINK_MAX_LENGTH = 500;
export const SUBMISSION_STATUSES = Object.freeze(["pending_review", "withdrawn"]);

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function cleanLine(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, maxLength + 1);
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return SMART_LINK_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

// The link is stored as a user-supplied reference. It is never fetched, scraped or
// redirected to by the server, and it is not evidence of ownership or distribution.
export function validateSmartLink(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: true, url: "" };
  if (raw.length > SMART_LINK_MAX_LENGTH) return { ok: false, error: `Keep the smart link under ${SMART_LINK_MAX_LENGTH} characters.` };
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return { ok: false, error: "The smart link contains characters that are not allowed." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Enter a complete link that starts with https://." };
  }
  if (!/^https:\/\//i.test(raw) || url.protocol !== "https:") return { ok: false, error: "Smart links must use https://." };
  if (url.username || url.password) return { ok: false, error: "Smart links must not include login details." };
  if (url.port || /^https:\/\/[^/?#]*:/i.test(raw)) return { ok: false, error: "Smart links must not specify a port." };
  if (!isAllowedHost(url.hostname)) {
    return { ok: false, error: `Use a distributor smart link from ${SMART_LINK_HOSTS.join(", ")}.` };
  }
  const host = url.hostname.toLowerCase();
  if ((host === "distrokid.com" || host.endsWith(".distrokid.com")) && !url.pathname.startsWith("/hyperfollow/")) {
    return { ok: false, error: "DistroKid links must be HyperFollow links (distrokid.com/hyperfollow/…)." };
  }
  const normalized = url.toString();
  if (normalized.length > SMART_LINK_MAX_LENGTH) return { ok: false, error: `Keep the smart link under ${SMART_LINK_MAX_LENGTH} characters.` };
  return { ok: true, url: normalized };
}

export function validateSubmission(payload, { terms = SUBMISSION_TERMS } = {}) {
  const errors = {};
  const source = payload && typeof payload === "object" ? payload : {};
  const projectId = String(source.projectId || "").trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(projectId)) errors.projectId = "Save this release project before submitting it.";

  const pathway = typeof source.pathway === "string" ? source.pathway : "";
  if (!Object.hasOwn(SUBMISSION_PATHWAYS, pathway)) errors.pathway = "Choose a submission pathway.";

  const artistName = cleanLine(source.artistName, 120);
  if (!artistName) errors.artistName = "Enter the primary artist name.";
  else if (artistName.length > 120) errors.artistName = "Keep the artist name to 120 characters or fewer.";

  const trackTitle = cleanLine(source.trackTitle, 160);
  if (!trackTitle) errors.trackTitle = "Enter the track title.";
  else if (trackTitle.length > 160) errors.trackTitle = "Keep the track title to 160 characters or fewer.";

  const link = validateSmartLink(source.smartLinkUrl);
  if (!link.ok) errors.smartLinkUrl = link.error;

  if (source.rightsAttested !== true || source.attestationVersion !== RIGHTS_ATTESTATION.version) {
    errors.rightsAttested = "Confirm the current rights-control statement to submit.";
  }

  let termsVersion = null;
  if (terms?.status === "approved") {
    if (!terms.version || !terms.url || source.termsVersion !== terms.version) errors.terms = "Review and accept the current submission terms.";
    else termsVersion = terms.version;
  } else if (source.termsVersion !== undefined && source.termsVersion !== null && source.termsVersion !== "") {
    errors.terms = "No approved submission terms are available to accept yet.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { projectId, pathway, artistName, trackTitle, smartLinkUrl: link.url, attestationVersion: RIGHTS_ATTESTATION.version, termsVersion }
  };
}

export function submissionPolicy() {
  return {
    pathways: Object.entries(SUBMISSION_PATHWAYS).map(([id, pathway]) => ({ id, ...pathway })),
    attestation: RIGHTS_ATTESTATION,
    terms: SUBMISSION_TERMS,
    smartLinkHosts: SMART_LINK_HOSTS
  };
}

export function isMissingSubmissionStorage(error) {
  return error?.code === "42P01" || /halo_release_house_submissions.*does not exist/i.test(String(error?.message || ""));
}

export function serializeSubmission(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    pathway: row.pathway,
    pathwayLabel: SUBMISSION_PATHWAYS[row.pathway]?.label || row.pathway,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    smartLinkUrl: row.smart_link_url || "",
    attestationVersion: row.rights_attestation_version,
    attestedAt: new Date(row.rights_attested_at).toISOString(),
    termsVersion: row.terms_version || null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function loadLatestSubmissions(db, memberId) {
  const rows = await db.sql`
    SELECT DISTINCT ON (project_id)
      id, project_id, pathway, artist_name, track_title, smart_link_url, rights_attestation_version,
      rights_attested_at, terms_version, status, created_at, updated_at
    FROM halo_release_house_submissions
    WHERE owner_member_id = ${memberId}
    ORDER BY project_id, created_at DESC
    LIMIT 50
  `;
  return Object.fromEntries(rows.map(row => [row.project_id, serializeSubmission(row)]));
}

export async function recordSubmission(db, memberId, value) {
  const projects = await db.sql`
    SELECT id FROM halo_release_house_projects
    WHERE id = ${value.projectId} AND owner_member_id = ${memberId} AND status <> 'archived'
  `;
  if (!projects.length) return { status: 404, message: "That release project was not found" };

  const rows = await db.sql`
    INSERT INTO halo_release_house_submissions (
      id, project_id, owner_member_id, pathway, artist_name, track_title, smart_link_url,
      rights_attestation_version, terms_version
    ) VALUES (
      ${randomUUID()}, ${value.projectId}, ${memberId}, ${value.pathway}, ${value.artistName}, ${value.trackTitle},
      ${value.smartLinkUrl}, ${value.attestationVersion}, ${value.termsVersion}
    )
    ON CONFLICT (project_id) WHERE status = 'pending_review' DO NOTHING
    RETURNING id, project_id, pathway, artist_name, track_title, smart_link_url, rights_attestation_version,
      rights_attested_at, terms_version, status, created_at, updated_at
  `;
  if (!rows.length) return { status: 409, message: "This project already has a submission pending review. Withdraw it before submitting again." };
  return { status: 201, submission: serializeSubmission(rows[0]) };
}

export async function withdrawSubmission(db, memberId, submissionId) {
  const id = String(submissionId || "").trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(id)) return { status: 400, message: "Choose a valid submission" };
  const rows = await db.sql`
    UPDATE halo_release_house_submissions
    SET status = 'withdrawn', updated_at = NOW()
    WHERE id = ${id} AND owner_member_id = ${memberId} AND status = 'pending_review'
    RETURNING id, project_id, pathway, artist_name, track_title, smart_link_url, rights_attestation_version,
      rights_attested_at, terms_version, status, created_at, updated_at
  `;
  if (!rows.length) return { status: 404, message: "No pending submission was found to withdraw" };
  return { status: 200, submission: serializeSubmission(rows[0]) };
}
