import { createMilestoneCelebration } from "./milestone-celebration.js";

export function createRoomSession({
  fetch = globalThis.fetch, onState, isVisible = () => !globalThis.document?.hidden,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout
}) {
  let roomId = "", generation = 0, timer, controller, busy = false, snapshot = null, stopped = false, failures = 0;
  const emit = (phase, message = "") => onState({ phase, message, snapshot, busy });
  function cancel() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  }
  async function run(body) {
    if (!roomId || busy || stopped || !isVisible()) return false;
    clearTimeout(timer);
    const current = generation;
    const active = new AbortController();
    controller = active;
    busy = true;
    emit(snapshot ? "connected" : "loading", body ? "Saving…" : "Loading messages…");
    const timeout = setTimeout(() => active.abort(), 12000);
    let saved = false;
    let failureMessage = "";
    try {
      const response = await fetch(`/api/hype-room?roomId=${encodeURIComponent(roomId)}`, {
        credentials: "same-origin", cache: "no-store", signal: active.signal,
        ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, roomId }) } : {})
      });
      const data = await response.json();
      if (current !== generation) return false;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) stopped = true;
        throw new Error(data.message || "Room unavailable");
      }
      if (!body) {
        if (data.roomId !== roomId || !Array.isArray(data.messages) || !["PUBLIC", "INNER_CIRCLE", "COLLABORATOR_VAULT"].includes(data.visibility)) {
          throw new Error("Invalid room response");
        }
        snapshot = { ...data, messages: data.messages.slice(-50) };
      }
      failures = 0;
      saved = true;
      return true;
    } catch (error) {
      if (current !== generation) return false;
      snapshot = null;
      failures++;
      failureMessage = body
        ? `${error.message || "Connection interrupted"}. Change not confirmed. Refresh before retrying; messages are never automatically resent.`
        : error.name === "AbortError" ? "Room timed out. Reconnecting…" : error.message;
      return false;
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        busy = false;
        controller = null;
        if (saved) emit("connected", body ? "Change saved." : "Connected · checks every 10 seconds");
        else emit(stopped ? "error" : "reconnecting", failureMessage || "Connection interrupted. Retrying…");
        if (!stopped) timer = setTimeout(() => run(), failures ? Math.min(60000, 10000 * 2 ** failures) : 10000);
      }
    }
  }
  return {
    join(id) {
      cancel(); generation++; roomId = id; busy = false; snapshot = null; stopped = false; failures = 0;
      emit("loading", "Loading messages…"); return run();
    },
    async mutate(body) {
      if (!snapshot || busy || stopped) return false;
      const current = generation;
      const saved = await run(body);
      if (saved && current === generation) await run();
      return saved && current === generation;
    },
    refresh() { stopped = false; return run(); },
    visibilityChanged() {
      cancel(); generation++; busy = false;
      if (isVisible()) return run();
      snapshot = null;
      emit("paused", "Updates paused while this page is hidden.");
    },
    leave() {
      cancel(); generation++; roomId = ""; snapshot = null; busy = false; stopped = false;
      emit("idle", "Choose Open Hype Room on a Signal post.");
    }
  };
}

export function createHypeRoom(root, { document = globalThis.document, window = globalThis.window, ...options } = {}) {
  if (!root) return { open() {}, reset() {}, destroy() {} };
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const title = node("h3", "Hype Room");
  title.tabIndex = -1;
  const status = node("p");
  status.setAttribute("role", "status");
  const context = node("p");
  const event = node("p");
  const list = node("ol");
  list.setAttribute("aria-label", "Recent room messages");
  list.tabIndex = 0;
  const form = node("form");
  const label = node("label", "Message (up to 500 characters)");
  const input = node("textarea");
  input.maxLength = 500; input.required = true; input.rows = 3;
  label.append(input);
  const consentLabel = node("label");
  const consent = node("input"); consent.type = "checkbox"; consent.required = true;
  const consentText = node("span");
  consentLabel.append(consent, consentText);
  const send = node("button", "Send message"); send.type = "submit";
  const notice = node("p"); notice.setAttribute("role", "status");
  form.append(label, consentLabel, send, notice);
  const retry = node("button", "Reconnect / refresh");
  retry.type = "button";
  const close = node("button", "Leave room");
  close.type = "button";
  const radio = node("a", "Open HALO Radio"); radio.href = "/radio/";
  root.append(title, status, context, event, list, form, retry, close, radio);
  const celebration = createMilestoneCelebration(root, { document, window });
  let previous = "", sending = false, disposed = false, epoch = 0;
  const session = createRoomSession({
    ...options, isVisible: () => !document.hidden,
    onState(state) {
      if (disposed) return;
      status.textContent = state.message;
      list.setAttribute("aria-busy", String(state.busy));
      form.hidden = ["idle", "paused", "error"].includes(state.phase);
      input.disabled = consent.disabled = !state.snapshot || sending;
      send.disabled = !state.snapshot || state.busy || sending;
      retry.disabled = state.busy || state.phase === "idle";
      close.disabled = state.phase === "idle";
      const data = state.snapshot;
      celebration.update(data);
      context.textContent = data ? data.visibility === "PUBLIC"
        ? "Public post: these messages also appear as public Signal comments. Use only a display name you wish to share."
        : "Selected audience: messages are shared with this post's author and authorized audience." : "";
      consentText.textContent = data?.visibility === "PUBLIC"
        ? " I deliberately publish this message and my display name publicly."
        : " I share this message and my display name with this post's selected audience.";
      event.textContent = data?.milestone
        ? `${data.milestone.title} — ${data.milestone.artist}: reached reviewed radio rotation on ${new Date(data.milestone.reachedAt).toLocaleString()}.` : "";
      const key = JSON.stringify(data?.messages ?? null);
      if (key === previous) return;
      previous = key;
      list.replaceChildren();
      if (!data) return;
      if (!data.messages.length) list.append(node("li", "No messages yet. Start the conversation."));
      for (const message of data.messages) {
        const entry = node("li");
        entry.append(node("strong", message.authorName), node("p", message.body),
          node("small", new Date(message.createdAt).toLocaleString()));
        for (const action of message.own ? ["remove"] : ["block", "report"]) {
          const button = node("button", { remove: "Remove my message", block: "Block member", report: "Report message" }[action]);
          button.type = "button";
          button.addEventListener("click", async () => {
            const current = epoch;
            const reason = action === "report" ? window.prompt("Describe the concern (3–500 characters). Reports require operator review.") : undefined;
            if (action === "report" && reason === null) return;
            if (action !== "report" && !window.confirm(action === "block" ? "Block this member across Signal? Public content remains public to signed-out visitors." : "Remove this message and its replies?")) return;
            button.disabled = true;
            const saved = await session.mutate({ action, messageId: message.id, ...(reason !== undefined ? { reason } : {}) });
            if (!disposed && current === epoch) {
              notice.textContent = saved ? action === "report" ? "Report saved for operator review. Content is not automatically removed." : "Change saved." : "Change not confirmed. Refresh and retry.";
              button.disabled = false;
            }
          });
          entry.append(button);
        }
        list.append(entry);
      }
    }
  });
  const submit = async e => {
    e.preventDefault();
    if (sending || !input.value.trim() || !consent.checked) return;
    const current = epoch;
    sending = true; send.disabled = true;
    const saved = await session.mutate({ action: "message", body: input.value, confirmAudience: consent.checked });
    if (disposed || current !== epoch) return;
    sending = false;
    if (saved) { input.value = ""; notice.textContent = "Message saved."; }
    else notice.textContent = "Send not confirmed. Refresh before retrying; it may already be saved.";
    session.refresh();
  };
  const refresh = () => session.refresh();
  const leave = () => { epoch++; celebration.reset(); sending = false; input.value = ""; consent.checked = false; notice.textContent = ""; session.leave(); };
  const visibility = () => session.visibilityChanged();
  form.addEventListener("submit", submit);
  retry.addEventListener("click", refresh);
  close.addEventListener("click", leave);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", leave);
  session.leave();
  return {
    open(id) { leave(); session.join(id); title.focus(); root.scrollIntoView({ block: "center" }); },
    reset: leave,
    destroy() {
      leave(); disposed = true;
      celebration.destroy();
      form.removeEventListener("submit", submit);
      retry.removeEventListener("click", refresh);
      close.removeEventListener("click", leave);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      root.replaceChildren();
    }
  };
}
