import { reviewRequest } from "./reviews.js";

const $ = selector => document.querySelector(selector);
let authorized = false, busy = false, accessSequence = 0;

function lock(message) {
  authorized = false;
  $("#workspace").hidden = true;
  $("#locked").hidden = false;
  $("#result").hidden = true;
  $("#paid").checked = false;
  $("#resultText").textContent = "";
  $("#resultAction").textContent = "";
  $("#sendStatus").textContent = "";
  $("#accessStatus").textContent = message;
}

async function checkAccess() {
  const current = ++accessSequence;
  lock("Checking owner access…");
  try {
    const response = await fetch("/api/halo-control-center", { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    if (current !== accessSequence) return;
    if (response.status !== 204) {
      lock(response.status === 401 ? "Sign in with an owner account." : response.status === 403
        ? "This workspace is limited to the owner team." : "Owner access could not be verified.");
      return;
    }
    authorized = true;
    $("#locked").hidden = true;
    $("#workspace").hidden = false;
    $("#accessStatus").textContent = "Owner access verified for this request. Each review requires a manual action.";
  } catch {
    if (current === accessSequence) lock("Owner access could not be verified. Check your connection.");
  }
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("[data-review], #paid").forEach(control => { control.disabled = value; });
}

async function requestReview(key) {
  if (!authorized || busy) return;
  const generation = accessSequence;
  setBusy(true);
  $("#result").hidden = true;
  $("#sendStatus").textContent = "Sending one request to the owner council…";
  try {
    const response = await fetch("/api/halo-control-center", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reviewRequest(key, $("#paid").checked))
    });
    if (generation !== accessSequence) return;
    if (response.status === 401 || response.status === 403) {
      ++accessSequence;
      lock("Owner access expired or could not be verified. Sign in again.");
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "The council request failed.");
    if (!data.command || typeof data.command.response !== "string" ||
        typeof data.command.model !== "string") throw new Error("The council returned an incomplete response.");
    const command = data.command;
    $("#resultMode").textContent = command.model === "deterministic-fallback"
      ? "Deterministic acknowledgement; no AI synthesis was completed."
      : "Advisory AI response. Review and verify every suggestion.";
    $("#resultText").textContent = command.response;
    $("#resultAction").textContent = command.actionId
      ? `Proposal #${command.actionId} was recorded in the existing approval queue. It is not approved or implemented.`
      : "No proposed action was returned.";
    $("#result").hidden = false;
    $("#sendStatus").textContent = "Request recorded. No tests or implementation ran.";
  } catch (error) {
    if (generation === accessSequence) $("#sendStatus").textContent = `Request not confirmed: ${error.message}. Check the control center before retrying; the request may already have been recorded.`;
  } finally { setBusy(false); }
}

$("#checkAccess").addEventListener("click", checkAccess);
document.querySelectorAll("[data-review]").forEach(button => button.addEventListener("click", () => requestReview(button.dataset.review)));
function subscribeIdentity(identity) {
  identity?.onAuthChange?.(() => { ++accessSequence; lock("Identity changed. Check owner access again."); });
}
if (window.haloIdentity) subscribeIdentity(window.haloIdentity);
else window.addEventListener("halo-identity-ready", event => subscribeIdentity(event.detail), { once: true });
window.addEventListener("pageshow", checkAccess);
