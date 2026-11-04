import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
const profile = await mkdtemp(join(tmpdir(), "halo-live-browser-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
const observed = [];
const mediaRequests = new Set();
const boundRanges = process.env.HALO_AUDIO_PROBE_BOUND_RANGES === "1";
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
      observed.push({ exception: message.params.exceptionDetails.text });
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
  if (boundRanges) {
    console.log("EXPERIMENT: cap browser media range requests to 4 MiB; this does not change deployed code.");
    await command("Fetch.enable", { patterns: [{ urlPattern: `${target.origin}/api/song-catalog/audio*`, requestStage: "Request" }] });
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
  if (!before.click) throw new Error("The live page did not expose its Play control.");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...before.click, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...before.click, button: "left", clickCount: 1 });
  let after;
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(500);
    after = await snapshot();
    if ((!after.paused && after.currentTime > .25) || after.mediaError || observed.some(event => event.filePickerOpened)) break;
  }
  console.log("After click:", JSON.stringify(after));
  console.log("Browser observations:", JSON.stringify(observed));
  if (after.paused || !(after.currentTime > .25)) throw new Error("Live playback did not advance after a real Play click.");
  console.log("VERIFIED: Chrome decoded audio and advanced currentTime after a Play click. Physical audibility is not verified.");
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
  await rm(profile, { recursive: true, force: true });
}
