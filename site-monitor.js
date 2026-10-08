(() => {
  const SCOUT_NAME = "HALO Maintenance Scout";
  const runtimeIssues = [];
  const resourceIssues = [];
  const submittedFindings = new Set();
  const MAX_ISSUES = 8;
  const STATUS_LABEL = { green: "WORKING", yellow: "ATTENTION", red: "BROKEN" };
  const STATUS_RANK = { green: 0, yellow: 1, red: 2 };
  let watcherRegistryPromise;

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function safeResource(value = "") {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch {
      return String(value).slice(0, 500);
    }
  }

  function isSafeLinkDestination(value) {
    const href = String(value ?? "").trim();
    if (!href || href === "#") return false;
    try {
      const url = new URL(href, window.location.origin);
      return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
        && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function quarantineLink(link) {
    link?.removeAttribute?.("href");
    link?.setAttribute?.("aria-disabled", "true");
    link?.setAttribute?.("data-halo-link-quarantined", "true");
  }

  function hasAccessibleControlName(element) {
    const clean = value => String(value ?? "").trim();
    if (clean(element?.getAttribute?.("aria-label"))) return true;
    const labelledBy = clean(element?.getAttribute?.("aria-labelledby"));
    if (labelledBy && labelledBy.split(/\s+/).some(id => clean(document.getElementById(id)?.textContent))) return true;
    if (clean(element?.textContent) || clean(element?.value) || clean(element?.getAttribute?.("title"))) return true;
    if (element?.labels && [...element.labels].some(label => clean(label.textContent))) return true;
    const type = clean(element?.getAttribute?.("type")).toLowerCase();
    return element?.tagName?.toLowerCase() === "input" && ["submit", "reset", "button"].includes(type);
  }

  function loadWatcherRegistryModule() {
    if (!watcherRegistryPromise) {
      watcherRegistryPromise = import("/lib/watcher-registry.js")
        .then(module => ({
          watchersForPage: typeof module.watchersForPage === "function" ? module.watchersForPage : () => [],
          canonicalize: typeof module.canonicalizeWatcherTarget === "function" ? module.canonicalizeWatcherTarget : value => String(value || ""),
          available: typeof module.watchersForPage === "function" && typeof module.canonicalizeWatcherTarget === "function"
        }))
        .catch(() => ({
          watchersForPage: () => [],
          canonicalize: value => String(value || ""),
          available: false
        }));
    }
    return watcherRegistryPromise;
  }

  function visible(element) {
    if (!element || typeof element.getClientRects !== "function") return false;
    try {
      const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
      return (!style || style.display !== "none" && style.visibility !== "hidden") && element.getClientRects().length > 0;
    } catch {
      return false;
    }
  }

  window.addEventListener("error", event => {
    if (event.target !== window) {
      resourceIssues.push(safeResource(event.target?.src || event.target?.href || "Unknown resource"));
      resourceIssues.splice(MAX_ISSUES);
      return;
    }
    runtimeIssues.push(event.message || "Unknown JavaScript error");
    runtimeIssues.splice(MAX_ISSUES);
  }, true);

  window.addEventListener("unhandledrejection", event => {
    runtimeIssues.push(event.reason?.message || String(event.reason || "Unhandled promise rejection"));
    runtimeIssues.splice(MAX_ISSUES);
  });

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .halo-qa-launcher{position:fixed;right:16px;bottom:16px;z-index:9998;border:1px solid #c8ff36;background:#10140f;color:#efffd0;padding:10px 13px;font:700 10px/1.2 "DM Mono","Share Tech Mono",monospace;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;box-shadow:0 12px 32px rgba(0,0,0,.4)}
      .halo-qa-launcher[data-state="attention"]{border-color:#ff9b78;color:#ffd2c3}
      .halo-qa-launcher[data-state="broken"]{border-color:#ff6b6b;color:#ffd1d1}
      .halo-qa-launcher[data-state="healthy"]::before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#c8ff36;box-shadow:0 0 0 4px rgba(200,255,54,.12)}
      .halo-qa-panel{position:fixed;right:16px;bottom:62px;z-index:9999;width:min(390px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 90px));overflow:auto;background:#0b0e0b;color:#f5f7f2;border:1px solid rgba(200,255,54,.4);box-shadow:0 24px 80px rgba(0,0,0,.62);font-family:"DM Mono","Share Tech Mono",monospace}.halo-qa-panel[hidden]{display:none}
      .halo-qa-head{position:sticky;top:0;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:17px;background:#111510;border-bottom:1px solid rgba(255,255,255,.1)}.halo-qa-head strong{display:block;font-size:13px;letter-spacing:.08em;text-transform:uppercase}.halo-qa-head span{display:block;margin-top:5px;color:#8f9a8d;font-size:9px}.halo-qa-close{border:0;background:transparent;color:#b9c1b6;font-size:18px;cursor:pointer}
      .halo-qa-dash{padding:12px 15px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.halo-qa-dash strong{display:block;font-size:10px;text-transform:uppercase}.halo-qa-dash small{color:#8f9a8d;font-size:8px}
      .halo-qa-dash-state{font-size:10px;padding:4px 7px;border:1px solid rgba(200,255,54,.4);color:#c8ff36}.halo-qa-dash[data-status="yellow"] .halo-qa-dash-state,.halo-qa-dash[data-status="red"] .halo-qa-dash-state{color:#ffd2c3;border-color:#ff9b78}
      .halo-qa-watchers{padding:10px 15px;border-bottom:1px solid rgba(255,255,255,.08);display:grid;gap:6px}.halo-qa-watcher{padding:8px;border:1px solid rgba(255,255,255,.1);display:grid;gap:4px}.halo-qa-watcher b{font-size:9px}.halo-qa-watcher small{color:#98a096;font-size:8px}.halo-qa-watcher[data-status="yellow"],.halo-qa-watcher[data-status="red"]{border-color:rgba(255,155,120,.45)}
      .halo-qa-list{display:grid;gap:1px;background:rgba(255,255,255,.08)}.halo-qa-card{display:grid;grid-template-columns:10px 1fr auto;gap:11px;align-items:start;padding:14px;background:#0b0e0b}.halo-qa-dot{width:8px;height:8px;margin-top:3px;border-radius:50%;background:#c8ff36}.halo-qa-card[data-state="attention"] .halo-qa-dot{background:#ff9b78}.halo-qa-copy strong{display:block;font-size:10px;text-transform:uppercase}.halo-qa-copy p{margin:5px 0 0;color:#98a096;font:400 9px/1.45 "DM Mono","Share Tech Mono",monospace}.halo-qa-count{color:#c8ff36;font-size:9px}.halo-qa-card[data-state="attention"] .halo-qa-count{color:#ff9b78}
      .halo-qa-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 15px;border-top:1px solid rgba(255,255,255,.08)}.halo-qa-run{border:1px solid #c8ff36;background:#c8ff36;color:#10140f;padding:9px 12px;font:700 9px "DM Mono","Share Tech Mono",monospace;text-transform:uppercase;cursor:pointer}.halo-qa-time{color:#7f897d;font-size:8px}
      .halo-qa-report{padding:10px 15px;border-top:1px solid rgba(255,255,255,.08);color:#8f9a8d;font-size:8px;line-height:1.45}.halo-qa-report[data-state="sent"]{color:#c8ff36}.halo-qa-report[data-state="failed"]{color:#ff9b78}
      @media(max-width:560px){.halo-qa-launcher{right:10px;bottom:10px}.halo-qa-panel{right:10px;bottom:56px;width:calc(100vw - 20px)}}
      .has-maintenance-dock .halo-qa-launcher{left:16px;right:auto}.has-maintenance-dock .halo-qa-panel{left:16px;right:auto}
      @media(max-width:560px){.has-maintenance-dock .halo-qa-launcher{left:10px}.has-maintenance-dock .halo-qa-panel{left:10px;right:auto}}
    `;
    document.documentElement?.classList?.toggle("has-maintenance-dock", Boolean(document.querySelector("#maintenanceDock")));
    document.head.appendChild(style);
  }

  function normalizeWatcherState(status) {
    return STATUS_LABEL[status] ? status : "red";
  }

  async function runWatcherChecks() {
    const module = await loadWatcherRegistryModule();
    const expectedWatchers = module.watchersForPage(window.location.pathname) || [];
    const repairs = [];
    const watcherResults = expectedWatchers.map(watcher => {
      let element = null;
      let selectorError = "";
      try {
        element = watcher.selector ? document.querySelector(watcher.selector) : null;
      } catch (error) {
        selectorError = error?.message || "Invalid watcher selector";
      }
      const expectedTarget = module.canonicalize(watcher.target);
      let resolvedBy = "selector";
      if (!element && module.available && expectedTarget.startsWith("/")) {
        const candidates = [...document.querySelectorAll("a[href]")].filter(link => {
          if (!isSafeLinkDestination(link.getAttribute("href"))) return false;
          try {
            const url = new URL(link.getAttribute("href"), window.location.origin);
            return url.origin === window.location.origin && module.canonicalize(url.pathname) === expectedTarget;
          } catch {
            return false;
          }
        });
        if (candidates.length === 1) {
          [element] = candidates;
          resolvedBy = "canonical-target";
        }
      }
      if (!element) {
        const accessibleLabel = String(watcher.label || "").split("(")[0].trim().toLowerCase();
        const candidates = [...document.querySelectorAll("a")].filter(link => {
          const name = String(link.getAttribute("aria-label") || link.textContent || link.getAttribute("title") || "").trim().toLowerCase();
          return accessibleLabel && name.includes(accessibleLabel);
        });
        if (candidates.length === 1) {
          [element] = candidates;
          resolvedBy = "accessible-label";
        }
      }
      if (!element) {
        return {
          ...watcher,
          status: "red",
          action: "escalated",
          selectorError,
          detail: `Missing expected control${selectorError ? ` (${selectorError})` : ""}. Escalated to ${watcher.ownerAgent}.`
        };
      }
      if (!module.available) {
        return {
          ...watcher,
          status: "red",
          action: "escalated",
          detail: `Watcher registry is unavailable; target verification was not performed. Escalated to ${watcher.ownerAgent}.`
        };
      }
      if (!expectedTarget.startsWith("/") || !isSafeLinkDestination(expectedTarget)) {
        return {
          ...watcher,
          status: "red",
          action: "escalated",
          detail: `Registry target is not a safe local route. Escalated to ${watcher.ownerAgent}.`
        };
      }
      const isAnchor = element.tagName?.toLowerCase() === "a";
      const href = isAnchor ? element.getAttribute("href") : null;
      if (isAnchor && !isSafeLinkDestination(href)) {
        quarantineLink(element);
        return {
          ...watcher,
          status: "red",
          action: "escalated",
          observedTarget: String(href ?? "").slice(0, 200),
          detail: `Unsafe watcher link was disabled instead of repaired. Escalated to ${watcher.ownerAgent}.`
        };
      }
      let linkedTarget = expectedTarget;
      if (isAnchor) {
        try {
          const url = new URL(href, window.location.origin);
          linkedTarget = url.origin === window.location.origin ? module.canonicalize(url.pathname) : "";
          if (!linkedTarget) quarantineLink(element);
        } catch {
          linkedTarget = "";
          quarantineLink(element);
        }
      }
      if (linkedTarget !== expectedTarget) {
        const observedTarget = String(href ?? "").slice(0, 200);
        if (isAnchor && linkedTarget && element.setAttribute) {
          element.setAttribute("href", expectedTarget);
          repairs.push({ watcherId: watcher.id, label: watcher.label, from: observedTarget, to: expectedTarget, resolvedBy });
          return {
            ...watcher,
            status: "green",
            action: "repaired",
            observedTarget,
            detail: `Safe local route mismatch repaired to ${expectedTarget}; verification passed.`
          };
        }
        return {
          ...watcher,
          status: "red",
          action: "escalated",
          observedTarget,
          detail: `Control resolves outside its trusted route instead of ${expectedTarget}. Escalated to ${watcher.ownerAgent}.`
        };
      }
      return {
        ...watcher,
        status: "green",
        action: resolvedBy === "canonical-target" ? "rebound" : "verified",
        resolvedBy,
        detail: `Control is present and points to canonical route ${expectedTarget}${resolvedBy !== "selector" ? ` (resolved by ${resolvedBy})` : ""}.`
      };
    });
    if (!module.available) {
      watcherResults.push({
        id: "watcher-registry-unavailable",
        label: "Watcher registry",
        target: "",
        ownerAgent: "Routing Agent",
        status: "red",
        action: "escalated",
        detail: "Watcher registry could not be loaded; route checks fail closed."
      });
    }
    const overall = watcherResults.reduce(
      (worst, watcher) => (STATUS_RANK[watcher.status] > STATUS_RANK[worst] ? watcher.status : worst),
      "green"
    );
    const flagged = watcherResults.filter(watcher => watcher.status !== "green");
    const dash = {
      pagePath: window.location.pathname,
      checkedAt: new Date().toISOString(),
      status: normalizeWatcherState(overall),
      statusLabel: STATUS_LABEL[normalizeWatcherState(overall)],
      watcherCount: watcherResults.length,
      issueCount: flagged.length,
      flagged,
      watchers: watcherResults,
      repairs
    };
    window.__haloDashAI = dash;
    window.dispatchEvent(new CustomEvent("halo:dash-ai-update", { detail: dash }));
    return dash;
  }

  async function runChecks() {
    const interactive = [...document.querySelectorAll("button,a,input,select,textarea")].filter(visible);
    const unlabeled = interactive.filter(element => {
      return element.matches?.('input[type="hidden"]') !== true && !hasAccessibleControlName(element);
    });
    const imagesWithoutAlt = [...document.images].filter(image => !image.hasAttribute("alt"));
    const audioContext = window.__haloAudioContext;
    const audioHealth = window.__haloAudioHealth;
    const audioReady = (!audioContext || ["running", "suspended"].includes(audioContext.state)) && audioHealth?.status !== "error";
    const audioDetail = audioHealth?.message || (audioContext ? `Audio engine is ${audioContext.state}. Press play to run a signal check.` : "Audio engine loads on the first playback gesture.");
    const recorderState = document.querySelector("#recorderGuard")?.dataset?.state || "";
    const recorderReady = recorderState !== "triggered";
    const dash = await runWatcherChecks();
    const invalidLinks = [...document.querySelectorAll("a[href]")].filter(link => !isSafeLinkDestination(link.getAttribute("href")));
    invalidLinks.forEach(quarantineLink);
    const failedWatchers = (dash.watchers || []).filter(watcher => watcher.status !== "green");

    const checks = [
      { name: "Audio Scout", category: "audio", severity: "high", ok: audioReady, detail: audioDetail, count: audioReady ? 0 : 1 },
      { name: "Interaction Tester", category: "accessibility", severity: "medium", ok: unlabeled.length === 0, detail: unlabeled.length ? `${unlabeled.length} visible control${unlabeled.length === 1 ? " needs" : "s need"} an accessible name.` : `${interactive.length} visible controls are identifiable.`, count: unlabeled.length },
      { name: "Navigation Tester", category: "navigation", severity: "high", ok: invalidLinks.length === 0, detail: invalidLinks.length ? `${invalidLinks.length} unsafe or placeholder link${invalidLinks.length === 1 ? " was" : "s were"} disabled and escalated.` : "Page links have usable destinations.", count: invalidLinks.length, action: invalidLinks.length ? "escalated" : "verified" },
      { name: "Visual Access Tester", category: "accessibility", severity: "medium", ok: imagesWithoutAlt.length === 0, detail: imagesWithoutAlt.length ? `${imagesWithoutAlt.length} image${imagesWithoutAlt.length === 1 ? " is" : "s are"} missing alt text.` : "Images expose alternative text.", count: imagesWithoutAlt.length },
      { name: "Runtime Watcher", category: "runtime", severity: "high", ok: runtimeIssues.length + resourceIssues.length === 0, detail: runtimeIssues[0] || resourceIssues[0] || "No browser errors or failed resources observed.", count: runtimeIssues.length + resourceIssues.length },
      ...(window.location.pathname === "/dj-deck.html" ? [{
        name: "Recorder Safety Guard",
        category: "audio",
        severity: "high",
        ok: recorderReady,
        detail: recorderReady ? "Recorder bleed guard is not reporting a recording risk." : "Recorder bleed guard is triggered; recording remains blocked until the feed is safe.",
        count: recorderReady ? 0 : 1,
        action: recorderReady ? "verified" : "escalated"
      }] : []),
      { name: "Dash AI Link Aggregator", category: "navigation", severity: "low", ok: true, detail: `Dash AI reports ${dash.statusLabel} with ${dash.watcherCount} watcher${dash.watcherCount === 1 ? "" : "s"} and ${dash.issueCount} issue${dash.issueCount === 1 ? "" : "s"}.`, count: 0 }
    ].concat(failedWatchers.map(watcher => ({
      name: `Watcher: ${watcher.label}`,
      category: "navigation",
      severity: watcher.status === "red" ? "high" : "medium",
      ok: false,
      detail: watcher.detail,
      count: 1,
      action: watcher.action || "escalated",
      watcherId: watcher.id,
      watcherSelector: watcher.selector || null,
      watcherTarget: watcher.target,
      observedTarget: watcher.observedTarget || null,
      ownerAgent: watcher.ownerAgent
    })));
    const issueCount = checks.reduce((total, check) => total + check.count, 0);
    const highSeverityIssue = checks.some(check => !check.ok && check.severity === "high");
    if (typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("halo:control-room-update", {
        detail: {
          pagePath: window.location.pathname,
          status: highSeverityIssue ? "broken" : issueCount ? "attention" : "healthy",
          issueCount,
          escalatedCount: checks.filter(check => !check.ok).length,
          healedCount: dash.repairs?.length || 0,
          watcherCount: dash.watcherCount
        }
      }));
    }
    return checks;
  }

  function journalControlRoomEvent(eventType, targetName, details) {
    if (typeof CustomEvent !== "function" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: { eventType, category: eventType === "qa_repair" ? "maintenance" : "problem", targetName, details, immediate: true }
    }));
  }

  async function reportFindings(checks, reportElement, dash) {
    const findings = checks.filter(check => !check.ok);
    const repairs = dash?.repairs || [];
    repairs.forEach(repair => {
      const fingerprint = `${window.location.pathname}|repair|${repair.watcherId}|${repair.from}|${repair.to}`;
      if (submittedFindings.has(fingerprint)) return;
      submittedFindings.add(fingerprint);
      journalControlRoomEvent("qa_repair", repair.label || repair.watcherId, {
        category: "navigation",
        outcome: "healed_and_verified",
        watcherId: repair.watcherId,
        resolvedBy: repair.resolvedBy,
        observedTarget: safeResource(repair.from),
        expectedTarget: repair.to,
        pagePath: window.location.pathname
      });
    });
    if (!findings.length) {
      reportElement.dataset.state = "healthy";
      reportElement.textContent = repairs.length
        ? `${repairs.length} watcher issue${repairs.length === 1 ? "" : "s"} auto-repaired and verified. No remaining risk.`
        : `Healthy · ${checks.length} checks passed. No maintenance escalation needed.`;
      return;
    }

    const pending = findings.filter(check => {
      const fingerprint = `${window.location.pathname}|${check.name}|${check.detail}`;
      if (submittedFindings.has(fingerprint)) return false;
      submittedFindings.add(fingerprint);
      check.fingerprint = fingerprint;
      return true;
    });
    if (!pending.length) return;

    pending.forEach(check => journalControlRoomEvent("qa_issue", check.name, {
      category: check.category,
      severity: check.severity,
      count: check.count,
      outcome: check.action || "escalated",
      watcherId: check.watcherId || null,
      watcherSelector: check.watcherSelector || null,
      watcherTarget: check.watcherTarget || null,
      observedTarget: check.observedTarget ? safeResource(check.observedTarget) : null,
      ownerAgent: check.ownerAgent || null,
      pagePath: window.location.pathname
    }));

    reportElement.dataset.state = "sending";
    reportElement.textContent = `${repairs.length} healed · ${pending.length} escalated. Reporting to maintenance…`;
    const results = await Promise.allSettled(pending.map(check => fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "browser",
        category: check.category,
        severity: check.severity,
        title: `${check.name} detected a problem`,
        details: check.detail,
        pagePath: window.location.pathname,
        fingerprint: check.fingerprint,
        metadata: {
          count: check.count,
          controlRoomOutcome: check.action || "escalated",
          watcherId: check.watcherId || null,
          watcherSelector: check.watcherSelector || null,
          watcherTarget: check.watcherTarget || null,
          observedTarget: check.observedTarget ? safeResource(check.observedTarget) : null,
          ownerAgent: check.ownerAgent || null,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          online: navigator.onLine
        }
      }),
      keepalive: true
    }).then(response => {
      if (!response.ok) throw new Error(`Issue endpoint returned ${response.status}`);
      return response.json();
    })));

    const failed = results.filter(result => result.status === "rejected").length;
    reportElement.dataset.state = failed ? "failed" : "sent";
    reportElement.textContent = failed
      ? `${repairs.length} healed · ${pending.length - failed} reported · ${failed} could not be sent and can be retried after reload.`
      : `${repairs.length} healed · ${pending.length} escalated to AI triage and maintenance.`;
  }

  function renderDashWatchers(panel, dash) {
    const summary = panel.querySelector(".halo-qa-dash");
    const copy = panel.querySelector(".halo-qa-dash-copy");
    const stateNode = panel.querySelector(".halo-qa-dash-state");
    summary.dataset.status = dash.status;
    copy.innerHTML = `<strong>Dash AI</strong><small>${dash.watcherCount} watcher${dash.watcherCount === 1 ? "" : "s"} · ${dash.issueCount} issue${dash.issueCount === 1 ? "" : "s"} · ${escapeHTML(dash.pagePath)}</small>`;
    stateNode.textContent = dash.statusLabel;

    const watcherList = panel.querySelector(".halo-qa-watchers");
    const visible = (dash.watchers || []).slice(0, 8);
    watcherList.innerHTML = visible.map(watcher => `
      <article class="halo-qa-watcher" data-status="${watcher.status}">
        <b>${escapeHTML(watcher.label)}</b>
        <small>${escapeHTML(watcher.status.toUpperCase())} · ${escapeHTML(watcher.target)} · ${escapeHTML(watcher.ownerAgent)}</small>
      </article>
    `).join("") || `<article class="halo-qa-watcher" data-status="green"><b>No watchers configured for this route.</b><small>Dash AI is waiting for route-specific controls.</small></article>`;
  }

  function createMonitor() {
    injectStyles();
    const launcher = document.createElement("button");
    launcher.className = "halo-qa-launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-expanded", "false");
    launcher.textContent = "Site status: Checking";

    const panel = document.createElement("section");
    panel.className = "halo-qa-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Site quality monitor");
    panel.innerHTML = `<div class="halo-qa-head"><div><strong>${SCOUT_NAME}</strong><span>Detects issues, reports them, and verifies recovery.</span></div><button class="halo-qa-close" type="button" aria-label="Close quality monitor">×</button></div><div class="halo-qa-dash"><div class="halo-qa-dash-copy"></div><span class="halo-qa-dash-state">CHECKING</span></div><div class="halo-qa-watchers"></div><div class="halo-qa-list"></div><div class="halo-qa-report">Connecting to the maintenance queue…</div><div class="halo-qa-actions"><span class="halo-qa-time"></span><button class="halo-qa-run" type="button">Run all checks</button></div>`;
    document.body.append(panel, launcher);

    let activeRender = null;
    const render = async () => {
      if (activeRender) return activeRender;
      activeRender = (async () => {
        const checks = await runChecks();
        const orderedChecks = [...checks].sort((left, right) => {
          const severityRank = { high: 0, medium: 1, low: 2 };
          return (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3) || right.count - left.count;
        });
        const issueCount = checks.reduce((total, check) => total + check.count, 0);
        const hasHighSeverityIssue = checks.some(check => !check.ok && check.severity === "high");
        const launcherState = hasHighSeverityIssue ? "broken" : issueCount ? "attention" : "healthy";
        const dash = window.__haloDashAI || { status: "yellow", statusLabel: "ATTENTION", watchers: [], watcherCount: 0, issueCount: 0, pagePath: window.location.pathname };
        const repairedChecks = (dash.repairs || []).map(repair => ({
          name: `Healed: ${repair.label || repair.watcherId}`,
          severity: "low",
          ok: true,
          count: 0,
          action: "repaired",
          detail: `Repaired ${safeResource(repair.from)} to ${repair.to} and verified the watcher.`
        }));
        panel.querySelector(".halo-qa-list").innerHTML = [...repairedChecks, ...orderedChecks].map(check => {
          const outcome = check.action === "repaired" ? "HEALED" : check.ok ? "PASS" : check.action === "escalated" ? "ESCALATED" : `${check.count} ISSUE${check.count === 1 ? "" : "S"}`;
          return `<article class="halo-qa-card" data-state="${check.ok ? "healthy" : "attention"}"><span class="halo-qa-dot"></span><div class="halo-qa-copy"><strong>${escapeHTML(check.name)}</strong><p>${escapeHTML(check.detail)}</p></div><span class="halo-qa-count">${outcome}</span></article>`;
        }).join("");
        renderDashWatchers(panel, dash);
        launcher.dataset.state = launcherState;
        launcher.textContent = hasHighSeverityIssue
          ? `Site status: BROKEN (${issueCount} risk${issueCount === 1 ? "" : "s"})`
          : issueCount
            ? `Site status: ATTENTION (${issueCount} risk${issueCount === 1 ? "" : "s"})`
            : (dash.repairs || []).length
              ? `Site status: HEALED (${dash.repairs.length} repaired)`
              : "Site status: WORKING";
        panel.querySelector(".halo-qa-time").textContent = `Last run ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
        await reportFindings(checks, panel.querySelector(".halo-qa-report"), dash);
      })().finally(() => {
        activeRender = null;
      });
      return activeRender;
    };

    launcher.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      launcher.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) render();
    });
    panel.querySelector(".halo-qa-close").addEventListener("click", () => {
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    });
    panel.querySelector(".halo-qa-run").addEventListener("click", () => render());
    window.addEventListener("halo:audio-state", () => render());
    render();
    setInterval(() => render(), 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createMonitor, { once: true });
  else createMonitor();
})();

(() => {
  if (!document.querySelector('script[data-halo-journal]')) {
    const journal = document.createElement("script");
    journal.src = "/halo-journal.js";
    journal.defer = true;
    journal.dataset.haloJournal = "true";
    document.head.appendChild(journal);
  }

  if (document.querySelector('script[data-halo-companion]')) return;
  const companion = document.createElement("script");
  companion.src = "/halo-companion.js";
  companion.defer = true;
  companion.dataset.haloCompanion = "true";
  document.head.appendChild(companion);
})();
