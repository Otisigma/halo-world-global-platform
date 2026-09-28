const elements = {
  artworkFile: document.getElementById("artworkFile"),
  artworkDropZone: document.getElementById("artworkDropZone"),
  artworkDropTitle: document.getElementById("artworkDropTitle"),
  artworkDropDetail: document.getElementById("artworkDropDetail"),
};
const state = { artworkFile: null, artworkObjectUrl: "" };
function loadArtworkFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return;
  if (!file.type.startsWith("image/") || file.type === "image/gif") return;
  state.artworkFile = file;
  if (state.artworkObjectUrl) URL.revokeObjectURL(state.artworkObjectUrl);
  state.artworkObjectUrl = URL.createObjectURL(file);
  elements.artworkDropTitle.textContent = file.name;
  elements.artworkDropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · cover ready`;
  elements.artworkDropZone.classList.add("has-file");
}
if (elements.artworkFile) elements.artworkFile.addEventListener("change", event => loadArtworkFile(event.target.files?.[0]));
if (elements.artworkDropZone) {
  ["dragenter", "dragover"].forEach(name => elements.artworkDropZone.addEventListener(name, event => { event.preventDefault(); elements.artworkDropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(name => elements.artworkDropZone.addEventListener(name, event => { event.preventDefault(); elements.artworkDropZone.classList.remove("dragging"); }));
  elements.artworkDropZone.addEventListener("drop", event => { const file = event.dataTransfer?.files?.[0]; if (file) loadArtworkFile(file); });
}
