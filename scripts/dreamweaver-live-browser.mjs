import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = process.env.HALO_AUDIO_PROBE_ORIGIN || "https://halo-world-global-platform.netlify.app";
const base = new URL(origin);
if (base.username || base.password || base.pathname !== "/" || base.search || base.hash
  || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) {
  throw new Error("Provide a public HTTPS origin (HTTP is allowed only for a local test fixture).");
}
const songId = process.env.HALO_AUDIO_PROBE_SONG_ID;
if (!/^[0-9a-f-]{36}$/i.test(songId || "")) throw new Error("Provide a public song UUID.");
const target = new URL("/dreamweaver/", base);
target.search = new URLSearchParams({ mix: "owen-anthony-quiet-heart", song: songId, satellite: "dreamweaver" });
const boundRanges = process.env.HALO_AUDIO_PROBE_BOUND_RANGES === "1";
const candidatePlayer = process.env.HALO_AUDIO_PROBE_CANDIDATE_PLAYER === "1";
const checkCinema = process.env.HALO_AUDIO_PROBE_CINEMA === "1";
if (checkCinema && (candidatePlayer || boundRanges)) {
  throw new Error("Cinema verification must use unchanged production, not candidate experiments.");
}
const replacements = new Map(candidatePlayer ? await Promise.all([
  "dreamweaver/dreamweaver.js", "lib/halo-sentinel.js", "lib/audio-stream-diagnostics.js",
  "dreamweaver-lab/resumable-upload.js",
].map(async path => [`/${path}`, await readFile(new URL(`../${path}`, import.meta.url), "base64")])) : []);
const profile = await mkdtemp(join(tmpdir(), "halo-live-browser-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
const observed = [];
const mediaRequests = new Set();
let sequence = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
    let text = "";
    chrome.once("error", error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on("data", bytes => {
      text += bytes.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      }
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const replacement = replacements.get(new URL(request.url).pathname);
      if (replacement) {
        void send("Fetch.fulfillRequest", {
          requestId, responseCode: 200, body: replacement,
          responseHeaders: [{ name: "Content-Type", value: "text/javascript" }, { name: "Cache-Control", value: "no-store" }],
        }, message.sessionId).catch(error => observed.push({ interceptionError: error.message }));
        return;
      }
      const headers = Object.entries(request.headers).map(([name, value]) => {
        if (name.toLowerCase() !== "range") return { name, value };
        const range = /^bytes=(\d+)-(\d*)$/i.exec(value);
        if (!range) return { name, value };
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : Infinity, start + 4 * 1024 * 1024 - 1);
        return { name, value: `bytes=${start}-${end}` };
      });
      void send("Fetch.continueRequest", { requestId, headers }, message.sessionId).catch(error => {
        observed.push({ interceptionError: error.message });
      });
    } else if (message.method === "Network.requestWillBeSent") {
      const { requestId, request } = message.params;
      if (new URL(request.url).pathname === "/api/song-catalog/audio") {
        mediaRequests.add(requestId);
        observed.push({ method: request.method, range: request.headers.Range || request.headers.range || "" });
      }
    } else if (message.method === "Network.responseReceived") {
      const response = message.params.response;
      const path = new URL(response.url).pathname;
      if (path === "/api/song-catalog/audio") observed.push({
        path, status: response.status, type: response.mimeType,
        range: response.headers["content-range"] || response.headers["Content-Range"],
        length: response.headers["content-length"] || response.headers["Content-Length"],
      });
    } else if (message.method === "Network.loadingFailed" && mediaRequests.has(message.params.requestId)) {
      observed.push({ mediaRequestFailed: message.params.errorText });
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      observed.push({ exception: details.text, description: details.exception?.description?.split("\n").slice(0, 2).join(" ").slice(0, 500) });
    } else if (message.method === "Page.fileChooserOpened") {
      observed.push({ filePickerOpened: true });
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome debugging connection failed")), { once: true });
  });
  async function send(method, params = {}, sessionId) {
    const id = ++sequence;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    let timer;
    try {
      return await Promise.race([result, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15000);
      })]);
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const response = await command("Runtime.evaluate", { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error("Browser evaluation failed.");
    return response.result.value;
  };
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  if (boundRanges || candidatePlayer) {
    if (boundRanges) console.log("EXPERIMENT: cap browser media range requests to 4 MiB; this does not change deployed code.");
    if (candidatePlayer) console.log("EXPERIMENT: use this branch's four player modules only in this isolated browser; production is unchanged.");
    await command("Fetch.enable", { patterns: [
      ...(boundRanges ? [{ urlPattern: `${target.origin}/api/song-catalog/audio*`, requestStage: "Request" }] : []),
      ...[...replacements.keys()].map(path => ({ urlPattern: `${target.origin}${path}*`, requestStage: "Request" })),
    ] });
  }
  await command("Page.setInterceptFileChooserDialog", { enabled: true });
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__haloMediaEvents = [];
    for (const name of ["loadedmetadata", "canplay", "playing", "error"]) {
      document.addEventListener(name, event => {
        if (event.target.id === "showAudio") window.__haloMediaEvents.push(name);
      }, true);
    }
  ` });
  const navigation = await command("Page.navigate", { url: target.href });
  if (navigation.errorText) throw new Error(`Production navigation failed: ${navigation.errorText}`);
  const snapshot = () => evaluate(`(() => {
    const audio = document.getElementById("showAudio");
    const button = document.getElementById("playBtn");
    const rect = button?.getBoundingClientRect();
    return {
      title: document.getElementById("songLobbyPlayerTitle")?.textContent,
      status: document.getElementById("songLobbyPlayerStatus")?.textContent,
      sourcePath: audio?.currentSrc ? new URL(audio.currentSrc).pathname : "",
      readyState: audio?.readyState, paused: audio?.paused, currentTime: audio?.currentTime,
      preload: audio?.preload,
      muted: audio?.muted, volume: audio?.volume,
      duration: Number.isFinite(audio?.duration) ? audio.duration : null,
      mediaError: audio?.error ? { code: audio.error.code, message: audio.error.message } : null,
      videoPaused: document.getElementById("heroReelVideo")?.paused,
      cinemaControl: Boolean(document.getElementById("cinemaToggle")),
      events: window.__haloMediaEvents || [],
      click: rect?.width ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
    };
  })()`);
  console.log("Checked origin:", target.origin);
  let before;
  for (let attempt = 0; attempt < 60; attempt++) {
    before = await snapshot();
    if (before.mediaError || before.readyState >= 2 || /Stream unavailable/.test(before.status || "")
      || (before.preload === "none" && before.sourcePath && before.click)) break;
    await delay(500);
  }
  await evaluate('document.getElementById("playBtn")?.scrollIntoView({ block: "center" })');
  before = await snapshot();
  console.log("Before click:", JSON.stringify(before));
  if (checkCinema && (!before.cinemaControl || before.videoPaused !== true)) {
    throw new Error("Deployed cinema control is missing or video started before Play.");
  }
  if (!before.click) throw new Error("The live page did not expose its Play control.");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...before.click, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...before.click, button: "left", clickCount: 1 });
  let after;
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(500);
    after = await snapshot();
    if ((!after.paused && after.currentTime > .25) || after.mediaError || observed.some(event => event.filePickerOpened)) break;
  }
  console.log("After click:", JSON.stringify(after));
  console.log("Browser observations:", JSON.stringify(observed));
  if (after.paused || !(after.currentTime > .25)) throw new Error("Live playback did not advance after a real Play click.");
  console.log("VERIFIED: Chrome decoded audio and advanced currentTime after a Play click. Physical audibility is not verified.");
  if (checkCinema) {
    const cinemaSnapshot = () => evaluate(`(() => {
      const video = document.getElementById("heroReelVideo");
      const audio = document.getElementById("showAudio");
      return {
        sourcePath: video?.currentSrc ? new URL(video.currentSrc).pathname : "",
        readyState: video?.readyState, paused: video?.paused, currentTime: video?.currentTime,
        muted: video?.muted, loop: video?.loop, hidden: video?.hidden,
        backdrop: document.querySelector(".song-lobby__media")?.classList.contains("is-cinema-playing"),
        toggle: document.getElementById("cinemaToggle")?.getAttribute("aria-pressed"),
        audioPaused: audio?.paused, audioTime: audio?.currentTime,
        status: document.getElementById("heroReelStatus")?.textContent,
        mediaError: video?.error?.code || null
      };
    })()`);
    const waitCinema = async predicate => {
      let result;
      for (let attempt = 0; attempt < 40; attempt++) {
        result = await cinemaSnapshot();
        if (predicate(result)) return result;
        await delay(500);
      }
      throw new Error(`Cinema state did not match: ${JSON.stringify(result)}`);
    };
    const playing = await waitCinema(value => !value.paused && value.backdrop && value.readyState >= 2);
    await delay(1000);
    const advancing = await cinemaSnapshot();
    console.log("Cinema playing:", JSON.stringify(advancing));
    if (!advancing.muted || !advancing.loop || advancing.currentTime === playing.currentTime) {
      throw new Error("Video must be muted, looping and advancing with audio.");
    }
    const clickControl = async id => {
      await evaluate(`document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ block: "center" })`);
      const point = await evaluate(`(() => {
        const rect = document.getElementById(${JSON.stringify(id)})?.getBoundingClientRect();
        return rect?.width ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
      })()`);
      if (!point) throw new Error(`Missing cinema test control: ${id}`);
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    };
    await clickControl("playBtn");
    console.log("Cinema paused:", JSON.stringify(await waitCinema(value => value.audioPaused && value.paused && !value.backdrop)));
    await clickControl("playBtn");
    await waitCinema(value => !value.audioPaused && !value.paused && value.backdrop);
    await clickControl("cinemaToggle");
    const off = await waitCinema(value => value.toggle === "false" && value.paused && !value.backdrop && !value.audioPaused);
    await delay(500);
    if ((await cinemaSnapshot()).audioTime <= off.audioTime) throw new Error("Motion-off interrupted audio.");
    await clickControl("cinemaToggle");
    await waitCinema(value => !value.paused && value.backdrop);
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    console.log("Cinema reduced motion:", JSON.stringify(await waitCinema(value => value.paused && !value.backdrop && !value.audioPaused)));
    console.log("VERIFIED CINEMA: deployed video decoded and advanced; pause and motion controls stopped visuals without blocking audio.");
  }
} catch (error) {
  console.error(error.message);
  console.error("Browser observations:", JSON.stringify(observed));
  process.exitCode = 1;
} finally {
  socket?.close();
  const stopped = new Promise(resolve => chrome.once("exit", resolve));
  if (chrome.exitCode === null && chrome.pid) {
    chrome.kill("SIGTERM");
    await Promise.race([stopped, delay(5000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
