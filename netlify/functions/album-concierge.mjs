import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const conceptModel = "gpt-5.4-mini";
const imageModel = "gpt-image-1";
const mediaStore = getStore({ name: "halo-album-concierge", consistency: "strong" });
const VALID_PURPOSES = new Set(["self", "gift", "fans", "project"]);
const VALID_MODES = new Set(["private", "gift", "public"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav"]);
const MAX_VOICE_NOTE_BYTES = 12 * 1024 * 1024;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function originAllowed(request) {
  try {
    return verifyRequestOrigin(request) !== false;
  } catch {
    return false;
  }
}

function cleanList(value, maxItems, maxItemLen) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => cleanText(String(item), maxItemLen)).filter(Boolean);
}

function cleanTrackCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) ? Math.min(12, Math.max(5, count)) : 8;
}

function safeFilename(value, fallback) {
  return cleanText(value, 180).replace(/[^a-zA-Z0-9._ -]/g, "") || fallback;
}

function mediaUrl(row, kind, shared = false) {
  const key = kind === "cover" ? row.cover_blob_key : row.voice_note_blob_key;
  if (!key) return "";
  const identifier = shared
    ? `share=${encodeURIComponent(row.share_token)}`
    : `sessionId=${encodeURIComponent(row.id)}`;
  return `/api/album-concierge?action=media&kind=${kind}&${identifier}`;
}

function serialize(row, { shared = false } = {}) {
  return {
    id: row.id,
    purpose: row.purpose,
    emotion: row.emotion,
    soundDirection: row.sound_direction,
    storyInput: shared ? "" : row.story_input,
    selectedTitle: row.selected_title || "",
    generatedTitles: row.generated_titles || [],
    generatedTheme: row.generated_theme || "",
    generatedWhy: row.generated_why || "",
    generatedStyleReferences: row.generated_style_references || [],
    generatedTracks: row.generated_tracks || [],
    generatedCoverPrompt: row.generated_cover_prompt || "",
    generatedDedication: row.generated_dedication || "",
    finalDedication: row.final_dedication || row.generated_dedication || "",
    genreDirection: row.genre_direction || "",
    trackCount: Number(row.track_count) || 8,
    toneDirection: row.tone_direction || "",
    artworkStyle: row.artwork_style || "",
    booklet: row.booklet_json || {},
    unlockedExtras: row.unlocked_extras || [],
    coverUrl: mediaUrl(row, "cover", shared),
    voiceNoteUrl: mediaUrl(row, "voice", shared),
    voiceNoteFilename: row.voice_note_filename || "",
    shareToken: shared ? "" : String(row.share_token || ""),
    shareUrl: row.mode === "private" ? "" : `/album-concierge/?share=${encodeURIComponent(row.share_token)}`,
    mode: row.mode,
    isPremium: row.premium_status === "active" || Boolean(row.is_premium),
    premiumStatus: row.premium_status || (row.is_premium ? "active" : "free"),
    status: row.status,
    errorMessage: row.error_message || "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function ownerContext(db) {
  const user = await getUser();
  if (!user?.id) return null;
  const membership = await ensureMembership(db, user);
  return { user, actorId: membership.actorId };
}

async function ownerSession(db, sessionId, actorId) {
  const rows = await db.query(
    "SELECT * FROM halo_album_concierge_sessions WHERE id = $1 AND member_id = $2 LIMIT 1",
    [sessionId, actorId]
  );
  return rows[0] || null;
}

async function sharedSession(db, shareToken) {
  const rows = await db.query(
    `SELECT * FROM halo_album_concierge_sessions
     WHERE share_token::text = $1 AND mode IN ('gift', 'public') AND status = 'ready'
     LIMIT 1`,
    [shareToken]
  );
  return rows[0] || null;
}

async function handleGet(request, db) {
  const url = new URL(request.url);
  const shareToken = cleanText(url.searchParams.get("share") || "", 40);
  if (shareToken) {
    const session = await sharedSession(db, shareToken);
    if (!session) return json({ error: "Shared album not found" }, 404);
    return json(serialize(session, { shared: true }));
  }

  const owner = await ownerContext(db);
  if (!owner) return json({ error: "Unauthorized" }, 401);
  const sessionId = cleanText(url.searchParams.get("sessionId") || "", 40);
  if (sessionId) {
    const session = await ownerSession(db, sessionId, owner.actorId);
    if (!session) return json({ error: "Not found" }, 404);
    return json(serialize(session));
  }

  const rows = await db.query(
    "SELECT * FROM halo_album_concierge_sessions WHERE member_id = $1 ORDER BY updated_at DESC LIMIT 40",
    [owner.actorId]
  );
  return json({ sessions: rows.map(row => serialize(row)) });
}

async function handleCreate(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const purpose = cleanText(body.purpose, 64);
  if (!VALID_PURPOSES.has(purpose)) return json({ error: "Invalid purpose" }, 400);
  const emotion = cleanText(body.emotion, 256);
  const soundDirection = cleanText(body.soundDirection, 128);
  const storyInput = cleanText(body.storyInput, 4000);
  if (!emotion || !soundDirection || storyInput.length < 20) return json({ error: "Complete the album direction and story" }, 400);

  const rows = await db.query(
    `INSERT INTO halo_album_concierge_sessions
       (member_id, purpose, emotion, sound_direction, story_input, genre_direction,
        track_count, tone_direction, artwork_style, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
     RETURNING *`,
    [
      actorId,
      purpose,
      emotion,
      soundDirection,
      storyInput,
      cleanText(body.genreDirection, 160),
      cleanTrackCount(body.trackCount),
      cleanText(body.toneDirection, 160),
      cleanText(body.artworkStyle, 160)
    ]
  );
  return json(serialize(rows[0]), 201);
}

function conceptPrompt(session, refinement) {
  const priorConcept = session.generated_tracks?.length
    ? `\nCurrent concept to improve:\nTitles: ${JSON.stringify(session.generated_titles)}\nTheme: ${session.generated_theme}\nTracks: ${JSON.stringify(session.generated_tracks)}\nDedication: ${session.final_dedication || session.generated_dedication}`
    : "";
  const refinementInstruction = refinement ? `\nRequested refinement: ${refinement}` : "";
  return `Create a premium album concept for the following:
Purpose: ${session.purpose}
Emotional direction: ${session.emotion}
Sound direction: ${session.sound_direction}
Genre direction: ${session.genre_direction || "Concierge choice"}
Tone refinement: ${session.tone_direction || "Stay true to the story"}
Artwork style: ${session.artwork_style || "Concierge choice"}
Track count: ${cleanTrackCount(session.track_count)}
Story: ${session.story_input}${priorConcept}${refinementInstruction}

Respond with ONLY valid JSON in this exact shape:
{
  "titles": ["<title 1>", "<title 2>", "<title 3>"],
  "theme": "<2–3 sentence album theme statement>",
  "whyItMatters": "<2–3 sentences explaining the emotional meaning and keepsake value>",
  "styleReferences": ["<original sonic or visual descriptor>", "<descriptor>", "<descriptor>"],
  "tracks": [{"position": 1, "title": "<track title>", "moodNote": "<1-sentence story or mood note>"}],
  "coverPrompt": "<visual art direction for a square album cover: style, palette, imagery, typography, no real people>",
  "dedication": "<personal dedication or liner note message, 2–4 sentences>",
  "unlock": "<a subtle hidden-note or bonus-track message tied to the story>"
}

Include exactly ${cleanTrackCount(session.track_count)} tracks. Keep every idea original, emotionally grounded, specific, and premium.`;
}

async function handleGenerate(request, db, actorId, isRefinement = false) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sessionId = cleanText(body.sessionId, 40);
  if (!sessionId) return json({ error: "sessionId required" }, 400);
  let session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);
  if (session.status === "generating") return json({ error: "Already generating" }, 409);

  const refinement = cleanText(body.refinement, 1000);
  const genreDirection = cleanText(body.genreDirection, 160) || session.genre_direction || "";
  const trackCount = cleanTrackCount(body.trackCount ?? session.track_count);
  const toneDirection = cleanText(body.toneDirection, 160) || session.tone_direction || "";
  const artworkStyle = cleanText(body.artworkStyle, 160) || session.artwork_style || "";
  const finalDedication = cleanText(body.finalDedication, 600) || session.final_dedication || "";

  const updatedRows = await db.query(
    `UPDATE halo_album_concierge_sessions
     SET status = 'generating', genre_direction = $1, track_count = $2, tone_direction = $3,
         artwork_style = $4, final_dedication = $5, last_refinement = $6,
         cover_blob_key = CASE WHEN $7 THEN '' ELSE cover_blob_key END,
         cover_content_type = CASE WHEN $7 THEN '' ELSE cover_content_type END,
         updated_at = NOW()
     WHERE id = $8 AND member_id = $9
     RETURNING *`,
    [genreDirection, trackCount, toneDirection, artworkStyle, finalDedication, refinement, isRefinement, sessionId, actorId]
  );
  session = updatedRows[0];

  const openai = new OpenAI();
  const systemPrompt = `You are a premium album concierge creative director for HALO World.
Turn a personal story, mood, or memory into a bespoke, giftable album concept.
Always return valid JSON matching the requested schema.
Never imitate living artists, invent credits, or reproduce copyrighted lyrics.
Use descriptive genre, era, instrumentation, production, and visual language instead of artist names.`;

  let generated;
  try {
    const completion = await openai.chat.completions.create({
      model: conceptModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conceptPrompt(session, refinement) }
      ],
      temperature: 0.85,
      max_tokens: 2400
    });
    const raw = completion.choices[0]?.message?.content || "{}";
    generated = JSON.parse(raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""));
  } catch (error) {
    await db.query(
      "UPDATE halo_album_concierge_sessions SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
      [String(error.message).slice(0, 500), sessionId]
    );
    return json({ error: "Generation failed" }, 502);
  }

  const titles = cleanList(generated.titles, 3, 120);
  const theme = cleanText(generated.theme, 1000);
  const whyItMatters = cleanText(generated.whyItMatters, 1000);
  const styleReferences = cleanList(generated.styleReferences, 6, 160);
  const tracks = Array.isArray(generated.tracks)
    ? generated.tracks.slice(0, trackCount).map((track, index) => ({
        position: index + 1,
        title: cleanText(String(track.title || ""), 120),
        moodNote: cleanText(String(track.moodNote || ""), 300)
      })).filter(track => track.title)
    : [];
  const coverPrompt = cleanText(generated.coverPrompt, 800);
  const generatedDedication = cleanText(generated.dedication, 600);
  const dedication = finalDedication || generatedDedication;
  const unlock = cleanText(generated.unlock, 400);
  const selectedTitle = titles.includes(session.selected_title) ? session.selected_title : (titles[0] || "Untitled Album");
  const booklet = {
    title: selectedTitle,
    theme,
    whyItMatters,
    dedication,
    styleReferences,
    tracks,
    createdFor: session.purpose
  };
  const extras = unlock ? [{ type: "hidden_note", label: "Hidden sleeve note", content: unlock }] : [];

  const result = await db.query(
    `UPDATE halo_album_concierge_sessions
     SET status = 'ready', generated_titles = $1, selected_title = $2, generated_theme = $3,
         generated_why = $4, generated_style_references = $5, generated_tracks = $6,
         generated_cover_prompt = $7, generated_dedication = $8, final_dedication = $9,
         booklet_json = $10, unlocked_extras = $11, model = $12, error_message = '', updated_at = NOW()
     WHERE id = $13 AND member_id = $14
     RETURNING *`,
    [
      JSON.stringify(titles), selectedTitle, theme, whyItMatters, JSON.stringify(styleReferences),
      JSON.stringify(tracks), coverPrompt, generatedDedication, dedication,
      JSON.stringify(booklet), JSON.stringify(extras), conceptModel, sessionId, actorId
    ]
  );
  return json(serialize(result[0]));
}

async function handleSave(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const sessionId = cleanText(body.sessionId, 40);
  if (!sessionId) return json({ error: "sessionId required" }, 400);
  const session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);

  const mode = VALID_MODES.has(body.mode) ? body.mode : session.mode;
  const selectedTitle = cleanText(body.selectedTitle, 120) || session.selected_title || session.generated_titles?.[0] || "";
  const finalDedication = cleanText(body.finalDedication, 600) || session.final_dedication || session.generated_dedication || "";
  const booklet = {
    ...(session.booklet_json || {}),
    title: selectedTitle,
    dedication: finalDedication
  };
  const rows = await db.query(
    `UPDATE halo_album_concierge_sessions
     SET mode = $1, selected_title = $2, final_dedication = $3, booklet_json = $4,
         published_at = CASE WHEN $1 IN ('gift', 'public') THEN COALESCE(published_at, NOW()) ELSE published_at END,
         updated_at = NOW()
     WHERE id = $5 AND member_id = $6
     RETURNING *`,
    [mode, selectedTitle, finalDedication, JSON.stringify(booklet), sessionId, actorId]
  );
  return json(serialize(rows[0]));
}

async function handleCover(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const sessionId = cleanText(body.sessionId, 40);
  const session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);
  if (session.premium_status !== "active" && !session.is_premium) return json({ error: "Collector Edition required" }, 402);
  if (session.status !== "ready") return json({ error: "Generate the album concept first" }, 409);

  try {
    const openai = new OpenAI();
    const result = await openai.images.generate({
      model: imageModel,
      prompt: `Create a premium square album cover for an original project titled "${session.selected_title || session.generated_titles?.[0] || "Untitled Album"}". ${session.generated_cover_prompt}. ${session.artwork_style ? `Art direction: ${session.artwork_style}.` : ""} Do not include photographs of identifiable real people, logos, signatures, or copyrighted characters. Keep any typography minimal and legible.`,
      size: "1024x1024"
    });
    const imageBase64 = result.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("No image returned");
    const blobKey = `covers/${actorId}/${sessionId}/${randomUUID()}.png`;
    await mediaStore.set(blobKey, Buffer.from(imageBase64, "base64"));
    const rows = await db.query(
      `UPDATE halo_album_concierge_sessions
       SET cover_blob_key = $1, cover_content_type = 'image/png', updated_at = NOW()
       WHERE id = $2 AND member_id = $3 RETURNING *`,
      [blobKey, sessionId, actorId]
    );
    return json(serialize(rows[0]));
  } catch (error) {
    console.error("Album Concierge cover generation failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Custom artwork could not be generated right now" }, 502);
  }
}

async function handleVoiceNote(request, db, actorId) {
  const form = await request.formData();
  const sessionId = cleanText(form.get("sessionId"), 40);
  const session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);
  if (session.premium_status !== "active" && !session.is_premium) return json({ error: "Collector Edition required" }, 402);

  const file = form.get("voiceNote");
  if (!(file instanceof File) || !file.size) return json({ error: "Choose a voice note" }, 400);
  if (file.size > MAX_VOICE_NOTE_BYTES) return json({ error: "Voice notes are limited to 12 MB" }, 413);
  if (!AUDIO_TYPES.has(file.type)) return json({ error: "Upload an MP3, M4A, WAV, OGG, or WebM audio file" }, 415);

  const blobKey = `voice-notes/${actorId}/${sessionId}/${randomUUID()}`;
  await mediaStore.set(blobKey, file);
  const rows = await db.query(
    `UPDATE halo_album_concierge_sessions
     SET voice_note_blob_key = $1, voice_note_content_type = $2, voice_note_filename = $3, updated_at = NOW()
     WHERE id = $4 AND member_id = $5 RETURNING *`,
    [blobKey, file.type, safeFilename(file.name, "album-voice-note"), sessionId, actorId]
  );
  return json(serialize(rows[0]));
}

async function handleMedia(request, db) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "voice" ? "voice" : "cover";
  const shareToken = cleanText(url.searchParams.get("share") || "", 40);
  let session = shareToken ? await sharedSession(db, shareToken) : null;

  if (!session) {
    const owner = await ownerContext(db);
    if (!owner) return json({ error: "Unauthorized" }, 401);
    const sessionId = cleanText(url.searchParams.get("sessionId") || "", 40);
    session = await ownerSession(db, sessionId, owner.actorId);
  }
  if (!session) return json({ error: "Media not found" }, 404);

  const blobKey = kind === "voice" ? session.voice_note_blob_key : session.cover_blob_key;
  if (!blobKey) return json({ error: "Media not found" }, 404);
  const blob = await mediaStore.get(blobKey, { type: "blob" });
  if (!blob) return json({ error: "Media not found" }, 404);
  const contentType = kind === "voice" ? session.voice_note_content_type : session.cover_content_type;
  const filename = kind === "voice" ? safeFilename(session.voice_note_filename, "voice-note") : "album-cover.png";
  return new Response(blob, {
    headers: {
      "Cache-Control": shareToken ? "public, max-age=3600" : "private, no-store",
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`
    }
  });
}

function validCheckoutAmount() {
  const amount = Number.parseInt(process.env.STRIPE_ALBUM_CONCIERGE_PRICE_MINOR || "", 10);
  return Number.isFinite(amount) && amount >= 100 ? amount : 0;
}

async function stripeRequest(path, options = {}) {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey) throw new Error("Stripe is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(cleanText(data?.error?.message || "Stripe request failed", 300));
  return data;
}

async function handleCheckout(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const sessionId = cleanText(body.sessionId, 40);
  const session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);
  if (session.premium_status === "active" || session.is_premium) return json({ alreadyPremium: true });
  const amount = validCheckoutAmount();
  if (!amount) return json({ error: "Collector Edition checkout is not configured" }, 503);

  try {
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams({
      mode: "payment",
      client_reference_id: session.id,
      success_url: `${origin}/album-concierge/?session=${encodeURIComponent(session.id)}&checkout={CHECKOUT_SESSION_ID}#collector`,
      cancel_url: `${origin}/album-concierge/?session=${encodeURIComponent(session.id)}&payment=cancelled#collector`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": String(process.env.STRIPE_ALBUM_CONCIERGE_CURRENCY || "USD").toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": `${session.selected_title || "Album Concierge"} — Collector Edition`,
      "line_items[0][price_data][product_data][description]": "Custom artwork, story booklet, private media, and collector keepsake tools",
      "metadata[album_session_id]": session.id,
      "metadata[member_id]": actorId
    });
    const checkout = await stripeRequest("checkout/sessions", { method: "POST", body: params });
    const checkoutUrl = new URL(checkout.url);
    if (checkoutUrl.protocol !== "https:") throw new Error("Invalid checkout URL");
    await db.query(
      `UPDATE halo_album_concierge_sessions
       SET premium_status = 'pending', premium_checkout_id = $1, updated_at = NOW()
       WHERE id = $2 AND member_id = $3`,
      [cleanText(checkout.id, 200), sessionId, actorId]
    );
    return json({ checkoutUrl: checkoutUrl.href, priceMinor: amount, currency: String(process.env.STRIPE_ALBUM_CONCIERGE_CURRENCY || "USD").toUpperCase() });
  } catch (error) {
    console.error("Album Concierge checkout failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Secure checkout could not be opened right now" }, 503);
  }
}

async function handleVerifyCheckout(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const sessionId = cleanText(body.sessionId, 40);
  const checkoutSessionId = cleanText(body.checkoutSessionId, 200);
  const session = await ownerSession(db, sessionId, actorId);
  if (!session) return json({ error: "Not found" }, 404);
  if (session.premium_status === "active" || session.is_premium) return json(serialize(session));
  if (!checkoutSessionId || checkoutSessionId !== session.premium_checkout_id) return json({ error: "Checkout session mismatch" }, 400);

  try {
    const checkout = await stripeRequest(`checkout/sessions/${encodeURIComponent(checkoutSessionId)}`);
    const valid = checkout.payment_status === "paid"
      && checkout.metadata?.album_session_id === sessionId
      && checkout.metadata?.member_id === actorId;
    if (!valid) return json({ error: "Payment has not been confirmed" }, 409);
    const rows = await db.query(
      `UPDATE halo_album_concierge_sessions
       SET premium_status = 'active', is_premium = TRUE, updated_at = NOW()
       WHERE id = $1 AND member_id = $2 RETURNING *`,
      [sessionId, actorId]
    );
    return json(serialize(rows[0]));
  } catch (error) {
    console.error("Album Concierge payment verification failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Payment confirmation is unavailable right now" }, 503);
  }
}

export default async function handler(request) {
  const db = getDatabase();
  const url = new URL(request.url);
  const action = cleanText(url.searchParams.get("action") || "", 32);

  if (request.method === "GET" && action === "media") return handleMedia(request, db);
  if (request.method === "GET") return handleGet(request, db);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403);

  const owner = await ownerContext(db);
  if (!owner) return json({ error: "Unauthorized" }, 401);

  if (action === "generate") return handleGenerate(request, db, owner.actorId, false);
  if (action === "refine") return handleGenerate(request, db, owner.actorId, true);
  if (action === "save") return handleSave(request, db, owner.actorId);
  if (action === "cover") return handleCover(request, db, owner.actorId);
  if (action === "voice-note") return handleVoiceNote(request, db, owner.actorId);
  if (action === "checkout") return handleCheckout(request, db, owner.actorId);
  if (action === "verify-checkout") return handleVerifyCheckout(request, db, owner.actorId);
  return handleCreate(request, db, owner.actorId);
}

export const config = { path: "/api/album-concierge" };
