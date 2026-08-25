(() => {
  document.documentElement.classList.add("has-motion");
  const meter = document.querySelector(".scroll-meter i");
  const revealItems = document.querySelectorAll(".reveal");
  const hero = document.querySelector(".hero");

  function updateScrollMeter() {
    if (!meter) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
    meter.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16 });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add("is-visible"));
  }

  window.addEventListener("scroll", updateScrollMeter, { passive: true });
  updateScrollMeter();

  hero?.addEventListener("pointermove", event => {
    const bounds = hero.getBoundingClientRect();
    hero.style.setProperty("--pointer-x", `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
    hero.style.setProperty("--pointer-y", `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
  });

  const supporterCount = document.querySelector("#supporterCount");
  const supporterPrice = document.querySelector("#supporterPrice");
  const supporterCountHeading = document.querySelector("#supporterCountHeading");
  const supporterCountOutput = document.querySelector("#supporterCountOutput");
  const supporterPriceOutput = document.querySelector("#supporterPriceOutput");
  const directGross = document.querySelector("#directGross");
  const directProcessing = document.querySelector("#directProcessing");
  const directArtistTotal = document.querySelector("#directArtistTotal");
  const streamEquivalent = document.querySelector("#streamEquivalent");

  if (supporterCount && supporterPrice) {
    const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

    function updateEarningsIllustration() {
      const supporters = Number(supporterCount.value);
      const price = Number(supporterPrice.value);
      const gross = supporters * price;
      const processing = supporters * ((price * 0.029) + 0.3);
      const artistTotal = Math.max(0, gross - processing);
      const estimatedStreams = Math.ceil(artistTotal / 0.004);

      supporterCountHeading.textContent = integer.format(supporters);
      supporterCountOutput.textContent = integer.format(supporters);
      supporterPriceOutput.textContent = currency.format(price);
      directGross.textContent = currency.format(gross);
      directProcessing.textContent = `−${currency.format(processing)}`;
      directArtistTotal.textContent = currency.format(artistTotal);
      streamEquivalent.textContent = integer.format(estimatedStreams);
    }

    supporterCount.addEventListener("input", updateEarningsIllustration);
    supporterPrice.addEventListener("input", updateEarningsIllustration);
    updateEarningsIllustration();
  }

  const form = document.querySelector("#artistProForm");
  const status = document.querySelector("#formStatus");
  const successPanel = document.querySelector("#successPanel");
  if (!form || !status || !successPanel) return;

  const submitButton = form.querySelector("button[type='submit']");
  let formStarted = false;

  function track(eventName, metadata = {}) {
    window.haloStats?.track(eventName, metadata);
  }

  function showStatus(message, success = false) {
    status.textContent = message;
    status.classList.add("is-visible");
    status.classList.toggle("is-success", success);
  }

  function clearStatus() {
    status.textContent = "";
    status.className = "form-status";
  }

  function payloadFromForm() {
    const data = new FormData(form);
    return {
      artistName: String(data.get("artistName") || "").trim(),
      email: String(data.get("email") || "").trim(),
      countryCode: String(data.get("countryCode") || "").trim(),
      releaseStage: String(data.get("releaseStage") || ""),
      releaseTitle: String(data.get("releaseTitle") || "").trim(),
      targetReleaseDate: String(data.get("targetReleaseDate") || ""),
      primaryGoal: String(data.get("primaryGoal") || ""),
      artistUrl: String(data.get("artistUrl") || "").trim(),
      message: String(data.get("message") || "").trim(),
      company: String(data.get("company") || "").trim(),
      consent: data.get("consent") === "on"
    };
  }

  form.addEventListener("focusin", () => {
    if (formStarted) return;
    formStarted = true;
    track("artist_pro_form_start", { target: "application_form" });
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    clearStatus();

    if (!form.reportValidity()) {
      showStatus("Complete the required release details before submitting.");
      return;
    }

    const payload = payloadFromForm();
    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = "Placing release on the board…";
    track("artist_pro_application_submit", {
      stage: payload.releaseStage,
      goal: payload.primaryGoal,
      plan: "artist_pro"
    });

    try {
      const response = await fetch("/api/artist-pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "The application could not be submitted");

      form.hidden = true;
      successPanel.hidden = false;
      successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      track("artist_pro_application_success", {
        stage: payload.releaseStage,
        goal: payload.primaryGoal,
        plan: "artist_pro"
      });
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "The application could not be submitted");
      track("artist_pro_application_error", { target: "application_form" });
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector("span").textContent = "Put my release on the board";
    }
  });
})();
