const limits = { title: 80, artist: 60, mood: 80, location: 80, dedication: 500 };
const escapeXml = value => value.replace(/[<>&"']/g, char => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
})[char]);

export function coverMetadata(input, requireComplete = true) {
  const metadata = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = input[key];
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) {
      throw new Error(`Use valid ${key} text, up to ${limit} characters.`);
    }
    metadata[key] = value.trim().replace(/\s+/gu, " ");
  }
  if (requireComplete && (!metadata.title || !metadata.artist)) throw new Error("Enter a title and primary artist before downloading.");
  return metadata;
}

function textLines(value, width) {
  const chars = Array.from(value);
  const lines = [];
  while (chars.length) lines.push(chars.splice(0, width).join(""));
  return lines;
}

export function coverSvg(input) {
  const data = coverMetadata(input, false);
  const text = (value, y, size, color = "#f5f0e7", width = 1000) =>
    `<text x="600" y="${y}" text-anchor="middle" font-family="Georgia,serif" font-size="${size}" fill="${color}" textLength="${Math.max(1, Math.min(width, Array.from(value).length * size * .6))}" lengthAdjust="spacingAndGlyphs">${escapeXml(value)}</text>`;
  const title = data.title || "Your next release";
  const lines = textLines(title, 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-labelledby="cover-title">
    <title id="cover-title">${escapeXml(title)} - local cover concept</title>
    <defs><radialGradient id="gold"><stop stop-color="#302818"/><stop offset="1" stop-color="#0a0a0a"/></radialGradient></defs>
    <rect width="1200" height="1200" fill="url(#gold)"/>
    <rect x="35" y="35" width="1130" height="1130" fill="none" stroke="#d4af37" stroke-width="2"/>
    ${text("HALO WORLD / LOCAL DESIGN CONCEPT", 105, 22, "#d4af37")}
    ${textLines(data.mood, 40).map((line, index) => text(line, 175 + index * 38, 28, "#d4af37")).join("")}
    <g fill="none" stroke="#d4af37"><circle cx="600" cy="480" r="130" opacity=".3"/><circle cx="600" cy="480" r="95" opacity=".5"/>
    <circle cx="600" cy="480" r="55" stroke-width="3"/><path d="M450 480h300M600 330v300" opacity=".35"/></g>
    ${textLines(data.location, 40).map((line, index) => text(line, 660 + index * 32, 22, "#aaa193")).join("")}
    ${lines.map((line, index) => text(line, 795 + index * 64, 52)).join("")}
    ${text(`by ${data.artist || "Your artist name"}`, 1090, 30, "#d4af37")}
    ${text("CREATIVE SKETCH / NO RECORDING OR OWNERSHIP GRANT", 1140, 16, "#aaa193")}
  </svg>`;
}

export function compileCoverPackage(input) {
  const metadata = coverMetadata(input);
  return {
    schema: "halo-local-cover-concept", version: 1,
    notice: "Local design concept only. Not published, uploaded, licensed, or saved to a HALO account. No audio included.",
    metadata, artwork: { format: "image/svg+xml", width: 1200, height: 1200, svg: coverSvg(metadata) }
  };
}

export function createCoverBuilder(root, {
  document = globalThis.document, urls = globalThis.URL, Blob = globalThis.Blob,
  defer = globalThis.setTimeout
} = {}) {
  const form = root.querySelector("[data-cover-form]");
  const image = root.querySelector("[data-cover-preview]");
  const dedication = root.querySelector("[data-cover-dedication]");
  const status = root.querySelector("[data-cover-status]");
  let previewUrl;
  const downloads = new Set();
  const read = () => Object.fromEntries(Object.keys(limits).map(key => [key, form.elements.namedItem(key).value]));
  function render() {
    try {
      const input = read();
      const next = urls.createObjectURL(new Blob([coverSvg(input)], { type: "image/svg+xml" }));
      image.src = next;
      if (previewUrl) urls.revokeObjectURL(previewUrl);
      previewUrl = next;
      dedication.textContent = input.dedication.trim() ? `Liner note: ${input.dedication.trim()}` : "Your optional dedication will appear here and in the metadata package.";
      status.textContent = "Local preview updated. Nothing uploaded or saved; download to keep your design.";
    } catch (error) {
      if (previewUrl) urls.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      image.removeAttribute("src");
      dedication.textContent = "";
      status.textContent = error.message;
    }
  }
  function download(kind) {
    let url, anchor;
    try {
      const compiled = compileCoverPackage(read());
      const artwork = kind === "artwork";
      const content = artwork ? compiled.artwork.svg : JSON.stringify(compiled, null, 2);
      const filename = artwork ? "halo-cover-concept.svg" : "halo-cover-concept.json";
      url = urls.createObjectURL(new Blob([content], { type: artwork ? "image/svg+xml" : "application/json" }));
      anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename;
      document.body.append(anchor); anchor.click();
      downloads.add(url);
      defer(() => { urls.revokeObjectURL(url); downloads.delete(url); }, 60000);
      status.textContent = `Download requested: ${filename}. Check your browser downloads to keep it. Nothing queued in a vault or saved to your account.`;
    } catch (error) {
      if (url) urls.revokeObjectURL(url);
      status.textContent = `Could not export: ${error.message}`;
    } finally { anchor?.remove(); }
  }
  form.addEventListener("input", render);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (form.reportValidity()) download(event.submitter?.dataset.coverExport || "package");
  });
  image.addEventListener("error", () => { status.textContent = "The cover preview could not render. Try editing again; your text has not been uploaded."; });
  render();
  return {
    render, download,
    dispose() {
      if (previewUrl) urls.revokeObjectURL(previewUrl);
      for (const url of downloads) urls.revokeObjectURL(url);
      downloads.clear(); previewUrl = undefined;
      image.removeAttribute("src");
    }
  };
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-cover-builder]");
  if (root) {
    const builder = createCoverBuilder(root);
    window.addEventListener("pagehide", () => builder.dispose());
    window.addEventListener("pageshow", event => { if (event.persisted) builder.render(); });
  }
}
