// DJ Council verdict badge for HALO OS. Renders the council score, pass/fail state, the four
// specialist pillars and actionable recommendations. Pure markup builder + DOM renderer so it can
// be contract-tested without a browser.

const PILLAR_STATUS_COPY = Object.freeze({ pass: "Cleared", warn: "Advisory", fail: "Blocked" });

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function statusClass(status) {
  return ["pass", "warn", "fail"].includes(status) ? status : "fail";
}

export function djCouncilBadgeMarkup(verdict, options = {}) {
  if (!verdict || typeof verdict !== "object" || !Array.isArray(verdict.pillars)) {
    return `<div class="dj-council-badge is-fail" data-council-state="unavailable"><header class="dj-council-head"><span class="dj-council-score"><b>—</b><small>/100</small></span><div><p class="dj-council-eyebrow">DJ Council</p><h3>Council review unavailable</h3><p class="dj-council-summary">${escapeHTML(options.unavailableMessage || "The DJ Council could not review this mix, so it is not deliverable. Reload the deck and re-record.")}</p></div></header></div>`;
  }
  const passed = verdict.pass === true;
  const checksById = new Map((verdict.checks || []).map(check => [check.id, check]));
  const pillars = verdict.pillars.map(pillar => {
    const checks = (pillar.checks || []).map(id => checksById.get(id)).filter(Boolean);
    const state = statusClass(pillar.status);
    return `<li class="dj-council-pillar is-${state}" data-council-pillar="${escapeHTML(pillar.id)}">
      <header><span>${escapeHTML(pillar.specialist)}</span><b>${Number(pillar.score) || 0}</b></header>
      <strong>${escapeHTML(pillar.label)} · ${PILLAR_STATUS_COPY[state]}</strong>
      <ul>${checks.map(check => `<li class="is-${statusClass(check.status)}" data-council-check="${escapeHTML(check.id)}"><span>${escapeHTML(check.label)}</span><small>${escapeHTML(check.detail)}</small></li>`).join("")}</ul>
    </li>`;
  }).join("");
  const recommendations = (verdict.recommendations || []).map(item => `<li class="is-${item.priority === "blocker" ? "blocker" : "advisory"}" data-council-action="${escapeHTML(item.action)}"><b>${item.priority === "blocker" ? "Must fix" : "Advisory"}</b><span>${escapeHTML(item.message)}</span></li>`).join("");
  const showApply = typeof options.onApplyFixes === "function" && (verdict.recommendations || []).length > 0;
  return `<div class="dj-council-badge is-${passed ? "pass" : "fail"}" data-council-state="${passed ? "pass" : "fail"}">
    <header class="dj-council-head">
      <span class="dj-council-score" aria-label="Council score ${Number(verdict.score) || 0} out of 100"><b>${Number(verdict.score) || 0}</b><small>/100</small></span>
      <div>
        <p class="dj-council-eyebrow">DJ Council · ${passed ? "Deliverable" : "Not deliverable"}</p>
        <h3>${passed ? "Council passed" : "Council blocked delivery"}</h3>
        <p class="dj-council-summary">${escapeHTML(verdict.summary)}</p>
      </div>
    </header>
    <ul class="dj-council-pillars" aria-label="Council specialists">${pillars}</ul>
    ${recommendations ? `<div class="dj-council-fixes"><p class="dj-council-eyebrow">Actionable fixes</p><ol>${recommendations}</ol>${showApply ? `<button class="dj-council-apply" type="button" data-council-apply>${escapeHTML(options.applyLabel || "Apply council fixes")}</button>` : ""}</div>` : ""}
  </div>`;
}

export function renderDJCouncilBadge(container, verdict, options = {}) {
  if (!container) return null;
  container.innerHTML = djCouncilBadgeMarkup(verdict, options);
  container.hidden = false;
  const apply = container.querySelector("[data-council-apply]");
  if (apply && typeof options.onApplyFixes === "function") {
    apply.addEventListener("click", () => options.onApplyFixes(verdict.recommendations.slice()));
  }
  return container;
}

export function clearDJCouncilBadge(container) {
  if (!container) return;
  container.innerHTML = "";
  container.hidden = true;
}

if (typeof window !== "undefined") {
  window.HaloDJCouncilBadge = Object.freeze({ markup: djCouncilBadgeMarkup, render: renderDJCouncilBadge, clear: clearDJCouncilBadge });
}
