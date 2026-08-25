const state = {
  catalog: null,
  activeCreatorId: null,
  filter: "all",
  selectedProductId: null,
  identity: null,
  user: null,
  authMode: "signup",
  pendingAction: null,
  toastTimer: null
};

const elements = {
  artistFeature: document.querySelector("#artist-feature"),
  artistList: document.querySelector("#artist-list"),
  productGrid: document.querySelector("#product-grid"),
  catalogStatus: document.querySelector("#catalog-status"),
  catalogError: document.querySelector("#catalog-error"),
  retryCatalog: document.querySelector("#retry-catalog"),
  authButton: document.querySelector("#auth-button"),
  productModal: document.querySelector("#product-modal"),
  identityModal: document.querySelector("#identity-modal"),
  productTitle: document.querySelector("#product-modal-title"),
  productKicker: document.querySelector("#product-modal-kicker"),
  productDescription: document.querySelector("#product-modal-description"),
  productFormat: document.querySelector("#product-modal-format"),
  productEdition: document.querySelector("#product-modal-edition"),
  productPrice: document.querySelector("#product-modal-price"),
  productSaveButton: document.querySelector("#product-save-button"),
  identityForm: document.querySelector("#identity-form"),
  identityName: document.querySelector("#identity-name"),
  identityEmail: document.querySelector("#identity-email"),
  identityPassword: document.querySelector("#identity-password"),
  identitySubmit: document.querySelector("#identity-submit"),
  identityMessage: document.querySelector("#identity-message"),
  identityTitle: document.querySelector("#identity-title"),
  nameField: document.querySelector("#name-field"),
  foundingButtons: [document.querySelector("#founding-creator-hero"), document.querySelector("#founding-creator-button")],
  foundingStatus: document.querySelector("#founding-status"),
  toast: document.querySelector("#toast")
};

const productTypeLabels = {
  dj_tools: "Official DJ tools",
  stems: "Studio stems",
  masters: "Lossless master",
  education: "Creator class",
  review: "Private service"
};

const productAccent = {
  dj_tools: "#dfff42",
  stems: "#78a7ff",
  masters: "#ff6b35",
  education: "#ffdf6b",
  review: "#e8a5ff"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(priceMinor) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2
  }).format(priceMinor / 100);
}

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).join("").slice(0, 2);
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function setModal(modal, open) {
  modal.hidden = !open;
  document.body.classList.toggle("modal-open", open || !elements.productModal.hidden || !elements.identityModal.hidden);
  if (open) {
    window.setTimeout(() => modal.querySelector("button, input")?.focus(), 20);
  }
}

function renderArtists() {
  const creators = state.catalog?.creators || [];
  if (!creators.length) {
    elements.artistFeature.innerHTML = '<div class="empty-state"><h3>No creators published yet.</h3><p>The founding cohort appears here after approval.</p></div>';
    elements.artistList.innerHTML = "";
    return;
  }

  const activeCreator = creators.find(creator => creator.id === state.activeCreatorId) || creators[0];
  state.activeCreatorId = activeCreator.id;
  const creatorProducts = state.catalog.products.filter(product => product.creatorId === activeCreator.id);
  elements.artistFeature.innerHTML = `
    <div class="artist-art" style="--artist-accent:${escapeHtml(activeCreator.accent)}" data-initials="${escapeHtml(initials(activeCreator.name))}"></div>
    <div class="artist-feature-copy">
      <small>${escapeHtml(activeCreator.city)} · ${escapeHtml(activeCreator.disciplines.join(" / "))} · Preview creator</small>
      <h3>${escapeHtml(activeCreator.name)}</h3>
      <p>${escapeHtml(activeCreator.statement)}</p>
      <small>${creatorProducts.length} founding ${creatorProducts.length === 1 ? "drop" : "drops"}</small>
    </div>`;

  elements.artistList.innerHTML = creators.map((creator, index) => `
    <button class="artist-row ${creator.id === activeCreator.id ? "is-active" : ""}" type="button" data-creator-id="${creator.id}" style="--artist-accent:${escapeHtml(creator.accent)}" aria-pressed="${creator.id === activeCreator.id}">
      <span class="artist-row-index">${String(index + 1).padStart(2, "0")}</span>
      <span><strong>${escapeHtml(creator.name)}</strong><small>${escapeHtml(creator.city)} · ${escapeHtml(creator.disciplines.join(" / "))}</small></span>
      <span class="artist-row-arrow" aria-hidden="true">↗</span>
    </button>`).join("");

  elements.artistList.querySelectorAll("[data-creator-id]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeCreatorId = Number(button.dataset.creatorId);
      renderArtists();
    });
  });
}

function renderProducts() {
  const products = (state.catalog?.products || []).filter(product => state.filter === "all" || product.type === state.filter);
  if (!products.length) {
    elements.productGrid.innerHTML = '<div class="empty-state"><h3>No drops on this frequency yet.</h3><p>Choose another category or return when the founding catalog expands.</p></div>';
    return;
  }

  elements.productGrid.innerHTML = products.map((product, index) => `
    <article class="product-card" style="animation-delay:${index * 45}ms;--product-accent:${productAccent[product.type] || "#dfff42"}">
      <div class="product-card-header">
        <p class="product-type">${escapeHtml(productTypeLabels[product.type] || product.type)}</p>
        <button class="product-save ${product.saved ? "is-saved" : ""}" type="button" data-save-product="${product.id}" aria-label="${product.saved ? "Remove" : "Save"} ${escapeHtml(product.title)}" aria-pressed="${product.saved}">${product.saved ? "★" : "☆"}</button>
      </div>
      <div class="product-card-art"><span>${escapeHtml(product.title.split(" ").slice(0, 2).join("\n"))}</span></div>
      <h3>${escapeHtml(product.title)}</h3>
      <p class="product-creator">${escapeHtml(product.creatorName)}</p>
      <div class="product-footer">
        <p>${escapeHtml(product.format)}<br>${escapeHtml(product.edition || "Open edition")}</p>
        <span class="product-price">${escapeHtml(formatMoney(product.priceMinor, product.currency))}</span>
      </div>
      <button class="product-open" type="button" data-open-product="${product.id}" aria-label="Open details for ${escapeHtml(product.title)}"></button>
    </article>`).join("");

  elements.productGrid.querySelectorAll("[data-open-product]").forEach(button => {
    button.addEventListener("click", () => openProduct(Number(button.dataset.openProduct)));
  });
  elements.productGrid.querySelectorAll("[data-save-product]").forEach(button => {
    button.addEventListener("click", () => toggleSavedDrop(Number(button.dataset.saveProduct)));
  });
}

function updateCatalogMeta() {
  const creatorCount = state.catalog?.creators.length || 0;
  const productCount = state.catalog?.products.length || 0;
  elements.catalogStatus.textContent = `${creatorCount} preview creators · ${productCount} concept drops · ${state.catalog?.launch.access || "Founding edition"}`;
  const interested = Boolean(state.catalog?.foundingCreatorInterest);
  elements.foundingButtons.forEach(button => {
    button.textContent = interested ? "Founding interest registered ✓" : button.id === "founding-creator-hero" ? "Apply as a founding creator" : "Register founding interest";
    button.setAttribute("aria-pressed", String(interested));
  });
  elements.foundingStatus.textContent = interested
    ? "Your interest is attached to your HALO membership. The founding team can now include you in creator onboarding."
    : "Membership is required so we can keep your interest attached to your HALO identity.";
}

function renderCatalog() {
  renderArtists();
  renderProducts();
  updateCatalogMeta();
}

async function loadCatalog({ announce = false } = {}) {
  elements.catalogError.hidden = true;
  elements.productGrid.hidden = false;
  elements.catalogStatus.textContent = "Connecting to the founding catalog…";
  try {
    const response = await fetch("/api/creator-marketplace", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The founding catalog could not connect.");
    state.catalog = data;
    state.user = data.authenticated ? data.viewer : null;
    if (!state.activeCreatorId) state.activeCreatorId = data.creators[0]?.id || null;
    renderCatalog();
    updateAuthButton();
    if (announce) showToast("The founding catalog is connected.");
  } catch (error) {
    elements.productGrid.hidden = true;
    elements.catalogError.hidden = false;
    elements.catalogStatus.textContent = error.message || "Signal interrupted";
  }
}

function openProduct(productId) {
  const product = state.catalog?.products.find(item => item.id === productId);
  if (!product) return;
  state.selectedProductId = productId;
  elements.productKicker.textContent = `${productTypeLabels[product.type] || product.type} / ${product.creatorName}`;
  elements.productTitle.textContent = product.title;
  elements.productDescription.textContent = product.description;
  elements.productFormat.textContent = product.format;
  elements.productEdition.textContent = product.edition || "Open edition";
  elements.productPrice.textContent = formatMoney(product.priceMinor, product.currency);
  elements.productSaveButton.textContent = product.saved ? "Saved to your founding list ✓" : "Save this founding drop";
  elements.productSaveButton.setAttribute("aria-pressed", String(product.saved));
  setModal(elements.productModal, true);
  window.haloStats?.track("marketplace_product_opened", { product_type: product.type, creator: product.creatorSlug });
}

async function marketplaceAction(payload) {
  const response = await fetch("/api/creator-marketplace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "That action did not reach HALO.");
  return data;
}

function requireMembership(action) {
  if (state.user) return false;
  state.pendingAction = action;
  openIdentity("signup", "Join HALO to keep this action attached to your membership.");
  return true;
}

async function toggleSavedDrop(productId) {
  if (requireMembership({ type: "saved_drop", productId })) return;
  const product = state.catalog?.products.find(item => item.id === productId);
  if (!product) return;
  try {
    const result = await marketplaceAction({ action: "saved_drop", productId, enabled: !product.saved });
    product.saved = result.saved;
    renderProducts();
    if (state.selectedProductId === productId && !elements.productModal.hidden) openProduct(productId);
    showToast(result.saved ? "Drop saved to your founding list." : "Drop removed from your founding list.");
    window.haloStats?.track("marketplace_drop_saved", { enabled: result.saved, product_type: product.type });
  } catch (error) {
    showToast(error.message || "The drop could not be saved.");
  }
}

async function toggleFoundingCreator() {
  if (requireMembership({ type: "founding_creator" })) return;
  const enabled = !state.catalog?.foundingCreatorInterest;
  try {
    const result = await marketplaceAction({ action: "founding_creator", enabled });
    state.catalog.foundingCreatorInterest = result.foundingCreatorInterest;
    updateCatalogMeta();
    showToast(result.foundingCreatorInterest ? "Founding creator interest registered." : "Founding creator interest withdrawn.");
    window.haloStats?.track("marketplace_founding_creator_interest", { enabled: result.foundingCreatorInterest });
  } catch (error) {
    showToast(error.message || "Creator interest could not be updated.");
  }
}

function updateAuthButton() {
  elements.authButton.textContent = state.user ? `${state.user.name || "HALO member"} · Sign out` : "Join / sign in";
}

function openIdentity(mode = "signup", message = "") {
  state.authMode = mode;
  elements.identityMessage.textContent = message;
  elements.identityForm.reset();
  updateIdentityMode();
  setModal(elements.identityModal, true);
}

function updateIdentityMode() {
  const signup = state.authMode === "signup";
  elements.nameField.hidden = !signup;
  elements.identityName.required = signup;
  elements.identityPassword.autocomplete = signup ? "new-password" : "current-password";
  elements.identitySubmit.textContent = signup ? "Join HALO" : "Sign in";
  elements.identityTitle.textContent = signup ? "Keep your place in the founding world." : "Welcome back to the founding world.";
  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    button.setAttribute("aria-selected", String(button.dataset.authMode === state.authMode));
  });
}

async function submitIdentity(event) {
  event.preventDefault();
  if (!state.identity) {
    elements.identityMessage.textContent = "Membership is still connecting. Try again in a moment.";
    return;
  }
  elements.identitySubmit.disabled = true;
  elements.identitySubmit.textContent = state.authMode === "signup" ? "Creating membership…" : "Signing in…";
  elements.identityMessage.textContent = "";
  try {
    if (state.authMode === "signup") {
      const user = await state.identity.signup(elements.identityEmail.value.trim(), elements.identityPassword.value, { full_name: elements.identityName.value.trim() });
      if (!user?.emailVerified) {
        elements.identityMessage.textContent = "Check your email to confirm your membership, then return to HALO.";
        state.pendingAction = null;
        return;
      }
      state.user = { name: user.name || elements.identityName.value.trim() || "HALO member" };
    } else {
      const user = await state.identity.login(elements.identityEmail.value.trim(), elements.identityPassword.value);
      state.user = { name: user.name || user.userMetadata?.full_name || "HALO member" };
    }
    setModal(elements.identityModal, false);
    updateAuthButton();
    await loadCatalog();
    const pending = state.pendingAction;
    state.pendingAction = null;
    if (pending?.type === "saved_drop") await toggleSavedDrop(pending.productId);
    if (pending?.type === "founding_creator") await toggleFoundingCreator();
  } catch (error) {
    elements.identityMessage.textContent = error.message || "HALO membership could not connect.";
  } finally {
    elements.identitySubmit.disabled = false;
    updateIdentityMode();
  }
}

async function connectIdentity() {
  state.identity = window.haloIdentity;
  if (!state.identity) return;
  const user = await state.identity.getUser();
  state.user = user ? { name: user.name || user.userMetadata?.full_name || "HALO member" } : null;
  updateAuthButton();
  state.identity.onAuthChange(async (_event, nextUser) => {
    state.user = nextUser ? { name: nextUser.name || nextUser.userMetadata?.full_name || "HALO member" } : null;
    updateAuthButton();
    await loadCatalog();
  });
}

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("is-active", item === button));
    renderProducts();
    window.haloStats?.track("marketplace_filter_changed", { filter: state.filter });
  });
});

elements.retryCatalog.addEventListener("click", () => loadCatalog({ announce: true }));
elements.productSaveButton.addEventListener("click", () => toggleSavedDrop(state.selectedProductId));
elements.foundingButtons.forEach(button => button.addEventListener("click", toggleFoundingCreator));
elements.identityForm.addEventListener("submit", submitIdentity);

elements.authButton.addEventListener("click", async () => {
  if (!state.user) {
    openIdentity("login");
    return;
  }
  try {
    await state.identity?.logout();
    state.user = null;
    updateAuthButton();
    await loadCatalog();
    showToast("Signed out of HALO.");
  } catch (error) {
    showToast(error.message || "Sign out could not be completed.");
  }
});

document.querySelectorAll("[data-auth-mode]").forEach(button => {
  button.addEventListener("click", () => {
    state.authMode = button.dataset.authMode;
    elements.identityMessage.textContent = "";
    updateIdentityMode();
  });
});

document.querySelectorAll("[data-close-product]").forEach(button => button.addEventListener("click", () => setModal(elements.productModal, false)));
document.querySelectorAll("[data-close-identity]").forEach(button => button.addEventListener("click", () => {
  state.pendingAction = null;
  setModal(elements.identityModal, false);
}));

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!elements.productModal.hidden) setModal(elements.productModal, false);
  if (!elements.identityModal.hidden) {
    state.pendingAction = null;
    setModal(elements.identityModal, false);
  }
});

if (window.haloIdentity) connectIdentity();
else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });

loadCatalog();
