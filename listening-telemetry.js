(() => {
  const endpoint = "/api/listening-events";
  const checkbox = document.getElementById("listeningAnalytics");
  const status = document.getElementById("listeningAnalyticsStatus");
  const streamAlertsCheckbox = document.getElementById("streamAlertSharing");
  const streamAlertsStatus = document.getElementById("streamAlertSharingStatus");
  const bindings = new Set();
  let enabled = false;
  let sharingStreamAlerts = false;
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
        headers: { "Content-Type": "application/json", ...(!payload ? { "X-Halo-Listening": "1" } : {}) },
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
      sharingStreamAlerts = false;
      revision++;
      clear();
      if (checkbox) checkbox.checked = false;
      if (streamAlertsCheckbox) streamAlertsCheckbox.checked = false;
    }
    try { return response?.ok ? await response.json() : null; } catch { return null; }
  }

  async function refreshConsent() {
    const version = ++revision;
    enabled = false;
    sharingStreamAlerts = false;
    clear();
    if (checkbox) checkbox.disabled = true;
    if (streamAlertsCheckbox) streamAlertsCheckbox.disabled = true;
    if (privateBrowser()) {
      if (checkbox) checkbox.checked = false;
      if (streamAlertsCheckbox) streamAlertsCheckbox.checked = false;
      message("Listening analytics are off because of your browser privacy settings.");
      if (streamAlertsStatus) streamAlertsStatus.textContent = "Stream alerts are off because of your browser privacy settings.";
      return;
    }
    const response = await request();
    let preference;
    try { preference = response?.ok ? await response.json() : null; } catch {}
    if (version !== revision) return;
    enabled = preference?.enabled === true;
    sharingStreamAlerts = enabled && preference?.shareStreamAlerts === true;
    if (checkbox) {
      checkbox.checked = enabled;
      checkbox.disabled = !response?.ok;
    }
    if (streamAlertsCheckbox) {
      streamAlertsCheckbox.checked = sharingStreamAlerts;
      streamAlertsCheckbox.disabled = !response?.ok || !enabled;
    }
    message(response?.status === 401 ? "Sign in to choose optional listening analytics." :
      !response?.ok ? "Listening analytics unavailable; playback is unaffected." :
        enabled ? "Optional listening reports are on." : "Optional listening reports are off.");
    if (streamAlertsStatus) {
      streamAlertsStatus.textContent = response?.status === 401 ? "Sign in to choose stream alerts." :
        !response?.ok ? "Stream alerts unavailable." :
          sharingStreamAlerts ? "Anonymous stream alerts are on." :
            enabled ? "Stream alerts are off." : "Turn on optional listening reports before enabling stream alerts.";
    }
  }

  checkbox?.addEventListener("change", async () => {
    const desired = checkbox.checked;
    const version = ++revision;
    enabled = false;
    clear();
    checkbox.disabled = true;
    if (!desired && sharingStreamAlerts) {
      const alertsResponse = await request({ action: "stream_alert_consent", enabled: false });
      if (!alertsResponse?.ok) {
        checkbox.checked = true;
        message("Stream alert preference could not be revoked; try again.");
        await refreshConsent();
        return;
      }
      sharingStreamAlerts = false;
      if (streamAlertsCheckbox) {
        streamAlertsCheckbox.checked = false;
        streamAlertsCheckbox.disabled = true;
      }
      if (streamAlertsStatus) streamAlertsStatus.textContent = "Stream alerts are off.";
    }
    const response = await request({ action: "consent", enabled: desired && !privateBrowser() });
    if (version !== revision) return;
    enabled = response?.ok === true && desired && !privateBrowser();
    checkbox.checked = enabled;
    checkbox.disabled = privateBrowser();
    if (streamAlertsCheckbox) {
      streamAlertsCheckbox.checked = false;
      streamAlertsCheckbox.disabled = privateBrowser() || !enabled;
    }
    sharingStreamAlerts = false;
    message(!response?.ok ? "Preference could not be saved. Reports are off here; retry to save your choice." :
      enabled ? "Optional listening reports are on, starting with your next play." :
        "Listening reports are off and your stored listening reports were deleted.");
  });

  streamAlertsCheckbox?.addEventListener("change", async () => {
    const desired = streamAlertsCheckbox.checked;
    if (!enabled || privateBrowser()) {
      streamAlertsCheckbox.checked = false;
      if (streamAlertsStatus) streamAlertsStatus.textContent = "Turn on optional listening reports first.";
      return;
    }
    streamAlertsCheckbox.disabled = true;
    const response = await request({ action: "stream_alert_consent", enabled: desired });
    sharingStreamAlerts = response?.ok === true && desired;
    streamAlertsCheckbox.checked = sharingStreamAlerts;
    streamAlertsCheckbox.disabled = !enabled || privateBrowser();
    if (streamAlertsStatus) {
      streamAlertsStatus.textContent = !response?.ok ? "Stream alert preference could not be saved; try again." :
        sharingStreamAlerts ? "Anonymous stream alerts are on. HALO operations receives the release and artist names, never your identity." :
          "Stream alerts are off.";
    }
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
