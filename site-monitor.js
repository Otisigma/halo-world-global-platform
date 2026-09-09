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
      const url = new URL(value, window.location.origin);
      return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch {
      return String(value).slice(0, 500);
    }
  }

  function loadWatcherRegistryModule() {
    if (!watcherRegistryPromise) {
      watcherRegistryPromise = import("/lib/watcher-registry.js")
        .then(module => ({
          watchersForPage: typeof module.watchersForPage === "function" ? module.watchersForPage : () => [],
          canonicalize: typeof module.canonicalizeWatcherTarget === "function" ? module.canonicalizeWatcherTarget : value => String(value || "")
        }))
        .catch(() => ({
          watchersForPage: () => [],
          canonicalize: value => String(value || "")
        }));
    }
    return watcherRegistryPromise;
  }

  function visible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
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
    `;
    document.head.appendChild(style);
  }

  function normalizeWatcherState(status) {
    return STATUS_LABEL[status] ? status : "red";
  }

  async function runWatcherChecks() {
    const module = await loadWatcherRegistryModule();
    const expectedWatchers = module.watchersForPage(window.location.pathname) || [];
    const watcherResults = expectedWatchers.map(watcher => {
      const element = document.querySelector(watcher.selector);
      const expectedTarget = module.canonicalize(watcher.target);
      if (!element) {
        return {
          ...watcher,
          status: "red",
          detail: `Missing expected control. Dash AI routes this to ${watcher.ownerAgent}.`
        };
      }
      const linkedTarget = element.matches("a[href]") ? module.canonicalize(element.getAttribute("href") || "") : expectedTarget;
      if (linkedTarget !== expectedTarget) {
        return {
          ...watcher,
          status: "yellow",
          detail: `Control resolves to ${linkedTarget || "unknown"} instead of canonical ${expectedTarget}. Dash AI routes this to ${watcher.ownerAgent}.`
        };
      }
      return {
        ...watcher,
        status: "green",
        detail: `Control is present and points to canonical route ${expectedTarget}. Owner agent: ${watcher.ownerAgent}.`
      };
    });
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
      watchers: watcherResults
    };
    window.__haloDashAI = dash;
    window.dispatchEvent(new CustomEvent("halo:dash-ai-update", { detail: dash }));
    return dash;
  }

  async function runChecks() {
    const interactive = [...document.querySelectorAll("button,a,input,select,textarea")].filter(visible);
    const unlabeled = interactive.filter(element => {
      if (element.matches('input[type="hidden"],input[type="file"]')) return false;
      const text = element.textContent?.trim() || element.value || element.getAttribute("aria-label") || element.getAttribute("title");
      return !text;
    });
    const invalidLinks = [...document.querySelectorAll("a[href]")].filter(link => {
      const href = link.getAttribute("href")?.trim();
      return !href || href === "#" || href.startsWith("javascript:");
    });
    const imagesWithoutAlt = [...document.images].filter(image => !image.hasAttribute("alt"));
    const audioContext = window.__haloAudioContext;
    const audioHealth = window.__haloAudioHealth;
    const audioReady = (!audioContext || ["running", "suspended"].includes(audioContext.state)) && audioHealth?.status !== "error";
    const audioDetail = audioHealth?.message || (audioContext ? `Audio engine is ${audioContext.state}. Press play to run a signal check.` : "Audio engine loads on the first playback gesture.");
    const dash = await runWatcherChecks();
    const failedWatchers = (dash.watchers || []).filter(watcher => watcher.status !== "green");

    return [
      { name: "Audio Scout", category: "audio", severity: "high", ok: audioReady, detail: audioDetail, count: audioReady ? 0 : 1 },
      { name: "Interaction Tester", category: "accessibility", severity: "medium", ok: unlabeled.length === 0, detail: unlabeled.length ? `${unlabeled.length} visible control${unlabeled.length === 1 ? " needs" : "s need"} an accessible name.` : `${interactive.length} visible controls are identifiable.`, count: unlabeled.length },
      { name: "Navigation Tester", category: "navigation", severity: "medium", ok: invalidLinks.length === 0, detail: invalidLinks.length ? `${invalidLinks.length} placeholder or unsafe link${invalidLinks.length === 1 ? "" : "s"} found.` : "Page links have usable destinations.", count: invalidLinks.length },
      { name: "Visual Access Tester", category: "accessibility", severity: "medium", ok: imagesWithoutAlt.length === 0, detail: imagesWithoutAlt.length ? `${imagesWithoutAlt.length} image${imagesWithoutAlt.length === 1 ? " is" : "s are"} missing alt text.` : "Images expose alternative text.", count: imagesWithoutAlt.length },
      { name: "Runtime Watcher", category: "runtime", severity: "high", ok: runtimeIssues.length + resourceIssues.length === 0, detail: runtimeIssues[0] || resourceIssues[0] || "No browser errors or failed resources observed.", count: runtimeIssues.length + resourceIssues.length },
      { name: "Dash AI Link Aggregator", category: "navigation", severity: "high", ok: dash.status === "green", detail: `Dash AI reports ${dash.statusLabel} with ${dash.watcherCount} watcher${dash.watcherCount === 1 ? "" : "s"} and ${dash.issueCount} issue${dash.issueCount === 1 ? "" : "s"}.`, count: dash.issueCount }
    ].concat(failedWatchers.map(watcher => ({
      name: `Watcher: ${watcher.label}`,
      category: "navigation",
      severity: watcher.status === "red" ? "high" : "medium",
      ok: false,
      detail: watcher.detail,
      count: 1,
      watcherId: watcher.id,
      watcherTarget: watcher.target,
      ownerAgent: watcher.ownerAgent
    })));
  }

  async function reportFindings(checks, reportElement) {
    const findings = checks.filter(check => !check.ok);
    if (!findings.length) {
      reportElement.dataset.state = "healthy";
      reportElement.textContent = "No issues need maintenance attention.";
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

    pending.forEach(check => window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: {
        eventType: "qa_issue",
        category: "problem",
        targetName: check.name,
        details: {
          category: check.category,
          severity: check.severity,
          count: check.count,
          watcherId: check.watcherId || null,
          watcherTarget: check.watcherTarget || null,
          ownerAgent: check.ownerAgent || null
        },
        immediate: true
      }
    })));

    reportElement.dataset.state = "sending";
    reportElement.textContent = `Reporting ${pending.length} finding${pending.length === 1 ? "" : "s"} to maintenance…`;
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
          watcherId: check.watcherId || null,
          watcherTarget: check.watcherTarget || null,
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
      ? `${pending.length - failed} reported; ${failed} could not be sent and can be retried after reload.`
      : `${pending.length} finding${pending.length === 1 ? "" : "s"} queued for AI triage and maintenance.`;
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
        const issueCount = checks.reduce((total, check) => total + check.count, 0);
        const hasHighSeverityIssue = checks.some(check => !check.ok && check.severity === "high");
        const launcherState = hasHighSeverityIssue ? "broken" : issueCount ? "attention" : "healthy";
        panel.querySelector(".halo-qa-list").innerHTML = checks.map(check => `<article class="halo-qa-card" data-state="${check.ok ? "healthy" : "attention"}"><span class="halo-qa-dot"></span><div class="halo-qa-copy"><strong>${escapeHTML(check.name)}</strong><p>${escapeHTML(check.detail)}</p></div><span class="halo-qa-count">${check.ok ? "PASS" : `${check.count} ISSUE${check.count === 1 ? "" : "S"}`}</span></article>`).join("");
        const dash = window.__haloDashAI || { status: "yellow", statusLabel: "ATTENTION", watchers: [], watcherCount: 0, issueCount: 0, pagePath: window.location.pathname };
        renderDashWatchers(panel, dash);
        launcher.dataset.state = launcherState;
        launcher.textContent = hasHighSeverityIssue
          ? `Site status: BROKEN (${issueCount} alert${issueCount === 1 ? "" : "s"})`
          : issueCount
            ? `Site status: ATTENTION (${issueCount} alert${issueCount === 1 ? "" : "s"})`
            : "Site status: WORKING";
        panel.querySelector(".halo-qa-time").textContent = `Last run ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
        await reportFindings(checks, panel.querySelector(".halo-qa-report"));
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
