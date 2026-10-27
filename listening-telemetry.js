(() => {
  const endpoint = "/api/listening-events";
  const checkbox = document.getElementById("listeningAnalytics");
  const status = document.getElementById("listeningAnalyticsStatus");
  const bindings = new Set();
  let enabled = false;
  let revision = 0;
  let pending = 0;
  const privateBrowser = () => navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  const permitted = () => enabled && !privateBrowser();
  const message = text => { if (status) status.textContent = text; };

  function clear() {
    for (const binding of bindings) binding.clear();
  }

  async function request(payload) {
    try {
      return await fetch(endpoint, {
        method: payload ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin", mode: "same-origin", cache: "no-store",
        ...(typeof globalThis.AbortSignal?.timeout === "function" ? { signal: AbortSignal.timeout(4000) } : {}),
        ...(payload ? { body: JSON.stringify(payload), keepalive: true } : {})
      });
    } catch { return null; }
  }

  async function dispatch(payload, unload = false) {
    const version = revision;
    if (!permitted()) return null;
    if (unload) {
      try {
        const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
        if (navigator.sendBeacon?.(endpoint, body)) return null;
      } catch {}
    }
    let response = await request(payload);
    // At most one retry. Server receipts make a lost start response safe to retry.
    if (permitted() && version === revision && (!response || response.status === 503)) response = await request(payload);
    if (version === revision && (response?.status === 401 || response?.status === 403)) {
      enabled = false;
      revision++;
      clear();
      if (checkbox) checkbox.checked = false;
    }
    try { return response?.ok ? await response.json() : null; } catch { return null; }
  }

  async function refreshConsent() {
    const version = ++revision;
    enabled = false;
    clear();
    if (checkbox) checkbox.disabled = true;
    if (privateBrowser()) {
      if (checkbox) checkbox.checked = false;
      message("Listening analytics are off because of your browser privacy settings.");
      return;
    }
    const response = await request();
    let preference;
    try { preference = response?.ok ? await response.json() : null; } catch {}
    if (version !== revision) return;
    enabled = preference?.enabled === true;
    if (checkbox) {
      checkbox.checked = enabled;
      checkbox.disabled = !response?.ok;
    }
    message(response?.status === 401 ? "Sign in to choose optional listening analytics." :
      !response?.ok ? "Listening analytics unavailable; playback is unaffected." :
        enabled ? "Optional listening reports are on." : "Optional listening reports are off.");
  }

  checkbox?.addEventListener("change", async () => {
    const desired = checkbox.checked;
    const version = ++revision;
    enabled = false;
    clear();
    checkbox.disabled = true;
    const response = await request({ action: "consent", enabled: desired && !privateBrowser() });
    if (version !== revision) return;
    enabled = response?.ok === true && desired && !privateBrowser();
    checkbox.checked = enabled;
    checkbox.disabled = privateBrowser();
    message(!response?.ok ? "Preference could not be saved. Reports are off here; retry to save your choice." :
      enabled ? "Optional listening reports are on, starting with your next play." :
        "Listening reports are off and your stored listening reports were deleted.");
  });

  function bindAudio(audio, getReleaseId) {
    let active = null;
    const binding = { clear: () => { active = null; } };
    bindings.add(binding);

    function finish(action, unload = false) {
      const listening = active;
      active = null;
      if (!listening || !permitted() || listening.version !== revision) return;
      listening.terminal = { action, unload };
      if (listening.receipt) {
        void dispatch({ action, receipt: listening.receipt }, unload);
        listening.terminal = null;
      }
    }

    audio.addEventListener("playing", () => {
      try {
        if (!permitted() || active || pending >= 4) return;
        const releaseId = getReleaseId();
        if (typeof releaseId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(releaseId)) return;
        const listening = { version: revision, receipt: null, terminal: null };
        active = listening;
        pending++;
        void dispatch({ action: "listen_start", releaseId }).then(data => {
          if (!permitted() || listening.version !== revision) return;
          if (!data?.receipt) {
            if (active === listening) active = null;
            return;
          }
          listening.receipt = data.receipt;
          if (listening.terminal) {
            void dispatch({ action: listening.terminal.action, receipt: data.receipt }, listening.terminal.unload);
          }
        }).catch(() => {}).finally(() => { pending--; });
      } catch {}
    });
    audio.addEventListener("ended", () => finish("listen_complete"));
    audio.addEventListener("error", () => finish("listen_abandon"));
    window.addEventListener("pagehide", () => finish("listen_abandon", true));
    return Object.freeze({ reset: () => finish("listen_abandon") });
  }

  window.HaloListeningTelemetry = Object.freeze({ bindAudio });
  window.addEventListener("pageshow", event => { if (event.persisted) void refreshConsent(); });
  void refreshConsent();
})();
