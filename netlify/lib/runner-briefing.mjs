// HALO Runners Briefing: one owner-only daily check-in across the four runner pillars.
// Every figure comes from a recorded platform source. A source that cannot be read is
// reported as "unavailable" and is never shown as zero.

const DAY = 86_400_000;
export const PAYMENT_PATTERN = "(payout|payment|paid|refund|chargeback|dispute|checkout|stripe|invoice|purchase|billing|charge)";
const RADIO_PATTERN = "(radio|chart|broadcast|station)";
const CLOSED_SUPPORT = ["resolved", "closed"];

const count = value => Number(value || 0);
const iso = value => value ? new Date(value).toISOString() : null;
export const rate = (numerator, denominator) => denominator > 0 ? Math.round(numerator / denominator * 1000) / 10 : null;

async function read(name, load, shape) {
  try {
    return { status: "available", data: shape(await load()) };
  } catch (error) {
    console.error(`HALO runners briefing source unavailable: ${name}`, error instanceof Error ? error.message : "unknown error");
    return { status: "unavailable", data: null };
  }
}

export function ukDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function ukHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
}

function signupSources(db, day, week) {
  return Promise.all([
    read("members", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE joined_at >= ${day}::timestamptz)::int AS day,
        COUNT(*)::int AS week,
        COUNT(*) FILTER (WHERE tier <> 'member')::int AS paid_tier_week
      FROM halo_memberships WHERE joined_at >= ${week}::timestamptz
    `, rows => ({ day: count(rows[0]?.day), week: count(rows[0]?.week), paidTierWeek: count(rows[0]?.paid_tier_week) })),
    read("artists", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE created_at >= ${day}::timestamptz)::int AS day,
        COUNT(*) FILTER (WHERE created_at >= ${week}::timestamptz)::int AS week,
        COUNT(*) FILTER (WHERE status = 'new')::int AS awaiting_review
      FROM halo_artist_pro_leads
    `, rows => ({ day: count(rows[0]?.day), week: count(rows[0]?.week), awaitingReview: count(rows[0]?.awaiting_review) })),
    read("fans", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE created_at >= ${day}::timestamptz)::int AS day,
        COUNT(*)::int AS week
      FROM halo_dreamweaver_fan_signups WHERE created_at >= ${week}::timestamptz
    `, rows => ({ day: count(rows[0]?.day), week: count(rows[0]?.week) })),
    read("profileSetup", () => db.sql`
      SELECT COUNT(*)::int AS joined, COUNT(h.member_id)::int AS set_up
      FROM halo_memberships m LEFT JOIN halo_music_homes h ON h.member_id = m.member_id
      WHERE m.joined_at >= ${week}::timestamptz
    `, rows => {
      const joined = count(rows[0]?.joined);
      const setUp = count(rows[0]?.set_up);
      return { joined, setUp, notSetUp: Math.max(joined - setUp, 0), setupRate: rate(setUp, joined) };
    }),
    read("onboardingQuestions", () => db.sql`
      SELECT title, status, created_at FROM halo_support_requests
      WHERE category = 'support' AND status <> ALL(${CLOSED_SUPPORT})
        AND NOT (title ~* ${PAYMENT_PATTERN} OR details ~* ${PAYMENT_PATTERN})
      ORDER BY created_at ASC LIMIT 5
    `, rows => rows.map(row => ({ title: row.title, status: row.status, createdAt: iso(row.created_at) })))
  ]).then(([members, artists, fans, profileSetup, onboardingQuestions]) => ({ members, artists, fans, profileSetup, onboardingQuestions }));
}

function paymentSources(db, day, week, now) {
  const soon = new Date(now.getTime() + 3 * DAY).toISOString();
  return Promise.all([
    read("purchases", () => db.sql`
      SELECT currency, livemode,
        COUNT(*) FILTER (WHERE received_at >= ${day}::timestamptz)::int AS day_count,
        COUNT(*)::int AS week_count,
        COALESCE(SUM(amount_minor), 0)::bigint AS week_minor
      FROM halo_stripe_purchase_events WHERE received_at >= ${week}::timestamptz
      GROUP BY currency, livemode ORDER BY livemode DESC, currency ASC
    `, rows => {
      const live = rows.filter(row => row.livemode === true);
      return {
        liveDay: live.reduce((sum, row) => sum + count(row.day_count), 0),
        liveWeek: live.reduce((sum, row) => sum + count(row.week_count), 0),
        testWeek: rows.filter(row => row.livemode !== true).reduce((sum, row) => sum + count(row.week_count), 0),
        weekTotals: live.map(row => ({ currency: row.currency, amountMinor: count(row.week_minor) }))
      };
    }),
    read("creatorPasses", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE subscription_status = 'past_due')::int AS past_due,
        COUNT(*) FILTER (WHERE subscription_status = 'trialing' AND trial_ends_at < ${soon}::timestamptz)::int AS trials_ending,
        COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active
      FROM halo_creator_passes
    `, rows => ({ pastDue: count(rows[0]?.past_due), trialsEnding: count(rows[0]?.trials_ending), active: count(rows[0]?.active) })),
    read("paymentTickets", () => db.sql`
      SELECT title, category, status, created_at FROM halo_support_requests
      WHERE status <> ALL(${CLOSED_SUPPORT}) AND (title ~* ${PAYMENT_PATTERN} OR details ~* ${PAYMENT_PATTERN})
      ORDER BY created_at ASC LIMIT 8
    `, rows => rows.map(row => ({ title: row.title, category: row.category, status: row.status, createdAt: iso(row.created_at) }))),
    read("paymentIssues", () => db.sql`
      SELECT title, severity, occurrence_count, last_seen_at FROM maintenance_issues
      WHERE status <> 'healed' AND (category ~* ${PAYMENT_PATTERN} OR title ~* ${PAYMENT_PATTERN})
      ORDER BY last_seen_at DESC LIMIT 5
    `, rows => rows.map(row => ({ title: row.title, severity: row.severity, occurrences: count(row.occurrence_count), lastSeenAt: iso(row.last_seen_at) })))
  ]).then(([purchases, creatorPasses, paymentTickets, paymentIssues]) => ({ purchases, creatorPasses, paymentTickets, paymentIssues }));
}

function catalogSources(db, day, week, now) {
  return Promise.all([
    read("provenance", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE created_at >= ${day}::timestamptz)::int AS day,
        COUNT(*)::int AS week, COUNT(DISTINCT version_id)::int AS versions
      FROM halo_master_provenance_observations WHERE created_at >= ${week}::timestamptz
    `, rows => ({ day: count(rows[0]?.day), week: count(rows[0]?.week), versions: count(rows[0]?.versions) })),
    read("retainedMasters", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'pending' AND lease_until < ${now.toISOString()}::timestamptz)::int AS stalled,
        COUNT(*) FILTER (WHERE status = 'pending' AND lease_until >= ${now.toISOString()}::timestamptz)::int AS in_progress
      FROM halo_retained_master_snapshots
    `, rows => ({ ready: count(rows[0]?.ready), failed: count(rows[0]?.failed), stalled: count(rows[0]?.stalled), inProgress: count(rows[0]?.in_progress) })),
    read("playback", () => db.sql`
      WITH attempts AS (
        SELECT anonymous_id, metadata->>'play_id' AS play_id
        FROM analytics_events
        WHERE event_name = 'shop_playback_attempt' AND created_at >= ${week}::timestamptz
          AND COALESCE(metadata->>'play_id', '') <> ''
        GROUP BY anonymous_id, metadata->>'play_id'
      ), outcomes AS (
        SELECT a.play_id,
          BOOL_OR(e.event_name = 'shop_playback_ready') AS ready,
          BOOL_OR(e.event_name = 'shop_playback_failed') AS failed
        FROM attempts a
        LEFT JOIN analytics_events e ON e.anonymous_id = a.anonymous_id AND e.metadata->>'play_id' = a.play_id
          AND e.event_name IN ('shop_playback_ready', 'shop_playback_failed') AND e.created_at >= ${week}::timestamptz
        GROUP BY a.anonymous_id, a.play_id
      )
      SELECT COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE ready)::int AS ready,
        COUNT(*) FILTER (WHERE failed)::int AS failed
      FROM outcomes
    `, rows => {
      const attempts = count(rows[0]?.attempts);
      const ready = count(rows[0]?.ready);
      return { attempts, ready, failed: count(rows[0]?.failed), startRate: rate(ready, attempts) };
    }),
    read("radio", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_radio_play_history WHERE started_at >= ${day}::timestamptz) AS plays_day,
        (SELECT COUNT(*)::int FROM halo_chart_votes WHERE created_at >= ${week}::timestamptz) AS chart_votes_week,
        (SELECT COUNT(*)::int FROM maintenance_issues WHERE status <> 'healed'
          AND (category ~* ${RADIO_PATTERN} OR title ~* ${RADIO_PATTERN} OR page_path ~* ${RADIO_PATTERN})) AS open_issues
    `, rows => ({ playsDay: count(rows[0]?.plays_day), chartVotesWeek: count(rows[0]?.chart_votes_week), openIssues: count(rows[0]?.open_issues) })),
    read("priorityIssues", () => db.sql`
      SELECT title, severity, category, page_path, occurrence_count, last_seen_at FROM maintenance_issues
      WHERE status <> 'healed' AND severity IN ('high', 'critical')
      ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, last_seen_at DESC LIMIT 6
    `, rows => rows.map(row => ({
      title: row.title, severity: row.severity, category: row.category, pagePath: row.page_path,
      occurrences: count(row.occurrence_count), lastSeenAt: iso(row.last_seen_at)
    }))),
    read("bugReports", () => db.sql`
      SELECT COUNT(*)::int AS open FROM halo_support_requests
      WHERE category = 'bug' AND status <> ALL(${CLOSED_SUPPORT})
    `, rows => ({ open: count(rows[0]?.open) }))
  ]).then(([provenance, retainedMasters, playback, radio, priorityIssues, bugReports]) => ({ provenance, retainedMasters, playback, radio, priorityIssues, bugReports }));
}

function growthSources(db, week) {
  return Promise.all([
    read("listening", () => db.sql`
      SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT s.member_id)::int AS listeners,
        COUNT(*) FILTER (WHERE s.outcome = 'listen_complete')::int AS complete,
        COUNT(*) FILTER (WHERE s.outcome IS NOT NULL)::int AS finished
      FROM halo_listening_sessions s
      JOIN halo_listening_preferences p ON p.member_id = s.member_id
      WHERE p.enabled = TRUE AND p.consent_at IS NOT NULL AND s.started_at >= p.consent_at
        AND s.started_at >= ${week}::timestamptz
    `, rows => {
      const complete = count(rows[0]?.complete);
      return { sessions: count(rows[0]?.sessions), listeners: count(rows[0]?.listeners), completionRate: rate(complete, count(rows[0]?.finished)) };
    }),
    read("chartLeaders", () => db.sql`
      SELECT r.title, r.artist, COUNT(*)::int AS votes
      FROM halo_chart_votes v JOIN halo_release_campaigns r ON r.id = v.release_id
      WHERE v.created_at >= ${week}::timestamptz
      GROUP BY r.id, r.title, r.artist ORDER BY votes DESC, r.title ASC LIMIT 3
    `, rows => rows.map(row => ({ title: row.title, artist: row.artist, votes: count(row.votes) }))),
    read("featureRequests", () => db.sql`
      SELECT title, status, vote_count FROM halo_support_requests
      WHERE category = 'feature' AND status <> ALL(${CLOSED_SUPPORT})
      ORDER BY vote_count DESC, created_at ASC LIMIT 5
    `, rows => rows.map(row => ({ title: row.title, status: row.status, votes: count(row.vote_count) }))),
    read("shipped", () => db.sql`
      SELECT COUNT(*)::int AS resolved FROM halo_support_requests
      WHERE status = 'resolved' AND updated_at >= ${week}::timestamptz
    `, rows => ({ resolvedWeek: count(rows[0]?.resolved) }))
  ]).then(([listening, chartLeaders, featureRequests, shipped]) => ({ listening, chartLeaders, featureRequests, shipped }));
}

const ok = source => source?.status === "available" ? source.data : null;

// Turns the recorded signals into the 1-3 highest-impact moves. Rules are ordered by user impact.
export function leverageMoves({ signups, payments, catalog, growth }) {
  const moves = [];
  const add = (priority, title, why) => moves.push({ priority, title, why });
  const issues = ok(catalog.priorityIssues);
  const critical = issues?.filter(issue => issue.severity === "critical").length || 0;
  if (critical) add(100, "Clear critical platform issues first", `${critical} critical issue(s) are open, led by "${issues[0].title}".`);
  const tickets = ok(payments.paymentTickets);
  const passes = ok(payments.creatorPasses);
  const paymentLoad = (tickets?.length || 0) + (passes?.pastDue || 0) + (ok(payments.paymentIssues)?.length || 0);
  if (paymentLoad) add(90, "Answer every open payment and payout query", `${tickets?.length || 0} open payment ticket(s), ${passes?.pastDue || 0} past-due Creator Pass(es) and ${ok(payments.paymentIssues)?.length || 0} payment-related issue(s). Trust in getting paid is HALO's core promise to artists.`);
  const masters = ok(catalog.retainedMasters);
  if (masters && (masters.failed || masters.stalled)) add(85, "Re-run failed or stalled master snapshots", `${masters.failed} failed and ${masters.stalled} stalled retained-master snapshot(s) leave masters without a verified copy.`);
  const playback = ok(catalog.playback);
  if (playback?.startRate !== null && playback?.startRate !== undefined && playback.startRate < 95) add(80, "Fix playback start reliability", `Only ${playback.startRate}% of shop playback attempts reached playing this week (${playback.failed} reported errors).`);
  const artists = ok(signups.artists);
  if (artists?.awaitingReview) add(70, "Review waiting artist applications", `${artists.awaitingReview} Artist Pro application(s) are still marked new. Fast replies turn interest into releases.`);
  const setup = ok(signups.profileSetup);
  if (setup?.setupRate !== null && setup?.setupRate !== undefined && setup.setupRate < 60) add(60, "Close the profile-setup gap", `${setup.notSetUp} of ${setup.joined} members who joined this week have not set up their Music Home (${setup.setupRate}% completed).`);
  const radio = ok(catalog.radio);
  if (radio?.openIssues) add(55, "Stabilise radio and chart", `${radio.openIssues} open radio/chart issue(s).`);
  const features = ok(growth.featureRequests);
  if (features?.[0]?.votes) add(45, `Build the most-requested feature: "${features[0].title}"`, `${features[0].votes} vote(s). Things artists and fans ask for directly are where HALO can beat mainstream platforms.`);
  const leaders = ok(growth.chartLeaders);
  if (leaders?.[0]) add(30, `Amplify the chart leader: ${leaders[0].title}`, `${leaders[0].votes} chart vote(s) this week for ${leaders[0].artist}. Feature it on radio and in community rooms.`);
  return moves.sort((a, b) => b.priority - a.priority).slice(0, 3).map(({ title, why }) => ({ title, why }));
}

export async function buildRunnerBriefing(db, { now = new Date(), triggerType = "manual" } = {}) {
  const day = new Date(now.getTime() - DAY).toISOString();
  const week = new Date(now.getTime() - 7 * DAY).toISOString();
  const [signups, payments, catalog, growth] = await Promise.all([
    signupSources(db, day, week), paymentSources(db, day, week, now), catalogSources(db, day, week, now), growthSources(db, week)
  ]);
  const pillars = { signups, payments, catalog, growth };
  const all = Object.values(pillars).flatMap(pillar => Object.values(pillar));
  return {
    briefingDate: ukDate(now),
    generatedAt: now.toISOString(),
    triggerType,
    windows: { day: { start: day, end: now.toISOString() }, week: { start: week, end: now.toISOString() } },
    coverage: { available: all.filter(source => source.status === "available").length, total: all.length },
    pillars,
    leverageMoves: leverageMoves(pillars),
    gaps: [
      "Payouts, refunds and chargebacks are not recorded yet; only paid Stripe checkouts are stored. Check the Stripe dashboard for those.",
      "Fan and artist praise isn't captured as structured data. Feature requests and support themes are the closest signal.",
      "Competitor comparisons aren't measured automatically. Use the top feature requests as the gaps artists want HALO to fill."
    ]
  };
}

export async function storeRunnerBriefing(db, briefing) {
  await db.sql`
    INSERT INTO halo_runner_briefings (briefing_date, trigger_type, payload, generated_at)
    VALUES (${briefing.briefingDate}::date, ${briefing.triggerType}, ${JSON.stringify(briefing)}::jsonb, ${briefing.generatedAt}::timestamptz)
    ON CONFLICT (briefing_date) DO UPDATE SET
      trigger_type = EXCLUDED.trigger_type, payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at
  `;
}

export async function loadStoredBriefings(db, limit = 7) {
  try {
    const rows = await db.sql`
      SELECT briefing_date::text AS briefing_date, trigger_type, generated_at, payload
      FROM halo_runner_briefings ORDER BY briefing_date DESC LIMIT ${limit}
    `;
    return rows.map(row => ({ briefingDate: row.briefing_date, triggerType: row.trigger_type, generatedAt: iso(row.generated_at), briefing: row.payload }));
  } catch {
    return null;
  }
}
