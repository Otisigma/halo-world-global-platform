import { formatReleaseCaption, RELEASE_CAPTION_MAX_LENGTH } from "../lib/signal-dreamweaver.js";

export const SIGNAL_FEED_ENDPOINT = "/api/signal-feed";
// Optional outgoing automation hook. Leave empty to disable, or configure at runtime with
// window.HALO_SIGNAL_CONFIG = { broadcastWebhookUrl: "/api/..." } or
// <meta name="halo-signal-broadcast-webhook" content="...">. Prefer a same-origin proxy path.
export const SIGNAL_BROADCAST_WEBHOOK_URL = "";
export const SIGNAL_SHARE_CHANNELS = Object.freeze({ twitter: "share-twitter", facebook: "share-facebook", discord: "share-discord" });
const PLACEHOLDER = /YOUR[_-]|_HERE\b|PLACEHOLDER|[<>{}]/i;

export function resolveWebhookUrl(value) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048 || PLACEHOLDER.test(candidate)) return "";
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function readWebhookConfig(root = globalThis.document, win = globalThis.window) {
  const runtime = win?.HALO_SIGNAL_CONFIG?.broadcastWebhookUrl;
  const meta = root?.querySelector?.('meta[name="halo-signal-broadcast-webhook"]')?.getAttribute?.("content");
  return resolveWebhookUrl(runtime) || resolveWebhookUrl(meta) || resolveWebhookUrl(SIGNAL_BROADCAST_WEBHOOK_URL);
}

async function postJson(url, body, { fetchImpl = globalThis.fetch, timeoutMs = 12000, fallbackMessage } = {}) {
  if (typeof fetchImpl !== "function") throw new Error(fallbackMessage);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), ...(controller ? { signal: controller.signal } : {})
    });
    const data = typeof response.json === "function" ? await response.json().catch(() => ({})) : {};
    if (!response.ok) throw new Error(data?.message || fallbackMessage);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request took too long. Please retry.");
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}

// Default save path: the existing same-origin Signal feed API (Creator Pass session required).
export async function saveSignalToFeed({ content }, { fetchImpl } = {}) {
  const data = await postJson(SIGNAL_FEED_ENDPOINT, {
    action: "publish", kind: "TEXT", body: content, visibility: "PUBLIC", audience: [], publishPublic: true
  }, { fetchImpl, fallbackMessage: "The Signal feed is unavailable. Please retry." });
  return { id: data?.id || "", broadcast: true, message: "Signal published to Public Frequency." };
}

export function createSignalComposerController({
  root = globalThis.document, win = globalThis.window, form, publishButton, confirm, content, generateButton,
  statusElement, captionStatusElement, broadcastOptions, channels, save = saveSignalToFeed,
  webhookUrl, fetchImpl = globalThis.fetch, onStatus, onBusyChange, isEnabled = () => true,
  pendingMessage = "Publishing signal…", permalinkBase
} = {}) {
  const byId = id => root?.getElementById?.(id) || null;
  const elements = {
    publishButton: publishButton ?? byId("btn-publish-signal"),
    confirm: confirm ?? byId("confirm-publish"),
    content: content ?? byId("signal-content"),
    generateButton: generateButton ?? byId("btn-generate-caption"),
    status: statusElement ?? byId("signal-composer-status"),
    broadcastOptions: broadcastOptions ?? byId("signal-broadcast-options")
  };
  elements.captionStatus = captionStatusElement ?? elements.status;
  const channelInputs = Object.fromEntries(Object.entries(channels || SIGNAL_SHARE_CHANNELS)
    .map(([name, id]) => [name, typeof id === "string" ? byId(id) : id]).filter(([, input]) => input));
  const webhook = webhookUrl === undefined ? readWebhookConfig(root, win) : resolveWebhookUrl(webhookUrl);
  const publishForm = form ?? (elements.publishButton?.type === "submit" ? elements.publishButton.form : null) ?? null;
  const busyLabel = "Publishing…";
  let busy = false, token = 0, idleLabel = "";
  if (elements.broadcastOptions) elements.broadcastOptions.hidden = !webhook;

  function write(target, message, tone) {
    if (!target) return;
    target.textContent = message;
    target.setAttribute?.("data-tone", tone);
  }
  function report(message, tone = "info", target = elements.status) {
    write(target, message, tone);
    onStatus?.(message, tone);
  }
  function setBusy(value) {
    busy = value;
    const button = elements.publishButton;
    if (value) {
      onBusyChange?.(true);
      if (button) {
        idleLabel = button.textContent;
        button.textContent = busyLabel; button.disabled = true; button.setAttribute?.("aria-busy", "true");
      }
      if (elements.generateButton) elements.generateButton.disabled = true;
      return;
    }
    onBusyChange?.(false);
    if (elements.generateButton) elements.generateButton.disabled = false;
    if (button) {
      if (button.textContent === busyLabel) button.textContent = idleLabel;
      button.disabled = !isEnabled(); button.setAttribute?.("aria-busy", "false");
    }
  }
  function selectedChannels() {
    return Object.fromEntries(Object.entries(channelInputs).map(([name, input]) => [name, Boolean(input.checked)]));
  }
  function validate() {
    if (elements.confirm && !elements.confirm.checked) {
      return { message: "Please confirm the publication checkbox before publishing.", element: elements.confirm };
    }
    if (!elements.content || !String(elements.content.value ?? "").trim()) {
      return { message: "Please enter signal content to publish.", element: elements.content };
    }
    return null;
  }
  function resetFields() {
    if (elements.content) elements.content.value = "";
    if (elements.confirm) elements.confirm.checked = false;
    for (const input of Object.values(channelInputs)) input.checked = false;
  }
  function permalink(id) {
    const base = permalinkBase ?? (win?.location?.origin ? `${win.location.origin}/signal-network/` : "");
    return id && base ? `${base}#feed-post-${encodeURIComponent(id)}` : "";
  }
  async function broadcast(saved, payload) {
    if (!webhook || saved?.broadcast === false) return "";
    const channels = payload.channels;
    if (Object.keys(channels).length && !Object.values(channels).some(Boolean)) return "";
    try {
      await postJson(webhook, {
        id: saved?.id || "", content: saved?.content ?? payload.content, permalink: permalink(saved?.id),
        timestamp: new Date().toISOString(), channels
      }, { fetchImpl, timeoutMs: 8000, fallbackMessage: "Broadcast webhook rejected the signal." });
      return "queued";
    } catch { return "failed"; }
  }
  function generateCaption() {
    const field = elements.content;
    if (!field || busy) return "";
    const raw = String(field.value ?? "").trim();
    if (!raw) {
      report("Enter a track title or seed phrase first so Dreamweaver can shape a caption.", "error", elements.captionStatus);
      field.focus?.();
      return "";
    }
    const maxLength = Number(field.maxLength) > 0 ? Number(field.maxLength) : RELEASE_CAPTION_MAX_LENGTH;
    const caption = formatReleaseCaption(raw, { maxLength });
    field.value = caption;
    if (typeof Event === "function") field.dispatchEvent?.(new Event("input", { bubbles: true }));
    report("Caption generated in your draft. Review and edit before publishing.", "success", elements.captionStatus);
    field.focus?.();
    return caption;
  }
  async function publish(event) {
    event?.preventDefault?.();
    if (busy) return { ok: false, reason: "busy" };
    const problem = validate();
    if (problem) {
      report(problem.message, "error");
      problem.element?.focus?.();
      return { ok: false, reason: "invalid", message: problem.message };
    }
    const current = ++token;
    const payload = { content: String(elements.content.value).trim(), channels: selectedChannels() };
    setBusy(true);
    report(typeof pendingMessage === "function" ? pendingMessage() : pendingMessage, "info");
    try {
      const saved = await save(payload, { fetchImpl });
      if (current !== token) return { ok: false, reason: "cancelled" };
      const outcome = await broadcast(saved, payload);
      if (current !== token) return { ok: false, reason: "cancelled" };
      resetFields();
      const base = saved?.message || "Signal published.";
      if (outcome === "failed") report(`${base} Social broadcast could not be queued; your signal is saved.`, "warning");
      else report(outcome === "queued" ? `${base} Queued for social broadcasting.` : base, "success");
      return { ok: true, saved, broadcast: outcome };
    } catch (error) {
      if (current !== token) return { ok: false, reason: "cancelled" };
      report(error?.message || "Failed to publish signal. Please retry.", "error");
      return { ok: false, reason: "error", error };
    } finally {
      if (current === token) setBusy(false);
    }
  }
  function cancel() {
    token++;
    if (!busy) return;
    setBusy(false);
    write(elements.status, "", "info");
  }

  elements.generateButton?.addEventListener?.("click", generateCaption);
  if (publishForm) publishForm.addEventListener?.("submit", publish);
  else elements.publishButton?.addEventListener?.("click", publish);

  return {
    elements, webhookUrl: webhook, generateCaption, publish, validate, cancel,
    get busy() { return busy; }, channels: selectedChannels
  };
}
