import { buildDeckCompanion, buildReleaseKit, cleanCompanionTrack, parseReleaseKit, releaseKitSvg, RELEASE_KIT_DISCLOSURE, RELEASE_KIT_STORAGE_KEY } from "../lib/dreamweaver-deck.js";

const host = document.querySelector("#dreamweaverDeckCompanion");
const isDeck = host?.dataset.surface === "deck";
const params = new URLSearchParams(location.search);
let kit = null;
if (host && !isDeck && params.get("deck-kit") === "1") {
  try {
    const raw = localStorage.getItem(RELEASE_KIT_STORAGE_KEY);
    const saved = JSON.parse(raw || "null");
    const age = Date.now() - Number(saved?.savedAt);
    const draft = parseReleaseKit(raw);
    if (draft?.mixId && draft.mixId === params.get("mix") && age >= 0 && age < 3_600_000) kit = draft;
  } catch {}
}

if (host && (isDeck || kit)) {
  host.hidden = false;
  host.innerHTML = `
    <details open>
      <summary>V2 / Dreamweaver deck companion</summary>
      <p>${RELEASE_KIT_DISCLOSURE}</p>
      <div class="dw-companion-grid">
        <section data-live ${isDeck ? "" : "hidden"}>
          <h3>In the room</h3><p data-current>No track loaded.</p>
          <p data-context></p><h3>Energy / set arc</h3>
          <p data-phase></p><div class="dw-companion-energy" data-energy role="img"></div>
          <ol data-arc></ol><h3>Next move / advisory only</h3><p data-next></p>
          <p data-count>No performed selections yet.</p>
          <button type="button" data-reset>Start a new companion log</button>
        </section>
        <form data-kit-form ${isDeck ? "" : "hidden"}>
          <h3>Live set → release kit</h3>
          <label>Release title<input name="title" maxlength="140" placeholder="HALO live session"></label>
          <label>DJ / artist credit<input name="artist" maxlength="180" placeholder="HALO DJ"></label>
          <label>Release format<select name="format"><option value="free_stream">Live mix / free stream</option><option value="mix_album">Mix album</option></select></label>
          <label>Audience<input name="audience" maxlength="180" placeholder="The HALO room"></label>
          <label>Set notes / creative intent<textarea name="notes" maxlength="600" placeholder="What should listeners feel?"></textarea></label>
          <button type="submit" data-build disabled>Build draft release kit</button>
          <p>Only successful playback starts enter the tracklist, including previews or muted decks. Review the order before release. Offsets are session notes, not final master timestamps. This page-only log resets on reload. Nothing is uploaded.</p>
        </form>
        <section class="dw-companion-preview" data-preview hidden>
          <h3 data-title></h3><img data-cover alt="Dreamweaver draft release cover">
          <p data-description></p><ol data-chapters></ol><pre data-tracklist></pre><p data-offset-note></p>
          <h3>Rollout / fan copy</h3><pre data-rollout></pre><ul data-review></ul>
          <div class="dw-companion-actions">
            <button type="button" data-download="json">Download kit JSON</button>
            <button type="button" data-download="tracklist">Tracklist</button>
            <button type="button" data-download="cover">Cover SVG</button>
            <button type="button" data-download="card">Share card SVG</button>
            <button type="button" data-flightplan ${isDeck ? "" : "hidden"}>Fill empty flightplan draft fields</button>
            <a data-handoff target="_blank" rel="noopener" hidden>Continue in Dreamweaver ↗</a>
            <button type="button" data-campaign ${isDeck ? "hidden" : ""}>Use hook in campaign form</button>
          </div>
          <p data-handoff-note></p>
        </section>
      </div>
      <p class="dw-companion-status" data-status role="status"></p>
    </details>`;

  const node = selector => host.querySelector(selector);
  const text = (selector, value) => { node(selector).textContent = value; };
  const form = node("[data-kit-form]");
  let snapshot = {};
  let model = buildDeckCompanion();
  let coverUrl = "";
  let firstPlayedAt = null;
  let logRecordingId = "";
  let excludedRecordingId = "";
  const performed = [];
  const playingByDeck = new Map();
  const renderList = (selector, values) => {
    node(selector).replaceChildren(...values.map(value => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }));
  };

  function rememberPlayback(detail) {
    const track = cleanCompanionTrack(detail?.track);
    if (!track) return;
    const recordingId = String(detail.recordingId || "");
    if (recordingId && recordingId !== logRecordingId && recordingId !== excludedRecordingId) {
      performed.length = 0;
      playingByDeck.clear();
      firstPlayedAt = null;
      logRecordingId = recordingId;
      kit = null;
      node("[data-preview]").hidden = true;
    } else if (!recordingId) logRecordingId = "";
    if (performed.length >= 200) return;
    if (playingByDeck.get(detail.deck) === track.id && performed.at(-1)?.id === track.id) return;
    playingByDeck.set(detail.deck, track.id);
    const now = performance.now();
    if (firstPlayedAt === null) firstPlayedAt = now;
    performed.push({ ...track, offsetSeconds: (now - firstPlayedAt) / 1000 });
    text("[data-count]", `${performed.length} performed selections captured in this page session.`);
    node("[data-build]").disabled = false;
    if (kit) text("[data-status]", "New playback captured. Rebuild the draft to include the latest selections.");
  }

  function renderKit() {
    if (!kit) return;
    node("[data-preview]").hidden = false;
    text("[data-title]", `${kit.title} / draft`);
    text("[data-description]", kit.description);
    text("[data-tracklist]", kit.tracklist);
    text("[data-offset-note]", kit.timestampNote);
    text("[data-rollout]", `Teaser: ${kit.rollout.teaser}\n\nRelease: ${kit.rollout.release}\n\nFollow-up: ${kit.rollout.followUp}\n\nShare caption:\n${kit.shareCaption}`);
    renderList("[data-chapters]", kit.chapters.map(chapter => `${chapter.label} — ${chapter.copy}`));
    renderList("[data-review]", kit.reviewChecklist);
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = URL.createObjectURL(new Blob([releaseKitSvg(kit)], { type: "image/svg+xml" }));
    node("[data-cover]").src = coverUrl;
    const handoff = node("[data-handoff]");
    handoff.hidden = !isDeck || !kit.destination;
    handoff.href = kit.destination ? `${kit.destination}&deck-kit=1` : "/dreamweaver/";
    text("[data-handoff-note]", kit.destination
      ? "Dreamweaver opens the linked mix in a new tab. Your live deck stays here."
      : "Download this draft now. Post the finished recording through the deck, then rebuild to link the exact mix in Dreamweaver.");
  }

  function refresh() {
    if (!isDeck || typeof window.haloDreamweaverDeckSnapshot !== "function") return;
    try {
      snapshot = window.haloDreamweaverDeckSnapshot();
      model = buildDeckCompanion(snapshot);
      text("[data-current]", model.current ? `Deck ${model.deck} / ${model.current.playing ? "Live" : "Ready"}: ${model.current.artist} — ${model.current.title} · ${model.current.bpm} BPM · ${model.current.key}` : "No track loaded.");
      text("[data-context]", model.context);
      text("[data-phase]", `${model.persona} / ${model.curve} / ${model.phase}`);
      text("[data-next]", model.nextMove);
      node("[data-energy]").setAttribute("aria-label", `Target energy curve: ${model.energyCurve.join(", ")} out of 10`);
      node("[data-energy]").replaceChildren(...model.energyCurve.map(value => {
        const bar = document.createElement("i");
        bar.style.height = `${value * 10}%`;
        return bar;
      }));
      renderList("[data-arc]", model.setArc.map(step => `${step.title}: ${step.purpose}`));
      if (kit && !kit.destination && linkedMixId()) text("[data-status]", "This recording is now posted. Rebuild the draft to enable the exact Dreamweaver handoff.");
    } catch {
      text("[data-status]", "Companion context unavailable. Live deck controls remain independent.");
    }
  }

  function linkedMixId() {
    return logRecordingId && logRecordingId === snapshot.publishedRecordingId && !snapshot.recordingActive ? snapshot.mixId : "";
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    refresh();
    try {
      kit = buildReleaseKit({
        ...Object.fromEntries(new FormData(form)),
        tracks: performed, mood: model.current?.mood, mixId: linkedMixId()
      });
      renderKit();
      text("[data-status]", "Draft built locally. Review every asset and clearance before release.");
    } catch (error) {
      text("[data-status]", error.message);
    }
  });

  node("[data-reset]").addEventListener("click", () => {
    refresh();
    excludedRecordingId = snapshot.recordingId || "";
    logRecordingId = "";
    performed.length = 0;
    playingByDeck.clear();
    firstPlayedAt = null;
    kit = null;
    node("[data-preview]").hidden = true;
    node("[data-build]").disabled = true;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = "";
    text("[data-count]", "No performed selections yet.");
    text("[data-status]", "New companion log started. The live deck and recorder are unchanged.");
  });

  node("[data-flightplan]").addEventListener("click", () => {
    if (!kit) return;
    const flightplan = document.querySelector("#mixFlightplanForm");
    if (!flightplan) return;
    const values = { projectTitle: kit.title, mixPlanTitle: kit.title, djName: kit.artist, targetAudience: kit.audience, tracklist: kit.tracklist, reviewIntent: kit.notes, campaignHook: kit.rollout.teaser };
    Object.entries(values).forEach(([name, value]) => {
      const field = flightplan.elements.namedItem(name);
      if (field && !field.value.trim()) {
        field.value = value.slice(0, field.maxLength > 0 ? field.maxLength : value.length);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    text("[data-status]", "Empty flightplan draft fields filled. Existing edits, format, mastering and rights gates are unchanged.");
  });

  node("[data-handoff]").addEventListener("click", event => {
    if (!kit?.destination) { event.preventDefault(); return; }
    try {
      localStorage.setItem(RELEASE_KIT_STORAGE_KEY, JSON.stringify({ ...kit, savedAt: Date.now() }));
    } catch {
      event.preventDefault();
      text("[data-status]", "Draft storage unavailable. Download the kit instead; the deck remains live.");
    }
  });

  node("[data-campaign]").addEventListener("click", () => {
    const headline = document.querySelector("#campaignHeadline");
    if (!kit || !headline) return;
    if (headline.value.trim()) {
      text("[data-status]", "Campaign headline already has an edit. Copy your preferred hook from the kit.");
      return;
    }
    headline.value = kit.rollout.teaser.slice(0, 120);
    headline.dispatchEvent(new Event("input", { bubbles: true }));
    text("[data-status]", "Draft hook added to the campaign form. Open Make a reel / short to review and generate through the existing Dreamweaver workflow.");
  });

  host.querySelectorAll("[data-download]").forEach(button => button.addEventListener("click", () => {
    if (!kit) return;
    const type = button.dataset.download;
    const content = type === "json" ? JSON.stringify(kit, null, 2) : type === "tracklist" ? `${kit.tracklist}\n\n${kit.timestampNote}\n${kit.disclosure}` : releaseKitSvg(kit, { card: type === "card" });
    const mime = type === "json" ? "application/json" : type === "tracklist" ? "text/plain" : "image/svg+xml";
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `halo-release-${type}.${type === "json" ? "json" : type === "tracklist" ? "txt" : "svg"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));

  const onPlayback = event => { rememberPlayback(event.detail); refresh(); };
  let timer;
  if (isDeck) {
    window.addEventListener("halo:deck-playback-started", onPlayback);
    refresh();
    timer = setInterval(refresh, 1000);
  } else renderKit();
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    clearInterval(timer);
    window.removeEventListener("halo:deck-playback-started", onPlayback);
    if (coverUrl) URL.revokeObjectURL(coverUrl);
  });
}
