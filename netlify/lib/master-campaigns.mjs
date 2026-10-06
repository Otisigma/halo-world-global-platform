import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isOwner } from "./halo-x.mjs";
import { campaignThemeCopy, fallbackPackage, generateCampaignPackage } from "./dreamweaver-campaigns.mjs";
import { publicLink, publishSignalPost } from "./signal-feed.mjs";

export const CAMPAIGN_TYPES = ["release", "mix", "listening_party", "halo_update"];
export const CHANNELS = [
  ["signal", "HALO Signal", "native", 1000], ["lobby", "HALO lobby pin", "native", 240],
  ["tiktok", "TikTok", "connector", 1500], ["instagram", "Instagram", "connector", 2200],
  ["youtube", "YouTube", "connector", 3000], ["twitter", "Twitter / X", "connector", 280],
  ["facebook", "Facebook", "connector", 3000], ["discord", "Discord", "connector", 1800],
  ["email", "Email draft", "export", 4000], ["press", "Press pitch", "export", 4000],
  ["radio", "Radio pitch", "export", 3000], ["dj", "DJ promo", "export", 3000],
  ["advance", "Advance listening", "export", 3000], ["inbox", "HALO update inbox", "native", 1200]
].map(([id, label, mode, maxBody]) => ({ id, label, mode, maxBody }));
export const THEMES = [
  ["evergreen", "Dreamweaver", "#d5ef5a", "Artist-led, clear and cinematic"],
  ["spring", "Spring opening", "#a8dfbd", "Fresh beginnings, gentle motion"],
  ["summer", "Summer movement", "#f2c66d", "Warm energy, open horizons"],
  ["autumn", "Autumn reflection", "#d39b74", "Warm depth, reflective rhythm"],
  ["winter", "Winter light", "#b7cce7", "Quiet contrast, luminous detail"],
  ["celebration", "Community celebration", "#d4b4ed", "Shared joy without invented milestones"]
].map(([id, label, accent, direction]) => ({ id, label, accent, direction, version: 1 }));
const env = name => globalThis.Netlify?.env?.get(name) || process.env[name] || "";
const channelById = id => CHANNELS.find(channel => channel.id === id);
export class CampaignError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function cleanCopy(value, max, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new CampaignError(`Use ${required ? "1–" : "up to "}${max} characters`);
  }
  return value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
}
export function campaignId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CampaignError("Invalid campaign identifier");
  }
  return value;
}
function versionInput(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new CampaignError("Supply the current campaign version");
  return value;
}
function themeInput(id = "evergreen", details = {}) {
  const theme = THEMES.find(item => item.id === id);
  if (!theme) throw new CampaignError("Choose a theme from workspace metadata");
  const locale = cleanCopy(details.locale || "en", 24, true);
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(locale)) throw new CampaignError("Use a supported language tag");
  const region = cleanCopy(details.region || "Global", 80, true);
  const date = value => {
    if (!value) return null;
    if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new CampaignError("Use a valid theme date");
    return new Date(value).toISOString();
  };
  const activeFrom = date(details.activeFrom), activeUntil = date(details.activeUntil);
  if (activeFrom && activeUntil && Date.parse(activeUntil) <= Date.parse(activeFrom)) throw new CampaignError("Theme end must follow its start");
  return { ...theme, locale, region, activeFrom, activeUntil };
}
function channelsInput(value = CHANNELS.map(channel => channel.id)) {
  if (!Array.isArray(value) || !value.length || value.length > CHANNELS.length
    || new Set(value).size !== value.length || value.some(id => !channelById(id))) {
    throw new CampaignError("Choose distinct supported channels");
  }
  return value;
}
function recipientIdsInput(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 500
    || value.some(id => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,99}$/.test(id))
    || new Set(value).size !== value.length) throw new CampaignError("Choose up to 500 distinct Creator Pass member IDs");
  return value;
}
export function safeDestination(value = "") {
  if (!value) return "";
  const raw = cleanCopy(value, 500, true);
  if ((/^\/(?:music\/|dreamweaver\/|halo-relations\/?|fan-campaigns\/)[a-zA-Z0-9/?=&_%.-]*$/.test(raw)
    || /^\/halo(?:\/|\.html)?(?:\?[a-zA-Z0-9=&_%.-]*)?$/.test(raw))
    && !raw.includes("//") && !raw.includes("..") && !/(?:token|credential|signature)/i.test(raw)) return raw;
  const safe = publicLink(raw);
  if (!safe || safe.length > 500) throw new CampaignError("Use a safe public destination");
  return safe;
}
export function sanitizeOutput(channelId, value, destinationUrl = "") {
  const channel = channelById(channelId);
  if (!channel || !value || typeof value !== "object" || Array.isArray(value)) throw new CampaignError("Invalid channel output");
  const title = cleanCopy(value.title, channelId === "lobby" ? 80 : 160, true);
  const cta = cleanCopy(value.cta || "Open on HALO", channelId === "lobby" ? 24 : 180, true);
  if (channelId === "lobby" && (title.length < 2 || cta.length < 2)) throw new CampaignError("Room pin title and CTA need at least two characters");
  const safeUrl = safeDestination(destinationUrl);
  const maxBody = channelId === "signal" && safeUrl ? channel.maxBody - safeUrl.length - cta.length - 4 : channel.maxBody;
  return { title, body: cleanCopy(value.body, maxBody, true), cta, destinationUrl: safeUrl };
}
export function connectorConfig(channel, readEnv = env) {
  if (channelById(channel)?.mode !== "connector") return null;
  const key = channel.toUpperCase();
  const raw = readEnv(`HALO_CAMPAIGN_${key}_HOOK`);
  const secret = readEnv(`HALO_CAMPAIGN_${key}_SECRET`);
  const hosts = readEnv("HALO_CAMPAIGN_HOOK_HOSTS").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
      || !publicLink(raw) || !hosts.includes(url.hostname.toLowerCase()) || secret.length < 32) return null;
    return { url: url.href, secret };
  } catch { return null; }
}
export function campaignMetadata(readEnv = env) {
  return {
    types: CAMPAIGN_TYPES, themes: THEMES,
    channels: CHANNELS.map(channel => {
      const configured = channel.mode === "connector" && Boolean(connectorConfig(channel.id, readEnv));
      return {
        ...channel, mode: channel.mode === "connector" && !configured ? "export" : channel.mode,
        available: true, canQueue: channel.mode === "native" || configured, connectorConfigured: configured
      };
    }),
    limits: { bodyBytes: 24576, campaignsPerDay: 20, inboxRecipients: 500, channels: 14, attempts: 5, maxAttempts: 20 },
    approval: "Approve channels independently for the current version. Every revision invalidates all approvals. Queued channel approvals are immutable.",
    delivery: "Export means ready; connector 2xx means accepted; only signed receipts mean delivered. Cancellation cannot recall an in-flight external request."
  };
}
export async function readCampaignBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new CampaignError("Use application/json", 415);
  const max = 24576;
  if (Number(request.headers.get("content-length")) > max) throw new CampaignError("Request too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CampaignError("JSON body required");
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new CampaignError("Request too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new CampaignError("Use a JSON object"); }
}
export const campaignJson = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
});
export function campaignErrorResponse(error) {
  if (error instanceof CampaignError) return campaignJson({ message: error.message }, error.status);
  const messages = [error?.message, error?.cause?.message, error?.cause?.cause?.message].filter(value => typeof value === "string").join("\n");
  if (messages.includes("Campaign API rate limit reached")) return campaignJson({ message: "Campaign API rate limit reached; retry later" }, 429);
  const known = [
    "Version conflict", "Campaign not found", "Current version requires approval",
    "Wait for in-flight work before revising", "Approval is immutable after queueing",
    "Campaign creation limit reached", "Global campaign queue limit reached",
    "Inbox fanout exceeds 500; split the audience operationally", "Room pin overwrite approval required",
    "Revise cancelled campaign before approval", "Explicit rights and public consent required",
    "No retryable failed jobs; revise exhausted campaign", "Selected channel requires approval",
    "Queued channel approval is immutable", "Missing approved output",
    "Review distinct copy for each channel; duplicate variants cannot be approved"
  ].find(message => messages.includes(message));
  if (known) return campaignJson({ message: known }, 409);
  console.error("Campaign operation failed", error?.name || "Error");
  return campaignJson({ message: "Campaign operation unavailable; retry later" }, 503);
}
export async function verifyCampaignOrigin(request, verifyRequestOrigin) {
  let verified = false;
  try { verified = (await verifyRequestOrigin(request)) !== false; } catch {}
  if (!verified) throw new CampaignError("Cross-origin action rejected", 403);
}

export async function resolveCampaignSource(db, membership, source, type) {
  if (!source) {
    if (type !== "halo_update") throw new CampaignError("Select an owned source");
    return null;
  }
  const id = cleanCopy(source.id, 100, true);
  let rows;
  if (source.kind === "song") {
    rows = await db.sql`SELECT id,title,artist_name AS artist FROM halo_song_catalog
      WHERE id = ${campaignId(id)} AND owner_member_id = ${membership.member_id} AND status = 'active' LIMIT 1`;
  } else if (source.kind === "song_lab") {
    if (source.inputApproved !== true) throw new CampaignError("Explicitly approve the Song Lab input package");
    rows = await db.sql`SELECT id,title,artist_name AS artist,creative_package FROM halo_dreamweaver_songs
      WHERE id = ${campaignId(id)} AND member_id = ${membership.member_id}
        AND status = 'ready' AND rights_attested = TRUE LIMIT 1`;
  } else if (source.kind === "release") {
    rows = await db.sql`SELECT id,title,artist FROM halo_release_campaigns
      WHERE id = ${id} AND owner_member_id = ${membership.member_id} LIMIT 1`;
  } else if (source.kind === "mix") {
    rows = await db.sql`SELECT id,title FROM halo_mixes WHERE id = ${id} AND member_id = ${membership.member_id} LIMIT 1`;
  } else if (source.kind === "fan_campaign") {
    rows = await db.sql`SELECT id,title FROM halo_fan_vote_campaigns WHERE id = ${campaignId(id)}
      AND owner_member_id = ${membership.member_id} LIMIT 1`;
  } else throw new CampaignError("Unknown source type");
  if (!rows[0]) throw new CampaignError("Source unavailable or not owned by you", 403);
  if (type === "mix" && source.kind !== "mix") throw new CampaignError("Mix campaigns require an owned mix");
  if (type === "release" && !["song", "song_lab", "release"].includes(source.kind)) throw new CampaignError("Release campaigns require an owned song or release");
  const result = { kind: source.kind, id: rows[0].id, title: rows[0].title, artistName: rows[0].artist || membership.display_name };
  if (source.kind === "song_lab") {
    const supplied = rows[0].creative_package?.campaign || {};
    const approvedPackage = {
      tagline: cleanCopy(typeof supplied.tagline === "string" ? supplied.tagline.slice(0, 160) : "", 160),
      releaseCopy: cleanCopy(typeof supplied.releaseCopy === "string" ? supplied.releaseCopy.slice(0, 1200) : "", 1200)
    };
    const packageFingerprint = createHash("sha256").update(JSON.stringify(approvedPackage)).digest("hex");
    if (source.packageFingerprint && source.packageFingerprint !== packageFingerprint) throw new CampaignError("Source package changed; create a new review draft", 409);
    Object.assign(result, { inputApproved: true, approvedPackage, packageFingerprint });
  }
  return result;
}

const lead = {
  signal: "From the artist", lobby: "In the HALO room", tiktok: "A first moment", instagram: "Inside the artist world",
  youtube: "Watch the doorway", twitter: "The short signal", facebook: "For our community", discord: "Room announcement",
  email: "A note for subscribers", press: "For editorial consideration", radio: "For radio consideration",
  dj: "For selectors", advance: "Advance listening invitation", inbox: "Your HALO update"
};
export async function buildCampaignDraft(input, source, { generate = generateCampaignPackage } = {}) {
  if (!CAMPAIGN_TYPES.includes(input.type)) throw new CampaignError("Choose a campaign type");
  const title = cleanCopy(input.title || source?.title, 160, true);
  const artistName = cleanCopy(source?.artistName || input.artistName || "HALO", 100, true);
  const summary = cleanCopy(input.summary || source?.approvedPackage?.releaseCopy, 1200, true);
  const objective = cleanCopy(input.objective || "Artist-led awareness", 120);
  const audience = cleanCopy(input.audience || "HALO community", 320);
  const destinationUrl = safeDestination(input.destinationUrl || "");
  const theme = themeInput(input.themeId, input);
  const channels = channelsInput(input.channels);
  // The existing structured generator has type-aware grounded fallbacks without mix/YouTube prerequisites.
  const generated = await generate({
    artistName, mixTitle: title, headline: summary.slice(0, 100), template: "invitation",
    goal: input.type === "mix" ? "full_mix_starts" : "awareness", destinationUrl, clipDurationSeconds: 30, theme,
    campaignType: input.type, campaignTitle: title, factsSummary: summary
  });
  const outputs = Object.fromEntries(channels.map(id => {
    const channel = channelById(id);
    const platform = generated.package?.platforms?.[id];
    const opening = `${campaignThemeCopy(theme)} ${lead[id]}: ${title}.`.trim();
    const cta = input.type === "halo_update" ? "Read the update" : "Explore on HALO";
    const maxBody = id === "signal" && destinationUrl ? channel.maxBody - destinationUrl.length - cta.length - 4 : channel.maxBody;
    const body = `${opening} ${platform?.caption || summary}`.slice(0, maxBody);
    return [id, sanitizeOutput(id, {
      title: `${lead[id]} — ${title}`.slice(0, id === "lobby" ? 80 : 160),
      body, cta
    }, destinationUrl)];
  }));
  const now = new Date().toISOString();
  return {
    id: randomUUID(), type: input.type, title, artistName, summary, objective, audience, destinationUrl,
    source, theme, version: 1, status: "draft", outputs, approval: null, exports: {},
    generation: { model: generated.model, usedFallback: generated.usedFallback },
    createdAt: now, updatedAt: now
  };
}
export async function loadCampaign(db, memberId, id) {
  const rows = await db.sql`SELECT aggregate FROM halo_master_campaigns WHERE id = ${id} AND owner_member_id = ${memberId} LIMIT 1`;
  if (!rows[0]) throw new CampaignError("Campaign not found", 404);
  return rows[0].aggregate;
}
export async function campaignJobs(db, memberId, id) {
  const rows = await db.sql`SELECT j.id,j.version,j.channel,j.recipient,j.status,j.attempts,j.max_attempts,j.available_at,
    j.accepted_at,j.delivered_at,j.external_started_at,j.last_error,j.result,j.created_at
    FROM halo_campaign_outbox j JOIN halo_master_campaigns c ON c.id = j.campaign_id
    WHERE c.id = ${id} AND c.owner_member_id = ${memberId} ORDER BY j.created_at,j.id LIMIT 501`;
  return {
    jobs: rows.slice(0, 500).map(row => ({
      id: row.id, version: row.version, channel: row.channel, status: row.status,
      recipientId: row.recipient || "", recipient: row.recipient || "",
      attempts: row.attempts, maxAttempts: row.max_attempts, availableAt: row.available_at,
      acceptedAt: row.accepted_at, deliveredAt: row.delivered_at, externalStartedAt: row.external_started_at,
      lastError: row.last_error || "", result: row.result || {}, createdAt: row.created_at
    })),
    jobsTruncated: rows.length > 500
  };
}
export async function campaignActivity(db, memberId, id) {
  const rows = await db.sql`SELECT a.id,a.sequence,a.version,a.channel,a.job_id,a.kind,a.actor_member_id,a.details,a.created_at
    FROM halo_campaign_activity a JOIN halo_master_campaigns c ON c.id = a.campaign_id
    WHERE c.id = ${id} AND c.owner_member_id = ${memberId} ORDER BY a.sequence DESC LIMIT 201`;
  return {
    activity: rows.slice(0, 200).map(row => ({
      id: row.id, sequence: row.sequence == null ? null : String(row.sequence),
      version: row.version, channel: row.channel, jobId: row.job_id,
      kind: row.kind, actorMemberId: row.actor_member_id, details: row.details || {}, createdAt: row.created_at
    })),
    activityTruncated: rows.length > 200
  };
}
export function createMasterCampaignHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin, generate, readEnv = env }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return campaignJson({ message: "Method not allowed" }, 405);
    try {
      if (request.method === "POST") await verifyCampaignOrigin(request, verifyRequestOrigin);
      const user = await getUser();
      if (!user?.id) throw new CampaignError("Sign in with your Creator Pass", 401);
      if (!isOwner(user)) throw new CampaignError("Owner access required", 403);
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const metadata = campaignMetadata(readEnv);
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.searchParams.has("id")) {
          const id = campaignId(url.searchParams.get("id"));
          let campaign = await loadCampaign(db, membership.member_id, id);
          if (url.searchParams.has("version")) {
            const version = versionInput(Number(url.searchParams.get("version")));
            const rows = await db.sql`SELECT v.snapshot FROM halo_master_campaign_versions v
              JOIN halo_master_campaigns c ON c.id = v.campaign_id WHERE v.campaign_id = ${id}
                AND v.version = ${version} AND c.owner_member_id = ${membership.member_id} LIMIT 1`;
            if (!rows[0]) throw new CampaignError("Campaign version not found", 404);
            campaign = rows[0].snapshot;
          }
          return campaignJson({ metadata, campaign,
            ...await campaignJobs(db, membership.member_id, id),
            ...await campaignActivity(db, membership.member_id, id) });
        }
        const rows = await db.sql`SELECT aggregate FROM halo_master_campaigns
          WHERE owner_member_id = ${membership.member_id} ORDER BY updated_at DESC,id LIMIT 101`;
        return campaignJson({ metadata, campaigns: rows.slice(0, 100).map(row => row.aggregate), hasMore: rows.length > 100 });
      }
      const body = await readCampaignBody(request);
      await db.sql`SELECT halo_campaign_api_rate(${membership.member_id},'management')`;
      if (body.action === "create") {
        const source = await resolveCampaignSource(db, membership, body.source, body.type);
        const draft = await buildCampaignDraft(body, source, { generate });
        const rows = await db.sql`SELECT halo_campaign_create(${membership.member_id},${JSON.stringify(draft)}::jsonb,NULL) AS campaign`;
        return campaignJson({ campaign: rows[0].campaign }, 201);
      }
      if (!["revise", "edit_output", "approve", "queue", "cancel", "export", "retry"].includes(body.action)) throw new CampaignError("Unknown campaign action");
      const id = campaignId(body.id), version = versionInput(body.version);
      const campaign = await loadCampaign(db, membership.member_id, id);
      if (campaign.version !== version) throw new CampaignError("Version conflict; reload the campaign", 409);
      let patch = {};
      if (body.action === "revise") {
        const sourceChanged = body.source !== undefined && (
          body.source == null ? campaign.source != null
            : !campaign.source || body.source.kind !== campaign.source.kind
              || cleanCopy(body.source.id, 100, true) !== campaign.source.id
              || (campaign.source.kind === "song_lab" && body.source.inputApproved !== undefined
                && body.source.inputApproved !== campaign.source.inputApproved)
        );
        if (sourceChanged || (body.type !== undefined && body.type !== campaign.type)) {
          throw new CampaignError("Create a new campaign to change its source or type");
        }
        if (campaign.source) await resolveCampaignSource(db, membership, campaign.source, campaign.type);
        if (body.title !== undefined) patch.title = cleanCopy(body.title, 160, true);
        if (body.summary !== undefined) patch.summary = cleanCopy(body.summary, 1200, true);
        if (body.objective !== undefined) patch.objective = cleanCopy(body.objective, 120);
        if (body.audience !== undefined) patch.audience = cleanCopy(body.audience, 320);
        if (body.destinationUrl !== undefined) patch.destinationUrl = safeDestination(body.destinationUrl);
        if (["themeId","locale","region","activeFrom","activeUntil"].some(key => body[key] !== undefined)) {
          patch.theme = themeInput(body.themeId || campaign.theme.id, { ...campaign.theme, ...body });
        }
        const theme = patch.theme || campaign.theme;
        const revised = await buildCampaignDraft({
          type: campaign.type, title: patch.title || campaign.title, artistName: campaign.artistName,
          summary: patch.summary || campaign.summary, destinationUrl: patch.destinationUrl ?? campaign.destinationUrl,
          objective: patch.objective ?? campaign.objective, audience: patch.audience ?? campaign.audience,
          themeId: theme.id, locale: theme.locale, region: theme.region,
          activeFrom: theme.activeFrom, activeUntil: theme.activeUntil,
          channels: body.channels || Object.keys(campaign.outputs)
        }, campaign.source, { generate });
        patch.outputs = revised.outputs;
        patch.generation = revised.generation;
      } else if (body.action === "edit_output") {
        if (!campaign.outputs[body.channel]) throw new CampaignError("Channel not present in this campaign");
        patch.outputs = { ...campaign.outputs, [body.channel]: sanitizeOutput(body.channel, body.output, campaign.destinationUrl) };
        patch.editedChannel = body.channel;
      } else if (body.action === "approve") {
        if (body.rightsConfirmed !== true || body.publicConsent !== true) throw new CampaignError("Explicit rights and public consent required");
        if (campaign.source) await resolveCampaignSource(db, membership, campaign.source, campaign.type);
        const channels = channelsInput(body.channels || Object.keys(campaign.outputs));
        if (channels.some(channel => !campaign.outputs[channel])) throw new CampaignError("Channel not present in this campaign");
        const reviewed = [...new Set([...(campaign.approval?.version === version ? campaign.approval.channels || [] : []), ...channels])];
        const variants = reviewed.map(channel => campaign.outputs[channel].body.trim().toLowerCase());
        if (new Set(variants).size !== variants.length) throw new CampaignError("Review distinct copy for each channel; duplicate variants cannot be approved");
        patch = { channels, rightsConfirmed: true, publicConsent: true, overwritePin: body.overwritePin === true };
      } else if (body.action === "queue") {
        patch.channels = channelsInput(body.channels);
        patch.recipientIds = recipientIdsInput(body.recipientIds);
        if (patch.recipientIds.length && !patch.channels.includes("inbox")) throw new CampaignError("Recipient subsets apply only to inbox outputs");
        for (const ch of patch.channels) {
          if (channelById(ch).mode === "export") throw new CampaignError(`${ch} requires a human-managed approved export; it cannot be auto-sent`);
          if (channelById(ch).mode === "connector" && !connectorConfig(ch, readEnv)) throw new CampaignError(`${ch} connector is not configured`, 409);
          if (!campaign.outputs[ch]) throw new CampaignError("Approve a persisted channel variant before queueing");
          if (campaign.approval?.version !== version || !campaign.approval.channels?.includes(ch)) {
            throw new CampaignError("Approve this channel for the current version before queueing", 409);
          }
        }
      } else if (body.action === "export") {
        if (campaign.approval?.version !== version || !campaign.approval.channels?.includes(body.channel)
          || campaign.status === "cancelled") throw new CampaignError("Approve this channel for the current version before export", 409);
        if (!campaign.outputs[body.channel]) throw new CampaignError("Unknown output");
        const rows = await db.sql`SELECT halo_campaign_mutate(${membership.member_id},${id}::uuid,${version},'export',
          ${JSON.stringify({ channel: body.channel })}::jsonb) AS campaign`;
        const persisted = rows[0].campaign;
        return campaignJson({ status: "ready", version, channel: body.channel, output: persisted.outputs[body.channel],
          export: persisted.exports[body.channel], campaign: persisted, autoSent: false });
      } else if (body.action === "retry" && body.deliveryId !== undefined) {
        patch.deliveryId = campaignId(body.deliveryId);
      }
      const rows = await db.sql`SELECT halo_campaign_mutate(${membership.member_id},${id}::uuid,${version},${body.action},${JSON.stringify(patch)}::jsonb) AS campaign`;
      return campaignJson({ campaign: rows[0].campaign, ...await campaignJobs(db, membership.member_id, id) });
    } catch (error) { return campaignErrorResponse(error); }
  };
}

export function publicationCampaignFingerprint(song, versions) {
  const facts = {
    owner: song.owner_member_id, source: song.id, title: song.title, artist: song.artist_name,
    genre: song.genre || "", artwork: song.artwork_url || "", rights: song.rights_status,
    versions: versions.filter(version => version.status === "active").map(version => ({
      id: version.id, type: version.version_type, label: version.label || "",
      audio: version.audio_blob_prefix || version.audio_url || "", duration: Number(version.duration_seconds || 0),
      bytes: Number(version.audio_byte_size || 0), chunks: Number(version.audio_chunk_count || 0),
      artwork: version.artwork_blob_prefix || version.artwork_url || "", mastering: version.mastering_status || ""
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
export async function ensurePublishedSongCampaignDraft(db, song, versions, release) {
  const fingerprint = publicationCampaignFingerprint(song, versions);
  const draft = await buildCampaignDraft({
    type: "release", title: song.title, summary: `${song.title} by ${song.artist_name}. Explore the published release on HALO.`,
    destinationUrl: release.publicUrl, themeId: "evergreen"
  }, { kind: "song", id: song.id, title: song.title, artistName: song.artist_name }, {
    // Reconciliation creates an inexpensive review stub; repeated repair never makes a model or publish call.
    generate: async input => ({ package: fallbackPackage(input), model: "grounded-template", usedFallback: true })
  });
  draft.sourceVersionFingerprint = fingerprint;
  const rows = await db.sql`SELECT halo_campaign_create(${song.owner_member_id},${JSON.stringify(draft)}::jsonb,${fingerprint}) AS campaign`;
  return rows[0]?.campaign;
}

export function signCampaignPayload(secret, timestamp, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
export function verifyCampaignSignature(secret, timestamp, body, signature, now = Date.now()) {
  if (!secret || !/^\d{10}$/.test(timestamp || "") || Math.abs(now / 1000 - Number(timestamp)) > 300
    || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signCampaignPayload(secret, timestamp, body), "hex"));
}
export async function runCampaignWorker(db, { fetchImpl = fetch, readEnv = env } = {}) {
  const jobs = await db.sql`SELECT * FROM halo_campaign_claim(3)`;
  const results = [];
  // Three 8-second requests fit a 30-second scheduled function budget.
  for (const job of jobs) {
    try {
      const rows = await db.sql`SELECT m.member_id,m.actor_id,m.display_name,c.aggregate FROM halo_master_campaigns c
        JOIN halo_memberships m ON m.member_id = c.owner_member_id WHERE c.id = ${job.campaign_id} LIMIT 1`;
      const identity = rows[0];
      if (!identity) throw new CampaignError("Campaign identity unavailable");
      let result;
      if (job.channel === "signal") {
        result = await publishSignalPost(db, identity, {
          kind: "TEXT", body: job.payload.destinationUrl
            ? `${job.payload.body}\n\n${job.payload.cta}: ${job.payload.destinationUrl}` : job.payload.body,
          publishPublic: true, visibility: "PUBLIC"
        }, { enforceWriteLimit: true, persist: async validated => {
          const rows = await db.sql`SELECT halo_campaign_deliver(${job.id}::uuid,${job.lease_token}::uuid,${JSON.stringify(validated)}::jsonb) AS result`;
          return rows[0]?.result;
        } });
      } else {
        const rows = await db.sql`SELECT halo_campaign_deliver(${job.id}::uuid,${job.lease_token}::uuid,NULL) AS result`;
        result = rows[0]?.result;
      }
      if (result?.status === "sending") {
        const config = connectorConfig(job.channel, readEnv);
        if (!config) throw new CampaignError("Connector configuration unavailable");
        // No source package, membership, address, CRM note, or private campaign brief crosses the connector boundary.
        const payload = JSON.stringify({
          schemaVersion: 1, jobId: job.id, campaignId: job.campaign_id, version: job.version,
          channel: job.channel, idempotencyKey: job.id, output: job.payload
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const response = await fetchImpl(config.url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
          headers: { "Content-Type": "application/json", "Idempotency-Key": job.id,
            "X-HALO-Timestamp": timestamp, "X-HALO-Signature": signCampaignPayload(config.secret, timestamp, payload) },
          body: payload
        });
        if (response.body) await response.body.cancel().catch(() => {});
        if (!response.ok) throw new CampaignError(`Connector HTTP ${response.status}`);
        await db.sql`SELECT halo_campaign_finish(${job.id}::uuid,${job.lease_token}::uuid,TRUE,'')`;
        result = { status: "accepted" };
      }
      results.push({ id: job.id, status: result?.status || "skipped" });
    } catch (error) {
      // Never persist response bodies or infrastructure errors containing credentials.
      const message = error instanceof CampaignError ? error.message : "Delivery attempt failed";
      await db.sql`SELECT halo_campaign_finish(${job.id}::uuid,${job.lease_token}::uuid,FALSE,${message})`;
      results.push({ id: job.id, status: "retry_or_failed" });
    }
  }
  return { scanned: jobs.length, results };
}

export function createCampaignReceiptHandler({ getDatabase, readEnv = env }) {
  return async request => {
    if (request.method !== "POST") return campaignJson({ message: "Method not allowed" }, 405);
    try {
      const body = await readCampaignBody(request);
      const id = campaignId(body.jobId);
      if (body.status !== "delivered" || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.nonce || "")) throw new CampaignError("Invalid delivery receipt");
      const config = connectorConfig(body.channel, readEnv);
      // Signature is over the canonical JSON of the bounded receipt, not arbitrary response text.
      const canonical = JSON.stringify({ jobId: id, channel: body.channel, status: "delivered", nonce: body.nonce });
      if (!config || !verifyCampaignSignature(config.secret, request.headers.get("x-halo-timestamp"), canonical, request.headers.get("x-halo-signature"))) {
        throw new CampaignError("Invalid receipt signature", 401);
      }
      const db = await getDatabase();
      const rows = await db.sql`SELECT halo_campaign_receipt(${id}::uuid,${body.channel},${body.nonce}) AS verified`;
      if (!rows[0]?.verified) throw new CampaignError("Receipt is replayed or not scoped to an active job", 409);
      return campaignJson({ status: "delivered", jobId: id });
    } catch (error) { return campaignErrorResponse(error); }
  };
}
