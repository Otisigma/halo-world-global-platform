// HALO Living Player card.
// Wraps an existing <audio> element (it never takes over playback) with:
//   • a WebGL fragment-shader stage that reacts to live bass/treble energy, with an SVG fallback
//   • kinetic typography that blooms the current synced lyric line (or the track title)
//   • a provenance badge that appears ONLY when a shared, Ed25519-signed master snapshot exists
//     and its signature verifies in this browser
// Frequency analysis reuses the Obsidian visualizer (captureStream, so audio is never re-routed or muted).
import { createLivingVisualizer } from "../obsidian/living-visualizer.js";
import { parseTimestampedLyrics, findActiveLyricIndex } from "../lib/dreamweaver-lyrics.js";
import { verifySnapshotInBrowser } from "../lib/retained-record.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VERTEX = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;uniform float u_time,u_bass,u_treble;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/min(u_res.x,u_res.y);
  float t=u_time*.06,r=length(uv);
  vec2 q=vec2(fbm(uv*1.6+t),fbm(uv*1.6-t+3.1));
  float flow=fbm(uv*2.2+q*(1.4+u_bass*1.8)+t*.5);
  float ring=1.-smoothstep(0.,.02+.025*u_bass,abs(r-(.34+.08*u_bass)-.04*(flow-.5)));
  float ring2=(1.-smoothstep(0.,.006,abs(r-.47-.02*sin(t*9.+flow*6.))))*.35;
  float aura=exp(-r*r*(5.-2.6*u_bass));
  float glints=pow(noise(uv*38.+t*20.),18.)*u_treble*2.2;
  vec3 obsidian=vec3(.039,.039,.043),bronze=vec3(.36,.26,.1),gold=vec3(.83,.69,.22),pale=vec3(.95,.9,.67);
  vec3 col=obsidian;
  col=mix(col,bronze,smoothstep(.35,.85,flow)*aura*.9);
  col+=gold*aura*(.16+.55*u_bass);
  col+=mix(gold,pale,u_treble)*(ring*(.3+.7*u_bass)+ring2);
  col+=pale*glints;
  col*=1.-smoothstep(.55,1.2,r);
  gl_FragColor=vec4(col,1.);
}`;

function createShaderStage(canvas, win) {
  let gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }); } catch { gl = null; }
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader failed");
    return shader;
  };
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program failed");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = name => gl.getUniformLocation(program, name);
    const uniforms = { res: u("u_res"), time: u("u_time"), bass: u("u_bass"), treble: u("u_treble") };
    return {
      draw(time, bass, treble) {
        const ratio = Math.min(win.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, width, height);
        gl.uniform2f(uniforms.res, width, height);
        gl.uniform1f(uniforms.time, time);
        gl.uniform1f(uniforms.bass, bass);
        gl.uniform1f(uniforms.treble, treble);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  } catch (error) {
    console.warn("HALO living player: WebGL stage unavailable, using SVG", error);
    return null;
  }
}

// One shared catalog lookup per page: release id or Song Catalog song id → release.
let catalogPromise = null;
function catalogIndex(fetchImpl) {
  catalogPromise ??= fetchImpl("/api/release-catalog", { headers: { Accept: "application/json" } })
    .then(response => (response.ok ? response.json() : { releases: [] }))
    .then(data => {
      const map = new Map();
      for (const release of Array.isArray(data.releases) ? data.releases : []) {
        if (release?.id) map.set(String(release.id), release);
        if (release?.catalog?.songId) map.set(String(release.catalog.songId), release);
      }
      return map;
    })
    .catch(() => { catalogPromise = null; return new Map(); });
  return catalogPromise;
}

let keysPromise = null;
function publishedKeys(fetchImpl) {
  keysPromise ??= fetchImpl("/api/master-snapshots?action=keys", { headers: { Accept: "application/json" } })
    .then(response => { if (!response.ok) throw new Error("keys unavailable"); return response.json(); })
    .catch(error => { keysPromise = null; throw error; });
  return keysPromise;
}

// Returns the verified record, or null. Any failure means "no badge" — never a false claim.
export async function verifiedMasterRecord({ songId, versionId }, { fetchImpl = fetch, cryptoProvider = globalThis.crypto } = {}) {
  if (!UUID.test(songId || "") || !UUID.test(versionId || "")) return null;
  try {
    const query = new URLSearchParams({ action: "public-latest", songId, versionId });
    const response = await fetchImpl(`/api/master-snapshots?${query}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const envelope = await response.json();
    if (envelope?.shared !== true) return null;
    const record = await verifySnapshotInBrowser(envelope, await publishedKeys(fetchImpl), cryptoProvider);
    if (record.songId !== songId || record.versionId !== versionId) return null;
    return { record, limitation: String(envelope.limitation || "") };
  } catch {
    return null;
  }
}

export function lyricsFor(release) {
  const source = release?.dreamweaverPayload?.lyricsText || "";
  const parsed = parseTimestampedLyrics(source);
  const timed = parsed.lines.filter(line => line.time !== null && line.kind !== "section");
  return { timed, hasTimed: timed.length > 0 };
}

const el = (doc, tag, className, attrs = {}) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function mountLivingPlayer({ mount, audio, label = "HALO living player", window: win = globalThis.window,
  document: doc = globalThis.document, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  if (!mount || !audio) throw new TypeError("The living player needs a mount element and an audio element");
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");

  const root = el(doc, "section", "halo-living", { "aria-label": label });
  const stage = el(doc, "div", "halo-living-stage");
  const canvas = el(doc, "canvas", "halo-living-gl", { "aria-hidden": "true" });
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "halo-living-svg");
  svg.setAttribute("viewBox", "0 0 500 300");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = `<defs><radialGradient id="haloLivingGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#d4af37" stop-opacity=".6"/><stop offset="60%" stop-color="#8a6f1a" stop-opacity=".2"/>
    <stop offset="100%" stop-color="#0a0a0a" stop-opacity="0"/></radialGradient></defs>
    <circle class="halo-living-aura" cx="250" cy="150" r="130" fill="url(#haloLivingGlow)"/>
    <circle class="halo-living-ring" cx="250" cy="150" r="140" fill="none" stroke="#d4af37" stroke-width=".6" stroke-dasharray="4 8"/>
    <circle class="halo-living-ring is-inner" cx="250" cy="150" r="96" fill="none" stroke="#f3e5ab" stroke-width=".8"/>`;
  const words = el(doc, "div", "halo-living-words");
  const line = el(doc, "p", "halo-living-line");
  const next = el(doc, "p", "halo-living-next", { "aria-hidden": "true" });
  words.append(line, next);
  stage.append(canvas, svg, words);

  const bar = el(doc, "div", "halo-living-bar");
  const meta = el(doc, "div", "halo-living-meta");
  const title = el(doc, "strong");
  const artist = el(doc, "span");
  meta.append(title, artist);
  const badge = el(doc, "a", "halo-living-badge");
  badge.hidden = true;
  const toggle = el(doc, "button", "halo-living-toggle", { type: "button", "aria-pressed": "false" });
  toggle.textContent = "Enable audio visualizer";
  bar.append(meta, badge, toggle);
  const status = el(doc, "p", "halo-living-status", { role: "status" });
  root.append(stage, bar, status);
  mount.replaceChildren(root);

  // Live analysis levels (targets) and the smoothed values the stage draws with.
  const level = { bass: 0, treble: 0, targetBass: 0, targetTreble: 0 };
  const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
  const supported = Boolean(AudioContextCtor) && typeof audio.captureStream === "function";
  const visualizer = createLivingVisualizer({ audio, button: toggle, status, field: svg, window: win, document: doc,
    onFrame: (bass, treble) => { level.targetBass = bass; level.targetTreble = treble; } });
  if (!supported) {
    toggle.hidden = true;
    status.textContent = "Live frequency analysis isn't available in this browser. Playback is unchanged.";
  } else {
    status.textContent = "Press play, then enable the visualizer to let the stage react to the music.";
  }

  // Remember the listener's choice so the visual follows them from track to track.
  let wanted = false;
  root.addEventListener("click", event => {
    if (event.target === toggle) wanted = !visualizer.active;
  }, true);
  audio.addEventListener("loadstart", () => { if (visualizer.active) visualizer.reset(); });
  audio.addEventListener("playing", () => { if (wanted && supported && !visualizer.active) void visualizer.enable(); });

  let shader = createShaderStage(canvas, win);
  const useSvg = () => { shader = null; root.classList.add("is-svg"); };
  if (!shader) useSvg();
  canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); useSvg(); });

  let frame = null, visible = true, startTime = win.performance.now();
  const shouldAnimate = () => visible && !doc.hidden && !motion.matches
    && (!audio.paused || level.bass > 0.005 || level.treble > 0.005);
  function draw(now) {
    const ease = (value, target) => value + (target - value) * (target > value ? 0.45 : 0.08);
    level.bass = ease(level.bass, audio.paused ? 0 : level.targetBass);
    level.treble = ease(level.treble, audio.paused ? 0 : level.targetTreble);
    root.style.setProperty("--living-bass", level.bass.toFixed(3));
    shader?.draw(motion.matches ? 0 : (now - startTime) / 1000, level.bass, level.treble);
  }
  function loop(now) {
    frame = null;
    draw(now);
    if (shouldAnimate()) frame = win.requestAnimationFrame(loop);
  }
  function wake() {
    if (frame === null) frame = win.requestAnimationFrame(loop);
  }
  if ("IntersectionObserver" in win) {
    new win.IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) wake(); }).observe(root);
  }
  if ("ResizeObserver" in win) new win.ResizeObserver(() => wake()).observe(stage);
  for (const type of ["play", "playing", "pause", "seeked"]) audio.addEventListener(type, wake);
  doc.addEventListener("visibilitychange", wake);
  wake();

  // Kinetic typography.
  let lyrics = { timed: [], hasTimed: false };
  let current = { title: "", artist: "" };
  let shownIndex = -2;
  function bloom(text, upcoming = "") {
    line.textContent = text;
    next.textContent = upcoming;
    line.classList.remove("is-blooming");
    void line.offsetWidth; // restart the CSS bloom animation
    line.classList.add("is-blooming");
  }
  function syncWords() {
    if (!current.title) {
      if (shownIndex !== -3) { shownIndex = -3; bloom("Press play to enter the soundscape…"); }
      return;
    }
    if (!lyrics.hasTimed) {
      if (shownIndex !== -1) { shownIndex = -1; bloom(current.title, current.artist); }
      return;
    }
    const index = findActiveLyricIndex(lyrics.timed, audio.currentTime);
    if (index === shownIndex) return;
    shownIndex = index;
    if (index < 0) bloom(current.title, lyrics.timed[0]?.text || "");
    else bloom(lyrics.timed[index].text, lyrics.timed[index + 1]?.text || "");
  }
  audio.addEventListener("timeupdate", syncWords);
  audio.addEventListener("seeked", syncWords);
  syncWords();

  function showBadge(verified) {
    if (!verified) { badge.hidden = true; badge.removeAttribute("href"); return; }
    const { record, limitation } = verified;
    badge.textContent = `Signed master · SHA-256 ${record.sha256.slice(0, 10)}…`;
    badge.href = `/provenance/verify/?record=${encodeURIComponent(record.recordId)}`;
    badge.title = `${limitation} Open the verifier to check this record or compare your own copy.`.trim();
    badge.setAttribute("aria-label", `Signed master snapshot, SHA-256 beginning ${record.sha256.slice(0, 10)}. Open the HALO verifier.`);
    badge.hidden = false;
  }

  let generation = 0;
  async function setTrack(track) {
    const ticket = ++generation;
    current = { title: String(track?.title || ""), artist: String(track?.artist || "") };
    title.textContent = current.title || "Nothing playing yet";
    artist.textContent = current.artist;
    lyrics = { timed: [], hasTimed: false };
    shownIndex = -2;
    showBadge(null);
    syncWords();
    const key = String(track?.releaseId || track?.songId || "");
    if (!key) return;
    const release = (await catalogIndex(fetchImpl)).get(key);
    if (ticket !== generation || !release) return;
    lyrics = lyricsFor(release);
    shownIndex = -2;
    syncWords();
    const verified = await verifiedMasterRecord({ songId: release.catalog?.songId, versionId: release.catalog?.masterCopy?.versionId }, { fetchImpl });
    if (ticket === generation) showBadge(verified);
  }
  setTrack(null);

  return { setTrack, root };
}
