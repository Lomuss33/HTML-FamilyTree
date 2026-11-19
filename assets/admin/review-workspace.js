import { createAdminAuthClient } from "./auth-client.js";
import { AdminApiError, createAdminApiClient } from "./api-client.js";
import { createFamilyAdditionsPatch, serializeFamilyAdditionsPatch } from "./patch-model.js";
import { createReviewCardHtml, suggestionToReviewNodes } from "./review-graph-adapter.js";
import { createPhotoClient } from "../viewer/photo-client.js";
import { PROFILE_CHANGE_FIELDS, applyProfileChange, profileFieldText } from "../suggestions/profile-change.js";

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
    getPhotoTargets = getCanonicalNodes,
    canStagePhotos = () => false,
    isCanonicalDirty = () => false,
    getFamilyChart = () => globalThis.f3,
    config = globalThis.window?.FAMILY_TREE_CONFIG,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    authClient,
    apiClient,
    onStageDraft,
    onStagePhotos,
    downloadFile = defaultDownloadFile
  }) {
    if (!(root instanceof HTMLDialogElement)) throw new Error("Admin review dialog is required.");
    this.root = root;
    this.openButton = openButton;
    this.countBadge = countBadge;
    this.getCanonicalNodes = getCanonicalNodes;
    this.getPhotoTargets = getPhotoTargets;
    this.canStagePhotos = canStagePhotos;
    this.isCanonicalDirty = isCanonicalDirty;
    this.generation = 0;
    this.selectionGeneration = 0;
    this.listGeneration = 0;
    this.busy = false;
    this.familyUnlocked = false;
    this.getFamilyChart = getFamilyChart;
    this.fetchImpl = fetchImpl;
    this.downloadFile = downloadFile;
    this.onStageDraft = onStageDraft;
    this.onStagePhotos = onStagePhotos;
    this.attachmentPhotos = null;
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
    this.auth.onFamilyUnlocked?.();
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
    this.attachmentPhotos?.clear(); this.attachmentPhotos = null;
    this.elements.photoList.replaceChildren(); this.elements.photos.hidden = true;
    for (const key of ["detailName", "detailEmail", "detailRelationship", "detailMessage", "detailId", "anchorId"]) this.elements[key].textContent = "";
    this.elements.graphPeople.replaceChildren(); this.elements.graphRelationships.replaceChildren();
    this.#renderEmptyDetail();
  }

  onCanonicalSaved() {
    this.currentRevision = null; this.currentPatch = null;
    if (this.selected && this.root.open) void this.#renderDetail();
  }

  onCanonicalDirtyChanged() {
    this.elements.accept.disabled = this.busy || this.#acceptBlocked();
    this.elements.addToDraft.disabled = this.busy || this.isCanonicalDirty() || !this.#hasDraft();
    this.elements.photosToDraft.disabled = this.busy || !this.canStagePhotos();
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
    this.elements.addToDraft.addEventListener("click", () => void this.addToDraft());
    this.elements.photosToDraft.addEventListener("click", () => void this.addPhotosToDraft());
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
    this.elements.detailTitle.textContent = suggestion.profileChange ? "Ispravak podataka o osobi" : suggestion.type === "graph" ? "Proposed family branch" : "Written correction";
    this.elements.detailId.textContent = `Suggestion ID: ${suggestion.id}`;
    this.elements.detailDate.textContent = formatDate(suggestion.createdAt, true);
    this.elements.detailName.textContent = suggestion.submitter?.name || "—";
    this.elements.detailEmail.textContent = suggestion.submitter?.email || "—";
    this.elements.detailRelationship.textContent = suggestion.submitter?.relationship || "—";
    this.elements.reviewNote.value = suggestion.review?.note ?? "";
    this.elements.textDetail.hidden = suggestion.type !== "text";
    this.elements.graphDetail.hidden = suggestion.type !== "graph";
    this.elements.detailMessage.textContent = suggestion.payload?.message || "No message supplied.";
    this.elements.accept.textContent = suggestion.type === "graph" || suggestion.profileChange
      ? this.onStageDraft ? "Odobri i dodaj u nacrt" : "Accept & download patch" : "Accept";
    this.elements.addToDraft.hidden = !this.onStageDraft || suggestion.status !== "accepted" || (suggestion.type !== "graph" && !suggestion.profileChange);
    this.elements.addToDraft.disabled = this.busy || this.isCanonicalDirty();
    this.elements.downloadPatch.hidden = suggestion.status !== "accepted" || suggestion.type !== "graph";
    this.#setReviewStatus("");
    this.#renderPhotos();
    this.#renderProfileChange();
    this.elements.accept.disabled = this.busy || this.#acceptBlocked();

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
    this.attachmentPhotos?.clear(); this.attachmentPhotos = null;
    this.elements.photoList.replaceChildren(); this.elements.photos.hidden = true;
    this.elements.emptyDetail.hidden = false;
    this.elements.detailContent.hidden = true;
    this.elements.profileChange.replaceChildren(); this.elements.profileChange.hidden = true;
  }

  #selectedProfileFields() {
    return [...this.elements.profileChange.querySelectorAll("input[data-accepted-profile-field]:checked")].map(input => input.dataset.acceptedProfileField);
  }

  #hasDraft() {
    return this.selected?.profileChange ? Boolean(this.onStageDraft && this.selected.profileApproval) : Boolean(this.currentPatch);
  }

  #acceptBlocked() {
    if (this.isCanonicalDirty()) return true;
    if (this.selected?.profileChange) return !this.onStageDraft || this.selected.status === "accepted" || !this.#selectedProfileFields().length;
    return this.selected?.type === "graph" && !this.currentPatch;
  }

  #renderProfileChange() {
    const section = this.elements.profileChange;
    section.replaceChildren(); section.hidden = !this.selected?.profileChange;
    if (section.hidden) return;
    const change = this.selected.profileChange;
    const nodes = this.getCanonicalNodes();
    const person = nodes.find(value => value.id === change.personId);
    function text(tag, value, className) {
      const element = document.createElement(tag); element.textContent = value;
      if (className) element.className = className;
      return element;
    }
    if (!person) {
      section.append(text("p", "Osoba više nije u trenutačnom stablu. Ispravak se ne može prihvatiti.", "status-message is-error"));
      return;
    }
    section.append(text("h3", displayCanonicalPerson(person)),
      text("p", "Označi promjene koje prihvaćaš. Bilješke i mjesta života dodaju se postojećim zapisima. Javna vidljivost ostaje nepromijenjena; nacrt spremaš gumbom Save."));
    const accepted = this.selected.status === "accepted";
    const fields = Object.keys(change.changes);
    const proposed = applyProfileChange(nodes, change, fields).find(value => value.id === change.personId);
    for (const field of PROFILE_CHANGE_FIELDS.filter(field => Object.hasOwn(change.changes, field.key))) {
      const row = document.createElement("div"); row.className = "admin-profile-field";
      const label = document.createElement("label"); label.className = "profile-change-toggle";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox";
      checkbox.dataset.acceptedProfileField = field.key;
      checkbox.checked = !accepted || this.selected.profileApproval?.fields.includes(field.key) === true;
      checkbox.disabled = this.busy || accepted;
      checkbox.addEventListener("change", () => { this.elements.accept.disabled = this.busy || this.#acceptBlocked(); });
      label.append(checkbox, text("strong", field.label));
      const comparison = document.createElement("dl");
      comparison.append(text("dt", "Sada je upisano"), text("dd", profileFieldText(person.data[field.key])),
        text("dt", "Nakon prihvaćanja"), text("dd", profileFieldText(proposed.data[field.key])));
      row.append(label, comparison); section.append(row);
    }
    if (accepted) section.append(text("p", "Odobrena polja označena su kvačicom. Za drukčiji odabir vrati prijedlog na čekanje. Nakon spremanja stabla za ponovno dodavanje potreban je novi pregled."));
  }

  #renderPhotos() {
    this.attachmentPhotos?.clear(); this.attachmentPhotos = null;
    this.elements.photoList.replaceChildren();
    const suggestion = this.selected;
    const photos = suggestion?.attachments ?? [];
    this.elements.photos.hidden = !this.onStagePhotos || !photos.length;
    this.elements.photosToDraft.hidden = suggestion?.status !== "accepted";
    this.elements.photosToDraft.disabled = this.busy || !this.canStagePhotos();
    if (this.elements.photos.hidden) return;
    const viewer = createPhotoClient({ readPhoto: photoId => this.api.photo(suggestion.id, photoId) });
    this.attachmentPhotos = viewer;
    for (const photo of photos) {
      const row = document.createElement("div"); row.className = "admin-photo-item";
      const open = document.createElement("button"); open.type = "button"; open.className = "photo-tile";
      open.setAttribute("aria-label", "Otvori priloženu fotografiju: " + photo.name);
      const image = document.createElement("img"); image.alt = photo.caption || photo.name;
      const name = document.createElement("span"); name.textContent = photo.caption || photo.name;
      open.append(image, name);
      void viewer.preview(photo.id).then(url => { if (image.isConnected) image.src = url; }, () => { name.textContent = "Fotografija nije dostupna. " + photo.name; });
      open.addEventListener("click", () => void viewer.show(photo).catch(error => this.#setReviewStatus(error.message, true)));
      row.append(open);
      const label = document.createElement("label"); label.className = "field";
      const title = document.createElement("span"); title.textContent = "Dodaj u galeriju osobe";
      const select = document.createElement("select"); select.dataset.photoId = photo.id;
      select.append(new Option("Ostavi samo uz prijedlog", ""));
      for (const person of this.getPhotoTargets()) select.append(new Option(displayCanonicalPerson(person) + (person.data.birthday ? " · " + person.data.birthday : ""), person.id));
      select.disabled = this.busy || suggestion.status !== "accepted";
      label.append(title, select); row.append(label); this.elements.photoList.append(row);
    }
  }

  async addPhotosToDraft() {
    if (this.busy || !this.onStagePhotos || this.selected?.status !== "accepted") return;
    if (!this.canStagePhotos()) return this.#setReviewStatus("Dovrši otvorena polja prije dodavanja fotografija.", true);
    const assignments = [...this.elements.photoList.querySelectorAll("select[data-photo-id]")]
      .filter(select => select.value).map(select => ({ id: select.dataset.photoId, personId: select.value }));
    if (!assignments.length) return this.#setReviewStatus("Odaberi fotografiju i osobu za njezinu galeriju.", true);
    const generation = this.generation, selectionGeneration = this.selectionGeneration;
    this.busy = true; this.#setActionsDisabled(true);
    try {
      const result = await this.api.photoDraft(this.selected.id, assignments);
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      const added = this.onStagePhotos(result.draft);
      for (const select of this.elements.photoList.querySelectorAll("select")) select.value = "";
      this.#setReviewStatus(added === false ? "Odabrane fotografije već su u tim galerijama." : "Fotografije su u privatnom nacrtu. Pregledaj galerije pa pritisni Save.");
    } catch (error) {
      if (generation === this.generation && selectionGeneration === this.selectionGeneration) this.#handleApiError(error, this.elements.reviewStatus);
    } finally {
      if (generation === this.generation) { this.busy = false; this.#setActionsDisabled(false); }
    }
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
      this.elements.addToDraft.disabled = this.busy || this.isCanonicalDirty();
    } catch (error) {
      this.currentPatch = null;
      this.elements.patchJson.textContent = error.message;
      this.elements.accept.disabled = true;
      this.elements.addToDraft.disabled = true;
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
      const fields = status === "accepted" && suggestion.profileChange ? this.#selectedProfileFields() : undefined;
      if (fields && (!fields.length || !this.onStageDraft)) throw new Error("Odaberi barem jedno predloženo polje za prihvaćanje u nacrt.");
      const result = await this.api.review(suggestion.id, { status, reviewerNote: this.elements.reviewNote.value }, fields);
      reviewed = true;
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      this.selected = result.suggestion;
      let stagingError = null, alreadyRecorded = false;
      if ((patch || fields) && this.onStageDraft) {
        try {
          if (!result.draft) throw new Error("Dopuna nije učitana. Ponovno je dodaj iz odobrenih prijedloga.");
          alreadyRecorded = this.onStageDraft(result.draft) === false;
        } catch (error) { stagingError = error; }
      }
      const index = this.items.findIndex(item => item.id === this.selected.id);
      if (index >= 0) this.items[index] = { ...this.items[index], ...this.selected, payload: undefined };
      this.#renderList();
      // The PATCH has committed. A metadata refresh must not prevent downloading its captured patch.
      try { await this.#renderDetail(); } catch { this.elements.downloadPatch.hidden = !patch; }
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      if ((patch || fields) && this.onStageDraft) {
        this.#setReviewStatus(stagingError
          ? "Odobreno, ali nije dodano u nacrt. " + stagingError.message
          : alreadyRecorded ? "Odobreno. Odabrani podaci već su upisani; stablo je nepromijenjeno."
          : "Odobreno. Dopuna je u nacrtu; zatvori pregled, provjeri stablo pa pritisni Save.", Boolean(stagingError));
      } else if (patch) {
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

  async addToDraft() {
    if (this.busy || !this.onStageDraft || this.selected?.status !== "accepted" || (this.selected.type !== "graph" && !this.selected.profileChange)) return;
    if (this.isCanonicalDirty()) return this.#setReviewStatus("Najprije spremi ili odbaci postojeći nacrt.", true);
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    const id = this.selected.id;
    this.busy = true;
    this.#setActionsDisabled(true);
    this.#setReviewStatus("Pripremam odobrenu dopunu…");
    try {
      const result = await this.api.draft(id);
      if (generation !== this.generation || selectionGeneration !== this.selectionGeneration) return;
      const added = this.onStageDraft(result.draft);
      this.#setReviewStatus(added === false ? "Odabrani podaci već su upisani; stablo je nepromijenjeno."
        : "Dopuna je u nacrtu. Zatvori pregled, provjeri stablo pa pritisni Save.");
    } catch (error) {
      if (generation === this.generation && selectionGeneration === this.selectionGeneration) this.#handleApiError(error, this.elements.reviewStatus);
    } finally {
      if (generation === this.generation) { this.busy = false; this.#setActionsDisabled(false); }
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
    for (const key of ["markPending", "reject", "accept", "addToDraft", "photosToDraft", "downloadPatch", "refresh", "statusFilter", "typeFilter", "loadMore"]) {
      this.elements[key].disabled = disabled;
    }
    if (!disabled) {
      this.elements.accept.disabled = this.#acceptBlocked();
      this.elements.addToDraft.disabled = this.isCanonicalDirty() || !this.#hasDraft();
      this.elements.photosToDraft.disabled = !this.canStagePhotos();
    }
    for (const select of this.elements.photoList.querySelectorAll("select")) select.disabled = disabled || this.selected?.status !== "accepted";
    for (const checkbox of this.elements.profileChange.querySelectorAll("input")) checkbox.disabled = disabled || this.selected?.status === "accepted";
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
    profileChange: get("admin-profile-change"),
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
    addToDraft: get("admin-add-to-draft"),
    downloadPatch: get("admin-download-patch"),
    photos: get("admin-photo-attachments"),
    photoList: get("admin-photo-list"),
    photosToDraft: get("admin-photos-to-draft"),
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
