const form = document.getElementById("reviewForm");
const status = document.getElementById("reviewStatus");
const select = document.getElementById("reviewSubmission");
const note = document.getElementById("reviewNote");
const save = document.getElementById("saveReview");
const refresh = document.getElementById("refreshReviews");
let submissions = [];

function showDetails() {
  const record = submissions.find(item => item.id === select.value);
  document.getElementById("reviewDetails").textContent = record ? [
    `${record.artistName} — ${record.trackTitle}`, record.pathwayLabel,
    `Unverified link: ${record.smartLinkUrl || "None"}`,
    `Rights statement: ${record.attestationVersion} at ${record.attestedAt}`,
    `Terms: ${record.termsVersion || "None accepted — counsel review required"}`,
    `Submission: ${record.id} at ${record.createdAt}`,
    ...record.reviews.map(review => `${review.created_at} · ${review.reviewer_member_id} · ${review.action}\n${review.note}`)
  ].join("\n\n") : "";
  note.value = "";
}

async function loadReviews() {
  form.hidden = true;
  select.replaceChildren();
  submissions = [];
  showDetails();
  status.textContent = "Checking staff access and review storage…";
  refresh.disabled = true;
  try {
    const response = await fetch("/api/release-house-review", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = data.message || "Staff review is unavailable.";
      return;
    }
    submissions = data.submissions || [];
    for (const record of submissions) {
      const option = document.createElement("option");
      option.value = record.id;
      option.textContent = `${record.artistName} — ${record.trackTitle}`;
      select.append(option);
    }
    status.textContent = submissions.length ? `${submissions.length} pending requests shown. No review timeframe is promised.` : "No pending requests.";
    form.hidden = !submissions.length;
    showDetails();
  } catch {
    status.textContent = "Staff review could not be reached. No review action is available.";
  } finally {
    refresh.disabled = false;
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (save.disabled) return;
  save.disabled = true;
  refresh.disabled = true;
  select.disabled = true;
  try {
    const response = await fetch("/api/release-house-review", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: select.value, action: document.getElementById("reviewAction").value, note: note.value })
    });
    const data = await response.json();
    if (response.status === 201 && data.review?.id) {
      await loadReviews();
      status.textContent = data.message;
    } else {
      if ([401, 403, 503].includes(response.status)) form.hidden = true;
      status.textContent = data.message || "The review note was not saved.";
    }
  } catch {
    status.textContent = "Save could not be confirmed. Refresh the queue before retrying.";
  } finally {
    save.disabled = false;
    refresh.disabled = false;
    select.disabled = false;
  }
});
select.addEventListener("change", showDetails);
refresh.addEventListener("click", loadReviews);
loadReviews();
