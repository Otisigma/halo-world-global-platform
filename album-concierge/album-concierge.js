/* Album Concierge — client-side flow controller */

(function () {
  "use strict";

  /* ── State ───────────────────────────────────────────────────────────────── */

  const state = {
    purpose: "",
    emotions: [],
    soundDirection: "",
    storyInput: "",
    sessionId: "",
    selectedTitle: "",
    result: null,
    currentStep: 0
  };

  /* ── DOM refs ─────────────────────────────────────────────────────────────── */

  const notice = document.getElementById("acNotice");
  const stepper = document.getElementById("acStepper");
  const loading = document.getElementById("acLoading");
  const loadingLabel = document.getElementById("acLoadingLabel");
  const results = document.getElementById("acResults");

  const steps = [1, 2, 3, 4].map(n => document.getElementById(`step-${n}`));

  /* ── Utilities ────────────────────────────────────────────────────────────── */

  function showNotice(message, type) {
    if (!notice) return;
    notice.textContent = message;
    notice.className = `ac-notice is-${type}`;
    notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearNotice() {
    if (!notice) return;
    notice.textContent = "";
    notice.className = "ac-notice";
  }

  function showStep(n) {
    steps.forEach((el, i) => {
      if (!el) return;
      el.classList.toggle("is-active", i + 1 === n);
    });
    loading.classList.remove("is-active");
    results.classList.remove("is-active");
    updateStepper(n);
    state.currentStep = n;
    clearNotice();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLoading() {
    steps.forEach(el => el && el.classList.remove("is-active"));
    results.classList.remove("is-active");
    loading.classList.add("is-active");
    updateStepper(5);
    const labels = [
      "Crafting your album story…",
      "Finding song ideas that match the feeling…",
      "Building a keepsake-worthy tracklist…",
      "Adding the finishing touches…"
    ];
    let idx = 0;
    if (loadingLabel) loadingLabel.textContent = labels[0];
    const interval = setInterval(() => {
      idx = (idx + 1) % labels.length;
      if (loadingLabel) loadingLabel.textContent = labels[idx];
    }, 2200);
    return () => clearInterval(interval);
  }

  function showResults(data) {
    loading.classList.remove("is-active");
    steps.forEach(el => el && el.classList.remove("is-active"));
    results.classList.add("is-active");
    updateStepper(5, true);
    renderResults(data);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    window.haloStats?.track("album_concierge_result_ready", { session_id: data.id });
  }

  function updateStepper(active, done = false) {
    if (!stepper) return;
    stepper.querySelectorAll(".ac-step").forEach(el => {
      const n = Number(el.dataset.step);
      el.classList.remove("is-done");
      el.removeAttribute("aria-current");
      if (done || n < active) {
        el.classList.add("is-done");
      } else if (n === active) {
        el.setAttribute("aria-current", "step");
      }
    });
  }

  /* ── Choice/chip selection helpers ───────────────────────────────────────── */

  function bindSingleChoice(containerEl, onSelect) {
    containerEl.querySelectorAll(".ac-choice").forEach(btn => {
      btn.addEventListener("click", () => {
        containerEl.querySelectorAll(".ac-choice").forEach(b => {
          b.classList.remove("is-selected");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-selected");
        btn.setAttribute("aria-pressed", "true");
        onSelect(btn.dataset.value);
      });
    });
  }

  function bindMultiChip(containerEl, onUpdate) {
    containerEl.querySelectorAll(".ac-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const pressed = btn.getAttribute("aria-pressed") === "true";
        btn.classList.toggle("is-selected", !pressed);
        btn.setAttribute("aria-pressed", String(!pressed));
        const selected = Array.from(containerEl.querySelectorAll(".ac-chip.is-selected"))
          .map(b => b.dataset.value);
        onUpdate(selected);
      });
    });
  }

  /* ── Step 1: Purpose ──────────────────────────────────────────────────────── */

  const step1El = document.getElementById("step-1");
  const step1Next = document.getElementById("step1Next");

  if (step1El) {
    bindSingleChoice(step1El, value => {
      state.purpose = value;
      if (step1Next) step1Next.disabled = false;
    });
  }

  const purposeFromQuery = new URLSearchParams(window.location.search).get("purpose");
  const purposePresetMap = {
    self: "self",
    gift: "gift",
    fans: "fans",
    collector: "fans",
    project: "project"
  };
  const mappedPurposePreset = purposeFromQuery ? (purposePresetMap[purposeFromQuery] ?? "") : "";
  if (mappedPurposePreset && step1El) {
    const preset = Array.from(step1El.querySelectorAll(".ac-choice")).find(btn => btn.dataset.value === mappedPurposePreset);
    if (preset) preset.click();
  }

  step1Next?.addEventListener("click", () => showStep(2));

  /* ── Step 2: Emotion ──────────────────────────────────────────────────────── */

  const step2El = document.getElementById("step-2");
  const step2Next = document.getElementById("step2Next");
  const step2Back = document.getElementById("step2Back");

  if (step2El) {
    bindMultiChip(step2El, values => {
      state.emotions = values;
      if (step2Next) step2Next.disabled = values.length === 0;
    });
  }

  step2Back?.addEventListener("click", () => showStep(1));
  step2Next?.addEventListener("click", () => showStep(3));

  /* ── Step 3: Sound ────────────────────────────────────────────────────────── */

  const step3El = document.getElementById("step-3");
  const step3Next = document.getElementById("step3Next");
  const step3Back = document.getElementById("step3Back");

  if (step3El) {
    bindSingleChoice(step3El, value => {
      state.soundDirection = value;
      if (step3Next) step3Next.disabled = false;
    });
  }

  step3Back?.addEventListener("click", () => showStep(2));
  step3Next?.addEventListener("click", () => showStep(4));

  /* ── Step 4: Story ────────────────────────────────────────────────────────── */

  const storyInput = document.getElementById("storyInput");
  const step4Generate = document.getElementById("step4Generate");
  const step4Back = document.getElementById("step4Back");

  storyInput?.addEventListener("input", () => {
    const trimmed = storyInput.value.trim();
    state.storyInput = trimmed;
    if (step4Generate) step4Generate.disabled = trimmed.length < 20;
  });

  step4Back?.addEventListener("click", () => showStep(3));

  step4Generate?.addEventListener("click", async () => {
    clearNotice();
    const stop = showLoading();

    try {
      /* Create session */
      const createRes = await fetch("/api/album-concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: state.purpose,
          emotion: state.emotions.join(", "),
          soundDirection: state.soundDirection,
          storyInput: state.storyInput
        })
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || "Could not start session");
      }

      const session = await createRes.json();
      state.sessionId = session.id;

      /* Generate */
      const genRes = await fetch("/api/album-concierge?action=generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId })
      });

      if (!genRes.ok) {
        const err = await genRes.json().catch(() => ({}));
        throw new Error(err.error || "Generation failed");
      }

      const generated = await genRes.json();
      state.result = generated;
      stop();
      showResults(generated);
    } catch (err) {
      stop();
      loading.classList.remove("is-active");
      showStep(4);
      showNotice(`Something went wrong: ${err.message}`, "error");
    }
  });

  /* ── Render results ───────────────────────────────────────────────────────── */

  function renderResults(data) {
    /* Theme */
    const themeEl = document.getElementById("themeText");
    if (themeEl) themeEl.textContent = data.generatedTheme || "";

    const themeIntro = document.getElementById("resultsThemeIntro");
    if (themeIntro) themeIntro.textContent = data.generatedTheme ? data.generatedTheme.split(".")[0] + "." : "";

    /* Title chips */
    const titleChips = document.getElementById("titleChips");
    if (titleChips && Array.isArray(data.generatedTitles)) {
      titleChips.innerHTML = "";
      data.generatedTitles.forEach((title, i) => {
        const btn = document.createElement("button");
        btn.className = "ac-title-chip" + (i === 0 ? " is-active" : "");
        btn.type = "button";
        btn.textContent = title;
        btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        btn.addEventListener("click", () => {
          titleChips.querySelectorAll(".ac-title-chip").forEach(b => {
            b.classList.remove("is-active");
            b.setAttribute("aria-pressed", "false");
          });
          btn.classList.add("is-active");
          btn.setAttribute("aria-pressed", "true");
          state.selectedTitle = title;
          const coverTitle = document.getElementById("coverTitleDisplay");
          if (coverTitle) coverTitle.textContent = title;
        });
        titleChips.appendChild(btn);
      });
      state.selectedTitle = data.generatedTitles[0] || "";
    }

    /* Cover title */
    const coverTitle = document.getElementById("coverTitleDisplay");
    if (coverTitle) coverTitle.textContent = state.selectedTitle;

    /* Cover art prompt note */
    const coverNote = document.getElementById("coverPromptNote");
    if (coverNote) coverNote.textContent = data.generatedCoverPrompt || "";

    /* Tracklist */
    const tracklist = document.getElementById("tracklistEl");
    if (tracklist && Array.isArray(data.generatedTracks)) {
      tracklist.innerHTML = "";
      data.generatedTracks.forEach(track => {
        const li = document.createElement("li");
        li.className = "ac-track";
        li.innerHTML = `
          <span class="ac-track-num">${String(track.position).padStart(2, "0")}</span>
          <div class="ac-track-info">
            <div class="ac-track-title">${escapeHtml(track.title)}</div>
            ${track.moodNote ? `<div class="ac-track-note">${escapeHtml(track.moodNote)}</div>` : ""}
          </div>`;
        tracklist.appendChild(li);
      });
    }

    /* Dedication */
    const ded = document.getElementById("dedicationEl");
    if (ded) ded.textContent = data.generatedDedication || "";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── Result actions ───────────────────────────────────────────────────────── */

  document.getElementById("savePrivateBtn")?.addEventListener("click", async () => {
    if (!state.sessionId) return;
    try {
      await fetch("/api/album-concierge?action=save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, mode: "private" })
      });
      showNotice("Album concept saved privately.", "success");
    } catch {
      showNotice("Save failed. Please try again.", "error");
    }
  });

  document.getElementById("shareBtn")?.addEventListener("click", async () => {
    if (!state.sessionId) return;
    try {
      const saveRes = await fetch("/api/album-concierge?action=save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, mode: "public" })
      });
      if (!saveRes.ok) throw new Error("Could not make session shareable");
      const url = `${location.origin}/album-concierge/?session=${encodeURIComponent(state.sessionId)}`;
      if (navigator.share) {
        await navigator.share({ title: state.selectedTitle || "My Album Concept", url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showNotice("Shareable link copied to clipboard.", "success");
      }
    } catch {
      showNotice("Share failed. Please try again.", "error");
    }
  });

  document.getElementById("giftBtn")?.addEventListener("click", async () => {
    if (!state.sessionId) return;
    try {
      await fetch("/api/album-concierge?action=save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, mode: "gift" })
      });
      showNotice("Album concept saved as a gift. Share the link with someone special.", "success");
    } catch {
      showNotice("Could not save as gift. Please try again.", "error");
    }
  });

  document.getElementById("restartBtn")?.addEventListener("click", () => {
    state.purpose = "";
    state.emotions = [];
    state.soundDirection = "";
    state.storyInput = "";
    state.sessionId = "";
    state.selectedTitle = "";
    state.result = null;

    /* Reset all UI selections */
    document.querySelectorAll(".ac-choice").forEach(b => {
      b.classList.remove("is-selected");
      b.setAttribute("aria-pressed", "false");
    });
    document.querySelectorAll(".ac-chip").forEach(b => {
      b.classList.remove("is-selected");
      b.setAttribute("aria-pressed", "false");
    });
    if (storyInput) storyInput.value = "";
    if (step1Next) step1Next.disabled = true;
    if (step2Next) step2Next.disabled = true;
    if (step3Next) step3Next.disabled = true;
    if (step4Generate) step4Generate.disabled = true;

    showStep(1);
  });

  document.getElementById("upgradeBtn")?.addEventListener("click", () => {
    showNotice("Collector edition is coming soon. Your session has been saved.", "success");
  });

  /* ── Entry points from hero ───────────────────────────────────────────────── */

  document.getElementById("startFlowBtn")?.addEventListener("click", () => {
    document.getElementById("concierge")?.scrollIntoView({ behavior: "smooth" });
    showStep(1);
  });

  document.getElementById("giftFlowBtn")?.addEventListener("click", () => {
    document.getElementById("concierge")?.scrollIntoView({ behavior: "smooth" });
    showStep(1);
    /* Pre-select "gift" purpose */
    const giftChoice = step1El?.querySelector('[data-value="gift"]');
    if (giftChoice) {
      giftChoice.click();
    }
  });

  /* ── Load existing session from URL ──────────────────────────────────────── */

  async function maybeLoadSession() {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("session");
    if (!sessionId) return;

    const stop = showLoading();
    try {
      const res = await fetch(`/api/album-concierge?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error("Session not found");
      const data = await res.json();
      stop();
      if (data.status === "ready") {
        state.sessionId = data.id;
        state.result = data;
        showResults(data);
      } else {
        showStep(1);
      }
    } catch {
      stop();
      showStep(1);
    }
  }

  /* ── Boot ─────────────────────────────────────────────────────────────────── */

  /* Start hidden (stepper invisible) until user clicks a CTA */
  steps.forEach(el => el && el.classList.remove("is-active"));
  loading.classList.remove("is-active");
  results.classList.remove("is-active");

  maybeLoadSession();

}());
