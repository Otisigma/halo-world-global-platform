export function initializeDreamweaverUploadPanel({ disclosure, frame, status }) {
  if (!disclosure || !frame || !status) return;
  let loaded = false;
  frame.addEventListener("load", () => {
    if (!loaded) return;
    status.textContent = "Song Lab opened. Complete sign-in or verification if prompted; uploads remain private until you explicitly start analysis.";
  });
  disclosure.addEventListener("toggle", () => {
    if (!disclosure.open || loaded) return;
    loaded = true;
    status.textContent = "Loading Dreamweaver Song Lab. If it does not appear, use Open full Dreamweaver Song Lab.";
    frame.hidden = false;
    frame.src = "/dreamweaver-lab/";
  });
  return {
    reset() {
      if (!loaded) return;
      loaded = false;
      disclosure.open = false;
      frame.removeAttribute("src");
      frame.hidden = true;
      status.textContent = "Sign in and expand to load Dreamweaver Song Lab.";
    },
  };
}
