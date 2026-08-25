import { acceptPublicIssueReport, reportIssue } from "../lib/maintenance.mjs";

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function issuesHandler(request) {
  if (request.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) return jsonResponse({ message: "Issue report is too large" }, 413);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return jsonResponse({ message: "Cross-origin issue reports are not accepted" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ message: "Issue report must be valid JSON" }, 400);
  }

  if (!payload || typeof payload !== "object" || !String(payload.title || "").trim()) {
    return jsonResponse({ message: "Issue title is required" }, 422);
  }

  try {
    if (!(await acceptPublicIssueReport(request))) {
      return jsonResponse({ message: "Issue report rate limit exceeded" }, 429, { "Retry-After": "60" });
    }
    const issue = await reportIssue(payload);
    return jsonResponse({
      accepted: true,
      issueId: issue.id,
      status: issue.status,
      triageStatus: issue.triageStatus,
      dispatchStatus: issue.dispatchStatus
    }, 202);
  } catch (error) {
    console.error("Issue report storage failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Issue report could not be stored" }, 500);
  }
}

export const config = {
  path: "/api/issues"
};
