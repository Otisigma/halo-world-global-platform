// HALO Artist Shop + Video + AI blueprint: the eight-item working list turned into a live,
// owner-only build board. Each workstream reports readiness signals read from platform records,
// a computed stage, the existing surfaces it builds on, ordered build tasks and runner check-ins.
// A source that cannot be read is reported as "unavailable" and never shown as zero.

import { PAYMENT_PATTERN, rate } from "./runner-briefing.mjs";

const DAY = 86_400_000;
const count = value => Number(value || 0);

async function read(name, load, shape) {
  try {
    return { status: "available", data: shape(await load()) };
  } catch (error) {
    console.error(`HALO shop blueprint source unavailable: ${name}`, error instanceof Error ? error.message : "unknown error");
    return { status: "unavailable", data: null };
  }
}

const ok = source => source?.status === "available" ? source.data : null;

async function loadSources(db, now) {
  const week = new Date(now.getTime() - 7 * DAY).toISOString();
  const month = new Date(now.getTime() - 30 * DAY).toISOString();
  const [
    saleVersions, stemPacks, vaultOrders, purchases, marketplace,
    milestones, video, discovery, provenance, payments, onboarding, roster
  ] = await Promise.all([
    read("saleVersions", () => db.sql`
      SELECT
        COUNT(*) FILTER (WHERE v.sale_enabled)::int AS sale_enabled,
        COUNT(*) FILTER (WHERE v.sale_enabled AND v.version_type IN ('instrumental', 'extended'))::int AS alt_mixes,
        COUNT(*) FILTER (WHERE v.version_type = 'sale_master')::int AS sale_masters,
        COUNT(DISTINCT v.song_id) FILTER (WHERE v.sale_enabled)::int AS songs_on_sale
      FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
      WHERE v.status = 'active' AND s.status = 'active'
    `, rows => ({
      saleEnabled: count(rows[0]?.sale_enabled), altMixes: count(rows[0]?.alt_mixes),
      saleMasters: count(rows[0]?.sale_masters), songsOnSale: count(rows[0]?.songs_on_sale)
    })),
    read("stemPacks", () => db.sql`
      SELECT COUNT(*)::int AS packs, COUNT(*) FILTER (WHERE rights_attested)::int AS attested
      FROM halo_stem_packs WHERE status <> 'archived'
    `, rows => ({ packs: count(rows[0]?.packs), attested: count(rows[0]?.attested) })),
    read("vaultOrders", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
        COUNT(*) FILTER (WHERE status = 'pending' AND created_at < ${new Date(now.getTime() - DAY).toISOString()}::timestamptz)::int AS abandoned
      FROM halo_dj_vault_orders WHERE created_at >= ${month}::timestamptz
    `, rows => ({ paid: count(rows[0]?.paid), abandoned: count(rows[0]?.abandoned) })),
    read("purchases", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE livemode)::int AS live, COUNT(*) FILTER (WHERE NOT livemode)::int AS test
      FROM halo_stripe_purchase_events WHERE received_at >= ${month}::timestamptz
    `, rows => ({ live: count(rows[0]?.live), test: count(rows[0]?.test) })),
    read("marketplace", () => db.sql`
      SELECT COUNT(*) FILTER (WHERE status = 'published')::int AS published, COUNT(*)::int AS total
      FROM marketplace_products
    `, rows => ({ published: count(rows[0]?.published), total: count(rows[0]?.total) })),
    read("milestones", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_release_milestones) AS reached,
        (SELECT COUNT(*)::int FROM halo_release_milestones WHERE reached_at >= ${month}::timestamptz) AS reached_month,
        (SELECT COUNT(*)::int FROM halo_chart_votes WHERE created_at >= ${week}::timestamptz) AS votes_week
    `, rows => ({ reached: count(rows[0]?.reached), reachedMonth: count(rows[0]?.reached_month), votesWeek: count(rows[0]?.votes_week) })),
    read("video", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_videos WHERE status = 'published') AS gallery_videos,
        (SELECT COUNT(DISTINCT song_id)::int FROM halo_song_versions WHERE status = 'active' AND promo_video_url <> '') AS promo_cuts,
        (SELECT COUNT(*)::int FROM halo_song_versions WHERE status = 'active' AND video_url <> '') AS track_videos,
        (SELECT COUNT(DISTINCT song_id)::int FROM halo_song_versions WHERE status = 'active') AS songs,
        (SELECT COUNT(*)::int FROM halo_social_snippets WHERE status = 'ready') AS snippets
    `, rows => ({
      galleryVideos: count(rows[0]?.gallery_videos), promoCuts: count(rows[0]?.promo_cuts),
      trackVideos: count(rows[0]?.track_videos), songs: count(rows[0]?.songs), snippets: count(rows[0]?.snippets)
    })),
    read("discovery", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_radio_tracks WHERE status IN ('approved', 'aired')) AS rotation,
        (SELECT COUNT(*)::int FROM halo_radio_tracks WHERE status IN ('approved', 'aired') AND bpm IS NOT NULL AND genre <> '') AS tagged,
        (SELECT COUNT(*)::int FROM halo_radio_play_history WHERE started_at >= ${week}::timestamptz) AS plays_week,
        (SELECT COUNT(*)::int FROM halo_chart_votes WHERE created_at >= ${week}::timestamptz) AS votes_week
    `, rows => ({
      rotation: count(rows[0]?.rotation), tagged: count(rows[0]?.tagged), taggedRate: rate(count(rows[0]?.tagged), count(rows[0]?.rotation)),
      playsWeek: count(rows[0]?.plays_week), votesWeek: count(rows[0]?.votes_week)
    })),
    read("provenance", () => db.sql`
      SELECT
        (SELECT COUNT(DISTINCT version_id)::int FROM halo_master_provenance_observations) AS observed_versions,
        (SELECT COUNT(*)::int FROM halo_retained_master_snapshots WHERE status = 'ready') AS verified,
        (SELECT COUNT(*)::int FROM halo_retained_master_snapshots WHERE status = 'ready' AND published_at IS NOT NULL) AS published,
        (SELECT COUNT(*)::int FROM halo_retained_master_snapshots WHERE status = 'failed') AS failed,
        (SELECT COUNT(DISTINCT v.song_id)::int FROM halo_song_versions v WHERE v.sale_enabled AND v.status = 'active') AS on_sale
    `, rows => ({
      observedVersions: count(rows[0]?.observed_versions), verified: count(rows[0]?.verified),
      published: count(rows[0]?.published), failed: count(rows[0]?.failed), onSale: count(rows[0]?.on_sale)
    })),
    read("payments", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_support_requests WHERE status NOT IN ('resolved', 'closed')
          AND (title ~* ${PAYMENT_PATTERN} OR details ~* ${PAYMENT_PATTERN})) AS open_queries,
        (SELECT COUNT(*)::int FROM maintenance_issues WHERE status <> 'healed'
          AND (category ~* ${PAYMENT_PATTERN} OR title ~* ${PAYMENT_PATTERN})) AS open_issues,
        (SELECT COUNT(*)::int FROM halo_creator_passes WHERE subscription_status = 'past_due') AS past_due
    `, rows => ({ openQueries: count(rows[0]?.open_queries), openIssues: count(rows[0]?.open_issues), pastDue: count(rows[0]?.past_due) })),
    read("onboarding", () => db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_memberships WHERE joined_at >= ${week}::timestamptz) AS joined,
        (SELECT COUNT(*)::int FROM halo_memberships m JOIN halo_music_homes h ON h.member_id = m.member_id
          WHERE m.joined_at >= ${week}::timestamptz) AS set_up,
        (SELECT COUNT(*)::int FROM halo_artist_pro_leads WHERE status = 'new') AS awaiting,
        (SELECT COUNT(*)::int FROM halo_dreamweaver_fan_signups WHERE created_at >= ${week}::timestamptz) AS fans
    `, rows => {
      const joined = count(rows[0]?.joined);
      const setUp = count(rows[0]?.set_up);
      return { joined, setUp, setupRate: rate(setUp, joined), awaiting: count(rows[0]?.awaiting), fans: count(rows[0]?.fans) };
    }),
    read("roster", () => db.sql`
      SELECT
        (SELECT COUNT(DISTINCT lower(artist_name))::int FROM halo_song_catalog WHERE status = 'active') AS catalog_artists,
        (SELECT COUNT(*)::int FROM halo_song_catalog WHERE status = 'active' AND artist_name ~* 'halo\\s*rock') AS halo_rock_songs,
        (SELECT COUNT(*)::int FROM halo_artist_pages WHERE status = 'published') AS artist_pages,
        (SELECT COUNT(*)::int FROM halo_radio_personas WHERE status IN ('resident', 'guest')) AS personas
    `, rows => ({
      catalogArtists: count(rows[0]?.catalog_artists), haloRockSongs: count(rows[0]?.halo_rock_songs),
      artistPages: count(rows[0]?.artist_pages), personas: count(rows[0]?.personas)
    }))
  ]);
  return { saleVersions, stemPacks, vaultOrders, purchases, marketplace, milestones, video, discovery, provenance, payments, onboarding, roster };
}

const v = (source, pick) => source?.status === "available" ? pick(source.data) : null;
const signal = (label, value, flag = false) => ({ label, value, flag: Boolean(flag) });
const pct = value => value === null || value === undefined ? "Not enough data" : `${value}%`;

// Stage ladder: "not_started" (no foundation), "foundation" (pieces exist, not joined up),
// "partial" (fans can use part of it), "live" (working end to end). Unknown when sources fail.
function stage(sources, decide) {
  if (sources.some(source => source?.status !== "available")) return "unknown";
  return decide(...sources.map(source => source.data));
}

export function buildWorkstreams(s) {
  return [
    {
      id: "direct-shop",
      pillar: "Direct Artist Shop & Monetization",
      title: "Direct-to-fan digital masters, stems and lossless bundle checkout",
      stage: stage([s.saleVersions, s.purchases], (sale, buys) =>
        sale.saleEnabled && buys.live ? "live" : sale.saleEnabled ? "partial" : "foundation"),
      signals: [
        signal("Songs with a version on sale", v(s.saleVersions, d => d.songsOnSale)),
        signal("Sale-enabled versions (instrumental / extended)", v(s.saleVersions, d => `${d.saleEnabled} (${d.altMixes})`)),
        signal("Stem packs (rights attested)", v(s.stemPacks, d => `${d.packs} (${d.attested})`)),
        signal("Paid DJ Vault orders (30d)", v(s.vaultOrders, d => d.paid)),
        signal("Live Stripe checkouts (30d)", v(s.purchases, d => d.live)),
        signal("Artist Shop products published", v(s.marketplace, d => `${d.published} / ${d.total}`), v(s.marketplace, d => d.published === 0))
      ],
      surfaces: [
        { label: "HALO Shop", href: "/music-upload/" },
        { label: "Artist Shop storefronts", href: "/artist-shop/" },
        { label: "DJ Vault", href: "/dj-vault/" }
      ],
      tasks: [
        "Move the Artist Shop off its conversation-only preview: publish the first approved product per creator.",
        "Add a bundle product (master + instrumental + extended + stems) priced from the existing sale-enabled versions.",
        "Deliver lossless files after checkout from the retained master copy, with a per-buyer download entitlement.",
        "Show each buyer the artist's share of the sale on the receipt (transparent payout line)."
      ],
      checkIns: ["New products waiting for rights review", "Checkouts started but not paid", "Download or delivery complaints"]
    },
    {
      id: "milestone-merch",
      pillar: "Direct Artist Shop & Monetization",
      title: "Physical plaques and limited merch tied to Living Chart milestones",
      stage: stage([s.milestones], m => m.reached ? "foundation" : "not_started"),
      signals: [
        signal("Releases that reached a chart milestone", v(s.milestones, d => d.reached)),
        signal("Milestones reached (30d)", v(s.milestones, d => d.reachedMonth)),
        signal("Living Chart votes (7d)", v(s.milestones, d => d.votesWeek)),
        signal("Physical / merch product type", "Not built yet", true)
      ],
      surfaces: [
        { label: "Living Chart", href: "/music-upload/#living-chart" },
        { label: "Track Drops", href: "/track-drops/" }
      ],
      tasks: [
        "Add a physical/limited product type with edition size, shipping regions and fulfilment status.",
        "Unlock a numbered plaque or limited edition automatically when a release reaches a chart milestone.",
        "Offer Discoverers (the first 20 supporters) first access to milestone editions.",
        "Choose a print/fulfilment partner and record each order's shipping state for runners."
      ],
      checkIns: ["Milestones reached since last check-in", "Edition stock left", "Orders not yet shipped"]
    },
    {
      id: "video-tech",
      pillar: "Video Tech & Visual Storytelling",
      title: "AI video teasers and visualizers synced to tracks and stems",
      stage: stage([s.video], d => d.promoCuts || d.trackVideos ? "partial" : d.galleryVideos ? "foundation" : "not_started"),
      signals: [
        signal("Published gallery videos", v(s.video, d => d.galleryVideos)),
        signal("Songs with a promo cut", v(s.video, d => `${d.promoCuts} of ${d.songs}`), v(s.video, d => d.songs > 0 && d.promoCuts === 0)),
        signal("Track versions with a full video", v(s.video, d => d.trackVideos)),
        signal("Ready social snippets", v(s.video, d => d.snippets))
      ],
      surfaces: [
        { label: "Obsidian visualizer", href: "/obsidian/" },
        { label: "YouTube Source Studio", href: "/youtube-studio/" },
        { label: "Mixes (visual studio)", href: "/mixes/" }
      ],
      tasks: [
        "Render a vertical 9:16 teaser per release from artwork, lyrics and a chorus window (extend the existing teaser renderer).",
        "Save each rendered teaser as the version's promo cut so the shop and player pick it up automatically.",
        "Play the Obsidian-style visualizer inside the shop player while a track is playing.",
        "Add stem-reactive visuals for DJ and stem drops."
      ],
      checkIns: ["Releases without a promo cut", "Teaser render failures", "Teaser shares and click-throughs"]
    },
    {
      id: "smart-discovery",
      pillar: "AI Smarts That Beat Standard Streaming",
      title: "Smart discovery combining streaming, radio and fan chart signals",
      // Discover, radio and the Living Chart already exist, so the floor is "foundation".
      stage: stage([s.discovery], d => d.rotation && (d.votesWeek || d.playsWeek) ? "partial" : "foundation"),
      signals: [
        signal("Tracks in radio rotation", v(s.discovery, d => d.rotation)),
        signal("Rotation tracks tagged with tempo + genre", v(s.discovery, d => pct(d.taggedRate)), v(s.discovery, d => d.taggedRate !== null && d.taggedRate < 80)),
        signal("Radio plays (7d)", v(s.discovery, d => d.playsWeek)),
        signal("Chart votes (7d)", v(s.discovery, d => d.votesWeek))
      ],
      surfaces: [
        { label: "Discover", href: "/discover/" },
        { label: "Radio", href: "/radio/" },
        { label: "Your playlists", href: "/music-upload/#personalPlaylistHub" }
      ],
      tasks: [
        "Tag every rotation track with mood and energy alongside tempo and genre.",
        "Build a 'Fresh for you' queue that blends mood, energy, radio rotation and chart momentum, and caps repeats per artist.",
        "Always reserve one slot in each queue for a track the listener has never heard (anti-rut rule).",
        "Explain each pick in one line (\"rising on the Living Chart\", \"matches your late-night mood\")."
      ],
      checkIns: ["Untagged tracks", "Share of plays from tracks listeners hadn't heard before", "Skip rate on discovery picks"]
    },
    {
      id: "provenance-badges",
      pillar: "AI Smarts That Beat Standard Streaming",
      title: "Master byte provenance and SHA-256 badges on track and shop pages",
      stage: stage([s.provenance], d => d.published && d.onSale ? "partial" : d.verified || d.observedVersions ? "foundation" : "not_started"),
      signals: [
        signal("Versions with byte observations", v(s.provenance, d => d.observedVersions)),
        signal("SHA-256 verified retained masters", v(s.provenance, d => d.verified)),
        signal("Verified masters published for public checks", v(s.provenance, d => d.published)),
        signal("Failed snapshots", v(s.provenance, d => d.failed), v(s.provenance, d => d.failed > 0)),
        signal("Songs on sale (badge candidates)", v(s.provenance, d => d.onSale))
      ],
      surfaces: [
        { label: "Provenance", href: "/provenance/" },
        { label: "Public verify tool", href: "/provenance/verify/" }
      ],
      tasks: [
        "Show a 'Verified master' badge on shop and track cards when a published, SHA-256 verified snapshot exists.",
        "Link the badge to the public verify tool, pre-filled for that release.",
        "Re-run failed snapshots before a release goes on sale; block sale-master changes without a new snapshot.",
        "Include the master fingerprint on purchase receipts."
      ],
      checkIns: ["Failed or stalled snapshots", "On-sale songs without a verified master", "Verify tool usage"]
    },
    {
      id: "stripe-runner-alerts",
      pillar: "Direct Artist Shop & Monetization",
      title: "Seamless Stripe payout and checkout flow with runner alerts",
      stage: stage([s.purchases, s.payments], (buys, pay) =>
        buys.live && !pay.openIssues ? "partial" : "foundation"), // Stripe checkout + webhook already exist
      signals: [
        signal("Live / test checkouts (30d)", v(s.purchases, d => `${d.live} / ${d.test}`)),
        signal("Abandoned DJ Vault checkouts (30d)", v(s.vaultOrders, d => d.abandoned), v(s.vaultOrders, d => d.abandoned > 0)),
        signal("Open payment queries", v(s.payments, d => d.openQueries), v(s.payments, d => d.openQueries > 0)),
        signal("Open payment / webhook issues", v(s.payments, d => d.openIssues), v(s.payments, d => d.openIssues > 0)),
        signal("Creator Passes past due", v(s.payments, d => d.pastDue), v(s.payments, d => d.pastDue > 0)),
        signal("Refunds, disputes and payouts", "Not recorded yet", true)
      ],
      surfaces: [
        { label: "Runners Briefing", href: "/halo-command.html#runnerBriefing" },
        { label: "Support desk", href: "/support/" },
        { label: "Pricing", href: "/pricing/" }
      ],
      tasks: [
        "Record Stripe refund, dispute and failed-payment webhook events alongside paid checkouts.",
        "Send runners an owner alert when a checkout fails or a dispute opens, linked to the support ticket.",
        "Add Stripe Connect payouts so artists see pending and paid-out balances.",
        "Follow up abandoned checkouts after 24 hours with a single reminder."
      ],
      checkIns: ["Failed checkouts and why", "Refunds or disputes opened", "Payout delays or questions"]
    },
    {
      id: "fast-onboarding",
      pillar: "Unified Roster & Ecosystem Flow",
      title: "Fast artist and fan sign-up with runner tracking on drop-offs",
      stage: stage([s.onboarding], d => d.joined ? (d.setupRate !== null && d.setupRate >= 60 ? "live" : "partial") : "foundation"),
      signals: [
        signal("New members (7d)", v(s.onboarding, d => d.joined)),
        signal("Music Home set up (7d joiners)", v(s.onboarding, d => `${d.setUp} (${pct(d.setupRate)})`), v(s.onboarding, d => d.setupRate !== null && d.setupRate < 60)),
        signal("Artist applications awaiting review", v(s.onboarding, d => d.awaiting), v(s.onboarding, d => d.awaiting > 0)),
        signal("Fan sign-ups (7d)", v(s.onboarding, d => d.fans))
      ],
      surfaces: [
        { label: "Artist Pro", href: "/artist-pro/" },
        { label: "Music Home", href: "/music-home/" },
        { label: "Sign-up review", href: "/halo-command.html#runnerBriefing" }
      ],
      tasks: [
        "Track each onboarding step (joined, email confirmed, Music Home created, first save or upload) as events.",
        "Show runners where people stop, step by step, with a 48-hour nudge for anyone stuck.",
        "Let fans join from the shop player with one tap and finish their profile later.",
        "Answer Artist Pro applications within 48 hours, with a visible queue age."
      ],
      checkIns: ["Drop-off step with the biggest loss", "Unverified accounts", "Applications older than 48 hours"]
    },
    {
      id: "unified-roster",
      pillar: "Unified Roster & Ecosystem Flow",
      title: "Unified HALO + HALO Rock + virtual artist roster in the shop and player",
      stage: stage([s.roster], d => d.artistPages && d.catalogArtists > 1 ? (d.haloRockSongs ? "partial" : "foundation") : "not_started"),
      signals: [
        signal("Artists in the active catalog", v(s.roster, d => d.catalogArtists)),
        signal("HALO Rock catalog songs", v(s.roster, d => d.haloRockSongs), v(s.roster, d => d.haloRockSongs === 0)),
        signal("Published artist rooms", v(s.roster, d => d.artistPages)),
        signal("Active virtual DJ / artist personas", v(s.roster, d => d.personas))
      ],
      surfaces: [
        { label: "Artist Rooms", href: "/artists/" },
        { label: "HALO Shop", href: "/music-upload/" },
        { label: "Radio personas", href: "/radio/" }
      ],
      tasks: [
        "Add a roster strip to the shop: flagship HALO, HALO Rock and virtual artists, each linking to their room and drops.",
        "Label virtual and AI artist personas clearly so fans always know who made what.",
        "Add a roster filter to the shop catalog and the player queue.",
        "Load the first HALO Rock releases into the shared catalog."
      ],
      checkIns: ["Roster artists without a room or drop", "New personas proposed", "Catalog songs missing an artist room"]
    }
  ];
}

const STAGE_RANK = { unknown: -1, not_started: 0, foundation: 1, partial: 2, live: 3 };

export async function buildShopBlueprint(db, { now = new Date() } = {}) {
  const sources = await loadSources(db, now);
  const workstreams = buildWorkstreams(sources);
  const all = Object.values(sources);
  const stages = workstreams.reduce((acc, item) => ({ ...acc, [item.stage]: (acc[item.stage] || 0) + 1 }), {});
  // The next three to build: closest to live first (fastest wins), keeping list order as tie-break.
  const nextUp = workstreams
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.stage !== "live" && item.stage !== "unknown")
    .sort((a, b) => STAGE_RANK[b.item.stage] - STAGE_RANK[a.item.stage] || a.index - b.index)
    .slice(0, 3)
    .map(({ item }) => ({ id: item.id, title: item.title, firstTask: item.tasks[0] }));
  return {
    generatedAt: now.toISOString(),
    coverage: { available: all.filter(source => source.status === "available").length, total: all.length },
    stages,
    nextUp,
    workstreams
  };
}
