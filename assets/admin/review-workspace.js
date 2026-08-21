import { createAdminAuthClient } from "./auth-client.js";
import { AdminApiError, createAdminApiClient } from "./api-client.js";
import { createFamilyAdditionsPatch, serializeFamilyAdditionsPatch } from "./patch-model.js";
import { createReviewCardHtml, suggestionToReviewNodes } from "./review-graph-adapter.js";

const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PUBLIC_CATALOG_URL = "./data/family.anchors.public.json";

export function createAdminReviewWorkspace(options) {
  try {
    return new AdminReviewWorkspace(options);
  } catch (error) {
    console.error("Administrator review is unavailable.", error);
    return createDisabledWorkspace();
  }
}

class AdminReviewWorkspace {
  constructor({
    root,
    openButton,
    countBadge,
    getCanonicalNodes,
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
    try {
      const result = await this.auth.completeRedirect();
      if (result.handled) this.#setAuthStatus("Administrator sign-in completed.");
    } catch (error) {
      this.#setAuthStatus(error.message, true);
    }
    this.#renderAuthState();
  }

  onFamilyUnlocked() {
    this.openButton?.classList.remove("is-hidden");
    if (this.auth.getSession()) void this.refreshPendingCount();
  }

  onFamilyLocked() {
    if (this.root.open) this.root.close();
    this.auth.clearLocalSession();
    this.openButton?.classList.add("is-hidden");
    this.#setCount(0);
    this.selected = null;
  }

  async open() {
    this.root.showModal();
    this.#renderAuthState();
    if (this.auth.getSession()) await this.loadSuggestions({ replace: true });
  }

  async refreshPendingCount() {
    if (!this.auth.getSession()) return this.#setCount(0);
    try {
      const result = await this.api.list({ status: "pending", limit: 50 });
      this.#setCount(result.items.length, Boolean(result.nextToken));
    } catch (error) {
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
        this.auth.clearLocalSession();
        this.#renderAuthState();
      }
      this.#setCount(0);
    }
  }

  async loadSuggestions({ replace }) {
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
      this.items.push(...result.items);
      this.nextToken = result.nextToken ?? "";
      this.#renderList();
      this.#setWorkspaceStatus(this.items.length ? "" : "No suggestions match these filters.");
      if (this.elements.statusFilter.value === "pending") this.#setCount(this.items.length, Boolean(this.nextToken));
    } catch (error) {
      this.#handleApiError(error, this.elements.workspaceStatus);
    }
  }

  async selectSuggestion(id) {
    this.#setWorkspaceStatus("Loading suggestion details...");
    try {
      const result = await this.api.get(id);
      this.selected = result.suggestion;
      this.graphMode = "original";
      this.currentPatch = null;
      this.#renderList();
      await this.#renderDetail();
      this.#setWorkspaceStatus("");
    } catch (error) {
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
    this.elements.accept.disabled = false;
    this.#setReviewStatus("");

    if (suggestion.type === "graph") {
      await this.#loadCurrentRevision();
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
      this.elements.accept.disabled = false;
    } catch (error) {
      this.currentPatch = null;
      this.elements.patchJson.textContent = error.message;
      this.elements.accept.disabled = true;
      this.#setReviewStatus(error.message, true);
    }
  }

  async #loadCurrentRevision() {
    if (this.currentRevision) return this.currentRevision;
    const response = await this.fetchImpl(PUBLIC_CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Current public revision metadata could not be loaded.");
    const catalog = await response.json();
    if (!REVISION_PATTERN.test(catalog?.catalogVersion ?? "") || !REVISION_PATTERN.test(catalog?.sourceRevision ?? "")) {
      throw new Error("Current public revision metadata is invalid.");
    }
    this.currentRevision = Object.freeze({
      catalogVersion: catalog.catalogVersion,
      sourceRevision: catalog.sourceRevision
    });
    return this.currentRevision;
  }

  async #review(status) {
    if (!this.selected) return;
    this.#setReviewStatus("Saving review...");
    try {
      if (status === "accepted" && this.selected.type === "graph" && !this.currentPatch) {
        throw new Error("A current additive patch could not be generated.");
      }
      const result = await this.api.review(this.selected.id, {
        status,
        reviewerNote: this.elements.reviewNote.value
      });
      this.selected = result.suggestion;
      const index = this.items.findIndex((item) => item.id === this.selected.id);
      if (index >= 0) this.items[index] = { ...this.items[index], ...this.selected, payload: undefined };
      if (status === "accepted" && this.selected.type === "graph") {
        this.downloadFile(
          `family-additions-${this.selected.id}.json`,
          serializeFamilyAdditionsPatch(this.currentPatch)
        );
      }
      this.#renderList();
      await this.#renderDetail();
      this.#setReviewStatus(status === "accepted" && this.selected.type === "graph"
        ? "Accepted. The deterministic additive patch was downloaded; apply it locally after review."
        : `Suggestion marked ${status}.`);
      await this.refreshPendingCount();
    } catch (error) {
      this.#handleApiError(error, this.elements.reviewStatus);
    }
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
    graphModeButtons: [...root.querySelectorAll("[data-admin-graph-mode]")]
  };
}

function createDisabledWorkspace() {
  return {
    configured: false,
    initialize: async () => {},
    onFamilyUnlocked: () => {},
    onFamilyLocked: () => {},
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
