const activeFilters = { goal: "all", budget: "all" };
const filterButtons = [...document.querySelectorAll("[data-filter-group]")];
const gearCards = [...document.querySelectorAll(".gear-card")];
const filterStatus = document.querySelector("#filter-status");

function applyFilters() {
  let visibleCount = 0;

  gearCards.forEach((card) => {
    const goalMatch = activeFilters.goal === "all" || card.dataset.goal.split(" ").includes(activeFilters.goal);
    const budgetMatch = activeFilters.budget === "all" || card.dataset.budget === activeFilters.budget;
    const visible = goalMatch && budgetMatch;
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  filterStatus.textContent = visibleCount
    ? `Showing ${visibleCount} honest ${visibleCount === 1 ? "option" : "options"}.`
    : "Nothing matches both choices. Try another spending level.";
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.dataset.filterGroup;
    activeFilters[group] = button.dataset.filter;

    filterButtons
      .filter((candidate) => candidate.dataset.filterGroup === group)
      .forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });

    applyFilters();
  });
});

const releaseChecks = [...document.querySelectorAll("[data-release-check]")];
const releaseCount = document.querySelector("#release-count");
const releaseProgressBar = document.querySelector("#release-progress-bar");
const releaseStatus = document.querySelector("#release-status");

function updateReleaseProgress() {
  const completed = releaseChecks.filter((check) => check.checked).length;
  const percent = Math.round((completed / releaseChecks.length) * 100);
  releaseCount.textContent = `${completed} / ${releaseChecks.length}`;
  releaseProgressBar.style.transform = `scaleX(${percent / 100})`;

  if (completed === releaseChecks.length) {
    releaseStatus.textContent = "The details are aligned. Review the distributor terms when you feel ready.";
  } else if (completed >= 3) {
    releaseStatus.textContent = "Good progress. Finish the unresolved details without rushing them.";
  } else if (completed > 0) {
    releaseStatus.textContent = "A clear release is built one confirmed detail at a time.";
  } else {
    releaseStatus.textContent = "Start with the files already in front of you.";
  }
}

releaseChecks.forEach((check) => check.addEventListener("change", updateReleaseProgress));
