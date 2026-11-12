import { WORLD_PALETTES, playlistWorld, buildPlaylistJourney, playlistCover, playlistExport } from "../lib/playlist-world.js";
import { publicPlaylistReleases } from "../lib/personal-playlists.js";
import { createMixSeed } from "../lib/mix-intent.js";

export function downloadPlaylist({ document, window, playlist, releases, format }) {
  const types = { svg: "image/svg+xml", json: "application/json", html: "text/html" };
  const blob = new window.Blob([playlistExport(playlist, releases, format, window.location.origin)], { type: types[format] });
  const url = window.URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `halo-playlist.${format}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export function mountPlaylistWorldEditor({ document, window, root, playlist, getReleases, save, report, canEdit = true }) {
  const world = playlistWorld(playlist.world);
  const details = document.createElement("details");
  details.className = "playlist-world-editor";
  const summary = document.createElement("summary");
  summary.textContent = canEdit ? "Shape this world / Dreamweaver journey" : "Explore this listening world";
  details.append(summary);
  const cover = document.createElement("div");
  cover.className = "playlist-generated-cover";
  cover.innerHTML = playlistCover(playlist);
  details.append(cover);
  const form = document.createElement("form");
  const field = (labelText, input) => {
    const label = document.createElement("label"); label.textContent = labelText; label.append(input); form.append(label); return input;
  };
  const select = (label, choices, value) => {
    const node = document.createElement("select");
    for (const [id, name] of choices) {
      const option = document.createElement("option"); option.value = id; option.textContent = name; node.append(option);
    }
    node.value = value; return field(label, node);
  };
  const palette = select("Original cover palette", Object.keys(WORLD_PALETTES).map(key => [key, key]), world.palette);
  const dedication = document.createElement("textarea"); dedication.maxLength = 500; dedication.value = world.dedication;
  field("Dedication (shared only when you enable a listening link)", dedication);
  const request = document.createElement("textarea"); request.maxLength = 500; request.value = world.request;
  request.placeholder = "Warm opening, deep house build, euphoric peak";
  field("Dreamweaver request / local catalog matching", request);
  const discovery = document.createElement("input"); discovery.type = "range"; discovery.min = "0"; discovery.max = "100";
  discovery.value = String(world.preferences.discovery);
  field("Familiar playlist songs 0 / New-to-this-playlist discovery 100", discovery);
  const content = select("Content controls", [["all", "All ratings"], ["exclude-explicit", "Exclude explicit (unknown ratings allowed)"],
    ["clean-only", "Only catalog-labelled clean songs (unknown excluded)"]], world.preferences.content);
  const transitions = select("Playback style", [["original", "Original-speed sequence"], ["smooth", "Smooth crossfades"],
    ["tempo", "Tempo-aware crossfades (not beatmatched)"]], world.preferences.transitions);
  const fade = document.createElement("input"); fade.type = "number"; fade.min = "2"; fade.max = "10";
  fade.value = String(world.preferences.fadeSeconds); field("Crossfade seconds (2-10)", fade);
  const normalize = document.createElement("input"); normalize.type = "checkbox"; normalize.checked = world.preferences.normalize;
  field("Optional live loudness reduction (no amplification; not mastering)", normalize);
  const chapters = document.createElement("textarea"); chapters.rows = 5;
  chapters.value = world.chapters.map(chapter => `${chapter.releaseId} | ${chapter.label} | ${chapter.energy}`).join("\n");
  field("Chapter starts: release ID | chapter name | target energy 1-4 (up to 12)", chapters);
  const help = document.createElement("p");
  help.textContent = `Available song IDs: ${playlist.releaseIds.join(", ") || "Add songs first"}. Target energy is your direction, not measured audio energy.`;
  form.append(help);
  const controls = document.createElement("div"); controls.className = "playlist-world-actions";
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "Save world";
  controls.append(submit);
  const message = document.createElement("p"); message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
  const proposals = document.createElement("div");
  const preferences = () => ({
    discovery: Number(discovery.value), content: content.value, transitions: transitions.value,
    fadeSeconds: Number(fade.value), normalize: normalize.checked
  });
  const value = () => playlistWorld({
    palette: palette.value, dedication: dedication.value, request: request.value, preferences: preferences(),
    chapters: chapters.value.split("\n").filter(line => line.trim()).map(line => {
      const [releaseId, label, energy] = line.split("|").map(part => part.trim());
      return { releaseId, label, energy: Number(energy) };
    })
  });
  const fail = error => { console.error("Playlist world", error); message.textContent = error.message; report(error.message); };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const next = value();
      if (next.chapters.some(chapter => !playlist.releaseIds.includes(chapter.releaseId))) throw new Error("Chapter starts must be in this playlist.");
      await save({ ...playlist, world: next });
    } catch (error) { fail(error); }
  });
  const generate = document.createElement("button"); generate.type = "button"; generate.textContent = "Propose a Dreamweaver journey";
  generate.addEventListener("click", () => {
    try {
      const settings = playlistWorld({ preferences: preferences() }).preferences;
      const journey = buildPlaylistJourney({
        releases: getReleases(), currentIds: playlist.releaseIds, prompt: request.value, preferences: settings, seed: createMixSeed(window.crypto)
      });
      proposals.replaceChildren();
      message.textContent = journey.notes.join(" ");
      if (!journey.tracks.length) { message.textContent += " No public songs match your controls."; return; }
      const list = document.createElement("ol");
      for (const item of journey.tracks) {
        const node = document.createElement("li");
        node.textContent = `${item.stage}: ${item.release.title} - ${item.release.artist}. ${item.explanation}`;
        list.append(node);
      }
      const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Use this order and chapters (replaces current order)";
      apply.addEventListener("click", async () => {
        try {
          await save({ ...playlist, releaseIds: journey.tracks.map(item => item.release.id), world: playlistWorld({
            ...value(), chapters: journey.chapters
          }) });
        } catch (error) { fail(error); }
      });
      proposals.append(list, apply);
    } catch (error) { fail(error); }
  });
  controls.append(generate); form.append(controls, message, proposals); details.append(form);
  const exports = document.createElement("div"); exports.className = "playlist-world-actions";
  for (const [format, label] of [["svg", "Download original cover"], ["html", "Export printable listening card"], ["json", "Export tracklist JSON"]]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => {
      try { downloadPlaylist({ document, window, playlist, releases: publicPlaylistReleases(playlist, getReleases()), format }); report("Download requested. No audio files or rights are included."); }
      catch (error) { fail(error); }
    }); exports.append(button);
  }
  details.append(exports);
  if (!canEdit) {
    form.hidden = true;
    const dedication = document.createElement("p"); dedication.textContent = world.dedication;
    details.append(dedication);
  }
  root.append(details);
  return details;
}
