import { createAdminAuthClient } from "./auth-client.js";
import { AdminApiError, createAdminApiClient } from "./api-client.js";
import { createFamilyAdditionsPatch, serializeFamilyAdditionsPatch } from "./patch-model.js";
import { createReviewCardHtml, suggestionToReviewNodes } from "./review-graph-adapter.js";

const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PUBLIC_CATALOG_URL = "./data/family.anchors.public.json";

export function createAdminReviewWorkspace(options) {
  const config = options.config ?? globalThis.window?.FAMILY_TREE_CONFIG;
  if (!options.authClient && (!config?.adminAuth || !config?.adminApiUrl)) return createDisabledWorkspace();
  try {
    return new AdminReviewWorkspace(options);
  } catch (error) {
    console.error("Administrator review is unavailable.");
    return createDisabledWorkspace();
  }
}

class AdminReviewWorkspace {
  constructor({
    root,
    openButton,
    countBadge,
    getCanonicalNodes,
    isCanonicalDirty = () => false,
    getFamilyChart = () => globalThis.f3,
    config = globalThis.window?.FAMILY_TREE_CONFIG,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    authClient,
    apiClient,
    downloadFile = defaultDownloadFile
  }) {
    if (!(root instanceof HTMLDialogElement)) throw new Error("Admin review dialog is required.");
    this.root = root;
    this.openButton = openButton;
    this.countBadge = countBadge;
    this.getCanonicalNodes = getCanonicalNodes;
    this.isCanonicalDirty = isCanonicalDirty;
    this.generation = 0;
    this.selectionGeneration = 0;
    this.listGeneration = 0;
    this.busy = false;
    this.familyUnlocked = false;
    this.getFamilyChart = getFamilyChart;
    this.fetchImpl = fetchImpl;
    this.downloadFile = downloadFile;
    this.auth = authClient ?? createAdminAuthClient({ config: config?.adminAuth, fetchImpl });
    this.api = apiClient ?? createAdminApiClient({
      apiUrl: config?.adminApiUrl,
      getAccessToken: () => this.auth.getAccessToken(),
      fetchImpl
    });
    this.configured = true;
    this.items = [];
    this.nextToken = "";
    this.selected = null;
    this.graphMode = "original";
    this.currentRevision = null;
    this.currentPatch = null;
    this.elements = collectElements(root);
    this.#bind();
  }

  async initialize() {
    const generation = this.generation;
    try {
      const result = await this.auth.completeRedirect();
      if (generation !== this.generation) return;
      if (result.handled) this.#setAuthStatus("Administrator sign-in completed.");
    } catch (error) {
      if (generation !== this.generation) return;
      this.#setAuthStatus(error.message, true);
    }
    this.#renderAuthState();
  }

  onFamilyUnlocked() {
    this.familyUnlocked = true;
    this.openButton?.classList.remove("is-hidden");
    if (this.auth.getSession()) void this.refreshPendingCount();
  }

  onFamilyLocked() {
    this.familyUnlocked = false;
    ++this.generation;
    ++this.selectionGeneration;
    ++this.listGeneration;
    this.busy = false;
    if (this.root.open) this.root.close();
    this.auth.clearLocalSession();
    this.openButton?.classList.add("is-hidden");
    this.#setCount(0);
    this.selected = null;
    this.items = []; this.nextToken = "";
    this.currentRevision = null; this.currentPatch = null;
    this.elements.graph.replaceChildren();
    this.elements.patchJson.textContent = "";
    this.elements.list.replaceChildren();
    this.elements.reviewNote.value = "";
    for (const key of ["detailName", "detailEmail", "detailRelationship", "detailMessage", "detailId", "anchorId"]) this.elements[key].textContent = "";
    this.elements.graphPeople.replaceChildren(); this.elements.graphRelationships.replaceChildren();
    this.#renderEmptyDetail();
  }

  onCanonicalSaved() {
    this.currentRevision = null; this.currentPatch = null;
    if (this.selected && this.root.open) void this.#renderDetail();
  }

  onCanonicalDirtyChanged() {
    this.elements.accept.disabled = this.busy || this.isCanonicalDirty();
    if (this.isCanonicalDirty()) this.#setReviewStatus("Save or discard local edits before accepting a suggestion.", true);
    else this.#setReviewStatus("");
  }

  async open() {
    if (!this.familyUnlocked) return;
    this.currentRevision = null;
    this.root.showModal();
    this.#renderAuthState();
    if (this.auth.getSession()) await this.loadSuggestions({ replace: true });
  }

  async refreshPendingCount() {
    const generation = this.generation;
    if (!this.auth.getSession()) return this.#setCount(0);
    try {
      const result = await this.api.list({ status: "pending", limit: 50 });
      if (generation !== this.generation) return;
      this.#setCount(result.items.length, Boolean(result.nextToken));
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
        this.auth.clearLocalSession();
        this.#renderAuthState();
      }
      this.#setCount(0);
    }
  }

  async loadSuggestions({ replace }) {
    const generation = this.generation;
    const listGeneration = ++this.listGeneration;
    if (replace) {
      this.items = [];
      this.nextToken = "";
      this.selected = null;
      this.#renderEmptyDetail();
    }
    this.#setWorkspaceStatus("Loading suggestions...");
    try {
      const result = await this.api.list({
        status: this.elements.statusFilter.value,
        type: this.elements.typeFilter.value,
        limit: 25,
        nextToken: replace ? "" : this.nextToken
      });
      if (generation !== this.generation || listGeneration !== this.listGeneration) return;
      this.items.push(...result.items);
      this.nextToken = result.nextToken ?? "";
      this.#renderList();
      this.#setWorkspaceStatus(this.items.length ? "" : "No suggestions match these filters.");
      if (this.elements.statusFilter.value === "pending") this.#setCount(this.items.length, Boolean(this.nextToken));
    } catch (error) {
      if (generation !== this.generation) return;
      this.#handleApiError(error, this.elements.workspaceStatus);
    }
  }

  async selectSuggestion(id) {
    if (this.busy) return;
    const generation = this.generation;
    const selectionGeneration = ++this.selectionGeneration;
    this.#setWorkspaceStatus("Loading suggestion details...");
    try {
      const result = await this.api.get(id);
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      this.selected = result.suggestion;
      this.graphMode = "original";
      this.currentPatch = null;
      this.currentRevision = null;
      this.#renderList();
      await this.#renderDetail();
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      this.#setWorkspaceStatus("");
    } catch (error) {
      if (generation !== this.generation) return;
      this.#handleApiError(error, this.elements.workspaceStatus);
    }
  }

  #bind() {
    this.openButton?.addEventListener("click", () => void this.open());
    this.elements.close.addEventListener("click", () => this.root.close());
    this.elements.signIn.addEventListener("click", () => void this.auth.beginLogin());
    this.elements.signOut.addEventListener("click", () => this.auth.beginLogout());
    this.elements.refresh.addEventListener("click", () => void this.loadSuggestions({ replace: true }));
    this.elements.statusFilter.addEventListener("change", () => void this.loadSuggestions({ replace: true }));
    this.elements.typeFilter.addEventListener("change", () => void this.loadSuggestions({ replace: true }));
    this.elements.loadMore.addEventListener("click", () => void this.loadSuggestions({ replace: false }));
    this.elements.graphModeButtons.forEach((button) => button.addEventListener("click", () => {
      this.graphMode = button.dataset.adminGraphMode;
      this.#renderGraph();
    }));
    this.elements.markPending.addEventListener("click", () => void this.#review("pending"));
    this.elements.reject.addEventListener("click", () => void this.#review("rejected"));
    this.elements.accept.addEventListener("click", () => void this.#review("accepted"));
    this.elements.downloadPatch.addEventListener("click", () => void this.downloadPatch());
  }

  #renderAuthState() {
    const session = this.auth.getSession();
    this.elements.authView.hidden = Boolean(session);
    this.elements.workspace.hidden = !session;
    this.elements.sessionLabel.textContent = session?.email || "Authenticated administrator";
  }

  #renderList() {
    this.elements.list.replaceChildren();
    for (const item of this.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-suggestion-item";
      button.classList.toggle("is-selected", item.id === this.selected?.id);
      button.addEventListener("click", () => void this.selectSuggestion(item.id));

      const heading = document.createElement("span");
      heading.className = "admin-suggestion-item-heading";
      const type = document.createElement("strong");
      type.textContent = item.type === "graph" ? "Visual suggestion" : "Text suggestion";
      const date = document.createElement("time");
      date.textContent = formatDate(item.createdAt);
      heading.append(type, date);

      const submitter = document.createElement("span");
      submitter.textContent = item.submitter?.name || "Unnamed submitter";
      const identifier = document.createElement("code");
      identifier.textContent = item.id;
      button.append(heading, submitter, identifier);
      this.elements.list.append(button);
    }
    this.elements.loadMore.hidden = !this.nextToken;
  }

  async #renderDetail() {
    const suggestion = this.selected;
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    if (!suggestion) return this.#renderEmptyDetail();
    this.elements.emptyDetail.hidden = true;
    this.elements.detailContent.hidden = false;
    this.elements.detailType.textContent = suggestion.type === "graph" ? "Visual" : "Text";
    this.elements.detailStatus.textContent = suggestion.status;
    this.elements.detailStatus.dataset.status = suggestion.status;
    this.elements.detailTitle.textContent = suggestion.type === "graph" ? "Proposed family branch" : "Written correction";
    this.elements.detailId.textContent = `Suggestion ID: ${suggestion.id}`;
    this.elements.detailDate.textContent = formatDate(suggestion.createdAt, true);
    this.elements.detailName.textContent = suggestion.submitter?.name || "—";
    this.elements.detailEmail.textContent = suggestion.submitter?.email || "—";
    this.elements.detailRelationship.textContent = suggestion.submitter?.relationship || "—";
    this.elements.reviewNote.value = suggestion.review?.note ?? "";
    this.elements.textDetail.hidden = suggestion.type !== "text";
    this.elements.graphDetail.hidden = suggestion.type !== "graph";
    this.elements.detailMessage.textContent = suggestion.payload?.message || "No message supplied.";
    this.elements.accept.textContent = suggestion.type === "graph" ? "Accept & download patch" : "Accept";
    this.elements.accept.disabled = this.busy || this.isCanonicalDirty();
    this.elements.downloadPatch.hidden = suggestion.status !== "accepted" || suggestion.type !== "graph";
    this.#setReviewStatus("");

    if (suggestion.type === "graph") {
      await this.#loadCurrentRevision();
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration || suggestion !== this.selected) return;
      this.#renderGraphSummary();
      this.#renderGraph();
      this.#renderPatchPreview();
    } else {
      this.currentPatch = null;
      this.elements.patchJson.textContent = "";
    }
  }

  #renderEmptyDetail() {
    this.elements.emptyDetail.hidden = false;
    this.elements.detailContent.hidden = true;
  }

  #renderGraph() {
    if (this.selected?.type !== "graph") return;
    this.elements.graphModeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.adminGraphMode === this.graphMode);
    });
    try {
      const nodes = suggestionToReviewNodes({
        mode: this.graphMode,
        canonicalNodes: this.getCanonicalNodes(),
        suggestion: this.selected
      });
      const familyChart = this.getFamilyChart();
      if (!familyChart?.createChart) throw new Error("Family graph renderer is unavailable.");
      this.elements.graph.replaceChildren();
      const chart = familyChart.createChart("#admin-review-chart", nodes)
        .setTransitionTime(250)
        .setCardXSpacing(250)
        .setCardYSpacing(150)
        .setShowSiblingsOfMain(true)
        .setSingleParentEmptyCard(false)
        .setOrientationVertical();
      chart.setCardHtml()
        .setStyle("rect")
        .setMiniTree(false)
        .setCardDim({ width: 220, height: 116 })
        .setCardInnerHtmlCreator(createReviewCardHtml);
      chart.updateTree({ initial: true });
    } catch (error) {
      this.elements.graph.replaceChildren();
      const message = document.createElement("p");
      message.className = "status-message is-error";
      message.textContent = error.message;
      this.elements.graph.append(message);
    }
  }

  #renderGraphSummary() {
    const payload = this.selected.payload;
    this.elements.anchorId.textContent = `Canonical anchor: ${payload.anchorPersonId}`;
    this.elements.graphPeople.replaceChildren(...payload.people.map((person) => {
      const item = document.createElement("li");
      item.textContent = `+ ${displayProposedPerson(person)}`;
      return item;
    }));
    this.elements.graphRelationships.replaceChildren(...payload.relationships.map((relationship) => {
      const item = document.createElement("li");
      const symbol = relationship.type === "spouseOf" ? "↔ spouse of" : "→ parent of";
      item.textContent = `${this.#endpointLabel(relationship.from)} ${symbol} ${this.#endpointLabel(relationship.to)}`;
      return item;
    }));
  }

  #renderPatchPreview() {
    try {
      this.currentPatch = createFamilyAdditionsPatch(this.selected, this.currentRevision);
      this.elements.patchJson.textContent = serializeFamilyAdditionsPatch(this.currentPatch);
      this.elements.accept.disabled = this.busy || this.isCanonicalDirty();
    } catch (error) {
      this.currentPatch = null;
      this.elements.patchJson.textContent = error.message;
      this.elements.accept.disabled = true;
      this.#setReviewStatus(error.message, true);
    }
  }

  async #loadCurrentRevision() {
    const generation = this.generation;
    const response = await this.fetchImpl(PUBLIC_CATALOG_URL, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Current public revision metadata could not be loaded.");
    const catalog = await response.json();
    if (!REVISION_PATTERN.test(catalog?.catalogVersion ?? "") || !REVISION_PATTERN.test(catalog?.sourceRevision ?? "")) {
      throw new Error("Current public revision metadata is invalid.");
    }
    if (generation !== this.generation) return null;
    this.currentRevision = Object.freeze({
      catalogVersion: catalog.catalogVersion,
      sourceRevision: catalog.sourceRevision
    });
    return this.currentRevision;
  }

  async #review(status) {
    if (!this.selected || this.busy) return;
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    const suggestion = this.selected;
    let reviewed = false;
    this.busy = true;
    this.#setActionsDisabled(true);
    this.#setReviewStatus("Saving review...");
    try {
      if (status === "accepted" && this.isCanonicalDirty()) throw new Error("Save or discard local edits before accepting a suggestion.");
      let patch = null;
      if (status === "accepted" && suggestion.type === "graph") {
        const revision = await this.#loadCurrentRevision();
        if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
        patch = createFamilyAdditionsPatch(suggestion, revision);
        this.currentPatch = patch;
      }
      const result = await this.api.review(suggestion.id, { status, reviewerNote: this.elements.reviewNote.value });
      reviewed = true;
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      this.selected = result.suggestion;
      const index = this.items.findIndex(item => item.id === this.selected.id);
      if (index >= 0) this.items[index] = { ...this.items[index], ...this.selected, payload: undefined };
      this.#renderList();
      // The PATCH has committed. A metadata refresh must not prevent downloading its captured patch.
      try { await this.#renderDetail(); } catch { this.elements.downloadPatch.hidden = !patch; }
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      if (patch) {
        try {
          this.downloadFile("family-additions-" + suggestion.id + ".json", serializeFamilyAdditionsPatch(patch));
          this.#setReviewStatus("Accepted. Patch downloaded; review and apply it locally to update the tree.");
        } catch {
          this.#setReviewStatus("Accepted. The download failed; use Download patch again. Acceptance was already saved.", true);
        }
      } else this.#setReviewStatus("Suggestion marked " + status + ".");
      await this.refreshPendingCount();
    } catch (error) {
      if (generation === this.generation && selectionGeneration === this.selectionGeneration) {
        if (reviewed) this.#setReviewStatus("Review saved. Refresh the workspace to reload the details.", true);
        else this.#handleApiError(error, this.elements.reviewStatus);
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.#setActionsDisabled(false);
      }
    }
  }

  async downloadPatch() {
    if (this.busy || this.selected?.status !== "accepted" || this.selected.type !== "graph") return;
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    const suggestion = this.selected;
    try {
      const revision = await this.#loadCurrentRevision();
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      const patch = createFamilyAdditionsPatch(suggestion, revision);
      this.downloadFile("family-additions-" + suggestion.id + ".json", serializeFamilyAdditionsPatch(patch));
      this.#setReviewStatus("Patch downloaded again. No review status was changed.");
    } catch (error) {
      if (generation === this.generation && selectionGeneration === this.selectionGeneration) this.#setReviewStatus(error.message, true);
    }
  }

  #setActionsDisabled(disabled) {
    for (const key of ["markPending", "reject", "accept", "downloadPatch", "refresh", "statusFilter", "typeFilter", "loadMore"]) {
      this.elements[key].disabled = disabled;
    }
    if (!disabled) this.elements.accept.disabled = this.isCanonicalDirty() || (this.selected?.type === "graph" && !this.currentPatch);
  }

  #endpointLabel(id) {
    if (id === this.selected.payload.anchorPersonId) {
      const anchor = this.getCanonicalNodes().find((node) => node.id === id);
      return displayCanonicalPerson(anchor) || id;
    }
    const proposed = this.selected.payload.people.find((person) => person.id === id);
    return proposed ? displayProposedPerson(proposed) : id;
  }

  #handleApiError(error, element) {
    if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
      this.auth.clearLocalSession();
      this.#renderAuthState();
    }
    element.textContent = error.message || "Administrator request failed.";
    element.classList.add("is-error");
  }

  #setCount(count, hasMore = false) {
    if (!this.countBadge) return;
    this.countBadge.hidden = count === 0;
    this.countBadge.textContent = hasMore ? `${count}+` : String(count);
  }

  #setAuthStatus(message, isError = false) {
    setStatusElement(this.elements.authStatus, message, isError);
  }

  #setWorkspaceStatus(message, isError = false) {
    setStatusElement(this.elements.workspaceStatus, message, isError);
  }

  #setReviewStatus(message, isError = false) {
    setStatusElement(this.elements.reviewStatus, message, isError);
  }
}

function collectElements(root) {
  const get = (id) => {
    const element = root.querySelector(`#${id}`);
    if (!element) throw new Error(`Missing admin review element #${id}.`);
    return element;
  };
  return {
    close: get("admin-dialog-close"),
    authView: get("admin-auth-view"),
    signIn: get("admin-sign-in"),
    authStatus: get("admin-auth-status"),
    workspace: get("admin-workspace"),
    statusFilter: get("admin-status-filter"),
    typeFilter: get("admin-type-filter"),
    refresh: get("admin-refresh"),
    signOut: get("admin-sign-out"),
    sessionLabel: get("admin-session-label"),
    workspaceStatus: get("admin-workspace-status"),
    list: get("admin-suggestion-list"),
    loadMore: get("admin-load-more"),
    emptyDetail: get("admin-empty-detail"),
    detailContent: get("admin-detail-content"),
    detailType: get("admin-detail-type"),
    detailStatus: get("admin-detail-status"),
    detailTitle: get("admin-detail-title"),
    detailId: get("admin-detail-id"),
    detailDate: get("admin-detail-date"),
    detailName: get("admin-detail-name"),
    detailEmail: get("admin-detail-email"),
    detailRelationship: get("admin-detail-relationship"),
    textDetail: get("admin-text-detail"),
    detailMessage: get("admin-detail-message"),
    graphDetail: get("admin-graph-detail"),
    anchorId: get("admin-anchor-id"),
    graph: get("admin-review-chart"),
    graphPeople: get("admin-graph-people"),
    graphRelationships: get("admin-graph-relationships"),
    patchJson: get("admin-patch-json"),
    reviewNote: get("admin-review-note"),
    reviewStatus: get("admin-review-status"),
    markPending: get("admin-mark-pending"),
    reject: get("admin-reject"),
    accept: get("admin-accept"),
    downloadPatch: get("admin-download-patch"),
    graphModeButtons: [...root.querySelectorAll("[data-admin-graph-mode]")]
  };
}

function createDisabledWorkspace() {
  return {
    configured: false,
    initialize: async () => {},
    onFamilyUnlocked: () => {},
    onFamilyLocked: () => {},
    onCanonicalSaved: () => {},
    onCanonicalDirtyChanged: () => {},
    open: async () => {},
    refreshPendingCount: async () => {}
  };
}

function setStatusElement(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function displayCanonicalPerson(node) {
  return [node?.data?.["first name"], node?.data?.["last name"]].filter(Boolean).join(" ");
}

function displayProposedPerson(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unnamed person";
}

function formatDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function defaultDownloadFile(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
