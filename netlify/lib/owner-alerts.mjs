// Best-effort owner pings. Alerts intentionally carry no buyer or fan contact details.
const ALERT_TIMEOUT_MS = 4000;
const MAX_MESSAGE_LENGTH = 1500;

function readEnvironment(name, env) {
  if (env) return String(env[name] || "").trim();
  return String(globalThis.Netlify?.env?.get(name) || process.env[name] || "").trim();
}

function plainText(value, maxLength = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function ownerAlertText({ title, lines = [] }) {
  return [plainText(title, 120), ...lines.map(line => plainText(line)).filter(Boolean)]
    .join("\n").slice(0, MAX_MESSAGE_LENGTH);
}

function discordWebhookUrl(value) {
  try {
    const url = new URL(value);
    const trustedHost = ["discord.com", "discordapp.com"].includes(url.hostname);
    return url.protocol === "https:" && trustedHost && !url.username && !url.password && url.pathname.startsWith("/api/webhooks/")
      ? url : null;
  } catch {
    return null;
  }
}

export async function sendOwnerAlert(alert, { env, fetchImpl = fetch } = {}) {
  const text = ownerAlertText(alert);
  const telegramToken = readEnvironment("TELEGRAM_BOT_TOKEN", env);
  const telegramChatId = readEnvironment("TELEGRAM_CHAT_ID", env);
  const discordUrl = discordWebhookUrl(readEnvironment("HALO_OWNER_ALERT_DISCORD_WEBHOOK_URL", env));
  const deliveries = [];

  if (telegramToken && telegramChatId && /^[0-9]+:[A-Za-z0-9_-]+$/.test(telegramToken)) {
    deliveries.push(["telegram", fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Plain text avoids Markdown injection from song titles.
      body: JSON.stringify({ chat_id: telegramChatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS)
    })]);
  }
  if (discordUrl) {
    deliveries.push(["discord", fetchImpl(discordUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS)
    })]);
  }
  if (!deliveries.length) return { sent: [], failed: [], configured: false };

  const results = await Promise.allSettled(deliveries.map(([, delivery]) => delivery));
  const sent = [], failed = [];
  results.forEach((result, index) => {
    const channel = deliveries[index][0];
    if (result.status === "fulfilled" && result.value?.ok) sent.push(channel);
    else failed.push(channel);
  });
  if (failed.length) console.warn("HALO owner alert delivery failed", failed.join(","));
  return { sent, failed, configured: true };
}

export async function notifyOwnerSafely(alert, options) {
  try {
    return await sendOwnerAlert(alert, options);
  } catch {
    console.warn("HALO owner alert delivery failed");
    return { sent: [], failed: ["unknown"], configured: true };
  }
}
