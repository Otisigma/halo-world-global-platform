import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";

const careerStages = new Set(["first_master", "first_audience", "repeatable_releases", "professional_opportunities", "sustainable_catalogue"]);
const paymentModels = new Set(["undecided", "artist_seller", "halo_merchant"]);
const paymentStatuses = new Set(["not_connected", "preparing", "restricted", "ready"]);
const workTypes = new Set(["recording", "composition"]);
const rightsStatuses = new Set(["incomplete", "review", "cleared", "hold", "disputed"]);
const publisherStatuses = new Set(["unknown", "self_published", "administered", "publisher_controlled"]);
const participantRoles = new Set(["master_owner", "songwriter", "publisher", "producer", "featured_artist", "performer", "manager", "other"]);
const collectionStatuses = new Set(["unconfirmed", "registered", "collecting", "hold"]);
const incomeSources = new Set(["distribution", "publishing", "neighbouring_rights", "direct_sale", "membership", "licensing", "live", "merchandise", "service", "grant", "other"]);
const incomeStatuses = new Set(["expected", "received", "overdue", "disputed", "reconciled"]);
const campaignStages = new Set(["readiness", "test", "scale", "closed"]);
const campaignObjectives = new Set(["completed_listen", "retained_fan", "direct_sale", "event_registration", "licensing_lead", "other"]);
const campaignDecisions = new Set(["prepare", "test", "scale", "stop", "complete"]);
const mediaTypes = new Set(["film", "television", "advertising", "game", "trailer", "creator", "documentary", "other"]);
const licensingStages = new Set(["brief", "matched", "artist_approval", "pitched", "negotiating", "contracted", "delivered", "paid", "declined"]);
const rightsChecks = new Set(["required", "reviewing", "clear", "hold"]);
const settlementStatuses = new Set(["planning", "confirmed", "performed", "settling", "paid", "cancelled"]);
const proposalTypes = new Set(["product", "fee", "algorithm", "partnership", "campaign", "licensing", "policy", "other"]);
const ownershipEffects = new Set(["strengthens", "neutral", "weakens"]);
const incomeEffects = new Set(["improves", "neutral", "unknown", "harms"]);
const reversibilityValues = new Set(["reversible", "difficult", "irreversible"]);
const reviewDecisions = new Set(["review", "approve", "revise", "reject"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanText(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanMultiline(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function cleanSlug(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-|-$/g, "").slice(0, 80)
    : "";
}

function cleanCurrency(value, fallback = "GBP") {
  const currency = cleanText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

function integer(value, minimum = 0, maximum = 100000000000) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function decimal(value, minimum = 0, maximum = 10000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function enumValue(value, allowed, fallback) {
  const normalized = cleanText(value, 80).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

function cleanTimestamp(value) {
  const input = cleanText(value, 40);
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function cleanIdentifier(value) {
  const id = cleanText(value, 36).toLowerCase();
  return /^[0-9a-f-]{36}$/.test(id) ? id : "";
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function cleanRestrictions(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 20);
}

async function bodyFrom(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 48_000) throw new Error("payload_too_large");
  return request.json();
}

async function authorize(db, user, slug) {
  if (!user?.id) return { status: 401, message: "Sign in to open the Artist Economy" };
  const pageRows = await db.sql`
    SELECT slug, artist_name, owner_member_id, status
    FROM halo_artist_pages
    WHERE slug = ${slug}
    LIMIT 1
  `;
  if (!pageRows.length) return { status: 404, message: "Artist room not found" };
  const membership = await ensureMembership(db, user);
  const platformOwner = isOwner(user);
  if (!platformOwner && pageRows[0].owner_member_id !== membership.member_id) {
    return { status: 403, message: "This Artist Economy belongs to another artist room" };
  }
  return {
    memberId: membership.member_id,
    ownerMemberId: pageRows[0].owner_member_id || membership.member_id,
    platformOwner,
    page: pageRows[0]
  };
}

async function ensureProfile(db, slug, ownerMemberId) {
  await db.sql`
    INSERT INTO halo_artist_economy_profiles (artist_slug, owner_member_id)
    VALUES (${slug}, ${ownerMemberId})
    ON CONFLICT (artist_slug) DO NOTHING
  `;
}

function mapParticipant(row) {
  return {
    id: Number(row.id),
    workId: row.work_id,
    name: row.participant_name,
    role: row.role,
    shareBps: Number(row.share_bps),
    collectionStatus: row.collection_status,
    societyName: row.society_name,
    identifier: row.identifier
  };
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function dateOnly(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10);
}

function buildSummary(profile, works, incomes, campaigns, licensing, live) {
  const received = incomes.filter(item => item.status === "received" || item.status === "reconciled");
  const currentMonth = new Date().toISOString().slice(0, 7);
  const receivedGrossMinor = received.reduce((sum, item) => sum + item.grossMinor, 0);
  const feesMinor = received.reduce((sum, item) => sum + item.feesMinor, 0);
  const taxReserveMinor = received.reduce((sum, item) => sum + item.taxReserveMinor, 0);
  const obligationsMinor = received.reduce((sum, item) => sum + item.obligationsMinor, 0);
  const availableMinor = Math.max(0, receivedGrossMinor - feesMinor - taxReserveMinor - obligationsMinor);
  const monthlyNetMinor = received
    .filter(item => item.occurredOn?.slice(0, 7) === currentMonth)
    .reduce((sum, item) => sum + Math.max(0, item.grossMinor - item.feesMinor - item.taxReserveMinor - item.obligationsMinor), 0);
  const liveProfitMinor = live.reduce((sum, item) => sum + Math.max(0, item.guaranteedFeeMinor + item.ticketShareMinor + item.merchandiseMinor - item.costsMinor), 0);
  const licensingPipelineMinor = licensing
    .filter(item => !["paid", "declined"].includes(item.stage))
    .reduce((sum, item) => sum + item.quotedFeeMinor, 0);
  const campaignSpendMinor = campaigns.reduce((sum, item) => sum + item.spentMinor, 0);
  const meaningfulActions = campaigns.reduce((sum, item) => sum + item.meaningfulActions, 0);
  const gaps = [];
  if (!works.length) gaps.push("Add the first recording or composition to the Rights Passport.");
  if (works.some(work => work.rightsStatus !== "cleared")) gaps.push("Resolve rights records that are not cleared before commercial pitching.");
  if (works.some(work => !work.participants.length)) gaps.push("Record writers, owners, producers, and performer shares.");
  if (!incomes.length) gaps.push("Record the first expected or received income statement.");
  if (profile.paymentStatus !== "ready") gaps.push("Choose and verify the direct-payment operating model before taking fan money.");
  if (!licensing.length) gaps.push("Prepare at least one controlled licensing opportunity or catalogue target.");
  if (!live.length) gaps.push("Add the next show or performance opportunity and its real costs.");

  return {
    currency: profile.currency,
    receivedGrossMinor,
    feesMinor,
    taxReserveMinor,
    obligationsMinor,
    availableMinor,
    monthlyNetMinor,
    monthlyTargetMinor: profile.monthlyIncomeTargetMinor,
    targetProgress: profile.monthlyIncomeTargetMinor > 0 ? Math.min(1, monthlyNetMinor / profile.monthlyIncomeTargetMinor) : 0,
    artistPayMinor: Math.floor(availableMinor * profile.artistPayBps / 10000),
    nextMusicMinor: Math.floor(availableMinor * profile.nextMusicBps / 10000),
    audienceMinor: Math.floor(availableMinor * profile.audienceBps / 10000),
    businessReserveMinor: Math.floor(availableMinor * profile.businessReserveBps / 10000),
    experimentMinor: Math.floor(availableMinor * profile.experimentBps / 10000),
    expectedMinor: incomes.filter(item => item.status === "expected").reduce((sum, item) => sum + item.grossMinor, 0),
    clearedWorks: works.filter(work => work.rightsStatus === "cleared").length,
    totalWorks: works.length,
    licensingPipelineMinor,
    liveProfitMinor,
    campaignSpendMinor,
    meaningfulActions,
    costPerMeaningfulActionMinor: meaningfulActions > 0 ? Math.round(campaignSpendMinor / meaningfulActions) : 0,
    gaps: gaps.slice(0, 6)
  };
}

async function loadDashboard(db, slug, access) {
  const [profileRows, workRows, participantRows, incomeRows, campaignRows, licensingRows, liveRows, reviewRows] = await Promise.all([
    db.sql`SELECT * FROM halo_artist_economy_profiles WHERE artist_slug = ${slug} LIMIT 1`,
    db.sql`SELECT * FROM halo_artist_rights_works WHERE artist_slug = ${slug} ORDER BY updated_at DESC LIMIT 100`,
    db.sql`
      SELECT participant.*
      FROM halo_artist_rights_participants participant
      INNER JOIN halo_artist_rights_works work ON work.id = participant.work_id
      WHERE work.artist_slug = ${slug}
      ORDER BY participant.id
      LIMIT 500
    `,
    db.sql`SELECT * FROM halo_artist_income_entries WHERE artist_slug = ${slug} ORDER BY occurred_on DESC, created_at DESC LIMIT 200`,
    db.sql`SELECT * FROM halo_artist_campaign_investments WHERE artist_slug = ${slug} ORDER BY updated_at DESC LIMIT 100`,
    db.sql`SELECT * FROM halo_artist_licensing_opportunities WHERE artist_slug = ${slug} ORDER BY updated_at DESC LIMIT 100`,
    db.sql`SELECT * FROM halo_artist_live_engagements WHERE artist_slug = ${slug} ORDER BY performance_at DESC NULLS LAST, updated_at DESC LIMIT 100`,
    access.platformOwner
      ? db.sql`SELECT * FROM halo_artist_conscience_reviews WHERE artist_slug = ${slug} OR artist_slug IS NULL ORDER BY updated_at DESC LIMIT 100`
      : Promise.resolve([])
  ]);

  const row = profileRows[0];
  const profile = {
    artistSlug: row.artist_slug,
    currency: row.currency,
    careerStage: row.career_stage,
    monthlyIncomeTargetMinor: Number(row.monthly_income_target_minor),
    artistPayBps: Number(row.artist_pay_bps),
    nextMusicBps: Number(row.next_music_bps),
    audienceBps: Number(row.audience_bps),
    businessReserveBps: Number(row.business_reserve_bps),
    experimentBps: Number(row.experiment_bps),
    paymentModel: row.payment_model,
    paymentStatus: row.payment_status,
    missionNote: row.mission_note,
    updatedAt: iso(row.updated_at)
  };
  const participantsByWork = new Map();
  for (const participantRow of participantRows) {
    const participant = mapParticipant(participantRow);
    if (!participantsByWork.has(participant.workId)) participantsByWork.set(participant.workId, []);
    participantsByWork.get(participant.workId).push(participant);
  }
  const works = workRows.map(item => ({
    id: item.id,
    title: item.title,
    workType: item.work_type,
    linkedReleaseId: item.linked_release_id,
    isrc: item.isrc,
    iswc: item.iswc,
    upc: item.upc,
    rightsStatus: item.rights_status,
    oneStop: item.one_stop,
    masterOwner: item.master_owner,
    publisherStatus: item.publisher_status,
    restrictions: item.restrictions || [],
    evidence: item.evidence || {},
    notes: item.notes,
    updatedAt: iso(item.updated_at),
    participants: participantsByWork.get(item.id) || []
  }));
  const incomes = incomeRows.map(item => ({
    id: item.id,
    workId: item.work_id,
    sourceType: item.source_type,
    description: item.description,
    currency: item.currency,
    grossMinor: Number(item.gross_minor),
    feesMinor: Number(item.fees_minor),
    taxReserveMinor: Number(item.tax_reserve_minor),
    obligationsMinor: Number(item.obligations_minor),
    occurredOn: dateOnly(item.occurred_on),
    status: item.status,
    externalReference: item.external_reference,
    notes: item.notes,
    updatedAt: iso(item.updated_at)
  }));
  const campaigns = campaignRows.map(item => ({
    id: item.id,
    title: item.title,
    stage: item.stage,
    objective: item.objective,
    currency: item.currency,
    budgetMinor: Number(item.budget_minor),
    spentMinor: Number(item.spent_minor),
    meaningfulActions: Number(item.meaningful_actions),
    stopLossMinor: Number(item.stop_loss_minor),
    decision: item.decision,
    learning: item.learning,
    updatedAt: iso(item.updated_at)
  }));
  const licensing = licensingRows.map(item => ({
    id: item.id,
    workId: item.work_id,
    opportunityName: item.opportunity_name,
    buyerName: item.buyer_name,
    mediaType: item.media_type,
    territory: item.territory,
    currency: item.currency,
    quotedFeeMinor: Number(item.quoted_fee_minor),
    commissionBps: Number(item.commission_bps),
    stage: item.stage,
    rightsCheck: item.rights_check,
    decisionDueAt: iso(item.decision_due_at),
    restrictions: item.restrictions,
    notes: item.notes,
    updatedAt: iso(item.updated_at)
  }));
  const live = liveRows.map(item => ({
    id: item.id,
    title: item.title,
    venueName: item.venue_name,
    city: item.city,
    performanceAt: iso(item.performance_at),
    currency: item.currency,
    guaranteedFeeMinor: Number(item.guaranteed_fee_minor),
    ticketShareMinor: Number(item.ticket_share_minor),
    merchandiseMinor: Number(item.merchandise_minor),
    costsMinor: Number(item.costs_minor),
    ticketsSold: Number(item.tickets_sold),
    fansCaptured: Number(item.fans_captured),
    settlementStatus: item.settlement_status,
    setlistReported: item.setlist_reported,
    notes: item.notes,
    updatedAt: iso(item.updated_at)
  }));
  const conscience = reviewRows.map(item => ({
    id: item.id,
    artistSlug: item.artist_slug,
    proposalType: item.proposal_type,
    title: item.title,
    artistBenefit: item.artist_benefit,
    artistRisk: item.artist_risk,
    ownershipEffect: item.ownership_effect,
    incomeEffect: item.income_effect,
    reversibility: item.reversibility,
    decision: item.decision,
    evidence: item.evidence || {},
    conditions: item.conditions,
    updatedAt: iso(item.updated_at)
  }));

  return {
    artist: { slug, name: access.page.artist_name, status: access.page.status },
    viewer: { platformOwner: access.platformOwner },
    profile,
    summary: buildSummary(profile, works, incomes, campaigns, licensing, live),
    works,
    incomes,
    campaigns,
    licensing,
    live,
    conscience
  };
}

async function saveProfile(db, slug, ownerMemberId, body) {
  const currency = cleanCurrency(body.currency);
  const careerStage = enumValue(body.careerStage, careerStages, "first_master");
  const monthlyTarget = integer(body.monthlyIncomeTargetMinor);
  const artistPay = integer(body.artistPayBps, 0, 10000);
  const nextMusic = integer(body.nextMusicBps, 0, 10000);
  const audience = integer(body.audienceBps, 0, 10000);
  const reserve = integer(body.businessReserveBps, 0, 10000);
  const experiment = integer(body.experimentBps, 0, 10000);
  if (artistPay + nextMusic + audience + reserve + experiment !== 10000) return false;
  await db.sql`
    INSERT INTO halo_artist_economy_profiles (
      artist_slug, owner_member_id, currency, career_stage, monthly_income_target_minor,
      artist_pay_bps, next_music_bps, audience_bps, business_reserve_bps, experiment_bps,
      payment_model, payment_status, mission_note, updated_at
    ) VALUES (
      ${slug}, ${ownerMemberId}, ${currency}, ${careerStage}, ${monthlyTarget},
      ${artistPay}, ${nextMusic}, ${audience}, ${reserve}, ${experiment},
      ${enumValue(body.paymentModel, paymentModels, "undecided")},
      ${enumValue(body.paymentStatus, paymentStatuses, "not_connected")},
      ${cleanMultiline(body.missionNote, 2000)}, NOW()
    )
    ON CONFLICT (artist_slug) DO UPDATE SET
      currency = EXCLUDED.currency,
      career_stage = EXCLUDED.career_stage,
      monthly_income_target_minor = EXCLUDED.monthly_income_target_minor,
      artist_pay_bps = EXCLUDED.artist_pay_bps,
      next_music_bps = EXCLUDED.next_music_bps,
      audience_bps = EXCLUDED.audience_bps,
      business_reserve_bps = EXCLUDED.business_reserve_bps,
      experiment_bps = EXCLUDED.experiment_bps,
      payment_model = EXCLUDED.payment_model,
      payment_status = EXCLUDED.payment_status,
      mission_note = EXCLUDED.mission_note,
      updated_at = NOW()
  `;
  return true;
}

async function createWork(db, slug, ownerMemberId, body) {
  const title = cleanText(body.title, 180);
  if (!title) return false;
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_rights_works (
      id, artist_slug, owner_member_id, title, work_type, isrc, iswc, upc,
      rights_status, one_stop, master_owner, publisher_status, restrictions, notes
    ) VALUES (
      ${id}, ${slug}, ${ownerMemberId}, ${title}, ${enumValue(body.workType, workTypes, "recording")},
      ${cleanText(body.isrc, 15).toUpperCase()}, ${cleanText(body.iswc, 20).toUpperCase()}, ${cleanText(body.upc, 20)},
      ${enumValue(body.rightsStatus, rightsStatuses, "incomplete")}, ${bool(body.oneStop)},
      ${cleanText(body.masterOwner, 180)}, ${enumValue(body.publisherStatus, publisherStatuses, "unknown")},
      ${cleanRestrictions(body.restrictions)}::text[], ${cleanMultiline(body.notes, 4000)}
    )
  `;
  return id;
}

async function addParticipant(db, slug, body) {
  const workId = cleanIdentifier(body.workId);
  const name = cleanText(body.name, 180);
  if (!workId || !name) return false;
  const works = await db.sql`SELECT id FROM halo_artist_rights_works WHERE id = ${workId} AND artist_slug = ${slug} LIMIT 1`;
  if (!works.length) return false;
  const rows = await db.sql`
    INSERT INTO halo_artist_rights_participants (
      work_id, participant_name, role, share_bps, collection_status, society_name, identifier
    ) VALUES (
      ${workId}, ${name}, ${enumValue(body.role, participantRoles, "other")},
      ${integer(body.shareBps, 0, 10000)}, ${enumValue(body.collectionStatus, collectionStatuses, "unconfirmed")},
      ${cleanText(body.societyName, 120)}, ${cleanText(body.identifier, 120)}
    )
    RETURNING id
  `;
  return Number(rows[0]?.id || 0);
}

async function createIncome(db, slug, ownerMemberId, body) {
  const description = cleanText(body.description, 240);
  if (!description) return false;
  const gross = integer(body.grossMinor);
  const fees = integer(body.feesMinor, 0, gross);
  const tax = integer(body.taxReserveMinor, 0, gross);
  const obligations = integer(body.obligationsMinor, 0, gross);
  if (fees + tax + obligations > gross) return false;
  const workId = cleanIdentifier(body.workId) || null;
  if (workId) {
    const works = await db.sql`SELECT id FROM halo_artist_rights_works WHERE id = ${workId} AND artist_slug = ${slug} LIMIT 1`;
    if (!works.length) return false;
  }
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_income_entries (
      id, artist_slug, owner_member_id, work_id, source_type, description, currency,
      gross_minor, fees_minor, tax_reserve_minor, obligations_minor, occurred_on,
      status, external_reference, notes
    ) VALUES (
      ${id}, ${slug}, ${ownerMemberId}, ${workId}, ${enumValue(body.sourceType, incomeSources, "other")},
      ${description}, ${cleanCurrency(body.currency)}, ${gross}, ${fees}, ${tax}, ${obligations},
      ${cleanDate(body.occurredOn)}::date, ${enumValue(body.status, incomeStatuses, "expected")},
      ${cleanText(body.externalReference, 180)}, ${cleanMultiline(body.notes, 4000)}
    )
  `;
  return id;
}

async function createCampaign(db, slug, ownerMemberId, body) {
  const title = cleanText(body.title, 180);
  if (!title) return false;
  const budget = integer(body.budgetMinor);
  const spent = integer(body.spentMinor, 0, budget);
  const stopLoss = integer(body.stopLossMinor, 0, budget);
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_campaign_investments (
      id, artist_slug, owner_member_id, title, stage, objective, currency,
      budget_minor, spent_minor, meaningful_actions, stop_loss_minor, decision, learning
    ) VALUES (
      ${id}, ${slug}, ${ownerMemberId}, ${title}, ${enumValue(body.stage, campaignStages, "readiness")},
      ${enumValue(body.objective, campaignObjectives, "retained_fan")}, ${cleanCurrency(body.currency)},
      ${budget}, ${spent}, ${integer(body.meaningfulActions, 0, 100000000)}, ${stopLoss},
      ${enumValue(body.decision, campaignDecisions, "prepare")}, ${cleanMultiline(body.learning, 4000)}
    )
  `;
  return id;
}

async function createLicensing(db, slug, ownerMemberId, body) {
  const name = cleanText(body.opportunityName, 200);
  if (!name) return false;
  const workId = cleanIdentifier(body.workId) || null;
  if (workId) {
    const works = await db.sql`SELECT id FROM halo_artist_rights_works WHERE id = ${workId} AND artist_slug = ${slug} LIMIT 1`;
    if (!works.length) return false;
  }
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_licensing_opportunities (
      id, artist_slug, owner_member_id, work_id, opportunity_name, buyer_name, media_type,
      territory, currency, quoted_fee_minor, commission_bps, stage, rights_check,
      decision_due_at, restrictions, notes
    ) VALUES (
      ${id}, ${slug}, ${ownerMemberId}, ${workId}, ${name}, ${cleanText(body.buyerName, 180)},
      ${enumValue(body.mediaType, mediaTypes, "other")}, ${cleanText(body.territory, 120) || "worldwide"},
      ${cleanCurrency(body.currency)}, ${integer(body.quotedFeeMinor)}, ${integer(body.commissionBps, 0, 5000)},
      ${enumValue(body.stage, licensingStages, "brief")}, ${enumValue(body.rightsCheck, rightsChecks, "required")},
      ${cleanTimestamp(body.decisionDueAt)}, ${cleanMultiline(body.restrictions, 2000)}, ${cleanMultiline(body.notes, 4000)}
    )
  `;
  return id;
}

async function createLive(db, slug, ownerMemberId, body) {
  const title = cleanText(body.title, 180);
  if (!title) return false;
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_live_engagements (
      id, artist_slug, owner_member_id, title, venue_name, city, performance_at, currency,
      guaranteed_fee_minor, ticket_share_minor, merchandise_minor, costs_minor,
      tickets_sold, fans_captured, settlement_status, setlist_reported, notes
    ) VALUES (
      ${id}, ${slug}, ${ownerMemberId}, ${title}, ${cleanText(body.venueName, 180)}, ${cleanText(body.city, 120)},
      ${cleanTimestamp(body.performanceAt)}, ${cleanCurrency(body.currency)}, ${integer(body.guaranteedFeeMinor)},
      ${integer(body.ticketShareMinor)}, ${integer(body.merchandiseMinor)}, ${integer(body.costsMinor)},
      ${integer(body.ticketsSold, 0, 10000000)}, ${integer(body.fansCaptured, 0, 10000000)},
      ${enumValue(body.settlementStatus, settlementStatuses, "planning")}, ${bool(body.setlistReported)},
      ${cleanMultiline(body.notes, 4000)}
    )
  `;
  return id;
}

async function createReview(db, slug, memberId, body) {
  const title = cleanText(body.title, 200);
  const artistBenefit = cleanMultiline(body.artistBenefit, 4000);
  if (!title || !artistBenefit) return false;
  const id = randomUUID();
  await db.sql`
    INSERT INTO halo_artist_conscience_reviews (
      id, artist_slug, created_by_member_id, proposal_type, title, artist_benefit,
      artist_risk, ownership_effect, income_effect, reversibility, decision, conditions
    ) VALUES (
      ${id}, ${body.globalReview ? null : slug}, ${memberId}, ${enumValue(body.proposalType, proposalTypes, "other")},
      ${title}, ${artistBenefit}, ${cleanMultiline(body.artistRisk, 4000)},
      ${enumValue(body.ownershipEffect, ownershipEffects, "neutral")},
      ${enumValue(body.incomeEffect, incomeEffects, "unknown")},
      ${enumValue(body.reversibility, reversibilityValues, "reversible")},
      ${enumValue(body.decision, reviewDecisions, "review")}, ${cleanMultiline(body.conditions, 4000)}
    )
  `;
  return id;
}

async function updateItem(db, slug, platformOwner, body) {
  const id = cleanIdentifier(body.id);
  if (!id) return false;
  const recordType = cleanText(body.recordType, 40).toLowerCase();
  if (recordType === "work") {
    const rows = await db.sql`
      UPDATE halo_artist_rights_works
      SET rights_status = ${enumValue(body.rightsStatus, rightsStatuses, "incomplete")},
        one_stop = ${bool(body.oneStop)}, updated_at = NOW()
      WHERE id = ${id} AND artist_slug = ${slug}
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  if (recordType === "income") {
    const rows = await db.sql`
      UPDATE halo_artist_income_entries
      SET status = ${enumValue(body.status, incomeStatuses, "expected")}, updated_at = NOW()
      WHERE id = ${id} AND artist_slug = ${slug}
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  if (recordType === "campaign") {
    const rows = await db.sql`
      UPDATE halo_artist_campaign_investments
      SET stage = ${enumValue(body.stage, campaignStages, "readiness")},
        decision = ${enumValue(body.decision, campaignDecisions, "prepare")},
        spent_minor = LEAST(budget_minor, ${integer(body.spentMinor)}),
        meaningful_actions = ${integer(body.meaningfulActions, 0, 100000000)},
        learning = ${cleanMultiline(body.learning, 4000)}, updated_at = NOW()
      WHERE id = ${id} AND artist_slug = ${slug}
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  if (recordType === "licensing") {
    const rows = await db.sql`
      UPDATE halo_artist_licensing_opportunities
      SET stage = ${enumValue(body.stage, licensingStages, "brief")},
        rights_check = ${enumValue(body.rightsCheck, rightsChecks, "required")}, updated_at = NOW()
      WHERE id = ${id} AND artist_slug = ${slug}
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  if (recordType === "live") {
    const rows = await db.sql`
      UPDATE halo_artist_live_engagements
      SET settlement_status = ${enumValue(body.settlementStatus, settlementStatuses, "planning")},
        setlist_reported = ${bool(body.setlistReported)}, updated_at = NOW()
      WHERE id = ${id} AND artist_slug = ${slug}
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  if (recordType === "review" && platformOwner) {
    const rows = await db.sql`
      UPDATE halo_artist_conscience_reviews
      SET decision = ${enumValue(body.decision, reviewDecisions, "review")},
        conditions = ${cleanMultiline(body.conditions, 4000)}, updated_at = NOW()
      WHERE id = ${id} AND (artist_slug = ${slug} OR artist_slug IS NULL)
      RETURNING id
    `;
    return rows[0]?.id || false;
  }
  return false;
}

export default async function artistEconomyHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const slug = cleanSlug(url.searchParams.get("slug"));
      if (!slug) return json({ message: "Add an artist room handle" }, 400);
      const access = await authorize(db, user, slug);
      if (access.status) return json({ message: access.message }, access.status);
      await ensureProfile(db, slug, access.ownerMemberId);
      return json(await loadDashboard(db, slug, access));
    }

    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);
    let body;
    try {
      body = await bodyFrom(request);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "payload_too_large";
      return json({ message: tooLarge ? "Request is too large" : "Invalid request body" }, tooLarge ? 413 : 400);
    }
    const slug = cleanSlug(body?.slug);
    if (!slug) return json({ message: "Add an artist room handle" }, 400);
    const access = await authorize(db, user, slug);
    if (access.status) return json({ message: access.message }, access.status);
    await ensureProfile(db, slug, access.ownerMemberId);

    let result = false;
    if (body.action === "save_profile") result = await saveProfile(db, slug, access.ownerMemberId, body);
    if (body.action === "create_work") result = await createWork(db, slug, access.ownerMemberId, body);
    if (body.action === "add_participant") result = await addParticipant(db, slug, body);
    if (body.action === "create_income") result = await createIncome(db, slug, access.ownerMemberId, body);
    if (body.action === "create_campaign") result = await createCampaign(db, slug, access.ownerMemberId, body);
    if (body.action === "create_licensing") result = await createLicensing(db, slug, access.ownerMemberId, body);
    if (body.action === "create_live") result = await createLive(db, slug, access.ownerMemberId, body);
    if (body.action === "create_review" && access.platformOwner) result = await createReview(db, slug, access.memberId, body);
    if (body.action === "update_item") result = await updateItem(db, slug, access.platformOwner, body);
    if (!result) return json({ message: "That Artist Economy update could not be saved" }, 400);
    return json({ saved: true, id: result === true ? null : result, dashboard: await loadDashboard(db, slug, access) });
  } catch (error) {
    console.error("HALO Artist Economy request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Artist Economy is temporarily unavailable" }, 503);
  }
}

export const config = { path: "/api/artist-economy" };
