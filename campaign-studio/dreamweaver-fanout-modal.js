import { DreamweaverCampaignEngine, DREAMWEAVER_CAMPAIGN_THEMES } from "../services/dreamweaver-campaign-engine.js";
import { CampaignFanOutService } from "../services/campaign-fan-out.js";

export function initializeDreamweaverFanOutModal({
  document = globalThis.document,
  engine = new DreamweaverCampaignEngine(),
  fanOut = new CampaignFanOutService()
} = {}) {
  const dialog = document?.getElementById?.("dreamweaverFanoutDialog");
  if (!dialog) return null;

  const form = dialog.querySelector("[data-campaign-form]");
  const previews = dialog.querySelector("[data-channel-previews]");
  const approval = dialog.querySelector("[data-publish-approval]");
  const publishButton = dialog.querySelector("[data-publish-signal]");
  const status = dialog.querySelector("[data-fanout-status]");
  let campaign;

  const announce = message => { if (status) status.textContent = message; };
  const generate = () => {
    const fields = new FormData(form);
    campaign = engine.generate({
      title: fields.get("title"),
      artist: fields.get("artist"),
      theme: fields.get("theme"),
      hook: fields.get("hook"),
      callToAction: fields.get("callToAction")
    });
    previews.replaceChildren();
    for (const channel of campaign.channels) {
      const card = document.createElement("article");
      card.className = "fanout-preview";
      const heading = document.createElement("h3");
      heading.textContent = channel.label;
      const copy = document.createElement("pre");
      copy.className = "fanout-preview-copy";
      copy.textContent = channel.content;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost-button";
      button.dataset.copyChannel = channel.id;
      button.textContent = `Copy ${channel.label}`;
      card.append(heading, copy, button);
      previews.append(card);
    }
    approval.checked = false;
    publishButton.disabled = true;
    announce(`Seven channel drafts ready · ${campaign.theme.label} theme. Review each before publishing.`);
    return campaign;
  };

  document.addEventListener("click", event => {
    const opener = event.target?.closest?.("[data-open-dreamweaver-campaign]");
    if (opener) {
      form.elements.title.value ||= opener.dataset.campaignTitle || "";
      if (!dialog.open) dialog.showModal?.();
      return;
    }
    if (event.target?.closest?.("[data-close-fanout]")) {
      dialog.close?.();
      return;
    }
    if (event.target?.closest?.("[data-generate-campaign]")) {
      event.preventDefault();
      generate();
    }
    const copyButton = event.target?.closest?.("[data-copy-channel]");
    if (copyButton && campaign) {
      const channel = campaign.channels.find(item => item.id === copyButton.dataset.copyChannel);
      if (channel) fanOut.copy(channel.content).then(copied => announce(copied ? `${channel.label} output copied.` : "Clipboard access is unavailable in this browser."));
    }
    if (event.target?.closest?.("[data-publish-signal]")) {
      if (!campaign || !approval.checked) return;
      publishButton.disabled = true;
      announce("Publishing the approved Signal Feed draft…");
      fanOut.publishSignalFeed(campaign.channels.find(channel => channel.id === "signal")?.content)
        .then(() => {
          approval.checked = false;
          announce("Approved campaign published to the HALO Signal Feed.");
        })
        .catch(error => announce(error.message))
        .finally(() => { publishButton.disabled = !campaign || !approval.checked; });
    }
  });
  approval.addEventListener("change", () => { publishButton.disabled = !campaign || !approval.checked; });
  dialog.querySelector("[data-campaign-theme]").replaceChildren(...Object.entries(DREAMWEAVER_CAMPAIGN_THEMES).map(([value, theme]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = theme.label;
    return option;
  }));
  form.addEventListener("submit", event => event.preventDefault());

  return { generate, get campaign() { return campaign; } };
}

if (globalThis.document) initializeDreamweaverFanOutModal();
