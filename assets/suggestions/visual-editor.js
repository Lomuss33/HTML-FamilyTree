import { VisualSuggestionDraft } from "./draft-model.js";
import { createSuggestionCardHtml, draftToFamilyChartNodes } from "./graph-adapter.js";
import { filterPublicAnchors, loadPublicAnchorCatalog } from "./public-anchor-catalog.js";
import { submitVisualDraft } from "./submission-api.js";

const PUBLIC_ANCHOR_CATALOG_URL = "./data/family.anchors.public.json";

export function createVisualSuggestionEditor({
  root,
  getFamilyChart = () => globalThis.f3,
  confirmDiscard = (message) => globalThis.confirm(message),
  catalogUrl = PUBLIC_ANCHOR_CATALOG_URL,
  submitDraft = submitVisualDraft,
  onRequestClose = () => {}
}) {
  return new VisualSuggestionEditor({
    root,
    getFamilyChart,
    confirmDiscard,
    catalogUrl,
    submitDraft,
    onRequestClose
  });
}

class VisualSuggestionEditor {
  constructor({ root, getFamilyChart, confirmDiscard, catalogUrl, submitDraft, onRequestClose }) {
    if (!(root instanceof HTMLElement)) throw new Error("Visual suggestion root is required.");
    this.root = root;
    this.getFamilyChart = getFamilyChart;
    this.confirmDiscard = confirmDiscard;
    this.catalogUrl = catalogUrl;
    this.submitDraft = submitDraft;
    this.onRequestClose = onRequestClose;
    this.draft = new VisualSuggestionDraft();
    this.catalog = null;
    this.catalogPromise = null;
    this.selectedAnchor = null;
    this.selectedPersonId = null;
    this.personOperation = null;
    this.chart = null;
    this.isSubmitting = false;
    this.elements = this.#collectElements();
    this.#bindEvents();
    this.#showChooser();
  }

  async activate() {
    if (!this.catalog) await this.#loadCatalog();
    if (this.selectedAnchor) {
      this.#showWorkspace();
      this.#renderGraph();
    } else {
      this.#showChooser();
      this.elements.anchorSearch.focus();
    }
  }

  hasDraftContent() {
    return this.draft.hasContent();
  }

  requestDiscard(message = "Discard this visual suggestion draft?") {
    if (this.isSubmitting) return false;
    if (!this.hasDraftContent()) {
      this.reset();
      return true;
    }
    if (!this.confirmDiscard(message)) return false;
    this.reset();
    return true;
  }

  reset() {
    this.draft.reset();
    this.selectedAnchor = null;
    this.selectedPersonId = null;
    this.personOperation = null;
    this.chart = null;
    this.elements.anchorSearch.value = "";
    this.elements.graph.replaceChildren();
    this.elements.personForm.reset();
    this.elements.personEditor.hidden = true;
    this.elements.preview.hidden = true;
    this.elements.submit.hidden = true;
    this.elements.success.hidden = true;
    this.elements.editorView.hidden = false;
    this.elements.submitForm.reset();
    this.elements.submitButton.disabled = false;
    this.#setSubmitStatus("");
    this.#setStatus("");
    this.#showChooser();
    this.#renderAnchorOptions();
  }

  #collectElements() {
    const find = (id) => {
      const element = this.root.querySelector(`#${id}`);
      if (!element) throw new Error(`Missing visual suggestion element #${id}.`);
      return element;
    };
    return {
      chooser: find("visual-anchor-chooser"),
      anchorSearch: find("visual-anchor-search"),
      anchorStatus: find("visual-anchor-status"),
      anchorList: find("visual-anchor-list"),
      anchorRetry: find("visual-anchor-retry"),
      workspace: find("visual-workspace"),
      editorView: find("visual-editor-view"),
      graph: find("visual-family-chart"),
      anchorLabel: find("visual-current-anchor-label"),
      anchorMeta: find("visual-current-anchor-meta"),
      changeAnchor: find("visual-change-anchor"),
      selectedBadge: find("visual-selected-badge"),
      selectedLabel: find("visual-selected-label"),
      editPerson: find("visual-edit-person"),
      removePerson: find("visual-remove-person"),
      relationButtons: [...this.root.querySelectorAll("[data-visual-add]")],
      peopleCount: find("visual-people-count"),
      relationshipCount: find("visual-relationship-count"),
      status: find("visual-status"),
      previewButton: find("visual-preview-button"),
      resetButton: find("visual-reset-button"),
      personEditor: find("visual-person-editor"),
      personForm: find("visual-person-form"),
      personEditorTitle: find("visual-person-editor-title"),
      personEditorContext: find("visual-person-editor-context"),
      firstName: find("visual-person-first-name"),
      lastName: find("visual-person-last-name"),
      birthday: find("visual-person-birthday"),
      gender: find("visual-person-gender"),
      personStatus: find("visual-person-status"),
      personCancel: find("visual-person-cancel"),
      preview: find("visual-preview"),
      previewAnchor: find("visual-preview-anchor"),
      previewPeople: find("visual-preview-people"),
      previewRelationships: find("visual-preview-relationships"),
      serialization: find("visual-serialization"),
      previewBack: find("visual-preview-back"),
      previewContinue: find("visual-preview-continue"),
      submit: find("visual-submit"),
      submitForm: find("visual-submit-form"),
      submitterName: find("visual-submitter-name"),
      submitterEmail: find("visual-submitter-email"),
      submitterRelationship: find("visual-submitter-relationship"),
      submitterComment: find("visual-submitter-comment"),
      submitterCode: find("visual-submitter-code"),
      submitStatus: find("visual-submit-status"),
      submitBack: find("visual-submit-back"),
      submitButton: find("visual-submit-button"),
      success: find("visual-success"),
      successReference: find("visual-success-reference"),
      successClose: find("visual-success-close")
    };
  }

  #bindEvents() {
    this.elements.anchorSearch.addEventListener("input", () => this.#renderAnchorOptions());
    this.elements.anchorRetry.addEventListener("click", () => void this.#loadCatalog());
    this.elements.anchorList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-anchor-id]");
      if (button) this.#selectAnchor(button.dataset.anchorId);
    });
    this.elements.changeAnchor.addEventListener("click", () => {
      if (this.requestDiscard("Changing the anchor will discard this visual draft. Continue?")) {
        this.elements.anchorSearch.focus();
      }
    });
    this.elements.relationButtons.forEach((button) => {
      button.addEventListener("click", () => this.#openAddPerson(button.dataset.visualAdd));
    });
    this.elements.editPerson.addEventListener("click", () => this.#openEditPerson());
    this.elements.removePerson.addEventListener("click", () => this.#removeSelectedPerson());
    this.elements.personForm.addEventListener("submit", (event) => this.#savePerson(event));
    this.elements.personCancel.addEventListener("click", () => this.#closePersonEditor());
    this.elements.previewButton.addEventListener("click", () => this.#showPreview());
    this.elements.previewBack.addEventListener("click", () => {
      this.elements.preview.hidden = true;
      this.elements.editorView.hidden = false;
      this.#renderGraph();
      this.elements.previewButton.focus();
    });
    this.elements.previewContinue.addEventListener("click", () => this.#showSubmit());
    this.elements.submitBack.addEventListener("click", () => {
      if (this.isSubmitting) return;
      this.elements.submit.hidden = true;
      this.elements.preview.hidden = false;
      this.elements.previewContinue.focus();
    });
    this.elements.submitForm.addEventListener("submit", (event) => void this.#submit(event));
    this.elements.successClose.addEventListener("click", () => this.onRequestClose());
    this.elements.resetButton.addEventListener("click", () => {
      if (this.requestDiscard("Start over and discard this visual suggestion draft?")) {
        this.elements.anchorSearch.focus();
      }
    });
  }

  async #loadCatalog() {
    if (this.catalogPromise) return this.catalogPromise;
    this.elements.anchorSearch.disabled = true;
    this.elements.anchorRetry.hidden = true;
    this.#setAnchorStatus("Loading approved public anchors…");
    this.catalogPromise = loadPublicAnchorCatalog(this.catalogUrl)
      .then((catalog) => {
        this.catalog = catalog;
        this.elements.anchorSearch.disabled = catalog.anchors.length === 0;
        this.#renderAnchorOptions();
        return catalog;
      })
      .catch((error) => {
        console.error(error);
        this.catalogPromise = null;
        this.elements.anchorSearch.disabled = true;
        this.elements.anchorRetry.hidden = false;
        this.#setAnchorStatus("The approved public anchor catalog could not be loaded.", true);
        return null;
      });
    return this.catalogPromise;
  }

  #renderAnchorOptions() {
    this.elements.anchorList.replaceChildren();
    if (!this.catalog) return;
    const anchors = filterPublicAnchors(this.catalog.anchors, this.elements.anchorSearch.value);

    if (this.catalog.anchors.length === 0) {
      this.#setAnchorStatus("No public anchors are available yet. You can still use the Simple form.");
      return;
    }
    if (anchors.length === 0) {
      this.#setAnchorStatus("No approved anchors match that search.");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const anchor of anchors) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "visual-anchor-option";
      button.dataset.anchorId = anchor.id;
      button.setAttribute("role", "option");

      const label = document.createElement("strong");
      label.textContent = anchor.displayLabel;
      button.append(label);
      for (const value of [anchor.lifespanLabel, anchor.branchLabel]) {
        if (!value) continue;
        const meta = document.createElement("span");
        meta.textContent = value;
        button.append(meta);
      }
      fragment.append(button);
    }
    this.elements.anchorList.append(fragment);
    this.#setAnchorStatus(`${anchors.length} approved anchor${anchors.length === 1 ? "" : "s"} available.`);
  }

  #selectAnchor(anchorId) {
    const anchor = this.catalog?.anchors.find((entry) => entry.id === anchorId);
    if (!anchor) {
      this.#setAnchorStatus("That public anchor is no longer available.", true);
      return;
    }
    try {
      this.draft.selectAnchor(anchor, {
        anchorCatalogVersion: this.catalog.catalogVersion,
        sourceRevision: this.catalog.sourceRevision
      });
      this.selectedAnchor = anchor;
      this.selectedPersonId = anchor.id;
      this.#showWorkspace();
      this.#renderAll();
    } catch (error) {
      this.#setAnchorStatus(error.message, true);
    }
  }

  #showChooser() {
    this.elements.chooser.hidden = false;
    this.elements.workspace.hidden = true;
  }

  #showWorkspace() {
    this.elements.chooser.hidden = true;
    this.elements.workspace.hidden = false;
    this.elements.editorView.hidden = false;
    this.elements.preview.hidden = true;
    this.elements.submit.hidden = true;
    this.elements.success.hidden = true;
    this.elements.personEditor.hidden = true;
    this.elements.anchorLabel.textContent = this.selectedAnchor?.displayLabel ?? "";
    this.elements.anchorMeta.textContent = [
      this.selectedAnchor?.lifespanLabel,
      this.selectedAnchor?.branchLabel
    ].filter(Boolean).join(" · ");
  }

  #renderAll() {
    this.#renderGraph();
    this.#renderSelection();
    this.#renderSummary();
    this.#setStatus("");
  }

  #renderGraph() {
    if (!this.selectedAnchor || this.elements.editorView.hidden) return;
    const familyChart = this.getFamilyChart();
    if (!familyChart?.createChart) {
      this.#setStatus("The visual graph renderer is unavailable. Your draft remains intact.", true);
      return;
    }

    const nodes = draftToFamilyChartNodes(this.draft.getSnapshot(), this.selectedAnchor);
    this.elements.graph.replaceChildren();
    this.chart = familyChart.createChart("#visual-family-chart", nodes)
      .setTransitionTime(320)
      .setCardXSpacing(250)
      .setCardYSpacing(150)
      .setShowSiblingsOfMain(true)
      .setSingleParentEmptyCard(false)
      .setOrientationVertical();

    const editor = this;
    this.chart.setCardHtml()
      .setStyle("rect")
      .setMiniTree(false)
      .setCardDim({ width: 220, height: 116 })
      .setCardInnerHtmlCreator(createSuggestionCardHtml)
      .setOnCardUpdate(function updateVisualCardSelection(datum) {
        this.querySelector(".visual-node-card")?.classList.toggle(
          "is-selected",
          datum.data.id === editor.selectedPersonId
        );
      })
      .setOnCardClick((_event, datum) => {
        this.selectedPersonId = datum.data.id;
        this.#renderSelection();
        this.#markSelectedCard();
      });
    this.chart.updateTree({ initial: true });
    requestAnimationFrame(() => this.#markSelectedCard());
  }

  #markSelectedCard() {
    for (const card of this.elements.graph.querySelectorAll(".visual-node-card")) {
      card.classList.toggle("is-selected", card.dataset.personId === this.selectedPersonId);
    }
  }

  #renderSelection() {
    const isAnchor = this.selectedPersonId === this.selectedAnchor?.id;
    const person = isAnchor
      ? null
      : this.draft.getSnapshot().people.find((entry) => entry.id === this.selectedPersonId);
    if (!isAnchor && !person) {
      this.selectedPersonId = this.selectedAnchor?.id ?? null;
      return this.#renderSelection();
    }

    this.elements.selectedBadge.textContent = isAnchor ? "Anchor" : "Proposed";
    this.elements.selectedBadge.classList.toggle("is-proposed", !isAnchor);
    this.elements.selectedLabel.textContent = isAnchor
      ? this.selectedAnchor.displayLabel
      : displayPersonName(person);
    this.elements.editPerson.hidden = isAnchor;
    this.elements.removePerson.hidden = isAnchor;
    this.elements.relationButtons.forEach((button) => {
      button.disabled = !this.selectedPersonId;
    });
  }

  #renderSummary() {
    const snapshot = this.draft.getSnapshot();
    this.elements.peopleCount.textContent = `${snapshot.people.length} proposed ${snapshot.people.length === 1 ? "person" : "people"}`;
    this.elements.relationshipCount.textContent = `${snapshot.relationships.length} ${snapshot.relationships.length === 1 ? "relationship" : "relationships"}`;
    this.elements.previewButton.disabled = snapshot.people.length === 0;
  }

  #openAddPerson(relation) {
    if (!new Set(["parent", "child", "spouse"]).has(relation) || !this.selectedPersonId) return;
    this.personOperation = {
      mode: "add",
      relation,
      relativeId: this.selectedPersonId
    };
    this.elements.personForm.reset();
    this.elements.gender.value = "M";
    this.elements.personEditorTitle.textContent = `Add ${relation}`;
    this.elements.personEditorContext.textContent = `Connect to ${this.#endpointLabel(this.selectedPersonId)}.`;
    this.#openPersonEditor();
  }

  #openEditPerson() {
    const person = this.draft.getSnapshot().people.find((entry) => entry.id === this.selectedPersonId);
    if (!person) return;
    this.personOperation = { mode: "edit", personId: person.id };
    this.elements.firstName.value = person.firstName;
    this.elements.lastName.value = person.lastName;
    this.elements.birthday.value = person.birthday;
    this.elements.gender.value = person.gender;
    this.elements.personEditorTitle.textContent = "Edit proposed person";
    this.elements.personEditorContext.textContent = "Only this draft person will change.";
    this.#openPersonEditor();
  }

  #openPersonEditor() {
    this.elements.personStatus.textContent = "";
    this.elements.personStatus.classList.remove("is-error");
    this.elements.personEditor.hidden = false;
    this.elements.firstName.focus();
  }

  #closePersonEditor() {
    this.personOperation = null;
    this.elements.personEditor.hidden = true;
    this.elements.personForm.reset();
    this.elements.selectedLabel.focus?.();
  }

  #savePerson(event) {
    event.preventDefault();
    if (!this.personOperation) return;
    const person = {
      firstName: this.elements.firstName.value,
      lastName: this.elements.lastName.value,
      birthday: this.elements.birthday.value,
      gender: this.elements.gender.value
    };
    try {
      if (this.personOperation.mode === "edit") {
        this.draft.editPerson(this.personOperation.personId, person);
      } else {
        const method = {
          parent: "addParent",
          child: "addChild",
          spouse: "addSpouse"
        }[this.personOperation.relation];
        const added = this.draft[method](this.personOperation.relativeId, person);
        this.selectedPersonId = added.id;
      }
      this.#closePersonEditor();
      this.#renderAll();
    } catch (error) {
      this.elements.personStatus.textContent = error.message;
      this.elements.personStatus.classList.add("is-error");
    }
  }

  #removeSelectedPerson() {
    const person = this.draft.getSnapshot().people.find((entry) => entry.id === this.selectedPersonId);
    if (!person) return;
    try {
      const analysis = this.draft.analyzeRemoval(person.id);
      const disconnectedNames = analysis.disconnectedPersonIds.map((id) => this.#endpointLabel(id));
      const warning = disconnectedNames.length > 0
        ? `Remove ${displayPersonName(person)}? This will also remove the disconnected proposed branch: ${disconnectedNames.join(", ")}.`
        : `Remove ${displayPersonName(person)} from this unsubmitted draft?`;
      if (!this.confirmDiscard(warning)) return;
      this.draft.removePerson(person.id, { cascade: disconnectedNames.length > 0 });
      this.selectedPersonId = this.selectedAnchor.id;
      this.#renderAll();
    } catch (error) {
      this.#setStatus(error.message, true);
    }
  }

  #showPreview() {
    if (!this.draft.hasProposedPeople()) {
      this.#setStatus("Add at least one proposed person before previewing.", true);
      return;
    }
    const serialized = this.draft.serialize();
    this.elements.previewAnchor.textContent = this.selectedAnchor.displayLabel;
    this.elements.previewPeople.replaceChildren(...serialized.people.map((person) => {
      const item = document.createElement("li");
      item.textContent = `+ ${displayPersonName(person)}${person.birthday ? ` (${person.birthday})` : ""}`;
      return item;
    }));
    this.elements.previewRelationships.replaceChildren(...serialized.relationships.map((relationship) => {
      const item = document.createElement("li");
      item.textContent = relationship.type === "parentOf"
        ? `${this.#endpointLabel(relationship.from)} → parent of ${this.#endpointLabel(relationship.to)}`
        : `${this.#endpointLabel(relationship.from)} ↔ spouse of ${this.#endpointLabel(relationship.to)}`;
      return item;
    }));
    this.elements.serialization.textContent = JSON.stringify(serialized, null, 2);
    this.elements.editorView.hidden = true;
    this.elements.personEditor.hidden = true;
    this.elements.preview.hidden = false;
    this.elements.previewContinue.focus();
  }

  #showSubmit() {
    this.elements.preview.hidden = true;
    this.elements.submit.hidden = false;
    this.#setSubmitStatus("");
    this.elements.submitterName.focus();
  }

  async #submit(event) {
    event.preventDefault();
    if (this.isSubmitting || !this.draft.hasProposedPeople()) return;
    if (!this.elements.submitForm.checkValidity()) {
      this.elements.submitForm.reportValidity();
      return;
    }

    const details = {
      submitterName: this.elements.submitterName.value,
      email: this.elements.submitterEmail.value,
      relationship: this.elements.submitterRelationship.value,
      comment: this.elements.submitterComment.value,
      accessCode: this.elements.submitterCode.value
    };
    this.isSubmitting = true;
    this.elements.submitButton.disabled = true;
    this.elements.submitBack.disabled = true;
    this.#setSubmitStatus("Sending visual suggestion…");

    try {
      const result = await this.submitDraft(this.draft, details);
      this.selectedAnchor = null;
      this.selectedPersonId = null;
      this.personOperation = null;
      this.chart = null;
      this.elements.graph.replaceChildren();
      this.elements.submitForm.reset();
      this.elements.submit.hidden = true;
      this.elements.successReference.textContent = `Reference ID: ${result.id}`;
      this.elements.success.hidden = false;
      this.elements.successClose.focus();
    } catch (error) {
      // Preserve the draft and non-secret contact fields for a safe retry.
      this.elements.submitterCode.value = "";
      this.#setSubmitStatus(
        error?.message || "Unable to send the visual suggestion. Try again later.",
        true
      );
      this.elements.submitterCode.focus();
    } finally {
      this.isSubmitting = false;
      this.elements.submitButton.disabled = false;
      this.elements.submitBack.disabled = false;
    }
  }

  #endpointLabel(personId) {
    if (personId === this.selectedAnchor?.id) return this.selectedAnchor.displayLabel;
    const person = this.draft.getSnapshot().people.find((entry) => entry.id === personId);
    return person ? displayPersonName(person) : personId;
  }

  #setAnchorStatus(message, isError = false) {
    this.elements.anchorStatus.textContent = message;
    this.elements.anchorStatus.classList.toggle("is-error", isError);
  }

  #setStatus(message, isError = false) {
    this.elements.status.textContent = message;
    this.elements.status.classList.toggle("is-error", isError);
  }

  #setSubmitStatus(message, isError = false) {
    this.elements.submitStatus.textContent = message;
    this.elements.submitStatus.classList.toggle("is-error", isError);
  }
}

function displayPersonName(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unnamed person";
}
