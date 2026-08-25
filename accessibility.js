(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supportsRecognition = Boolean(SpeechRecognition);
  const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const eligibleFieldSelector = [
    "textarea",
    'input:not([type])',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="url"]'
  ].join(",");

  const icons = {
    access: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="4" r="2.25" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 8.25h15M12 7.5v12M8.25 20l3.75-6 3.75 6M7 8.5l1.5 5M17 8.5l-1.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    microphone: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  let activeField = null;
  let recognition = null;
  let recognizing = false;
  let speaking = false;
  let speechQueue = [];
  let finalTranscript = "";
  let captionTimer = 0;
  let safeSpaceEnabled = false;
  let safeSpaceBusy = false;

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "halo-access-launcher";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "halo-access-panel");
  launcher.setAttribute("aria-label", "Open reading and speech tools");
  launcher.innerHTML = `${icons.access}<span>Access</span>`;

  const panel = document.createElement("section");
  panel.id = "halo-access-panel";
  panel.className = "halo-access-panel";
  panel.setAttribute("aria-label", "Reading and speech tools");
  panel.hidden = true;
  panel.innerHTML = `
    <header class="halo-access-head">
      <div>
        <span class="halo-access-kicker">HALO Access</span>
        <strong>Reading + speech tools</strong>
        <p>Listen to the page, dictate into text fields, and improve reading clarity.</p>
      </div>
      <button class="halo-access-icon-button" type="button" data-access-action="close" aria-label="Close reading and speech tools">${icons.close}</button>
    </header>
    <div class="halo-access-body">
      <div class="halo-access-actions">
        <button class="halo-access-action" type="button" data-access-action="read-page" data-primary="true">Read this page</button>
        <button class="halo-access-action" type="button" data-access-action="stop">Stop audio</button>
      </div>
      <button class="halo-access-toggle" type="button" data-access-action="dyslexia" aria-pressed="false">
        <span>Dyslexia-friendly text</span><span class="halo-access-switch" aria-hidden="true"></span>
      </button>
      <section class="halo-safe-space" aria-labelledby="halo-safe-space-title">
        <button class="halo-access-toggle halo-safe-space-toggle" type="button" data-access-action="safe-space" aria-pressed="false">
          <span><strong id="halo-safe-space-title">Safe Space</strong><small>Calmer, low-pressure guidance from Sol</small></span>
          <span class="halo-access-switch" aria-hidden="true"></span>
        </button>
        <div class="halo-safe-space-room" data-safe-space-room hidden>
          <p class="halo-safe-space-note">Take this one step at a time. HALO can offer supportive guidance or help request a person, but it is not an emergency service.</p>
          <div class="halo-safe-space-messages" data-safe-space-messages role="log" aria-live="polite" aria-relevant="additions"></div>
          <div class="halo-safe-space-suggestions" data-safe-space-suggestions aria-label="Suggested messages"></div>
          <form class="halo-safe-space-form" data-safe-space-form>
            <label for="halo-safe-space-input">What would help right now?</label>
            <textarea id="halo-safe-space-input" data-safe-space-input rows="3" maxlength="1000" placeholder="You can keep it simple…" required></textarea>
            <button type="submit" data-safe-space-submit>Send to Sol</button>
          </form>
          <p class="halo-safe-space-status" data-safe-space-status role="status" aria-live="polite"></p>
        </div>
      </section>
      <div class="halo-access-transcript">
        <div class="halo-access-transcript-head"><strong>Live transcript</strong><button type="button" data-access-action="clear">Clear</button></div>
        <p data-access-transcript aria-live="polite">Spoken words appear here while the microphone is active.</p>
      </div>
      <p class="halo-access-status" data-access-status role="status" aria-live="polite">Focus a text field to show its microphone and listen buttons.</p>
      <p class="halo-access-shortcuts">Keyboard: Alt+A opens tools · Alt+M starts dictation · Alt+R reads the focused field.</p>
    </div>`;

  const dock = document.createElement("div");
  dock.className = "halo-access-dock";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", "Speech tools for focused text field");
  dock.hidden = true;
  dock.innerHTML = `
    <button type="button" data-access-action="dictate" aria-label="Speak to type" title="Speak to type"${supportsRecognition ? "" : " disabled"}>${icons.microphone}</button>
    <button type="button" data-access-action="read-field" aria-label="Listen to this text" title="Listen to this text"${supportsSpeech ? "" : " disabled"}>${icons.speaker}</button>`;

  const caption = document.createElement("div");
  caption.className = "halo-access-caption";
  caption.setAttribute("role", "status");
  caption.setAttribute("aria-live", "polite");
  caption.hidden = true;

  document.body.append(launcher, panel, dock, caption);

  const closeButton = panel.querySelector('[data-access-action="close"]');
  const readPageButton = panel.querySelector('[data-access-action="read-page"]');
  const dyslexiaButton = panel.querySelector('[data-access-action="dyslexia"]');
  const safeSpaceButton = panel.querySelector('[data-access-action="safe-space"]');
  const safeSpaceRoom = panel.querySelector("[data-safe-space-room]");
  const safeSpaceMessages = panel.querySelector("[data-safe-space-messages]");
  const safeSpaceSuggestions = panel.querySelector("[data-safe-space-suggestions]");
  const safeSpaceForm = panel.querySelector("[data-safe-space-form]");
  const safeSpaceInput = panel.querySelector("[data-safe-space-input]");
  const safeSpaceSubmit = panel.querySelector("[data-safe-space-submit]");
  const safeSpaceStatus = panel.querySelector("[data-safe-space-status]");
  const transcript = panel.querySelector("[data-access-transcript]");
  const status = panel.querySelector("[data-access-status]");
  const dictateButton = dock.querySelector('[data-access-action="dictate"]');

  function setStatus(message, isAlert = false) {
    status.textContent = message;
    status.style.color = isAlert ? "var(--halo-access-alert)" : "";
  }

  function showCaption(message, persist = false) {
    window.clearTimeout(captionTimer);
    caption.textContent = message;
    caption.hidden = !message;
    if (message && !persist) {
      captionTimer = window.setTimeout(() => {
        caption.hidden = true;
      }, 4200);
    }
  }

  function openPanel() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    closeButton.focus({ preventScroll: true });
  }

  function closePanel() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus({ preventScroll: true });
  }

  function updateDockPosition() {
    if (!activeField || dock.hidden || !activeField.isConnected) return;
    const rectangle = activeField.getBoundingClientRect();
    const dockWidth = dock.offsetWidth || 94;
    const dockHeight = dock.offsetHeight || 54;
    const gap = 8;
    const viewportPadding = 10;
    let top = rectangle.bottom + gap;
    if (top + dockHeight > window.innerHeight - viewportPadding) {
      top = rectangle.top - dockHeight - gap;
    }
    const left = Math.min(
      Math.max(rectangle.right - dockWidth, viewportPadding),
      window.innerWidth - dockWidth - viewportPadding
    );
    dock.style.top = `${Math.max(viewportPadding, top)}px`;
    dock.style.left = `${left}px`;
  }

  function activateField(field) {
    if (activeField && activeField !== field) activeField.classList.remove("halo-access-field-active");
    activeField = field;
    activeField.classList.add("halo-access-field-active");
    dock.hidden = false;
    updateDockPosition();
  }

  function deactivateField() {
    if (recognizing) return;
    activeField?.classList.remove("halo-access-field-active");
    activeField = null;
    dock.hidden = true;
  }

  function replaceFieldSelection(field, text) {
    const currentValue = field.value || "";
    const start = Number.isInteger(field.selectionStart) ? field.selectionStart : currentValue.length;
    const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : currentValue.length;
    const needsLeadingSpace = start > 0 && !/\s$/.test(currentValue.slice(0, start));
    const insertion = `${needsLeadingSpace ? " " : ""}${text}`;
    const nextValue = `${currentValue.slice(0, start)}${insertion}${currentValue.slice(end)}`;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (valueSetter) valueSetter.call(field, nextValue);
    else field.value = nextValue;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insertion }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    const cursorPosition = start + insertion.length;
    field.setSelectionRange?.(cursorPosition, cursorPosition);
  }

  function stopRecognition() {
    if (!recognition || !recognizing) return;
    recognition.stop();
  }

  function startRecognition() {
    if (!supportsRecognition) {
      setStatus("Speech-to-text is not available in this browser. Chrome and Edge provide the widest support.", true);
      openPanel();
      return;
    }
    if (!activeField) {
      setStatus("Focus a text field first, then start dictation.", true);
      openPanel();
      return;
    }
    if (recognizing) {
      stopRecognition();
      return;
    }

    finalTranscript = "";
    recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      recognizing = true;
      dictateButton.dataset.active = "true";
      dictateButton.setAttribute("aria-label", "Stop dictation");
      setStatus("Listening. Speak naturally; your words are added to the focused field.");
      showCaption("Listening…", true);
    };

    recognition.onresult = event => {
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const words = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) {
          finalTranscript = `${finalTranscript} ${words}`.trim();
          replaceFieldSelection(activeField, words);
        } else {
          interimTranscript = `${interimTranscript} ${words}`.trim();
        }
      }
      const visibleTranscript = [finalTranscript, interimTranscript].filter(Boolean).join(" ");
      transcript.textContent = visibleTranscript || "Listening…";
      showCaption(visibleTranscript || "Listening…", true);
    };

    recognition.onerror = event => {
      const messages = {
        "not-allowed": "Microphone access was blocked. Allow microphone access in browser settings and try again.",
        "audio-capture": "No working microphone was found.",
        network: "Speech recognition lost its network connection.",
        "no-speech": "No speech was heard. Try again when you are ready."
      };
      setStatus(messages[event.error] || "Speech recognition stopped unexpectedly.", true);
      showCaption(messages[event.error] || "Speech recognition stopped.");
    };

    recognition.onend = () => {
      recognizing = false;
      dictateButton.dataset.active = "false";
      dictateButton.setAttribute("aria-label", "Speak to type");
      showCaption(finalTranscript || "Dictation stopped.");
      setStatus(finalTranscript ? "Dictation added to the focused field." : "Dictation stopped.");
      activeField?.focus({ preventScroll: true });
    };

    try {
      recognition.start();
    } catch {
      setStatus("The microphone is already starting. Please wait a moment.", true);
    }
  }

  function getReadablePageText() {
    const selection = window.getSelection()?.toString().trim();
    if (selection) return selection;
    const source = document.querySelector("main") || document.body;
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,svg,button,input,textarea,select,[aria-hidden='true'],.halo-access-panel,.halo-access-dock,.halo-access-caption").forEach(element => element.remove());
    return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 18000);
  }

  function splitSpeech(text) {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let chunk = "";
    sentences.forEach(sentence => {
      const cleaned = sentence.trim();
      if (!cleaned) return;
      if (`${chunk} ${cleaned}`.trim().length > 240 && chunk) {
        chunks.push(chunk);
        chunk = cleaned;
      } else {
        chunk = `${chunk} ${cleaned}`.trim();
      }
    });
    if (chunk) chunks.push(chunk);
    return chunks;
  }

  function stopSpeech(message = "Audio stopped.") {
    speechQueue = [];
    speaking = false;
    if (supportsSpeech) window.speechSynthesis.cancel();
    readPageButton.textContent = "Read this page";
    setStatus(message);
  }

  function speakNext() {
    if (!speechQueue.length) {
      speaking = false;
      readPageButton.textContent = "Read this page";
      setStatus("Finished reading aloud.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(speechQueue.shift());
    utterance.lang = document.documentElement.lang || navigator.language || "en-US";
    utterance.rate = document.documentElement.classList.contains("halo-dyslexia-mode") ? .86 : .92;
    utterance.pitch = 1;
    utterance.onend = speakNext;
    utterance.onerror = () => stopSpeech("Reading aloud stopped.");
    window.speechSynthesis.speak(utterance);
  }

  function speak(text) {
    if (!supportsSpeech) {
      setStatus("Text-to-speech is not available in this browser.", true);
      openPanel();
      return;
    }
    const readableText = String(text || "").trim();
    if (!readableText) {
      setStatus("There is no text to read yet.", true);
      return;
    }
    stopSpeech("Starting read aloud.");
    speechQueue = splitSpeech(readableText);
    speaking = true;
    readPageButton.textContent = "Reading…";
    setStatus("Reading aloud. Use Stop audio at any time.");
    speakNext();
  }

  function readActiveField() {
    if (!activeField) {
      setStatus("Focus a text field first, then choose listen.", true);
      openPanel();
      return;
    }
    const selectedText = activeField.value.slice(activeField.selectionStart || 0, activeField.selectionEnd || 0);
    speak(selectedText || activeField.value || activeField.placeholder || activeField.getAttribute("aria-label"));
  }

  function toggleDyslexiaMode() {
    const enabled = !document.documentElement.classList.contains("halo-dyslexia-mode");
    document.documentElement.classList.toggle("halo-dyslexia-mode", enabled);
    dyslexiaButton.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("halo-dyslexia-mode", String(enabled));
    setStatus(enabled ? "Dyslexia-friendly spacing and type are on." : "Dyslexia-friendly spacing and type are off.");
  }

  function getSafeSpaceSessionId() {
    const storageKey = "halo-safe-space-session";
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const sessionId = window.crypto?.randomUUID
      ? window.crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32);
    sessionStorage.setItem(storageKey, sessionId);
    return sessionId;
  }

  function appendSafeSpaceMessage(role, message, agentName = "") {
    const article = document.createElement("article");
    article.className = `halo-safe-space-message halo-safe-space-message-${role}`;
    const label = document.createElement("span");
    label.textContent = role === "visitor" ? "You" : agentName || "Sol";
    const body = document.createElement("p");
    body.textContent = message;
    article.append(label, body);
    safeSpaceMessages.append(article);
    safeSpaceMessages.scrollTop = safeSpaceMessages.scrollHeight;
  }

  function renderSafeSpaceSuggestions(suggestions = []) {
    safeSpaceSuggestions.replaceChildren();
    suggestions.forEach(suggestion => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.safeSpaceSuggestion = suggestion;
      button.textContent = suggestion;
      safeSpaceSuggestions.append(button);
    });
  }

  function toggleSafeSpace() {
    safeSpaceEnabled = !safeSpaceEnabled;
    safeSpaceButton.setAttribute("aria-pressed", String(safeSpaceEnabled));
    safeSpaceRoom.hidden = !safeSpaceEnabled;
    document.documentElement.classList.toggle("halo-safe-space-mode", safeSpaceEnabled);
    if (safeSpaceEnabled && !safeSpaceMessages.children.length) {
      appendSafeSpaceMessage("assistant", "I’m Sol. We can slow things down, name what feels difficult, and choose one small next step. You do not need to explain everything at once.");
      renderSafeSpaceSuggestions(["Help me slow this down", "I need a person", "Make this easier to understand"]);
    }
    setStatus(safeSpaceEnabled ? "Safe Space is on. Sol is ready when you are." : "Safe Space is off.");
    if (safeSpaceEnabled) safeSpaceInput.focus({ preventScroll: true });
  }

  async function sendSafeSpaceMessage(message) {
    const cleanMessage = String(message || "").trim().slice(0, 1000);
    if (!cleanMessage || safeSpaceBusy) return;
    safeSpaceBusy = true;
    safeSpaceSubmit.disabled = true;
    safeSpaceInput.disabled = true;
    safeSpaceStatus.textContent = "Sol is listening…";
    appendSafeSpaceMessage("visitor", cleanMessage);
    renderSafeSpaceSuggestions();

    try {
      const response = await fetch("/api/halo-companion", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sessionId: getSafeSpaceSessionId(),
          message: cleanMessage,
          path: window.location.pathname,
          title: document.title,
          safeSpace: true
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Safe Space could not connect right now.");
      appendSafeSpaceMessage("assistant", result.reply, result.agent?.name || "Sol");
      renderSafeSpaceSuggestions(result.suggestions);
      safeSpaceStatus.textContent = result.careRequestCreated
        ? "A request for human care has been added."
        : "Your conversation can continue here.";
      if (result.route) {
        const routeButton = document.createElement("button");
        routeButton.type = "button";
        routeButton.dataset.safeSpaceRoute = result.route;
        routeButton.textContent = "Open the suggested HALO space";
        safeSpaceSuggestions.append(routeButton);
      }
      window.haloStats?.track("safe_space_message", { human_care: Boolean(result.careRequestCreated) });
    } catch (error) {
      safeSpaceStatus.textContent = error.message || "Safe Space could not connect right now.";
      appendSafeSpaceMessage("assistant", "The connection paused. You can try again, or ask someone you trust for support if this cannot wait.");
    } finally {
      safeSpaceBusy = false;
      safeSpaceSubmit.disabled = false;
      safeSpaceInput.disabled = false;
      safeSpaceInput.value = "";
      safeSpaceInput.focus({ preventScroll: true });
    }
  }

  function restorePreferences() {
    const enabled = localStorage.getItem("halo-dyslexia-mode") === "true";
    document.documentElement.classList.toggle("halo-dyslexia-mode", enabled);
    dyslexiaButton.setAttribute("aria-pressed", String(enabled));
  }

  launcher.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());

  panel.addEventListener("click", event => {
    const action = event.target.closest("[data-access-action]")?.dataset.accessAction;
    if (action === "close") closePanel();
    if (action === "read-page") speaking ? stopSpeech() : speak(getReadablePageText());
    if (action === "stop") {
      stopRecognition();
      stopSpeech();
    }
    if (action === "dyslexia") toggleDyslexiaMode();
    if (action === "safe-space") toggleSafeSpace();
    if (action === "clear") {
      finalTranscript = "";
      transcript.textContent = "Spoken words appear here while the microphone is active.";
      setStatus("Transcript cleared.");
    }
  });

  safeSpaceForm.addEventListener("submit", event => {
    event.preventDefault();
    sendSafeSpaceMessage(safeSpaceInput.value);
  });

  safeSpaceSuggestions.addEventListener("click", event => {
    const suggestion = event.target.closest("[data-safe-space-suggestion]")?.dataset.safeSpaceSuggestion;
    const route = event.target.closest("[data-safe-space-route]")?.dataset.safeSpaceRoute;
    if (suggestion) sendSafeSpaceMessage(suggestion);
    if (route?.startsWith("/") && !route.startsWith("//")) window.location.assign(route);
  });

  dock.addEventListener("mousedown", event => event.preventDefault());
  dock.addEventListener("click", event => {
    const action = event.target.closest("[data-access-action]")?.dataset.accessAction;
    if (action === "dictate") startRecognition();
    if (action === "read-field") readActiveField();
  });

  document.addEventListener("focusin", event => {
    if (event.target.matches?.(eligibleFieldSelector) && !event.target.disabled && !event.target.readOnly) {
      activateField(event.target);
    }
  });

  document.addEventListener("focusout", event => {
    if (event.target === activeField) {
      window.setTimeout(() => {
        if (!dock.contains(document.activeElement) && document.activeElement !== activeField) deactivateField();
      }, 0);
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (recognizing) stopRecognition();
      else if (!panel.hidden) closePanel();
    }
    if (event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      panel.hidden ? openPanel() : closePanel();
    }
    if (event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      startRecognition();
    }
    if (event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      activeField ? readActiveField() : speak(getReadablePageText());
    }
  });

  window.addEventListener("resize", updateDockPosition);
  window.addEventListener("scroll", updateDockPosition, true);
  window.addEventListener("beforeunload", () => {
    stopRecognition();
    if (supportsSpeech) window.speechSynthesis.cancel();
  });

  restorePreferences();
  if (!supportsRecognition) {
    setStatus("Read aloud is ready. Speech-to-text needs a browser with Web Speech recognition.");
  }
})();
