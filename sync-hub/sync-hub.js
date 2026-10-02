const catalog = [
  {
    id: "something-real", title: "Something Real", artist: "Owen Anthony",
    bpm: 122, key: "Fm", genre: "Deep House / Afro House",
    description: "Hypnotic basslines, atmospheric synths, and soulful vocal hooks.",
    stems: ["Full Mix", "Instrumental", "Sax Lead", "Drums & Bass"],
    audioSrc: {
      "Full Mix": "/audio/something-real-full.mp3",
      Instrumental: "/audio/something-real-inst.mp3",
      "Sax Lead": "/audio/something-real-sax.mp3",
      "Drums & Bass": "/audio/something-real-drums.mp3"
    }
  },
  {
    id: "through-my-own-eyes", title: "Through My Own Eyes", artist: "Owen Anthony",
    bpm: 122, key: "Am", genre: "Melodic Techno / Deep House",
    description: "Rich Swahili-English vocal textures with driving spatial percussion.",
    stems: ["Full Mix", "Instrumental", "Vocal Stems", "Synth & Bass"],
    audioSrc: {
      "Full Mix": "/audio/through-eyes-full.mp3",
      Instrumental: "/audio/through-eyes-inst.mp3",
      "Vocal Stems": "/audio/through-eyes-vocals.mp3",
      "Synth & Bass": "/audio/through-eyes-synths.mp3"
    }
  }
];

const byId = id => document.getElementById(id);
let selected = catalog[0];
let stem = selected.stems[0];
let previewRequest = 0;
const player = byId("audition");
const dialog = byId("inquiry");

function renderCatalog() {
  const list = byId("catalog");
  list.replaceChildren(...catalog.map(track => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track";
    button.setAttribute("aria-pressed", String(track === selected));
    const head = document.createElement("div");
    head.className = "track-head";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const bpm = document.createElement("span");
    bpm.className = "bpm";
    bpm.textContent = `${track.bpm} BPM | ${track.key}`;
    head.append(title, bpm);
    for (const [className, text] of [
      ["artist", `by ${track.artist}`], ["genre", track.genre],
      ["description", track.description], ["available", `Stems available: ${track.stems.join(", ")}`]
    ]) {
      const line = document.createElement("p");
      line.className = className;
      line.textContent = text;
      button.append(line);
    }
    button.prepend(head);
    button.addEventListener("click", () => {
      selected = track;
      stem = track.stems[0];
      render();
    });
    return button;
  }));
}

async function updatePreview() {
  const request = ++previewRequest;
  player.pause();
  player.removeAttribute("src");
  player.load();
  const status = byId("preview-status");
  status.textContent = "Checking preview availability…";
  const src = selected.audioSrc[stem];
  try {
    const response = await fetch(src, { method: "HEAD" });
    if (request !== previewRequest) return;
    if (!response.ok || !(response.headers.get("content-type") || "").startsWith("audio/")) throw new Error("Preview unavailable");
    player.src = src;
    player.load();
    status.textContent = "Preview ready. Press play to audition.";
  } catch {
    if (request === previewRequest) status.textContent = "Preview not available yet for this stem. You can still prepare an inquiry.";
  }
}

function render() {
  renderCatalog();
  byId("selected-title").textContent = selected.title;
  byId("selected-stem").textContent = stem;
  const options = byId("stem-options");
  options.replaceChildren(...selected.stems.map(name => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stem";
    button.textContent = name;
    button.setAttribute("aria-pressed", String(name === stem));
    button.addEventListener("click", () => { stem = name; render(); });
    return button;
  }));
  updatePreview();
}

player.addEventListener("error", () => {
  byId("preview-status").textContent = "This preview could not be played. You can still prepare an inquiry.";
});
byId("open-inquiry").addEventListener("click", () => {
  byId("inquiry-track").textContent = selected.title;
  byId("inquiry-stem").textContent = stem;
  dialog.showModal();
});
byId("close-inquiry").addEventListener("click", () => dialog.close());
byId("inquiry-form").addEventListener("submit", event => {
  event.preventDefault();
  byId("inquiry-status").textContent = `Inquiry prepared for ${selected.title} (${stem}). Online submission is not available yet; no request has been sent. Please keep your details for a future inquiry.`;
  dialog.close();
});
render();
