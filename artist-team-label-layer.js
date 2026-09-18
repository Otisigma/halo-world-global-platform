(() => {
  const tabs = ["dashboard", "roster", "releases", "ar", "payouts", "campaigns", "insights"];
  const panelIds = ["labelRosterPreview", "labelReleasePreview", "labelInsightPreview", "labelRosterList", "labelReleaseList", "labelDiscoveryList", "labelPayoutList", "labelCampaignList", "labelInsightList"];

  function nextTab(current, key) {
    const index = Math.max(0, tabs.indexOf(current));
    if (key === "ArrowRight" || key === "ArrowDown") return tabs[(index + 1) % tabs.length];
    if (key === "ArrowLeft" || key === "ArrowUp") return tabs[(index - 1 + tabs.length) % tabs.length];
    if (key === "Home") return tabs[0];
    if (key === "End") return tabs[tabs.length - 1];
    return current;
  }

  function unavailableState(message = "Reload to retry the label cockpit.") {
    return {
      summary: { label: "Label layer", value: "—", detail: "Artist intelligence remains available even when label telemetry is offline." },
      cards: Object.fromEntries(panelIds.map(id => [id, { title: "Unavailable", body: message }]))
    };
  }

  window.HaloArtistTeamLabelLayer = { tabs, nextTab, unavailableState };
})();
