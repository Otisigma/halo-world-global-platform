const flightplan = document.querySelector("#mixFlightplan");

if (flightplan) {
  const steps = [...flightplan.querySelectorAll(".flightplan-step")];
  const stages = [...flightplan.querySelectorAll(".flightplan-stage")];
  const form = flightplan.querySelector("#mixFlightplanForm");
  const status = flightplan.querySelector("#flightplanStatus");
  const radar = flightplan.querySelector("#flightplanRadar");
  const gate = flightplan.querySelector("#flightplanGate");
  const signalForm = flightplan.querySelector("#marketSignalForm");
  const progressValue = flightplan.querySelector("#flightplanProgressValue");
  const progressBar = flightplan.querySelector("#flightplanProgressBar");
  let planId = "";
  let activeStep = 1;

  function value(name) {
    return form.elements[name]?.value?.trim() || "";
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.style.color = error ? "var(--red)" : "var(--muted)";
  }

  function selectStep(step) {
    activeStep = Math.max(1, Math.min(5, Number(step) || 1));
    steps.forEach(button => button.setAttribute("aria-selected", String(Number(button.dataset.step) === activeStep)));
    stages.forEach(stage => stage.classList.toggle("is-active", Number(stage.dataset.stage) === activeStep));
    updateReadiness();
  }

  function readiness() {
    const checks = [
      value("demandTheme"),
      ["mastered", "approved"].includes(value("masteringStatus")),
      value("djName") && value("projectTitle") && value("genre") && value("releaseDate") && value("price"),
      form.elements.rightsConfirmed.checked,
      value("campaignHook")
    ];
    return checks.filter(Boolean).length;
  }

  function updateReadiness() {
    const completed = readiness();
    const percent = completed * 20;
    progressValue.textContent = `${completed} / 5`;
    progressBar.style.setProperty("--flight-progress", `${percent}%`);
    const saleReady = completed >= 4 && ["mastered", "approved"].includes(value("masteringStatus")) && form.elements.rightsConfirmed.checked;
    gate.classList.toggle("is-ready", saleReady);
    gate.querySelector(".flightplan-gate-mark").textContent = saleReady ? "GO" : "HOLD";
    gate.querySelector("strong").textContent = saleReady ? "Ready for a final sale review" : "Sale gate is still closed";
    gate.querySelector("span").textContent = saleReady
      ? "Mastering, core metadata, pricing, and rights checks are present. Review the package before publishing."
      : "A paid mix needs an approved master, complete product information, a price, and confirmed rights or clearances.";
  }

  function payload() {
    return {
      action: "save_plan",
      id: planId,
      title: value("mixPlanTitle") || "Untitled DJ mix",
      currentStep: activeStep,
      releaseFormat: value("releaseFormat"),
      masteringStatus: value("masteringStatus"),
      targetLufs: Number(value("targetLufs") || -14),
      truePeakDbtp: Number(value("truePeakDbtp") || -1),
      rightsConfirmed: form.elements.rightsConfirmed.checked,
      demandBrief: {
        theme: value("demandTheme"),
        audience: value("targetAudience"),
        sourceNote: value("demandSourceNote")
      },
      metadata: {
        djName: value("djName"),
        projectTitle: value("projectTitle"),
        genre: value("genre"),
        releaseDate: value("releaseDate"),
        price: value("price"),
        currency: value("currency"),
        territory: value("territory"),
        artworkStatus: value("artworkStatus"),
        tracklist: value("tracklist"),
        campaignHook: value("campaignHook")
      }
    };
  }

  function fillPlan(plan) {
    if (!plan) return;
    planId = plan.id || "";
    const metadata = plan.metadata || {};
    const demand = plan.demandBrief || {};
    const values = {
      mixPlanTitle: plan.title,
      releaseFormat: plan.releaseFormat,
      masteringStatus: plan.masteringStatus,
      targetLufs: plan.targetLufs,
      truePeakDbtp: plan.truePeakDbtp,
      demandTheme: demand.theme,
      targetAudience: demand.audience,
      demandSourceNote: demand.sourceNote,
      djName: metadata.djName,
      projectTitle: metadata.projectTitle,
      genre: metadata.genre,
      releaseDate: metadata.releaseDate,
      price: metadata.price,
      currency: metadata.currency,
      territory: metadata.territory,
      artworkStatus: metadata.artworkStatus,
      tracklist: metadata.tracklist,
      campaignHook: metadata.campaignHook
    };
    Object.entries(values).forEach(([name, fieldValue]) => {
      if (form.elements[name] && fieldValue !== undefined && fieldValue !== null) form.elements[name].value = fieldValue;
    });
    form.elements.rightsConfirmed.checked = Boolean(plan.rightsConfirmed);
    selectStep(plan.currentStep || 1);
  }

  function renderRadar(data = {}) {
    const signals = [...(data.manual || []), ...(data.audience || []), ...(data.external || []), ...(data.catalog || [])]
      .sort((first, second) => Number(second.demandScore || 0) - Number(first.demandScore || 0)).slice(0, 9);
    radar.innerHTML = signals.length ? signals.map(signal => `
      <article class="radar-card">
        <small>${escapeHtml(signal.source || "signal")} <span class="radar-score">${Math.round(Number(signal.demandScore || 0))}</span></small>
        <strong>${escapeHtml(signal.query)}</strong>
        <p>${escapeHtml(signal.evidence || "Demand signal saved")}</p>
      </article>`).join("") : `<article class="radar-card"><small>Waiting for signal</small><strong>Add the first audience request.</strong><p>Log searches, club reports, listener requests, social movement, or chart evidence.</p></article>`;
  }

  function escapeHtml(input) {
    const node = document.createElement("span");
    node.textContent = String(input || "");
    return node.innerHTML;
  }

  async function api(options = {}) {
    const response = await fetch("/api/mix-flightplan", { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Mix Flightplan request failed");
    return data;
  }

  steps.forEach(button => button.addEventListener("click", () => selectStep(button.dataset.step)));
  form.addEventListener("input", updateReadiness);
  form.addEventListener("change", updateReadiness);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    setStatus("Saving Mix Flightplan…");
    try {
      const data = await api({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      fillPlan(data.plan);
      setStatus(data.message || "Mix Flightplan saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  signalForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(signalForm));
    setStatus("Adding market signal…");
    try {
      const result = await api({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signal", ...data, demandScore: Number(data.demandScore) }) });
      renderRadar(result.radar);
      signalForm.reset();
      signalForm.elements.demandScore.value = 70;
      setStatus("Market signal added to the radar.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  const existingMixTitle = document.querySelector("#mixTitle");
  existingMixTitle?.addEventListener("input", () => {
    if (!value("mixPlanTitle")) form.elements.mixPlanTitle.value = existingMixTitle.value;
  });

  selectStep(1);
  api().then(data => {
    fillPlan(data.plan);
    renderRadar(data.radar);
    setStatus(data.plan ? "Saved flightplan loaded." : "Start at Demand Radar, then follow HALO Guide in order.");
  }).catch(error => {
    renderRadar();
    setStatus(error.message, true);
  });
}
