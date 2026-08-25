(() => {
  const reportEdition = {
    id: "HALO-SIGNAL-WP-001",
    slug: "own-the-return",
    title: "Own the return",
    subtitle: "Direct-to-fan sovereignty",
    published: "07 August 2026",
    edition: "1.0",
    publisher: "HALO SIGNAL",
    summary: "A white paper on creator-owned fan relationships, open radio access, transparent listener signal, direct income, and partnerships that add scale without taking permanent control.",
    quote: "Those who build the culture should remain its primary beneficiaries."
  };
  const articles = {
    "room-after-stream": {
      topic: "Community / Cover story / 8 min read",
      title: "The room after the stream",
      deck: "Discovery is abundant. Recognition is rare. The next generation of music platforms may be judged by what happens after someone presses play.",
      body: [
        "The music business has become exceptionally good at creating moments of contact. A track appears in a feed, a clip crosses a timeline, a set reaches a new listener. But contact is not the same as continuity. The harder and more valuable work begins when the first moment ends.",
        "A durable music community gives the listener somewhere meaningful to return. That place may be a physical room, a live broadcast, a member channel, a recurring show, or a small ritual shared across all four. The format matters less than the feeling: I have been here before, somebody noticed, and my presence can matter.",
        "This changes the product question. Instead of asking only how content travels, teams can ask how relationships accumulate. Does the second visit feel different from the first? Can a regular welcome a newcomer? Can a DJ understand what the room has lived through without reducing people to a dashboard?",
        "The opportunity is not to manufacture intimacy at scale. It is to build infrastructure that helps real intimacy survive growth. Recognition should support the relationship, not automate it out of existence."
      ],
      quote: "The most important audience event may not be the play. It may be the voluntary return."
    },
    "small-scene-economics": {
      topic: "Economics / Operating model / 6 min read",
      title: "Small scenes need better unit economics, not bigger slogans",
      deck: "Events, memberships, releases, and partnerships become more resilient when they operate as one audience system.",
      body: [
        "Independent music teams are often asked to behave like miniature versions of major institutions. The comparison obscures their real advantage: small teams can connect decisions across programming, community, and revenue without negotiating through layers of separation.",
        "A release can create the reason for a gathering. The gathering can create trust. Trust can support a membership, service, ticket, or direct purchase. The value sits in the connection between these moments, yet many teams still measure each one as an isolated campaign.",
        "Better unit economics start with a simple map: what does it cost to create a high-quality return moment, what forms of participation does that moment produce, and which of those forms can responsibly support the next one? This is more useful than chasing scale without a clear relationship between attention and sustainability.",
        "The goal is not to monetise every interaction. It is to understand which paid offers protect the culture, which weaken it, and which allow the people doing the work to continue."
      ],
      quote: "Revenue works best when it funds the next reason to gather."
    },
    "human-review": {
      topic: "Technology / Editorial position / 5 min read",
      title: "AI should widen the creative bench, not empty it",
      deck: "Automation is most useful when it expands preparation and access while leaving consequential judgement visible and human.",
      body: [
        "Creative technology should be judged by the work it enables and the power it redistributes. A useful system can help a small team prepare more options, translate a draft, organise an archive, test an arrangement, or make an interface more accessible.",
        "The risk begins when assistance becomes invisible substitution. If a system makes a decision involving identity, credit, money, access, or reputation, the person affected should know where human responsibility sits. A polished output is not a substitute for accountable judgement.",
        "For independent teams, the best pattern is often a wider bench rather than a smaller one. Let machines accelerate the first pass. Let people contribute taste, context, consent, and the final decision. Document the handoff so speed does not erase responsibility.",
        "This position is not anti-automation. It is pro-authorship, pro-review, and pro-tools that leave the people using them more capable than before."
      ],
      quote: "Automate preparation. Keep responsibility human."
    },
    "door-person": {
      topic: "Nightlife / Field note / 4 min read",
      title: "What digital communities can learn from the door person",
      deck: "The first interface of a venue is often a human being who reads context, protects the room, and signals what kind of place this is.",
      body: [
        "A strong door person does more than check access. They establish the social temperature of the room. They recognise regulars without making newcomers feel secondary. They enforce boundaries without turning hospitality into theatre. They understand that entry is both a transaction and a transition.",
        "Digital communities tend to flatten this work into permissions: member or non-member, allowed or blocked. The binary is operationally tidy but culturally weak. Arrival deserves design. A newcomer may need orientation. A regular may need recognition. A person returning after conflict may need a different path entirely.",
        "The lesson is not to imitate a velvet rope online. It is to treat welcome, safety, memory, and escalation as skilled community work. The room begins before the main event, and the quality of that beginning shapes everything that follows."
      ],
      quote: "A good entrance tells people both: you are welcome here, and this place is being cared for."
    },
    "care-not-surveillance": {
      topic: "Community / Trust systems / 4 min read",
      title: "The fan profile should remember care, not surveillance",
      deck: "Relationship context can make people feel known. Collected without restraint, the same context makes them feel watched.",
      body: [
        "Memory is central to hospitality. A host remembers a name, a favourite song, a useful introduction, or the support someone offered at the last event. This context creates continuity because it serves the next human interaction.",
        "Digital profiles can support the same care, but only if teams distinguish relationship memory from behavioural extraction. The test is practical: would the person reasonably expect this detail to be remembered, and can the team explain how remembering it improves their experience?",
        "Consent should not be treated as a one-time legal shield. It is an ongoing design constraint. Collect less, make correction possible, avoid covert inferences, and keep sensitive context away from automated outreach. A smaller, trusted record is more valuable than a comprehensive profile people never agreed to build.",
        "The standard is not perfect knowledge. It is respectful continuity."
      ],
      quote: "Remember what helps the relationship. Leave the rest uncollected."
    }
  };

  const articleTitles = Object.fromEntries(Object.entries(articles).map(([id, article]) => [id, article.title]));
  const savedKey = "halo-signal-reading-list";
  const readerDialog = document.querySelector("[data-reader-dialog]");
  const readerContent = document.querySelector("[data-reader-content]");
  const reportDialog = document.querySelector("[data-report-dialog]");
  const reportShareStudio = document.querySelector("[data-report-share-studio]");
  const reportShareStatus = document.querySelector("[data-report-share-status]");
  const libraryDialog = document.querySelector("[data-library-dialog]");
  const libraryItems = document.querySelector("[data-library-items]");
  let saved = readSaved();

  function readSaved() {
    try {
      const value = JSON.parse(window.localStorage.getItem(savedKey) || "[]");
      return Array.isArray(value) ? value.filter(id => articleTitles[id]) : [];
    } catch {
      return [];
    }
  }

  function storeSaved() {
    try {
      window.localStorage.setItem(savedKey, JSON.stringify(saved));
    } catch {
      saved = [...saved];
    }
    syncSavedUi();
  }

  function syncSavedUi() {
    document.querySelectorAll("[data-saved-count]").forEach(element => { element.textContent = String(saved.length); });
    document.querySelectorAll("[data-save]").forEach(button => {
      const isSaved = saved.includes(button.dataset.save);
      button.classList.toggle("is-saved", isSaved);
      button.textContent = isSaved ? "Saved" : "Save";
      button.setAttribute("aria-pressed", String(isSaved));
    });
  }

  function toggleSaved(id) {
    saved = saved.includes(id) ? saved.filter(item => item !== id) : [...saved, id];
    storeSaved();
  }

  function openArticle(id) {
    const article = articles[id];
    if (!article || !readerDialog || !readerContent) return;
    readerContent.innerHTML = `
      <p class="article-kicker">${article.topic}</p>
      <h2>${article.title}</h2>
      <p class="article-deck">${article.deck}</p>
      <div class="article-body">
        ${article.body.map(paragraph => `<p>${paragraph}</p>`).join("")}
        <blockquote>${article.quote}</blockquote>
      </div>`;
    readerDialog.showModal();
    readerContent.focus();
  }

  function renderLibrary() {
    if (!libraryItems) return;
    if (!saved.length) {
      libraryItems.innerHTML = '<p class="library-empty">Your reading list is quiet. Save a briefing to build this issue around your work.</p>';
      return;
    }
    libraryItems.innerHTML = saved.map(id => `
      <div class="library-item">
        <button type="button" data-library-open="${id}"><span>${articleTitles[id]}</span></button>
        <button type="button" data-library-remove="${id}">Remove</button>
      </div>`).join("");
  }

  function reportUrl() {
    return new URL(`/reports/${reportEdition.slug}/`, window.location.origin).href;
  }

  function reportCitation() {
    return `${reportEdition.publisher}. “${reportEdition.title}.” ${reportEdition.subtitle}. White Paper 001, edition ${reportEdition.edition}, ${reportEdition.published}. ${reportUrl()}`;
  }

  function reportBrief() {
    return [
      `${reportEdition.title.toUpperCase()} — ${reportEdition.publisher}`,
      reportEdition.summary,
      `“${reportEdition.quote}”`,
      `${reportEdition.id} · Published ${reportEdition.published} · Open access`,
      reportUrl()
    ].join("\n\n");
  }

  function setReportShareStatus(message, isError = false) {
    if (!reportShareStatus) return;
    reportShareStatus.textContent = message;
    reportShareStatus.classList.toggle("is-error", isError);
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    if (!copied) throw new Error("Copy unavailable");
  }

  function openReport(options = {}) {
    if (!reportDialog) return;
    if (!reportDialog.open) reportDialog.showModal();
    if (options.focusShare) {
      window.setTimeout(() => {
        reportShareStudio?.scrollIntoView({ behavior: "smooth", block: "start" });
        reportShareStudio?.focus({ preventScroll: true });
      }, 80);
    }
  }

  async function shareReport() {
    const shareData = {
      title: `${reportEdition.title} — ${reportEdition.publisher}`,
      text: `${reportEdition.summary} ${reportEdition.quote}`,
      url: reportUrl()
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setReportShareStatus("Share sheet opened with the edition briefing.");
        window.haloStats?.track("signal_report_shared", { method: "native", report_id: reportEdition.id });
      } catch (error) {
        if (error?.name !== "AbortError") setReportShareStatus("Sharing was unavailable. Copy the briefing or permanent link instead.", true);
      }
      return;
    }
    await copyText(reportBrief());
    setReportShareStatus("Your browser has no share sheet, so the full briefing was copied.");
    window.haloStats?.track("signal_report_shared", { method: "briefing_fallback", report_id: reportEdition.id });
  }

  function wrapCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    words.forEach(word => {
      const testLine = `${line}${word} `;
      if (context.measureText(testLine).width > maxWidth && line) {
        lines.push(line.trim());
        line = `${word} `;
      } else {
        line = testLine;
      }
    });
    if (line && lines.length < maxLines) lines.push(line.trim());
    lines.slice(0, maxLines).forEach((item, index) => context.fillText(item, x, y + (index * lineHeight)));
  }

  function downloadReportCard() {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Card export unavailable");

    context.fillStyle = "#171612";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#4d4a42";
    context.lineWidth = 2;
    context.strokeRect(54, 54, 1492, 792);
    context.strokeStyle = "#e25531";
    [168, 214, 260].forEach(radius => {
      context.beginPath();
      context.arc(1325, 260, radius, 0, Math.PI * 2);
      context.stroke();
    });
    context.fillStyle = "#e9ff55";
    context.beginPath();
    context.arc(1325, 260, 44, 0, Math.PI * 2);
    context.fill();
    context.font = "500 28px 'DM Mono', monospace";
    context.fillText("HALO SIGNAL / WHITE PAPER 001", 105, 135);
    context.fillStyle = "#f1eee5";
    context.font = "500 142px Newsreader, Georgia, serif";
    context.fillText("OWN THE", 100, 342);
    context.fillText("RETURN.", 100, 465);
    context.fillStyle = "#c7c1b3";
    context.font = "400 35px Newsreader, Georgia, serif";
    wrapCanvasText(context, reportEdition.summary, 105, 585, 930, 46, 3);
    context.fillStyle = "#e25531";
    context.font = "500 24px 'DM Mono', monospace";
    context.fillText(reportEdition.id, 105, 790);
    context.fillStyle = "#f1eee5";
    context.textAlign = "right";
    context.fillText("HALO MUSIC WORLD", 1490, 790);

    const link = document.createElement("a");
    link.download = "halo-signal-own-the-return-share-card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setReportShareStatus("Editorial share card downloaded as a 1600 × 900 PNG.");
    window.haloStats?.track("signal_report_shared", { method: "card_download", report_id: reportEdition.id });
  }

  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      let visibleCount = 0;
      document.querySelectorAll("[data-filter]").forEach(item => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("[data-topic]").forEach(card => {
        const visible = filter === "all" || card.dataset.topic === filter;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const empty = document.querySelector("[data-empty-filter]");
      if (empty) empty.hidden = visibleCount > 0;
    });
  });

  document.addEventListener("click", event => {
    const articleButton = event.target.closest("[data-open-article]");
    const saveButton = event.target.closest("[data-save]");
    const libraryOpen = event.target.closest("[data-library-open]");
    const libraryRemove = event.target.closest("[data-library-remove]");
    if (articleButton) openArticle(articleButton.dataset.openArticle);
    if (saveButton) toggleSaved(saveButton.dataset.save);
    if (libraryOpen) {
      libraryDialog.close();
      openArticle(libraryOpen.dataset.libraryOpen);
    }
    if (libraryRemove) {
      toggleSaved(libraryRemove.dataset.libraryRemove);
      renderLibrary();
    }
  });

  document.querySelectorAll("[data-open-report]").forEach(button => button.addEventListener("click", () => openReport()));
  document.querySelectorAll("[data-share-report]").forEach(button => button.addEventListener("click", () => openReport({ focusShare: true })));
  document.querySelector("[data-native-share-report]")?.addEventListener("click", () => shareReport().catch(() => setReportShareStatus("Sharing was unavailable. Copy the briefing or permanent link instead.", true)));
  document.querySelector("[data-copy-report-brief]")?.addEventListener("click", () => copyText(reportBrief()).then(() => {
    setReportShareStatus("Full briefing copied: argument, quotation, edition identity, and link.");
    window.haloStats?.track("signal_report_shared", { method: "briefing_copy", report_id: reportEdition.id });
  }).catch(() => setReportShareStatus("The briefing could not be copied on this browser.", true)));
  document.querySelector("[data-copy-report-citation]")?.addEventListener("click", () => copyText(reportCitation()).then(() => {
    setReportShareStatus("Citation copied with edition and publication details.");
    window.haloStats?.track("signal_report_shared", { method: "citation_copy", report_id: reportEdition.id });
  }).catch(() => setReportShareStatus("The citation could not be copied on this browser.", true)));
  document.querySelector("[data-copy-report-link]")?.addEventListener("click", () => copyText(reportUrl()).then(() => {
    setReportShareStatus("Permanent edition link copied.");
    window.haloStats?.track("signal_report_shared", { method: "link_copy", report_id: reportEdition.id });
  }).catch(() => setReportShareStatus("The permanent link could not be copied on this browser.", true)));
  document.querySelector("[data-download-report-card]")?.addEventListener("click", () => {
    try { downloadReportCard(); } catch { setReportShareStatus("The visual card could not be created on this browser.", true); }
  });
  document.querySelectorAll("[data-close-report]").forEach(button => button.addEventListener("click", () => reportDialog?.close()));
  document.querySelector("[data-print-report]")?.addEventListener("click", () => window.print());
  document.querySelector("[data-close-reader]")?.addEventListener("click", () => readerDialog?.close());
  document.querySelector("[data-open-library]")?.addEventListener("click", () => { renderLibrary(); libraryDialog?.showModal(); });
  document.querySelector("[data-close-library]")?.addEventListener("click", () => libraryDialog?.close());

  [readerDialog, reportDialog, libraryDialog].forEach(dialog => {
    dialog?.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll(".reveal").forEach(element => observer.observe(element));
  if (new URLSearchParams(window.location.search).get("report") === reportEdition.slug || window.location.hash === `#${reportEdition.slug}`) openReport();
  syncSavedUi();
})();
