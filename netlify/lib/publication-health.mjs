const READY_RADIO_STATUSES = new Set(["rotation", "preview", "held"]);

export const PUBLICATION_MONITOR_WINDOW_MINUTES = 15;

export const IN_HOUSE_DISTRIBUTOR_TEAM = Object.freeze([
  Object.freeze({
    id: "release-watch",
    label: "Release Watch",
    mission: "Keep the public release row, canonical URL, and site presence in sync.",
    handlesStates: ["fully_distributed", "missing_public_release_row", "needs_internal_repair"],
  }),
  Object.freeze({
    id: "radio-watch",
    label: "Radio Watch",
    mission: "Check for approved radio-ready audio and track broadcast delivery.",
    handlesStates: ["fully_distributed", "awaiting_radio_ready_version", "needs_artist_action"],
  }),
  Object.freeze({
    id: "dreamweaver-watch",
    label: "Dreamweaver Watch",
    mission: "Keep Dreamweaver sharing attached to the canonical published-song route.",
    handlesStates: ["fully_distributed", "missing_dreamweaver_share_payload", "needs_internal_repair"],
  }),
  Object.freeze({
    id: "artist-guide",
    label: "Artist Guide",
    mission: "Translate delivery blockers into exact next-step checklists for the artist.",
    handlesStates: ["awaiting_assets", "awaiting_radio_ready_version", "needs_artist_action", "fully_distributed"],
  }),
  Object.freeze({
    id: "repair-desk",
    label: "Repair Desk",
    mission: "Escalate platform-side faults, stale sync rows, and owner-link problems.",
    handlesStates: ["missing_public_release_row", "missing_dreamweaver_share_payload", "needs_internal_repair"],
  }),
]);

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function buildAgentAssignments(deliveryState) {
  return IN_HOUSE_DISTRIBUTOR_TEAM.map(agent => ({
    id: agent.id,
    label: agent.label,
    mission: agent.mission,
    status: agent.handlesStates.includes(deliveryState) ? "active" : "monitoring",
  }));
}

export function buildPublicationHealth({
  song,
  versions = [],
  releaseId = "",
  canonicalUrl = "",
  releaseStatus = "pending",
  radioStatus = "pending",
  dreamweaverStatus = "pending",
  radioTrackId = "",
  radioDetails = {},
  lastError = "",
} = {}) {
  const saleMaster = versions.find(version => version.version_type === "sale_master" && version.audio_url);
  const hasArtwork = Boolean(song?.artwork_url || versions.some(version => version.artwork_url));
  const approvedRadioVersion = versions.find(version =>
    ["radio_edit", "clean"].includes(version.version_type)
    && version.audio_url
    && version.mastering_status === "approved"
  );
  const propagatedSurfaces = [];
  const missingSurfaces = [];
  const checklist = [];
  let deliveryState = "fully_distributed";
  let reason = `HALO can see the public release, the site route, Dreamweaver share support, and the radio fallback for "${song?.title || "this song"}".`;
  let owner = { code: "internal", label: "In-house distributor team" };

  const publicReleaseReady = releaseStatus === "published" && Boolean(releaseId);
  const siteReady = Boolean(canonicalUrl);
  const radioReady = READY_RADIO_STATUSES.has(radioStatus) && Boolean(radioTrackId || approvedRadioVersion);
  const dreamweaverReady = dreamweaverStatus === "ready" && Boolean(canonicalUrl);

  if (publicReleaseReady) pushUnique(propagatedSurfaces, "Public release row");
  else pushUnique(missingSurfaces, "Public release row");
  if (siteReady) pushUnique(propagatedSurfaces, "HALO music page");
  else pushUnique(missingSurfaces, "HALO music page");
  if (radioReady) pushUnique(propagatedSurfaces, "HALO Radio");
  else pushUnique(missingSurfaces, "HALO Radio");
  if (dreamweaverReady) pushUnique(propagatedSurfaces, "Dreamweaver share");
  else pushUnique(missingSurfaces, "Dreamweaver share");

  if (lastError) {
    deliveryState = "needs_internal_repair";
    owner = { code: "internal", label: "Repair Desk" };
    reason = `The last distributor sweep hit an internal error: ${lastError}. HALO will keep retrying every ${PUBLICATION_MONITOR_WINDOW_MINUTES} minutes until the repair desk clears it.`;
    checklist.push(
      "Wait for the next automatic recheck or press “Recheck now” after internal changes land.",
      "If the same internal error keeps returning, share the exact failure summary with HALO support.",
      "Keep the song published so the distributor loop can continue retrying."
    );
  } else if (!publicReleaseReady) {
    deliveryState = "missing_public_release_row";
    owner = { code: "internal", label: "Release Watch" };
    reason = "The song is marked published in the catalog, but HALO does not currently see its public release row.";
    checklist.push(
      "Leave the song in Published so HALO can keep retrying the release fan-out.",
      "Press “Recheck now” after any internal release repair or migration backfill.",
      "If the row still does not appear, send the song title and release ID to HALO support for manual repair."
    );
  } else if (!dreamweaverReady) {
    deliveryState = "missing_dreamweaver_share_payload";
    owner = { code: "internal", label: "Dreamweaver Watch" };
    reason = "The release exists, but Dreamweaver does not yet have a clean canonical published-song share route to use.";
    checklist.push(
      "Keep the song published so Dreamweaver Watch can rebuild the share payload automatically.",
      "Press “Recheck now” after the public song route or release ID is corrected.",
      "Use the release row as the source of truth and avoid replacing the canonical song URL manually."
    );
  } else if (!saleMaster || !hasArtwork) {
    deliveryState = "awaiting_assets";
    owner = { code: "artist", label: "Artist action" };
    reason = !saleMaster
      ? "HALO still needs a connected sale master audio source before every downstream surface can stay healthy."
      : "HALO still needs artwork so the published song can travel with the right public-facing package.";
    if (!saleMaster) checklist.push("Upload or reconnect the approved sale master audio for this song.");
    if (!hasArtwork) checklist.push("Upload cover art for the song or at least one published version.");
    checklist.push(
      "Save the catalog record, then press “Recheck now” to have the distributor team inspect the new assets.",
      "Leave the song published so the monitor can keep retrying the missing surfaces."
    );
  } else if (!approvedRadioVersion || !radioReady) {
    deliveryState = "awaiting_radio_ready_version";
    owner = { code: "artist", label: "Artist action" };
    reason = radioDetails?.reason === "owner_membership_missing"
      ? "HALO could not attach the song to radio because the owner membership link is missing."
      : "HALO does not yet have an approved radio-ready version to place in the radio fallback lane.";
    if (radioDetails?.reason === "owner_membership_missing") {
      deliveryState = "needs_internal_repair";
      owner = { code: "internal", label: "Repair Desk" };
      checklist.push(
        "HALO support needs to repair the owner-to-radio linkage for this song.",
        "Keep the song published so the next automatic sweep can retry once the linkage is fixed.",
        "Press “Recheck now” after the internal repair is confirmed."
      );
    } else {
      checklist.push(
        "Upload audio for a radio edit or clean version.",
        "Mark at least one radio version as Approved after mastering review.",
        "Press “Recheck now” so Radio Watch can route the approved version into HALO Radio."
      );
    }
  } else if (song?.rights_status !== "cleared" || (song?.sale_status === "for_sale" && Number(song?.sale_price_cents || 0) <= 0)) {
    deliveryState = "needs_artist_action";
    owner = { code: "artist", label: "Artist action" };
    reason = song?.rights_status !== "cleared"
      ? "HALO needs a cleared rights confirmation before the published delivery loop can treat the release as complete."
      : "HALO still needs a sale price because the song is marked for sale.";
    if (song?.rights_status !== "cleared") checklist.push("Confirm ownership, samples, features, and splits in the catalog.");
    if (song?.sale_status === "for_sale" && Number(song?.sale_price_cents || 0) <= 0) checklist.push("Set a sale price for the published song.");
    checklist.push(
      "Save the song details so the distributor loop can read the new metadata.",
      "Press “Recheck now” to refresh the publication health report."
    );
  } else {
    checklist.push(
      "No action is required right now.",
      `HALO will recheck this song automatically every ${PUBLICATION_MONITOR_WINDOW_MINUTES} minutes while it stays published.`,
      "Use the canonical song link below when sharing the release from Dreamweaver or other surfaces."
    );
  }

  const surfaces = [
    {
      key: "public_release",
      label: "Public release row",
      status: publicReleaseReady ? "ready" : "missing",
      detail: publicReleaseReady ? `Release ${releaseId} is live.` : "The release row is still missing or unpublished.",
    },
    {
      key: "site",
      label: "HALO music page",
      status: siteReady ? "ready" : "missing",
      detail: siteReady ? canonicalUrl : "The canonical public song route is not ready yet.",
    },
    {
      key: "radio",
      label: "HALO Radio",
      status: radioReady ? "ready" : approvedRadioVersion ? "pending" : "missing",
      detail: radioReady
        ? `Radio status: ${titleCase(radioStatus)}.`
        : approvedRadioVersion
          ? `Approved radio version is waiting with status ${titleCase(radioStatus || "pending")}.`
          : "HALO needs an approved radio edit or clean version.",
    },
    {
      key: "dreamweaver",
      label: "Dreamweaver share",
      status: dreamweaverReady ? "ready" : "missing",
      detail: dreamweaverReady ? "Dreamweaver can share the canonical song route." : "Dreamweaver cannot see a share-ready canonical song route yet.",
    },
  ];

  return {
    deliveryState,
    stateLabel: titleCase(deliveryState),
    summary: reason,
    reason,
    owner,
    propagatedSurfaces,
    missingSurfaces,
    checklist,
    surfaces,
    canonicalUrl,
    releaseId,
    releaseStatus,
    radioStatus,
    dreamweaverStatus,
    autoRetry: deliveryState !== "fully_distributed",
    monitoringWindowMinutes: PUBLICATION_MONITOR_WINDOW_MINUTES,
    agentTeam: buildAgentAssignments(deliveryState),
  };
}
