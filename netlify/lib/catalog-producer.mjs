import { randomUUID } from "node:crypto";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const cleanLabel = value => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
const projectedNet = priceCents => Math.round(priceCents * 100 * 0.97);

function packagePrice(tracks, factor, minimum, maximum) {
  const retail = tracks.reduce((total, track) => total + Number(track.sale_price_cents || 129), 0);
  return clamp(Math.round((retail * factor) / 100) * 100, minimum, maximum);
}

function buildPackage(packageType, title, description, rationale, tracks, priceCents, signals = {}) {
  return { packageType, title, description, rationale, tracks, priceCents, signals };
}

function assemblePackages(candidates) {
  if (!candidates.length) return [];
  const packages = [];
  const ranked = [...candidates].sort((left, right) => Number(right.engagement_score) - Number(left.engagement_score) || Number(right.metadata_score) - Number(left.metadata_score));
  const artist = cleanLabel(ranked[0].artist_name) || "HALO Artist";

  const groups = new Map();
  for (const track of ranked) {
    const groupName = cleanLabel(track.album_title) || cleanLabel(track.genre);
    if (!groupName) continue;
    groups.set(groupName, [...(groups.get(groupName) || []), track]);
  }
  [...groups.entries()]
    .filter(([, tracks]) => tracks.length >= 4)
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 4)
    .forEach(([groupName, tracks]) => {
      const albumTracks = tracks.slice(0, 12);
      packages.push(buildPackage(
        "album",
        groupName,
        `${albumTracks.length} sale-ready songs assembled as a focused direct-to-fan album.`,
        "Dreamweaver grouped songs that share an existing project or genre signal, then ranked them by audience activity and catalog readiness.",
        albumTracks,
        packagePrice(albumTracks, 0.7, 700, 1800),
        { grouping: groupName, strongestEngagement: Number(albumTracks[0].engagement_score || 0) }
      ));
    });

  if (ranked.length >= 3) {
    const mixTracks = ranked.slice(0, Math.min(18, ranked.length));
    packages.push(buildPackage(
      "mix",
      `${artist} — Catalog Heat Mix`,
      `${mixTracks.length} high-signal songs sequenced as a continuous promotional and sale package.`,
      "Dreamweaver prioritized recent release-kit opens, outbound listens, complete metadata, and prepared sale masters.",
      mixTracks,
      packagePrice(mixTracks, 0.55, 800, 2400),
      { ranking: "engagement_then_readiness", strongestEngagement: Number(mixTracks[0].engagement_score || 0) }
    ));
  }

  if (ranked.length >= 2) {
    const vaultPrice = packagePrice(ranked, 0.35, 2900, 9900);
    packages.push(buildPackage(
      "vault",
      `${artist} — Complete Catalog Vault`,
      `A collector package containing all ${ranked.length} currently cleared, priced, and connected sale masters.`,
      "The vault gives dedicated listeners the strongest value while keeping the catalog under direct artist control.",
      ranked,
      vaultPrice,
      { catalogCoverage: 100, sourceTrackCount: ranked.length }
    ));
  }

  if (!packages.length) {
    packages.push(buildPackage(
      "album",
      `${artist} — Direct Edition`,
      `${ranked.length} sale-ready song${ranked.length === 1 ? "" : "s"} prepared as a direct edition.`,
      "This starter package keeps the current cleared catalog sellable while more songs become ready.",
      ranked,
      packagePrice(ranked, 0.8, 199, 1200),
      { grouping: "starter" }
    ));
  }
  return packages.slice(0, 6);
}

export async function runCatalogProducer(database, ownerMemberId, jobId) {
  await database.sql`UPDATE halo_catalog_producer_jobs SET status = 'working', stage = 'scanning', progress = 18, updated_at = NOW() WHERE id = ${jobId} AND owner_member_id = ${ownerMemberId}`;
  const candidates = await database.sql`
    SELECT song.id, song.artist_name, song.title, song.album_title, song.genre,
      song.sale_price_cents, song.metadata_score, song.updated_at,
      COUNT(event.id)::int AS engagement_score
    FROM halo_song_catalog song
    JOIN halo_song_versions version ON version.song_id = song.id
      AND version.status = 'active'
      AND version.version_type = 'sale_master'
      AND version.sale_enabled = TRUE
      AND version.mastering_status = 'approved'
      AND (version.audio_url <> '' OR version.audio_blob_prefix <> '')
    LEFT JOIN halo_release_campaign_events event ON event.release_id = song.source_release_id
      AND event.created_at >= NOW() - INTERVAL '30 days'
    WHERE song.owner_member_id = ${ownerMemberId}
      AND song.status = 'active'
      AND song.sale_status = 'for_sale'
      AND song.rights_status = 'cleared'
      AND song.sale_price_cents > 0
      AND song.metadata_score >= 60
    GROUP BY song.id
    ORDER BY engagement_score DESC, song.metadata_score DESC, song.updated_at DESC
    LIMIT 300
  `;

  await database.sql`UPDATE halo_catalog_producer_jobs SET stage = 'grouping', progress = 48, updated_at = NOW() WHERE id = ${jobId}`;
  const packages = assemblePackages(candidates);
  await database.sql`DELETE FROM halo_catalog_packages WHERE owner_member_id = ${ownerMemberId} AND strategy = 'dreamweaver' AND status = 'draft'`;
  await database.sql`UPDATE halo_catalog_producer_jobs SET stage = 'pricing', progress = 72, updated_at = NOW() WHERE id = ${jobId}`;

  for (const proposal of packages) {
    const packageId = randomUUID();
    await database.sql`
      INSERT INTO halo_catalog_packages (
        id, owner_member_id, source_job_id, package_type, title, description, rationale,
        price_cents, projected_monthly_net_cents, track_count, signals
      ) VALUES (
        ${packageId}, ${ownerMemberId}, ${jobId}, ${proposal.packageType}, ${proposal.title},
        ${proposal.description}, ${proposal.rationale}, ${proposal.priceCents},
        ${projectedNet(proposal.priceCents)}, ${proposal.tracks.length}, ${JSON.stringify(proposal.signals)}::jsonb
      )
    `;
    for (const [index, track] of proposal.tracks.entries()) {
      await database.sql`
        INSERT INTO halo_catalog_package_tracks (id, package_id, song_id, position, engagement_score)
        VALUES (${randomUUID()}, ${packageId}, ${track.id}, ${index + 1}, ${Number(track.engagement_score || 0)})
      `;
    }
  }

  await database.sql`
    UPDATE halo_catalog_producer_jobs
    SET status = 'ready', stage = 'ready', progress = 100, package_count = ${packages.length},
      error_message = ${packages.length ? "" : "No songs meet the sale-ready rules yet."}, completed_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId} AND owner_member_id = ${ownerMemberId}
  `;
  return packages.length;
}
