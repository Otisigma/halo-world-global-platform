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

// Daily check texts via Twilio. The recipient number lives in HALO_OWNER_SMS_TO, not in the public repo.
const SMS_MAX_LENGTH = 320;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function dailyCheckSmsText({ check, status = "done", lines = [] }) {
  const mark = status === "failed" ? "FAILED" : status === "skipped" ? "skipped" : "done";
  return [`HALO ${plainText(check, 60)}: ${mark}`, ...lines.map(line => plainText(line, 120)).filter(Boolean)]
    .join("\n").slice(0, SMS_MAX_LENGTH);
}

export async function sendOwnerSms(text, { env, fetchImpl = fetch } = {}) {
  const sid = readEnvironment("TWILIO_ACCOUNT_SID", env);
  const token = readEnvironment("TWILIO_AUTH_TOKEN", env);
  const from = readEnvironment("TWILIO_FROM_NUMBER", env).replace(/\s+/g, "");
  const to = readEnvironment("HALO_OWNER_SMS_TO", env).replace(/\s+/g, "");
  if (!sid || !token || !from || !to) return { sent: false, configured: false };
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid) || !E164.test(to) || !(E164.test(from) || /^[A-Za-z0-9 ]{1,11}$/.test(from))) {
    console.warn("HALO owner SMS skipped: Twilio settings are not in the expected format");
    return { sent: false, configured: false };
  }
  try {
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ To: to, From: from, Body: String(text).slice(0, SMS_MAX_LENGTH) }).toString(),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS)
    });
    if (!response.ok) console.warn("HALO owner SMS delivery failed", response.status);
    return { sent: response.ok, configured: true };
  } catch {
    console.warn("HALO owner SMS delivery failed");
    return { sent: false, configured: true };
  }
}

// Never throws, so a texting problem can't break the check itself.
export async function textDailyCheck(check, options) {
  try {
    return await sendOwnerSms(dailyCheckSmsText({ check, ...options }), options);
  } catch {
    return { sent: false, configured: true };
  }
}
