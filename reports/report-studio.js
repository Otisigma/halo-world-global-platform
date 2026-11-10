import { reports } from "./report-data.js";

const list = document.querySelector("[data-report-list]");
const sections = document.querySelector("[data-report-sections]");
const feedback = document.querySelector("[data-feedback]");
let selected = reports[0];

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function render(report) {
  selected = report;
  document.querySelector("[data-report-status]").textContent = `${report.id} · Edition ${report.edition} · ${report.published} · ${report.status}`;
  document.querySelector("[data-report-title]").textContent = report.title;
  document.querySelector("[data-report-subtitle]").textContent = report.subtitle;
  document.querySelector("[data-report-summary]").textContent = report.summary;
  sections.replaceChildren(...report.sections.map(section => {
    const article = document.createElement("section");
    article.append(node("h3", section.heading), ...section.paragraphs.map(paragraph => node("p", paragraph)));
    return article;
  }));
  const limits = document.querySelector("[data-report-limitations]");
  limits.replaceChildren(...report.limitations.map(item => node("li", item)));
  const sources = document.querySelector("[data-report-sources]");
  sources.replaceChildren(...report.sources.map(source => {
    const item = document.createElement("li");
    const link = node("a", source.label);
    link.href = source.url;
    item.append(link);
    return item;
  }));
  for (const button of list.querySelectorAll("[data-report-id]")) {
    button.setAttribute("aria-pressed", String(button.dataset.reportId === report.id));
  }
  feedback.textContent = `Selected ${report.id}. Choose print, JSON download or share.`;
}

for (const report of reports) {
  const button = node("button");
  button.type = "button";
  button.className = "report-choice";
  button.dataset.reportId = report.id;
  button.setAttribute("aria-pressed", "false");
  button.append(node("span", `${report.id} · ${report.published}`), node("strong", report.title));
  button.addEventListener("click", () => render(report));
  list.append(button);
}

document.querySelector("[data-print]").addEventListener("click", () => window.print());
document.querySelector("[data-download]").addEventListener("click", () => {
  const blob = new Blob([`${JSON.stringify(selected, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = `${selected.slug}-report-${selected.edition}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  feedback.textContent = `Downloaded the structured ${selected.id} report as JSON.`;
});
document.querySelector("[data-share]").addEventListener("click", async () => {
  const url = new URL(`/reports/#${encodeURIComponent(selected.id)}`, location.origin).href;
  const share = { title: `${selected.title} — HALO SIGNAL`, text: selected.summary, url };
  try {
    if (navigator.share) await navigator.share(share);
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    else throw new Error("Sharing is not supported in this browser.");
    feedback.textContent = navigator.share ? "Share sheet opened; choose whether to send the report." : "Report link copied.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    feedback.textContent = "Could not share automatically. Copy the page address to share this report.";
  }
});

render(reports.find(report => report.id === location.hash.slice(1)) || reports[0]);
