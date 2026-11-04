const versionFields = new Set(["sale_master", "sale_master_audio", "radio_edit", "radio_audio", "radio_master"]);

export function catalogGuidance({ authenticated, song, songCount = 0 }) {
  if (!authenticated) return null;
  if (!song) return {
    title: songCount ? "Choose a song" : "Start your catalog",
    detail: "Readiness and next steps are specific to each saved song.",
    next: songCount ? "Select a song from All songs to inspect its saved state." : "Add a song to create its catalog record, then connect audio and review the information.",
    target: songCount ? "songList" : "addSongButton",
    action: songCount ? "Choose a song" : "Add a song"
  };

  const required = (Array.isArray(song.metadataIssues) ? song.metadataIssues : []).filter(issue => issue?.level === "required");
  if (song.pipelineStatus === "published") {
    const health = song.publicationHealth;
    return {
      title: health?.label || "Published · checks pending",
      detail: health?.summary || "The catalog marks this song as published. A publication-health snapshot is not available yet.",
      next: health?.state === "published_and_fully_distributed"
        ? "Review the recorded surface checks below. These checks are not listener counts or a guarantee of streaming availability."
        : "Inspect the publication-health report for missing surfaces, recommended fixes, and retry status. Do not infer missing files from an unconfirmed surface.",
      target: "publicationHealthPanel",
      action: "Review publication health"
    };
  }

  const blocker = required[0];
  if (blocker) return {
    title: versionFields.has(blocker.field) ? "Required version work" : "Release information needs attention",
    detail: blocker.message,
    next: versionFields.has(blocker.field)
      ? "Open the relevant version to connect audio or review mastering, then save it to refresh the catalog review."
      : "Correct the listed information, then use Save + review to check the song again.",
    target: versionFields.has(blocker.field) ? "versionTable" : "songForm",
    action: versionFields.has(blocker.field) ? "Review version routing" : "Review song information"
  };

  if (song.metadataStatus === "ready") return {
    title: "Ready for publication review",
    detail: "The saved catalog review reports no required items or recommendations. This does not mean the song is published or in rotation.",
    next: "Review the saved information and the existing Push to Shop & Charts confirmation only when you intend to publish. Publication remains an authorized decision.",
    target: "songForm",
    action: "Review publication decision"
  };

  return {
    title: song.metadataStatus === "reviewed" ? "Review recommendations" : "Catalog review needed",
    detail: song.metadataStatus === "reviewed"
      ? "The saved review has recommendations, but no required blockers are listed."
      : "This song has not been confirmed ready by the saved catalog review.",
    next: "Inspect Dreamweaver review, address the listed items, and run the review again. Uploading alone does not publish a song.",
    target: "songReview",
    action: "Review next steps"
  };
}

export function renderCatalogGuidance({ root, ...context }) {
  const guidance = catalogGuidance(context);
  root.hidden = !guidance;
  for (const key of ["title", "detail", "next"]) {
    root.querySelector(`[data-guidance-${key}]`).textContent = guidance?.[key] || "";
  }
  const action = root.querySelector("[data-guidance-action]");
  const add = root.querySelector("[data-guidance-add]");
  const adding = guidance?.target === "addSongButton";
  add.hidden = !adding;
  action.hidden = !guidance || adding;
  action.textContent = guidance?.action || "";
  if (guidance && !adding) action.setAttribute("href", `#${guidance.target}`);
  else action.removeAttribute("href");
}
