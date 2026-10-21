(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("dreamweaverOracle");
  if (!panel) return;
  const history = [];
  let controller;
  let generation = 0;
  let busy = false;
  const node = (tag, value) => {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    return element;
  };
  const labels = {
    publication: "Publication health", radio: "Radio routing", sharing: "Dreamweaver sharing",
    feedback: "Community feedback / 30 days", votes: "Community votes / 30 days"
  };

  function clear() {
    generation++;
    controller?.abort();
    busy = false;
    panel.hidden = true;
    history.length = 0;
    byId("oracleThread").replaceChildren();
    byId("oracleTelemetry").replaceChildren();
    byId("oracleMessage").value = "";
    byId("oracleUseAI").checked = false;
    byId("oracleSend").disabled = false;
    byId("oracleRefresh").disabled = false;
    panel.setAttribute("aria-busy", "false");
  }

  function renderTelemetry(telemetry) {
    byId("oracleTelemetry").replaceChildren(...Object.entries(telemetry.sources).map(([key, source]) => {
      const card = node("article");
      card.append(node("h3", labels[key] || key), node("p", source.status));
      const list = node("ul");
      for (const [metric, value] of Object.entries(source.metrics || {})) {
        list.append(node("li", `${metric}: ${typeof value === "object" ? JSON.stringify(value) : value}`));
      }
      card.append(list, node("small", source.note));
      return card;
    }));
  }

  function appendMessage(role, content, suggestions = []) {
    const article = node("article");
    article.append(node("h3", role === "user" ? "You" : "Dreamweaver AI"), node("p", content));
    for (const suggestion of suggestions) {
      const pre = node("pre");
      const code = node("code", suggestion.code);
      pre.append(code);
      const copy = node("button", `Copy ${suggestion.language} proposal`);
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(suggestion.code);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy unavailable — select the code text";
        }
      });
      article.append(node("p", `Unverified proposal — ${suggestion.rationale}`), pre, copy,
        node("p", `Verification: ${suggestion.verification}`),
        node("small", `Evidence: ${suggestion.evidence.join(", ")}`));
    }
    const thread = byId("oracleThread");
    thread.append(article);
    while (thread.children.length > 20) thread.firstElementChild.remove();
    thread.scrollTop = thread.scrollHeight;
  }

  async function request(body) {
    if (busy) return;
    busy = true;
    const current = generation;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    byId("oracleSend").disabled = true;
    byId("oracleRefresh").disabled = true;
    panel.setAttribute("aria-busy", "true");
    byId("oracleStatus").textContent = body ? "Reading evidence and preparing advice…" : "Refreshing telemetry…";
    try {
      const response = await fetch("/api/dreamweaver/oracle", {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await response.json();
      if (current !== generation) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) clear();
        throw new Error("Dreamweaver request failed. Confirm owner access and retry.");
      }
      panel.hidden = false;
      renderTelemetry(data.telemetry);
      byId("oracleStatus").textContent = `Snapshot ${data.telemetry.generatedAt}${body ? data.usedFallback ? " · deterministic advice" : " · AI advisory response" : ""}`;
      if (body) {
        appendMessage("user", body.message);
        appendMessage("assistant", `${data.answer}\n\n${data.notice}`, data.suggestions);
        history.push({ role: "user", content: body.message.slice(0, 1000) },
          { role: "assistant", content: data.answer.slice(0, 1000) });
        history.splice(0, Math.max(0, history.length - 6));
        byId("oracleMessage").value = "";
      }
    } catch {
      if (current === generation) byId("oracleStatus").textContent = "Dreamweaver could not refresh. Displayed evidence may be stale; retry.";
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        busy = false;
        byId("oracleSend").disabled = false;
        byId("oracleRefresh").disabled = false;
        panel.setAttribute("aria-busy", "false");
      }
    }
  }

  byId("oracleRefresh").addEventListener("click", () => request());
  byId("oracleForm").addEventListener("submit", event => {
    event.preventDefault();
    const message = byId("oracleMessage").value.trim();
    if (message) request({ mode: "chat", message, history: history.slice(-6), useAI: byId("oracleUseAI").checked });
  });
  panel.querySelectorAll("[data-oracle-prompt]").forEach(button => button.addEventListener("click", () => {
    byId("oracleMessage").value = button.textContent;
    byId("oracleMessage").focus();
  }));
  window.addEventListener("halo-owner-operations", event => {
    if (!event.detail.authorized) return clear();
    panel.hidden = false;
    request();
  });
  window.setInterval(() => {
    if (!panel.hidden && document.visibilityState === "visible") request();
  }, 45_000);
})();
