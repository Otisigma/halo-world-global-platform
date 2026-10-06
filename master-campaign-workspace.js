import { createFeedCard } from "./signal-network/signal-components.js";

const root = document.getElementById("masterCampaignWorkspace");
const byId = id => document.getElementById(id);
const form = byId("masterCampaignForm");
const state = { epoch: 0, identity: null, user: null, detail: null, jobs: [], metadata: {}, editors: new Map(), busy: false, abort: new AbortController() };
const status = message => { byId("masterCampaignStatus").textContent = message; };
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};

async function request(payload, query = "") {
  const epoch = state.epoch;
  const controller = new AbortController();
  const sessionSignal = state.abort.signal;
  const cancel = () => controller.abort();
  sessionSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 60000);
  try {
    const response = await fetch(`/api/master-campaigns${query}`, {
      credentials: "same-origin", signal: controller.signal,
      ...(payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {})
    });
    const data = await response.json();
    if (epoch !== state.epoch) throw new Error("Session changed.");
    if (!response.ok) throw new Error(data.message || "Campaign request failed.");
    return data;
  } finally {
    clearTimeout(timer);
    sessionSignal.removeEventListener("abort", cancel);
  }
}

async function run(work) {
  if (state.busy || !state.user) return;
  const epoch = state.epoch;
  state.busy = true;
  byId("masterCampaignControls").inert = true;
  byId("masterCampaignRefresh").disabled = true;
  root.setAttribute("aria-busy", "true");
  try { await work(); }
  catch (error) { if (epoch === state.epoch) status(error.name === "AbortError" ? "Request interrupted. Refresh before retrying; the server may have saved your action." : error.message); }
  finally {
    if (epoch === state.epoch) {
      state.busy = false;
      byId("masterCampaignControls").inert = false;
      byId("masterCampaignRefresh").disabled = false;
      root.setAttribute("aria-busy", "false");
    }
  }
}

function button(label, action) {
  const element = node("button", label, "button light");
  element.type = "button";
  element.addEventListener("click", () => run(action));
  return element;
}

function readBrief() {
  const data = new FormData(form);
  const type = data.get("sourceType");
  const sourceKind = data.get("sourceKind");
  return {
    type, source: type === "halo_update" ? null : { kind: sourceKind, id: data.get("sourceId"), inputApproved: data.get("inputApproved") === "on" },
    title: data.get("title"), summary: data.get("brief"), objective: data.get("objective"),
    audience: data.get("audience"), destinationUrl: data.get("destinationUrl"),
    themeId: data.get("theme"), locale: data.get("locale"), region: data.get("region"),
    activeFrom: data.get("activeFrom") || null, activeUntil: data.get("activeUntil") || null,
    rightsConfirmed: data.get("rightsConfirmed") === "on",
    channels: [...byId("masterCampaignChannels").querySelectorAll("input:checked")].map(input => input.value)
  };
}

function renderMetadata(data) {
  state.metadata = data;
  const themeSelect = byId("masterCampaignTheme");
  themeSelect.replaceChildren();
  for (const theme of data.themes || []) {
    const option = node("option", theme.label || theme.name || theme.id);
    option.value = theme.id;
    themeSelect.append(option);
  }
  const channels = byId("masterCampaignChannels");
  channels.replaceChildren();
  for (const channel of data.channels || []) {
    const label = node("label");
    const input = node("input");
    input.type = "checkbox";
    input.value = channel.id;
    input.checked = ["signal", "lobby", "inbox"].includes(channel.id);
    label.append(input, document.createTextNode(`${channel.label || channel.id}${channel.mode === "export" ? " (human export)" : channel.available === false ? " (connector not configured)" : ""}`));
    channels.append(label);
  }
}

function renderList(campaigns) {
  const list = byId("masterCampaignList");
  list.replaceChildren();
  if (!campaigns.length) list.append(node("p", "No campaigns yet. Create a factual brief or publish a release to get a reviewable draft."));
  for (const campaign of campaigns) {
    const select = button(`${campaign.title} · v${campaign.version} · ${campaign.status}`, async () => {
      if (!confirmDiscardEdits()) return;
      await loadDetail(campaign.id);
      status("Campaign loaded. Review the brief and channel copy before approval.");
    });
    select.className = "member-card";
    list.append(select);
  }
}

async function loadList(metadata = false) {
  const data = await request();
  if (metadata) renderMetadata(data.metadata);
  renderList(data.campaigns || []);
  byId("masterCampaignControls").hidden = false;
}

async function loadDetail(id) {
  const data = await request(null, `?id=${encodeURIComponent(id)}`);
  state.detail = data.campaign;
  state.metadata = data.metadata;
  state.jobs = data.jobs || [];
  renderDetail();
}

function selectedPayload(action, extra = {}) {
  return { action, id: state.detail.id, version: state.detail.version, ...extra };
}

function approvedChannel(campaign, channel) {
  return campaign.status !== "cancelled" && campaign.approval?.version === campaign.version
    && Array.isArray(campaign.approval.channels) && campaign.approval.channels.includes(channel);
}

function confirmDiscardEdits() {
  return ![...state.editors.values()].some(changed => changed())
    || window.confirm("Unsaved channel edits will be discarded. Continue?");
}

function renderDetail() {
  const campaign = state.detail;
  const container = byId("masterCampaignDetail");
  container.replaceChildren();
  state.editors.clear();
  if (!campaign) return;
  byId("masterCampaignRevise").disabled = false;
  container.append(node("h3", `${campaign.title} · version ${campaign.version}`), node("p", campaign.summary));
  container.append(node("p", `Source: ${campaign.type} · Theme: ${campaign.theme?.label || "none"} · ${campaign.status}`));
  const history = node("details");
  history.append(node("summary", "Inspect a saved version (read-only)"));
  const historicalVersion = node("input");
  historicalVersion.type = "number";
  historicalVersion.min = 1;
  historicalVersion.max = campaign.version;
  historicalVersion.value = campaign.version;
  const versionLabel = node("label", "Version number");
  versionLabel.append(historicalVersion);
  const snapshot = node("pre", undefined, "campaign-snapshot");
  history.append(versionLabel, button("Load saved snapshot", async () => {
    const version = Number(historicalVersion.value);
    if (!Number.isSafeInteger(version) || version < 1 || version > campaign.version) throw new Error("Choose a saved version number.");
    const data = await request(null, `?id=${encodeURIComponent(campaign.id)}&version=${version}`);
    snapshot.textContent = JSON.stringify(data.campaign, null, 2);
    status("Saved snapshot loaded for inspection only. Editing and queueing still target the current version.");
  }), snapshot);
  container.append(history);
  const hydrate = button("Use this brief for a revised draft", async () => {
    for (const name of ["title", "objective", "audience", "destinationUrl"]) {
      if (form.elements[name]) form.elements[name].value = campaign[name] || "";
    }
    form.elements.sourceType.value = campaign.type;
    form.elements.sourceId.value = campaign.source?.id || "";
    form.elements.sourceKind.value = campaign.source?.kind || "release";
    form.elements.inputApproved.checked = false;
    form.elements.brief.value = campaign.summary;
    form.elements.theme.value = campaign.theme?.id || campaign.theme || "evergreen";
    for (const name of ["locale", "region", "activeFrom", "activeUntil"]) {
      const value = campaign.theme?.[name] || (["locale", "region"].includes(name) ? (name === "locale" ? "en" : "Global") : "");
      form.elements[name].value = name.startsWith("active") ? value.slice(0, 10) : value;
    }
    form.elements.rightsConfirmed.checked = false;
    const channels = new Set(Object.keys(campaign.outputs || {}));
    byId("masterCampaignChannels").querySelectorAll("input").forEach(input => { input.checked = channels.has(input.value); });
    form.closest("details").open = true;
    form.elements.brief.focus();
    status("Brief copied to the form. A revision creates new drafts and requires fresh approval.");
  });
  container.append(hydrate);
  for (const [channel, output] of Object.entries(campaign.outputs || {})) renderOutput(container, channel, output);
  const queue = node("div", undefined, "campaign-output");
  queue.append(node("h4", "Approved delivery"));
  const selection = node("fieldset");
  selection.append(node("legend", "Select approved channels to queue"));
  const queueChannels = [];
  for (const channel of state.metadata.channels || []) {
    if (!campaign.outputs[channel.id] || channel.mode === "export") continue;
    const label = node("label");
    const input = node("input");
    input.type = "checkbox";
    input.value = channel.id;
    input.disabled = !approvedChannel(campaign, channel.id) || channel.available === false;
    label.append(input, document.createTextNode(` ${channel.label}${input.disabled ? " (approval or configuration required)" : ""}`));
    selection.append(label);
    queueChannels.push(input);
  }
  selection.className = "campaign-channel-options";
  queue.append(selection);
  const recipients = node("textarea");
  recipients.rows = 2;
  recipients.maxLength = 2019;
  const recipientLabel = node("label", "Inbox audience: optional Creator Pass member IDs (commas). Empty targets opted-in members; subscriptions and blocks are rechecked.");
  recipientLabel.append(recipients);
  queue.append(recipientLabel);
  const confirm = node("input");
  confirm.type = "checkbox";
  const confirmation = node("label", undefined, "consent-field");
  confirmation.append(confirm, document.createTextNode("I deliberately authorize publication of the approved version. A lobby output replaces this account's current room pin."));
  queue.append(confirmation);
  queue.append(button("Queue approved outputs", async () => {
    if (!confirm.checked) throw new Error("Confirm deliberate publication before queueing.");
    if ([...state.editors.values()].some(isDirty => isDirty())) throw new Error("Save your channel edits and approve the saved version before queueing.");
    const data = await request(selectedPayload("queue", {
      channels: queueChannels.filter(input => input.checked).map(input => input.value),
      recipientIds: [...new Set(recipients.value.split(/[\s,]+/).filter(Boolean))]
    }));
    await loadDetail(campaign.id);
    status(data.message || "Approved outputs queued. External acceptance is not confirmed delivery.");
  }));
  queue.append(button("Cancel campaign / pending delivery", async () => {
    if (!window.confirm("Cancel this campaign and withdraw pending deliveries? Already published posts or external deliveries cannot be recalled.")) return;
    const data = await request(selectedPayload("cancel"));
    await loadDetail(campaign.id);
    await loadList();
    status(data.message || "Pending deliveries cancelled.");
  }));
  container.append(queue);
  const deliveryTitle = node("h4", "Delivery results");
  const deliveries = node("ul", undefined, "campaign-deliveries");
  for (const delivery of state.jobs) {
    const error = delivery.lastError || delivery.last_error || "";
    const item = node("li", `v${delivery.version} · ${delivery.channel} · ${delivery.recipientId || delivery.recipient || "channel"} · ${delivery.status} · ${delivery.attempts || 0} attempts${error ? ` · ${error}` : ""}`);
    if (delivery.status === "failed" && delivery.version === campaign.version && campaign.status !== "cancelled") item.append(button("Retry failed delivery", async () => {
      if (!confirmDiscardEdits()) return;
      const data = await request(selectedPayload("retry", { deliveryId: delivery.id }));
      await loadDetail(campaign.id);
      status(data.message || "Delivery retry queued.");
    }));
    deliveries.append(item);
  }
  if (!deliveries.children.length) deliveries.append(node("li", "No deliveries queued. Approval and export do not mean delivered."));
  container.append(deliveryTitle, deliveries);
}

function renderOutput(container, channel, output) {
  const approved = approvedChannel(state.detail, channel);
  const card = node("section", undefined, "campaign-output");
  card.append(node("h4", `${channel} · ${approved ? "approved" : "draft"}`));
  const title = node("input");
  title.maxLength = channel === "lobby" ? 80 : 160;
  title.value = output.title;
  const titleLabel = node("label", "Channel title");
  titleLabel.append(title);
  card.append(titleLabel);
  const content = node("textarea");
  content.rows = 5;
  content.maxLength = state.metadata.channels?.find(item => item.id === channel)?.maxBody || 2000;
  content.value = output.body || "";
  const label = node("label", "Channel-specific copy");
  label.append(content);
  card.append(label);
  const cta = node("input");
  cta.maxLength = channel === "lobby" ? 24 : 180;
  cta.value = output.cta;
  const ctaLabel = node("label", "Call to action");
  ctaLabel.append(cta);
  card.append(ctaLabel);
  const readOutput = () => ({ title: title.value, body: content.value, cta: cta.value });
  const isDirty = () => JSON.stringify(readOutput()) !== JSON.stringify({ title: output.title, body: output.body, cta: output.cta });
  state.editors.set(channel, isDirty);
  card.append(node("p", output.destinationUrl || ""));
  if (channel === "signal") {
    const post = () => ({
      kind: "TEXT", visibility: "PUBLIC",
      body: output.destinationUrl ? `${content.value}\n\n${cta.value}: ${output.destinationUrl}` : content.value
    });
    const preview = createFeedCard(post(), { preview: true });
    const count = node("p");
    const updatePreview = () => {
      const signal = post();
      preview.update(signal);
      count.textContent = `${signal.body.length}/1000 published Signal characters, including the destination. Preview only — nothing is published.`;
    };
    content.addEventListener("input", updatePreview);
    cta.addEventListener("input", updatePreview);
    updatePreview();
    card.append(count, preview.element);
  }
  const actions = node("div", undefined, "form-footer");
  if (state.detail.status !== "cancelled") {
    actions.append(button("Save copy as new version", async () => {
      if ([...state.editors].some(([id, changed]) => id !== channel && changed())
        && !window.confirm("Unsaved edits in other channels will be discarded when this version reloads. Continue?")) return;
      const data = await request(selectedPayload("edit_output", { channel, output: readOutput() }));
      await loadDetail(state.detail.id);
      status(data.message || "Channel copy saved as a new version. Previous approvals no longer apply.");
    }));
  }
  if (!approved && state.detail.status !== "cancelled") {
    const confirm = node("input");
    confirm.type = "checkbox";
    const consent = node("label", undefined, "consent-field");
    consent.append(confirm, document.createTextNode(`I reviewed this saved channel copy, factual claims, rights, and public destination.${channel === "lobby" ? " If queued, I authorize replacing this account's current room pin." : ""}`));
    card.append(consent);
    actions.append(button("Approve saved output", async () => {
      if (!confirm.checked) throw new Error("Review and confirm this channel before approval.");
      if ([...state.editors.values()].some(changed => changed())) throw new Error("Save your edits before approving.");
      const data = await request(selectedPayload("approve", { channels: [channel], rightsConfirmed: true, publicConsent: true, overwritePin: channel === "lobby" }));
      await loadDetail(state.detail.id);
      status(data.message || "Saved output approved for this version.");
    }));
  }
  if (approved) actions.append(button("Export approved copy", async () => {
    if ([...state.editors.values()].some(changed => changed())) throw new Error("Save your edits and approve the saved version before exporting.");
    const data = await request(selectedPayload("export", { channel }));
    const exported = JSON.stringify(data.export || data.output || data, null, 2);
    const blob = new Blob([exported], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = node("a");
    link.href = url;
    link.download = `halo-campaign-${state.detail.id}-${channel}-v${state.detail.version}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await loadDetail(state.detail.id);
    status("Approved copy exported for human handoff. No message was sent.");
  }));
  card.append(actions);
  container.append(card);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  run(async () => {
    if (!confirmDiscardEdits()) return;
    status("Generating reviewable channel drafts…");
    const data = await request({ action: "create", ...readBrief() });
    await loadList();
    await loadDetail(data.campaign.id);
    status(data.message || "New campaign drafts generated. Nothing has been published.");
  });
});
form.elements.sourceType.addEventListener("change", () => {
  const type = form.elements.sourceType.value;
  form.elements.sourceId.required = type !== "halo_update";
  if (type !== "halo_update") form.elements.sourceKind.value = type === "listening_party" ? "fan_campaign" : type;
});
byId("masterCampaignRevise").addEventListener("click", () => run(async () => {
  if (!state.detail || !form.reportValidity()) return;
  if (!confirmDiscardEdits()) return;
  const { type, source, ...revision } = readBrief();
  if (type !== state.detail.type || (source?.id || "") !== (state.detail.source?.id || "")
    || (source?.kind || "") !== (state.detail.source?.kind || "")) {
    throw new Error("Create a new campaign to change the source or type.");
  }
  const data = await request(selectedPayload("revise", revision));
  await loadList();
  await loadDetail(data.campaign.id);
  status("Revised campaign created. All new channel outputs require review.");
}));
byId("masterCampaignRefresh").addEventListener("click", () => run(async () => {
  if (!confirmDiscardEdits()) return;
  await loadList(true);
  if (state.detail) await loadDetail(state.detail.id);
  status("Campaigns and delivery state refreshed.");
}));

function sessionChanged(user) {
  state.epoch++;
  state.abort.abort();
  state.abort = new AbortController();
  state.user = user;
  state.detail = null;
  state.editors.clear();
  state.busy = false;
  byId("masterCampaignControls").hidden = true;
  byId("masterCampaignControls").inert = false;
  byId("masterCampaignList").replaceChildren();
  byId("masterCampaignDetail").replaceChildren();
  form.reset();
  byId("masterCampaignRevise").disabled = true;
  root.setAttribute("aria-busy", "false");
  status(user ? "Opening the owner campaign desk…" : "Owner sign-in required.");
  if (user) run(async () => { await loadList(true); status("Reviewable drafts and delivery controls are ready."); });
}

async function connect() {
  const identity = window.haloIdentity;
  if (!identity || state.identity) return;
  state.identity = identity;
  const unsubscribe = identity.onAuthChange((_event, user) => sessionChanged(user));
  const epoch = state.epoch;
  const user = await identity.getUser().catch(() => null);
  if (epoch === state.epoch) sessionChanged(user);
  window.addEventListener("pagehide", event => {
    if (!event.persisted) { state.epoch++; state.abort.abort(); unsubscribe?.(); }
  });
  window.addEventListener("pageshow", async event => {
    if (!event.persisted) return;
    sessionChanged(null);
    const epoch = state.epoch;
    const restoredUser = await identity.getUser().catch(() => null);
    if (epoch === state.epoch) sessionChanged(restoredUser);
  });
}
if (window.haloIdentity) connect();
else window.addEventListener("halo-identity-ready", connect, { once: true });
