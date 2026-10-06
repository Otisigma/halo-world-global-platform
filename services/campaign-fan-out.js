export const SIGNAL_FEED_PUBLISH_ENDPOINT = "/api/signal-feed";

export class CampaignFanOutService {
  constructor({ fetchImpl = globalThis.fetch, navigatorImpl = globalThis.navigator, document = globalThis.document } = {}) {
    this.fetch = fetchImpl;
    this.navigator = navigatorImpl;
    this.document = document;
  }

  async publishSignalFeed(content) {
    const body = String(content ?? "").trim();
    if (!body) throw new Error("Generate and review a Signal Feed draft before publishing.");
    if (typeof this.fetch !== "function") throw new Error("The Signal Feed publishing service is unavailable.");
    const response = await this.fetch(SIGNAL_FEED_PUBLISH_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", kind: "TEXT", body, visibility: "PUBLIC", audience: [], publishPublic: true })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The Signal Feed could not be published. Please retry.");
    return data;
  }

  async copy(text) {
    const value = String(text ?? "");
    if (!value) return false;
    try {
      if (typeof this.navigator?.clipboard?.writeText === "function") {
        await this.navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}
    if (!this.document?.createElement || !this.document?.body?.appendChild) return false;
    const field = this.document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    this.document.body.appendChild(field);
    field.select();
    let copied = false;
    try { copied = Boolean(this.document.execCommand?.("copy")); } catch {}
    field.remove();
    return copied;
  }
}
