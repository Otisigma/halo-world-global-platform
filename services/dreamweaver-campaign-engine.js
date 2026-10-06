const THEMES = Object.freeze({
  midnight: { label: "Midnight Signal", mood: "after dark", invitation: "Step into the room and hear what comes next." },
  electric: { label: "Electric Room", mood: "at full voltage", invitation: "Catch the energy and make this moment yours." },
  origin: { label: "First Light", mood: "at the beginning", invitation: "Be here for the first signal and help shape what follows." }
});
const CHANNELS = Object.freeze([
  { id: "signal", label: "HALO Signal Feed" },
  { id: "instagram", label: "Instagram" },
  { id: "threads", label: "Threads" },
  { id: "x", label: "X (Twitter)" },
  { id: "discord", label: "Discord" },
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "Newsletter / Email" }
]);
const clean = (value, limit, fallback = "") => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) || fallback;
const compact = value => value.replace(/\s+/g, " ").trim();

export class DreamweaverCampaignEngine {
  generate({ title, artist, theme = "midnight", hook = "", callToAction = "", destination = "/dreamweaver/" } = {}) {
    const campaignTitle = clean(title, 140, "A new HALO signal");
    const creator = clean(artist, 100);
    const themeKey = Object.hasOwn(THEMES, theme) ? theme : "midnight";
    const selectedTheme = THEMES[themeKey];
    const opening = clean(hook, 400, selectedTheme.invitation);
    const cta = clean(callToAction, 120, "Explore the signal");
    const safeDestination = this.#destination(destination);
    const credit = creator ? ` by ${creator}` : "";
    const short = compact(`${campaignTitle}${credit} — ${opening} ${cta}: ${safeDestination}`);
    const instagram = `${campaignTitle}${credit}\n\n${opening}\n\n${cta}: ${safeDestination}\n\n#HALO #Dreamweaver #IndependentMusic`;
    const email = `Subject: ${campaignTitle}${creator ? ` — ${creator}` : ""}\n\n${opening}\n\n${cta}: ${safeDestination}`;
    const messages = {
      signal: `✨ ${campaignTitle}${credit}\n\n${opening}\n\n${cta}: ${safeDestination}`,
      instagram,
      threads: `${campaignTitle}${credit}. ${opening} ${cta}: ${safeDestination}`,
      x: compact(short).slice(0, 280),
      discord: `**${campaignTitle}${credit}**\n${opening}\n\n${cta}: ${safeDestination}`,
      telegram: `✨ ${campaignTitle}${credit}\n\n${opening}\n${cta}: ${safeDestination}`,
      email
    };
    return {
      title: campaignTitle,
      theme: { id: themeKey, label: selectedTheme.label, mood: selectedTheme.mood },
      channels: CHANNELS.map(channel => ({ ...channel, content: messages[channel.id] }))
    };
  }

  #destination(value) {
    const candidate = clean(value, 500, "/dreamweaver/");
    if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) return candidate;
    try {
      const url = new URL(candidate);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "/dreamweaver/";
    } catch {
      return "/dreamweaver/";
    }
  }
}

export { CHANNELS as DREAMWEAVER_CAMPAIGN_CHANNELS, THEMES as DREAMWEAVER_CAMPAIGN_THEMES };
