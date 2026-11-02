import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { serializeSubmission } from "../lib/release-house-submission.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createReleaseHouseReviewHandler({
  database = getDatabase, currentUser = getUser, verifyOrigin = verifyRequestOrigin, membershipFor = ensureMembership
} = {}) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to access staff review." }, 401);
      if (!isOwner(user)) return json({ message: "Staff review access is required." }, 403);
      if (request.method === "POST") {
        try { verifyOrigin(request); } catch { return json({ message: "Cross-origin review actions are not accepted." }, 403); }
      }

      let payload;
      if (request.method === "POST") {
        const body = await request.text();
        if (new TextEncoder().encode(body).length > 12000) return json({ message: "Review note is too large." }, 413);
        try { payload = JSON.parse(body); } catch { return json({ message: "Request body must be valid JSON." }, 400); }
        const note = cleanText(payload?.note, 2001);
        if (!ID_PATTERN.test(payload?.submissionId || "") || !["note", "follow_up_needed"].includes(payload?.action) || !note || note.length > 2000) {
          return json({ message: "Choose a pending submission, a note or follow-up marker, and a note of 1–2000 characters." }, 400);
        }
        payload = { submissionId: payload.submissionId, action: payload.action, note };
      }

      const db = await database();
      if (request.method === "GET") {
        const rows = await db.sql`
          SELECT submission.*, COALESCE(history.entries, '[]'::json) AS review_history
          FROM halo_release_house_submissions submission
          LEFT JOIN LATERAL (
            SELECT json_agg(recent ORDER BY recent.created_at DESC, recent.id DESC) AS entries FROM (
              SELECT id, reviewer_member_id, action, note, created_at
              FROM halo_release_house_review_notes
              WHERE submission_id = submission.id
              ORDER BY created_at DESC, id DESC LIMIT 20
            ) recent
          ) history ON TRUE
          WHERE submission.status = 'pending_review'
          ORDER BY submission.created_at, submission.id
          LIMIT 50
        `;
        return json({ submissions: rows.map(row => ({ ...serializeSubmission(row), reviews: row.review_history })) });
      }

      const membership = await membershipFor(db, user);
      const rows = await db.sql`
        INSERT INTO halo_release_house_review_notes (id, submission_id, reviewer_member_id, action, note)
        SELECT ${randomUUID()}, id, ${membership.member_id}, ${payload.action}, ${payload.note}
        FROM halo_release_house_submissions
        WHERE id = ${payload.submissionId} AND status = 'pending_review'
        RETURNING id, submission_id, reviewer_member_id, action, note, created_at
      `;
      if (!rows.length) return json({ message: "No pending submission was found. Refresh the queue." }, 404);
      return json({ review: rows[0], message: "Internal review note saved. Submission remains pending; no artist notification was sent and no release gates were changed." }, 201);
    } catch (error) {
      if (error?.code === "42P01") {
        return json({ code: "review_unavailable", message: "Staff review storage is unavailable. Apply the submission and review-note migrations; no review note was recorded." }, 503);
      }
      console.error("Release House review failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Staff review is temporarily unavailable." }, 500);
    }
  };
}

export default createReleaseHouseReviewHandler();
export const config = { path: "/api/release-house-review" };
