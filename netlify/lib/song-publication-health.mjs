const READY_RADIO_STATUSES = new Set(["rotation", "preview", "held"]);

function titleCase(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isoDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function minutesSince(value, now = new Date()) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 60000));
}

function blockingMetadataIssues(song) {
  return cleanArray(song?.metadataIssues)
    .filter(issue => issue && typeof issue === "object" && issue.level === "required")
    .map(issue => ({
      field: String(issue.field || "metadata"),
      message: String(issue.message || "Complete the required release information.")
    }));
}

function buildSurfaces({ releaseReady, radioReady, dreamweaverReady, canonicalUrl, radioStatus }) {
  return [
    {
      key: "release",
      label: "Public release page",
      reached: releaseReady,
      detail: releaseReady ? `Live at ${canonicalUrl}` : "Waiting for the public music page to confirm the release."
    },
    {
      key: "radio",
      label: "HALO Radio",
      reached: radioReady,
      detail: radioReady ? `Ready in ${titleCase(radioStatus)}` : "Waiting for a dedicated radio-ready version."
    },
    {
      key: "dreamweaver",
      label: "Dreamweaver share",
      reached: dreamweaverReady,
      detail: dreamweaverReady ? "Dreamweaver can share the canonical song link." : "Waiting for Dreamweaver share readiness."
    }
  ];
}

function buildAgentTeam({ releaseReady, radioReady, dreamweaverReady, releaseBlocked, radioBlocked, lastError, escalated }) {
  return [
    {
      key: "release_distributor",
      name: "Release distributor",
      status: escalated ? "escalated" : releaseReady ? "ready" : releaseBlocked ? "repairing" : "watching",
      note: releaseReady ? "Public release page is confirmed." : releaseBlocked ? "Watching the public release surface and retrying when safe." : "Waiting for the release surface to propagate."
    },
    {
      key: "radio_distributor",
      name: "Radio distributor",
      status: escalated ? "escalated" : radioReady ? "ready" : radioBlocked ? "waiting_on_artist" : "watching",
      note: radioReady ? "Radio-ready version is connected." : radioBlocked ? "Waiting for an uploaded and approved radio or clean version." : "Watching for radio routing completion."
    },
    {
      key: "dreamweaver_share",
      name: "Dreamweaver share agent",
      status: escalated ? "escalated" : dreamweaverReady ? "ready" : releaseReady ? "watching" : "waiting_on_release",
      note: dreamweaverReady ? "Dreamweaver sharing is live." : releaseReady ? "Waiting for Dreamweaver to confirm the shared link." : "Dreamweaver will activate after the release page is ready."
    },
    {
      key: "repair_desk",
      name: "Repair desk",
      status: escalated ? "escalated" : lastError ? "repairing" : "watching",
      note: escalated ? "Internal escalation is open for manual follow-up." : lastError ? "Retrying the last failure with conservative repair rules." : "No manual repair is needed right now."
    }
  ];
}

function buildFix(title, steps, aiAssistPrompt) {
  return { title, steps: cleanArray(steps), aiAssistPrompt: String(aiAssistPrompt || "") };
}

export const PUBLICATION_HEALTH_STATES = {
  published_and_fully_distributed: "Published and fully distributed",
  awaiting_release_propagation: "Awaiting release propagation",
  awaiting_radio_ready_assets: "Awaiting radio-ready assets",
  awaiting_dreamweaver_share_readiness: "Awaiting Dreamweaver/share readiness",
  waiting_on_artist_action: "Waiting on artist action",
  waiting_on_internal_repair: "Waiting on internal repair",
  escalated: "Escalated"
};

export function buildPublicationHealth(song, sync = {}, now = new Date()) {
  const details = sync?.details && typeof sync.details === "object" ? sync.details : {};
  const versions = cleanArray(song?.versions);
  const blockingIssues = blockingMetadataIssues(song);
  const saleMaster = versions.find(version => version.versionType === "sale_master");
  const radioVersions = versions.filter(version => version.versionType === "radio_edit" || version.versionType === "clean");
  const hasRadioAudio = radioVersions.some(version => version.audioUrl);
  const hasApprovedRadioMaster = radioVersions.some(version => version.audioUrl && version.masteringStatus === "approved");
  const releaseReady = sync?.releaseStatus === "published" && String(sync?.releaseId || song?.sourceReleaseId || "") !== "" && String(sync?.canonicalUrl || "") !== "";
  const radioReady = READY_RADIO_STATUSES.has(String(sync?.radioStatus || "")) && String(sync?.radioTrackId || "") !== "";
  const dreamweaverReady = sync?.dreamweaverStatus === "ready" && String(sync?.canonicalUrl || "") !== "";
  const lastError = String(sync?.lastError || "");
  const errorStreak = Math.max(0, Number.parseInt(String(details.errorStreak || "0"), 10) || 0);
  const firstFailureAt = String(details.firstFailureAt || "");
  const escalatedAt = String(details.escalatedAt || "");
  const releaseBlocked = !releaseReady && Boolean(lastError);
  const radioBlocked = !radioReady && (!hasRadioAudio || !hasApprovedRadioMaster);
  const retryAgeMinutes = minutesSince(sync?.lastReconciledAt, now);
  const surfaces = buildSurfaces({
    releaseReady,
    radioReady,
    dreamweaverReady,
    canonicalUrl: String(sync?.canonicalUrl || ""),
    radioStatus: String(sync?.radioStatus || "")
  });
  const surfacesReached = surfaces.filter(surface => surface.reached).map(surface => surface.label);
  const missingSurfaces = surfaces.filter(surface => !surface.reached).map(surface => surface.label);
  const failureReasons = [];
  const recommendedFixes = [];
  let state = "waiting_on_internal_repair";
  let summary = "HALO is still checking the published song.";
  let retryState = "retrying";

  if (releaseReady && radioReady && dreamweaverReady) {
    state = "published_and_fully_distributed";
    summary = "HALO confirmed the song across the public release page, Dreamweaver sharing, and HALO Radio.";
    retryState = "stable";
    recommendedFixes.push(buildFix(
      "Keep the release steady",
      [
        "No repair is needed right now.",
        "If you update files or metadata, leave the song published and HALO will automatically re-check distribution."
      ],
      ""
    ));
  } else if (escalatedAt || errorStreak >= 4) {
    state = "escalated";
    summary = "HALO retried the publication loop several times and opened an internal escalation.";
    retryState = "escalated";
    failureReasons.push(lastError || "Automatic retries did not restore every publication surface.");
    recommendedFixes.push(buildFix(
      "Hold the release steady for the internal handoff",
      [
        "Do not unpublish the song unless you are replacing the release entirely.",
        "If you already fixed files or metadata, save the song or its version again to reopen automatic retries.",
        "Share the escalation note with the HALO team together with the current missing surfaces."
      ],
      `Summarize this escalated distribution issue for HALO support: ${song?.title || "Song"} by ${song?.artistName || "Artist"} is missing ${missingSurfaces.join(", ") || "a publication surface"}.`
    ));
  } else if (song?.rightsStatus !== "cleared" || blockingIssues.length) {
    state = "waiting_on_artist_action";
    summary = "The published song still has artist-owned release blockers that HALO will not guess around.";
    if (song?.rightsStatus !== "cleared") failureReasons.push("Rights and ownership are not marked as cleared.");
    blockingIssues.forEach(issue => failureReasons.push(issue.message));
    recommendedFixes.push(buildFix(
      "Clear the catalog blockers in Song Catalog",
      [
        "Open Song Catalog and select this song.",
        "Update the blocked metadata, rights, pricing, or version fields listed below.",
        "Save the song so Dreamweaver can review it again and the distributor loop can retry on the next check."
      ],
      `Turn these publication blockers into a release checklist for ${song?.title || "this song"}: ${failureReasons.join(" ")}`
    ));
  } else if (!hasRadioAudio || !hasApprovedRadioMaster) {
    state = "awaiting_radio_ready_assets";
    summary = "The public release is moving, but HALO Radio is still waiting for a dedicated radio-ready version.";
    if (!radioVersions.length) failureReasons.push("No radio edit or clean version exists yet.");
    else if (!hasRadioAudio) failureReasons.push("A radio or clean version exists, but its audio file is not connected.");
    else failureReasons.push("A radio or clean version is connected, but mastering is not approved yet.");
    recommendedFixes.push(buildFix(
      "Finish the radio version route",
      [
        "Open Song Catalog → Version routing and choose the radio edit or clean version.",
        "Upload the radio-ready file or import it from HALO Radio if it already exists there.",
        "Set mastering to Approved, save the version, and leave the song published so HALO can retry automatically."
      ],
      `Help me prepare the radio-ready release steps for ${song?.title || "this song"} by ${song?.artistName || "this artist"}.`
    ));
  } else if (!releaseReady && !lastError) {
    state = "awaiting_release_propagation";
    summary = "HALO is waiting for the public release surface to finish propagating this published song.";
    failureReasons.push("The song is marked published, but the public release page has not confirmed the release yet.");
    if (!saleMaster?.audioUrl) failureReasons.push("The sale master audio source is still missing.");
    recommendedFixes.push(buildFix(
      "Keep the release published and verify the release facts",
      [
        "Leave the song in the Published stage so the scheduled reconciler can keep checking.",
        "Confirm the sale master, title, artist name, and artwork are still correct in Song Catalog.",
        "If you changed anything important, save the song again to refresh the next reconciliation cycle."
      ],
      `Review the public-release readiness for ${song?.title || "this song"} and tell me if any catalog fields look inconsistent.`
    ));
  } else if (releaseReady && !dreamweaverReady && !lastError) {
    state = "awaiting_dreamweaver_share_readiness";
    summary = "The song is live on the public release page, and HALO is waiting for Dreamweaver sharing to catch up.";
    failureReasons.push("Dreamweaver does not yet show the canonical shared song link.");
    recommendedFixes.push(buildFix(
      "Wait for Dreamweaver share confirmation",
      [
        "Keep the song published and keep the public release link unchanged.",
        "Refresh the publication status after the next automatic check window.",
        "If the share surface still does not appear later, save the song notes once to trigger a fresh review and retry."
      ],
      `Draft a short Dreamweaver-share follow-up for ${song?.title || "this song"} so I can confirm the canonical link is ready.`
    ));
  } else {
    state = "waiting_on_internal_repair";
    summary = "HALO found a downstream distribution mismatch and is retrying a conservative repair.";
    if (lastError) failureReasons.push(lastError);
    else failureReasons.push("One or more expected surfaces are still missing after the latest reconciliation.");
    recommendedFixes.push(buildFix(
      "Let the repair loop work, then only change what is clearly wrong",
      [
        "You do not need to unpublish or re-upload everything right now.",
        "Wait for the next automatic retry window, then review the missing surfaces again.",
        "If you already know a file or metadata field is wrong, correct only that field and save once."
      ],
      `Summarize the current publication repair state for ${song?.title || "this song"} and tell me the safest single change to try next.`
    ));
  }

  return {
    state,
    label: PUBLICATION_HEALTH_STATES[state] || titleCase(state),
    summary,
    retryState,
    retrying: retryState === "retrying",
    escalated: retryState === "escalated",
    canonicalUrl: String(sync?.canonicalUrl || ""),
    releaseId: String(sync?.releaseId || song?.sourceReleaseId || ""),
    radioStatus: String(sync?.radioStatus || ""),
    dreamweaverStatus: String(sync?.dreamweaverStatus || ""),
    surfaces,
    surfacesReached,
    missingSurfaces,
    failureReasons,
    recommendedFixes,
    agentTeam: buildAgentTeam({ releaseReady, radioReady, dreamweaverReady, releaseBlocked, radioBlocked, lastError, escalated: retryState === "escalated" }),
    releaseReady,
    radioReady,
    dreamweaverReady,
    lastCheckedAt: isoDate(sync?.lastReconciledAt),
    firstFailureAt: isoDate(firstFailureAt),
    escalatedAt: isoDate(escalatedAt),
    errorStreak,
    retryAgeMinutes
  };
}

function normalizeSyncRow(sync) {
  return {
    releaseId: sync?.releaseId ?? sync?.release_id ?? "",
    radioTrackId: sync?.radioTrackId ?? sync?.radio_track_id ?? "",
    canonicalUrl: sync?.canonicalUrl ?? sync?.canonical_url ?? "",
    releaseStatus: sync?.releaseStatus ?? sync?.release_status ?? "",
    radioStatus: sync?.radioStatus ?? sync?.radio_status ?? "",
    dreamweaverStatus: sync?.dreamweaverStatus ?? sync?.dreamweaver_status ?? "",
    details: sync?.details && typeof sync.details === "object" ? sync.details : {},
    lastError: sync?.lastError ?? sync?.last_error ?? "",
    lastReconciledAt: sync?.lastReconciledAt ?? sync?.last_reconciled_at ?? ""
  };
}

export function attachPublicationHealthToSongs(catalog, syncRows = []) {
  const songs = cleanArray(catalog);
  const syncBySongId = new Map(cleanArray(syncRows).map(sync => [String(sync?.song_id || sync?.songId || ""), normalizeSyncRow(sync)]));
  return songs.map(song => ({
    ...song,
    publicationHealth: song?.pipelineStatus === "published"
      ? buildPublicationHealth(song, syncBySongId.get(String(song.id)) || {})
      : null
  }));
}
