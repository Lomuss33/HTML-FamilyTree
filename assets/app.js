import { createVisualSuggestionEditor } from "./suggestions/visual-editor.js";
import { buildTextSuggestionRequest, submitSuggestionRequest, getSuggestionsApiUrl, setLocalSuggestionsEnabled, setSuggestionPhotosEnabled, supportsSuggestionPhotos, setProfileSuggestionsEnabled, supportsProfileSuggestions, loadPublicSuggestionStatus } from "./suggestions/submission-api.js";
import { createSuggestionPhotoPicker } from "./suggestions/photo-attachments.js";
import { createProfileChangeForm } from "./suggestions/profile-change-form.js";
import { createAdminReviewWorkspace } from "./admin/review-workspace.js";
import { createLocalApiClient, LocalApiError, hashPayloadText, supportsLocalEditing } from "./editor/local-api.js";
import { activeCardForm, hasCardDraft, applyCardDraft } from "./editor/card-draft.js";
import { cloneNodes, sameNodes, normalizeEditorExport } from "./viewer/editor-state.js";
import { createCanonicalCardHtml } from "./viewer/card-format.js";
import { createPersonBrowser, personName } from "./viewer/person-browser.js";
import { loadPublicAnchorCatalog, filterPublicAnchors } from "./suggestions/public-anchor-catalog.js";
import { createPublicTree } from "./viewer/public-tree.js";
import { setupTreeNavigation } from "./viewer/tree-navigation.js";
import { createPhotoClient } from "./viewer/photo-client.js";
import { createLocalReviewClients } from "./admin/local-review.js";
import { applyFamilyEdit, FamilyEditError } from "./editor/family-edit.js";

const PAYLOAD_URL = "./data/family.enc.json";
const element = id => document.getElementById(id);
const lockScreen = element("lock-screen");
const treeShell = element("tree-shell");
const unlockForm = element("unlock-form");
const passwordInput = element("password");
const unlockButton = element("unlock-button");
const statusMessage = element("status-message");
const publicSearch = element("public-search");
const publicStatus = element("public-status");
const publicResults = element("public-results");
const publicRetry = element("public-retry");
const publicTreeButton = element("public-tree-button");
const clearSessionButton = element("clear-session");
const chartRoot = element("family-chart");
const peopleButton = element("people-button");
const peopleDialog = element("people-dialog");
const treeStatus = element("tree-status");
const editButton = element("edit-button");
const discardButton = element("discard-button");
const saveButton = element("save-button");
const exportDraftButton = element("export-draft-button");
const suggestButton = element("suggest-button");
const guestSuggestButton = element("guest-suggest-button");
const suggestionDialog = element("suggestion-dialog");
const suggestionForm = element("suggestion-form");
const suggestionCancelButton = element("suggestion-cancel");
const suggestionCloseButton = element("suggestion-close");
const suggestionSubmitButton = element("suggestion-submit");
const suggestionStatus = element("suggestion-status");
const suggestionSimpleTab = element("suggestion-simple-tab");
const suggestionVisualTab = element("suggestion-visual-tab");
const suggestionSimplePanel = element("suggestion-simple-panel");
const suggestionVisualPanel = element("suggestion-visual-panel");
const visualSuggestionRoot = element("visual-suggestion-root");
const adminReviewButton = element("admin-review-button");
const adminPendingCount = element("admin-pending-count");
const adminDialog = element("admin-dialog");
const serverAccess = document.documentElement.dataset.familyAccess;
const isPublicRuntime = serverAccess === "public";
const isLocalRuntime = supportsLocalEditing(location, { access: serverAccess });
const localApi = createLocalApiClient();
const textPhotos = createSuggestionPhotoPicker(element("text-photo-attachments"));
const profileChangeForm = createProfileChangeForm(element("profile-change-fields"));
const photos = createPhotoClient({ api: localApi, credentials: () => canEditPrivateTree()
  ? { password: state.currentPassword, payloadDigest: state.localSnapshot?.payloadDigest } : null });
let suggestionsConfigured = Boolean(getSuggestionsApiUrl());
let localReviewAvailable = false;
if (isLocalRuntime || isPublicRuntime) {
  setLocalSuggestionsEnabled(false);
  suggestionsConfigured = false;
}

const visualSuggestionEditor = createVisualSuggestionEditor({
  root: visualSuggestionRoot, getFamilyChart: () => window.f3, onRequestClose: closeSuggestionDialog
});

const state = {
  mode: null,
  currentNodes: [], savedNodes: [], currentPassword: null,
  isEditing: false, isSaving: false, localSaveAvailable: false, localSaveChecked: false,
  localSnapshot: null, needsPreparation: false, pendingSave: null, generation: 0,
  editor: null, chart: null, openEditorOnRender: false
};
const mobileProfileLayout = window.matchMedia("(max-width: 650px)");
let profilePreviewId = null;
const personBrowser = createPersonBrowser({
  root: peopleDialog,
  photos,
  onSuggestPersonChange: openPersonSuggestion,
  onProfileViewChange: syncProfilePreview,
  onFamilyEdit(request) {
    if (!canEditPrivateTree() || state.isSaving || state.pendingSave) throw new FamilyEditError("EDIT_UNAVAILABLE", "Pričekaj završetak spremanja ili ponovno otključaj privatno stablo.");
    if (!captureCardDraft()) throw new FamilyEditError("UNFINISHED_CARD", "Dovrši otvorenu karticu stabla pa pokušaj ponovno. Uneseni podaci su zadržani.");
    const result = applyFamilyEdit(state.currentNodes, request);
    state.currentNodes = result.nodes;
    state.isEditing = true; state.openEditorOnRender = false;
    renderTree();
    state.chart.updateMainId(result.personId).updateTree({ initial: true });
    adminReviewWorkspace.onCanonicalDirtyChanged();
    syncToolbar("Osoba i veze su u nacrtu. Pregledaj ih pa pritisni Save za trajno spremanje.");
    return { personId: result.personId };
  },
  onUpdatePerson(id, { data, privacy }) {
    if (!canEditPrivateTree() || state.isSaving || state.pendingSave || !captureCardDraft()) return false;
    if (!state.currentNodes.some(person => person.id === id)) return false;
    state.currentNodes = state.currentNodes.map(person => person.id === id
      ? { ...person, data: { ...person.data, ...data }, privacy: { ...person.privacy, ...privacy } } : person);
    state.isEditing = true;
    state.openEditorOnRender = false;
    renderTree();
    adminReviewWorkspace.onCanonicalDirtyChanged();
    syncToolbar("Profile changes are in the draft. Save the whole tree when ready.");
    return true;
  },
  onShowInTree(id) {
    if (state.isSaving || state.pendingSave || !state.chart || !captureCardDraft()) return false;
    state.chart.updateMainId(id).updateTree({ tree_position: "main_to_middle" });
    if (state.editor) state.editor.openFormWithId(id);
    syncToolbar();
    return true;
  }
});
const reviewOptions = {
  root: adminDialog, openButton: adminReviewButton, countBadge: adminPendingCount,
  getCanonicalNodes: () => cloneNodes(state.savedNodes),
  getPhotoTargets: () => cloneNodes(state.currentNodes),
  canStagePhotos: () => canEditPrivateTree() && !state.isSaving && !state.pendingSave && !state.needsPreparation
    && !hasCardDraft(chartRoot) && !personBrowser.hasDraft(),
  isCanonicalDirty: () => hasUnsavedChanges() || state.needsPreparation || state.isSaving || Boolean(state.pendingSave),
  getFamilyChart: () => window.f3
};
let adminReviewWorkspace = createAdminReviewWorkspace({ ...reviewOptions, config: {} });

let encryptedPayloadPromise;
let discoveryPromise;
let suggestionDialogReturnFocusTarget = null;
let suggestionPersonReturnId = null;
let publicAnchors = [];
let publicCatalog = null;

window.addEventListener("DOMContentLoaded", () => {
  // Remove plaintext left by the previous edition. New sessions exist only in memory.
  try { sessionStorage.removeItem("family-tree-session-v1"); } catch { /* Storage can be disabled. */ }
  unlockForm.addEventListener("submit", handleUnlock);
  // Never accept a password before the handler prevents native form submission.
  // A failed module import must leave the input and its submit button disabled.
  passwordInput.disabled = isPublicRuntime;
  unlockButton.disabled = isPublicRuntime;
  element("local-code-form").addEventListener("submit", event => { event.preventDefault(); void configureSubmissionCode(true); });
  element("local-disable-submissions").addEventListener("click", () => void configureSubmissionCode(false));
  publicSearch.addEventListener("input", renderPublicDirectory);
  publicRetry.addEventListener("click", () => void loadPublicDirectory());
  publicTreeButton.addEventListener("click", enterPublicTree);
  clearSessionButton.addEventListener("click", clearSession);
  peopleButton.addEventListener("click", () => personBrowser.open());
  window.addEventListener("resize", () => syncProfilePreview(profilePreviewId));
  peopleDialog.addEventListener("close", () => { if (!treeShell.classList.contains("is-hidden")) peopleButton.focus(); });
  editButton.addEventListener("click", enterEditMode);
  discardButton.addEventListener("click", discardChanges);
  saveButton.addEventListener("click", saveChanges);
  exportDraftButton.addEventListener("click", exportDraft);
  for (const type of ["input", "change"]) chartRoot.addEventListener(type, event => {
    if (!event.target.closest("form.f3-form")) return;
    adminReviewWorkspace.onCanonicalDirtyChanged();
    syncToolbar(hasCardDraft(chartRoot) ? "Card changes are pending. Submit the card or Save the tree to keep them." : "");
  });
  chartRoot.addEventListener("click", guardCardNavigation, true);
  suggestButton.addEventListener("click", openSuggestionDialog);
  guestSuggestButton.addEventListener("click", openSuggestionDialog);
  suggestionForm.addEventListener("submit", submitSuggestion);
  suggestionCancelButton.addEventListener("click", closeSuggestionDialog);
  suggestionCloseButton.addEventListener("click", closeSuggestionDialog);
  suggestionSimpleTab.addEventListener("click", () => setSuggestionMode("simple"));
  suggestionVisualTab.addEventListener("click", () => setSuggestionMode("visual"));
  suggestionSimpleTab.parentElement.addEventListener("keydown", handleSuggestionTabKeys);
  suggestionDialog.addEventListener("close", finalizeSuggestionDialogClose);
  suggestionDialog.addEventListener("cancel", event => {
    if (suggestionSubmitButton.disabled || !mayDiscardSuggestionPhotos() || !visualSuggestionEditor.requestDiscard()) event.preventDefault();
  });
  guestSuggestButton.classList.toggle("is-hidden", !suggestionsConfigured);
  window.addEventListener("beforeunload", event => {
    if (hasUnsavedChanges() || state.isSaving || state.pendingSave || textPhotos.hasFiles() || visualSuggestionEditor.hasPhotos() || profileChangeForm.hasDraft()) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  // Optional sign-in must never delay binding the family unlock controls.
  discoveryPromise = detectLocalSaveSupport();
  void loadPublicDirectory();
  syncToolbar();
});

async function loadPublicDirectory() {
  publicSearch.disabled = true;
  publicRetry.hidden = true;
  publicTreeButton.disabled = true;
  publicStatus.textContent = "Učitavanje javnih podataka…";
  try {
    const catalog = await loadPublicAnchorCatalog();
    publicCatalog = catalog;
    publicAnchors = catalog.anchors;
    publicTreeButton.disabled = !publicAnchors.length;
    publicSearch.disabled = false;
    renderPublicDirectory();
  } catch {
    publicAnchors = [];
    publicCatalog = null;
    publicResults.replaceChildren();
    publicStatus.textContent = "Javni se podaci trenutačno ne mogu učitati. Privatnom stablu i dalje možeš pristupiti lozinkom.";
    publicRetry.hidden = false;
  }
}

function enterPublicTree() {
  if (!publicCatalog || !publicAnchors.length || (!isPublicRuntime && unlockButton.disabled) || !treeShell.classList.contains("is-hidden")) return;
  const nodes = createPublicTree(publicCatalog);
  state.mode = "public";
  state.currentNodes = nodes;
  state.savedNodes = cloneNodes(nodes);
  state.currentPassword = null;
  state.localSnapshot = null;
  state.needsPreparation = false;
  state.chart = null;
  state.isEditing = false;
  passwordInput.value = "";
  showTree();
  renderTree();
  syncToolbar();
}

function renderPublicDirectory() {
  const matches = filterPublicAnchors(publicAnchors, publicSearch.value);
  publicResults.replaceChildren();
  publicStatus.textContent = !publicAnchors.length ? "Još nema odobrenih javnih podataka."
    : !matches.length ? "Nema rezultata. Pokušaj s dijelom imena ili javne oznake."
      : matches.length > 50 ? "Prikazano 50 od " + matches.length + " osoba. Suzi pretragu."
        : "Pronađeno osoba: " + matches.length;
  for (const anchor of matches.slice(0, 50)) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "person-link public-person-link";
    button.setAttribute("aria-label", "Otvori javni profil: " + anchor.displayLabel);
    button.addEventListener("click", () => {
      enterPublicTree();
      if (state.mode === "public") personBrowser.open(anchor.id);
    });
    const name = document.createElement("strong");
    name.textContent = anchor.displayLabel;
    button.append(name);
    for (const text of [anchor.lifespanLabel, anchor.branchLabel].filter(Boolean)) {
      const label = document.createElement("span");
      label.textContent = text;
      button.append(label);
    }
    item.append(button);
    publicResults.append(item);
  }
}

async function loadPayload() {
  const response = await fetch(PAYLOAD_URL, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("The encrypted tree could not be loaded.");
  const text = await response.text();
  if (text.length > 3 * 1024 * 1024) throw new Error("The encrypted tree is too large.");
  const payload = JSON.parse(text);
  if (payload.version !== 1 || payload.kdf !== "PBKDF2" || payload.hash !== "SHA-256"
    || !Number.isInteger(payload.iterations) || payload.iterations < 100000 || payload.iterations > 2000000
    || typeof payload.salt !== "string" || typeof payload.iv !== "string" || typeof payload.ciphertext !== "string"
    || fromBase64(payload.salt).length !== 16 || fromBase64(payload.iv).length !== 12) {
    throw new Error("The encrypted tree format is invalid.");
  }
  return { payload, payloadDigest: await hashPayloadText(text) };
}

async function detectLocalSaveSupport() {
  try {
    if (isLocalRuntime) {
      const status = await localApi.discover();
      state.localSaveAvailable = true;
      localReviewAvailable = status.localSuggestions === true;
      setSuggestionPhotosEnabled(status.localSuggestionPhotos === true);
      setProfileSuggestionsEnabled(status.localProfileSuggestions === true);
      if (localReviewAvailable) updateLocalSuggestionAvailability(status.submissionCodeConfigured === true);
    } else if (isPublicRuntime) {
      const status = await loadPublicSuggestionStatus();
      setSuggestionPhotosEnabled(status.localSuggestionPhotos);
      setProfileSuggestionsEnabled(status.localProfileSuggestions);
      updateLocalSuggestionAvailability(status.submissionCodeConfigured);
    }
  } catch { state.localSaveAvailable = false; }
  finally {
    adminReviewWorkspace = createAdminReviewWorkspace({ ...reviewOptions, ...(localReviewAvailable
      ? { ...createLocalReviewClients({ api: localApi, getPassword: () => canEditPrivateTree() ? state.currentPassword : null,
        getSnapshotId: () => state.localSnapshot?.snapshotId, getDraftNodes: () => cloneNodes(state.currentNodes), onLogout: clearSession }),
        onStageDraft: stageSuggestionDraft, onStagePhotos: stagePhotoDraft }
      : isLocalRuntime || isPublicRuntime ? { config: {} } : {}) });
    if (localReviewAvailable) {
      element("local-suggestion-settings").hidden = false;
      element("admin-workspace").classList.add("has-local-settings");
      element("admin-sign-in").textContent = "Ponovno otključaj privatno stablo";
      element("admin-auth-view").querySelector("p").textContent = "Za lokalni pregled prijedloga otključaj privatno stablo svojom lozinkom.";
      element("admin-dialog-title").nextElementSibling.textContent = "Odobrena vizualna dopuna dodaje se u nacrt. Pregledaj je pa spremi stablo tipkom Save.";
    }
    void adminReviewWorkspace.initialize();
    state.localSaveChecked = true; syncToolbar();
  }
}

function updateLocalSuggestionAvailability(enabled) {
  setLocalSuggestionsEnabled(enabled);
  textPhotos.setEnabled(supportsSuggestionPhotos());
  visualSuggestionEditor.setPhotoSupport(supportsSuggestionPhotos());
  personBrowser.setSuggestionSupport(supportsProfileSuggestions());
  suggestionsConfigured = Boolean(getSuggestionsApiUrl());
  guestSuggestButton.classList.toggle("is-hidden", !suggestionsConfigured);
  element("local-code-status").textContent = enabled ? "Kod je postavljen. Slanje prijedloga je uključeno." : "Slanje prijedloga je isključeno dok ne postaviš kod.";
  const settings = element("local-suggestion-settings");
  settings.open = !enabled;
  settings.querySelector("summary").textContent = "Kod za slanje prijedloga · " + (enabled ? "uključen" : "isključen");
}

async function configureSubmissionCode(enabled) {
  if (!localReviewAvailable || !canEditPrivateTree()) return;
  const input = element("local-submission-code");
  const form = element("local-code-form");
  const buttons = [...form.querySelectorAll("button")];
  for (const button of buttons) button.disabled = true;
  try {
    const result = await localApi.suggestionRequest("settings", { password: state.currentPassword, enabled,
      ...(enabled ? { accessCode: input.value } : {}) });
    input.value = "";
    updateLocalSuggestionAvailability(result.submissionCodeConfigured === true);
    syncToolbar();
  } catch (error) { input.value = ""; element("local-code-status").textContent = error.message || "Postavljanje koda nije uspjelo."; }
  finally { for (const button of buttons) button.disabled = false; }
}

async function handleUnlock(event) {
  event.preventDefault();
  if (isPublicRuntime) return;
  const password = passwordInput.value;
  if (!password || unlockButton.disabled) return;
  const generation = ++state.generation;
  unlockButton.disabled = true;
  setStatus("Unlocking the family tree...");
  try {
    await discoveryPromise;
    // Refresh the served edition after a maintenance command, before loading it.
    if (state.localSaveAvailable) await localApi.discover();
    const loaded = await getEncryptedPayload();
    let nodes = await decryptNodes(loaded.payload, password);
    let snapshot = null;
    if (state.localSaveAvailable) {
      snapshot = await localApi.open(password, loaded.payloadDigest);
      nodes = snapshot.nodes;
    }
    if (generation !== state.generation) return;
    state.mode = "private";
    state.currentPassword = isLocalRuntime && snapshot ? password : null;
    state.localSnapshot = snapshot;
    state.needsPreparation = snapshot?.needsPreparation === true;
    state.currentNodes = normalizeEditorExport(nodes);
    state.savedNodes = cloneNodes(state.currentNodes);
    state.isEditing = false;
    passwordInput.value = "";
    showTree();
    renderTree();
    setStatus("");
    syncToolbar();
  } catch (error) {
    if (generation !== state.generation) return;
    encryptedPayloadPromise = null;
    const guidance = {
      STALE_SNAPSHOT: "The tree changed. Reload this page and unlock again.",
      SOURCE_DIVERGED: "The local source needs review. Run the preparation command before editing.",
      RECOVERY_REQUIRED: "Local recovery is required before editing.",
      WRITER_BUSY: "Another local operation is running. Try unlocking again after it finishes.",
      INVALID_TOKEN: "The local server restarted. Reload this page and unlock again."
    };
    setStatus(guidance[error.code] ?? "Unable to unlock. Check the password, connection, and encrypted tree.", true);
  } finally {
    if (generation === state.generation) unlockButton.disabled = false;
  }
}

async function decryptNodes(payload, password) {
  const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({
    name: "PBKDF2", salt: fromBase64(payload.salt), iterations: payload.iterations, hash: payload.hash
  }, passwordKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(payload.iv) }, key, fromBase64(payload.ciphertext));
  const nodes = JSON.parse(new TextDecoder().decode(decrypted));
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("The decrypted tree is invalid.");
  return nodes;
}

function renderTree() {
  const mainId = state.chart?.getMainDatum()?.id;
  chartRoot.replaceChildren();
  state.editor = null;
  // The chart mutates its input while navigating. It never receives the saved snapshot.
  const chart = window.f3.createChart("#family-chart", cloneNodes(state.currentNodes))
    .setTransitionTime(300).setCardXSpacing(260).setCardYSpacing(150)
    .setAncestryDepth(1).setProgenyDepth(1).setShowSiblingsOfMain(true)
    .setModifyTreeHierarchy((root, ancestry) => {
      // These are layout nodes only. Partners of children appear when that
      // child becomes the main person; stored relationships stay intact.
      if (!ancestry) for (const child of root.children ?? []) child._ignore_spouses = child.data.rels.spouses;
    })
    .setSingleParentEmptyCard(false).setOrientationVertical();
  state.chart = chart;
  if (state.currentNodes.some(person => person.id === mainId)) chart.updateMainId(mainId);
  personBrowser.setNodes(state.currentNodes, { canEditPrivacy: canEditPrivateTree() && !state.isSaving && !state.pendingSave });
  const card = chart.setCardHtml().setStyle("rect").setMiniTree(true)
    .setCardDim({ width: 220, height: 108 })
    .setCardInnerHtmlCreator(createCanonicalCardHtml).setOnHoverPathToMain()
    .setOnCardClick((event, datum) => {
      card.onCardClickDefault(event, datum);
      personBrowser.open(datum.data.id);
    })
    .setOnCardUpdate(function(datum) {
      const target = this.querySelector(".card");
      const person = datum.data;
      if (state.mode === "private" && person.data?.avatar?.startsWith("media:") && canEditPrivateTree()) {
        const image = document.createElement("img"); image.className = "personal-tree-avatar"; image.alt = "";
        this.querySelector(".personal-tree-card")?.prepend(image);
        void photos.preview(person.data.avatar.slice(6)).then(url => { if (image.isConnected) image.src = url; }, () => image.remove());
      }
      target.tabIndex = 0;
      target.setAttribute("role", "button");
      target.setAttribute("aria-label", "Otvori osobu: " + personName(datum.data));
      target.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); target.click();
      });
    });
  if (state.isEditing && !state.isSaving && !state.pendingSave && state.localSaveAvailable) {
    const editor = chart.editTree().fixed(true)
      .setFields(["first name", "last name", "birthday", "avatar"])
      .setOnFormCreation(({ cont }) => {
        const avatar = cont.querySelector('input[name="avatar"]');
        if (avatar?.value.startsWith("media:")) {
          avatar.type = "hidden";
          avatar.closest(".f3-form-field").style.display = "none";
          const hint = document.createElement("p");
          hint.textContent = "Glavnu fotografiju i galeriju uređuješ u profilu osobe.";
          avatar.closest(".f3-form-field").after(hint);
        }
      })
      .setCardClickOpen(card).setEditFirst(true)
      .setOnChange(() => {
        state.currentNodes = normalizeEditorExport(editor.exportData());
        personBrowser.setNodes(state.currentNodes);
        adminReviewWorkspace.onCanonicalDirtyChanged();
        syncToolbar("Draft updated. Save the whole tree when ready.");
      }).setEdit();
    state.editor = editor;
  }
  chart.updateTree({ initial: true });
  setupTreeNavigation(chartRoot, chart);
  if (state.editor && state.openEditorOnRender) {
    state.openEditorOnRender = false; state.editor.openFormWithId();
  }
  syncProfilePreview(profilePreviewId);
}

function syncProfilePreview(personId) {
  profilePreviewId = personId;
  const previous = document.body.classList.contains("has-profile-preview");
  const show = Boolean(state.chart && peopleDialog.open && mobileProfileLayout.matches
    && state.currentNodes.some(person => person.id === personId) && !state.isEditing && !state.isSaving && !state.pendingSave && !hasCardDraft(chartRoot));
  document.body.classList.toggle("has-profile-preview", show);
  if (show) state.chart.updateMainId(personId).updateTree({ tree_position: "main_to_middle", scale: 0.85, transition_time: 0 });
  else if (previous && state.chart && !hasCardDraft(chartRoot)) state.chart.updateTree({ tree_position: "fit", transition_time: 0 });
}

function showTree() {
  document.body.classList.add("is-tree-mode");
  lockScreen.classList.add("is-hidden");
  treeShell.classList.remove("is-hidden");
  if (state.mode === "private") adminReviewWorkspace.onFamilyUnlocked();
}

function clearSession() {
  if (state.isSaving) return;
  if ((hasUnsavedChanges() || state.pendingSave) && !confirm(
    state.pendingSave ? "The last save response is uncertain. Check the save or download your draft before locking. Lock anyway?"
      : "Discard your unsaved draft and lock the tree?"
  )) return;
  ++state.generation;
  adminReviewWorkspace.onFamilyLocked();
  element("local-submission-code").value = "";
  state.currentNodes = []; state.savedNodes = []; state.currentPassword = null;
  state.mode = null;
  state.localSnapshot = null; state.needsPreparation = false; state.pendingSave = null;
  state.isEditing = false; state.editor = null; state.openEditorOnRender = false;
  state.chart = null;
  photos.clear();
  personBrowser.clear();
  encryptedPayloadPromise = null;
  chartRoot.replaceChildren();
  if (suggestionDialog.open) suggestionDialog.close();
  document.body.classList.remove("is-tree-mode");
  treeShell.classList.add("is-hidden");
  lockScreen.classList.remove("is-hidden");
  element("admin-entry").open = false;
  element("public-directory").open = false;
  setStatus("Tree locked. Refreshing also locks this session.");
  void loadPublicDirectory();
  syncToolbar(); passwordInput.focus();
}

function enterEditMode() {
  if (!state.localSaveAvailable || !state.currentPassword || state.pendingSave || state.isSaving) return;
  state.isEditing = true; state.openEditorOnRender = true;
  renderTree(); syncToolbar();
}

function discardChanges() {
  if (state.pendingSave || state.isSaving) return;
  if (hasUnsavedChanges() && !confirm("Discard all unsaved changes to this tree?")) return;
  state.currentNodes = cloneNodes(state.savedNodes);
  state.isEditing = false;
  renderTree(); adminReviewWorkspace.onCanonicalDirtyChanged();
  syncToolbar("Unsaved changes discarded.");
}

function stageSuggestionDraft(draft) {
  if (!canEditPrivateTree() || state.isSaving || state.pendingSave || state.needsPreparation || hasUnsavedChanges()) {
    throw new Error("Najprije spremi ili odbaci postojeće izmjene. Odobrena dopuna ostaje dostupna za ponovno dodavanje.");
  }
  if (!draft || draft.baseSnapshotId !== state.localSnapshot?.snapshotId || !Array.isArray(draft.nodes)) {
    throw new Error("Verzija stabla se promijenila. Ponovno otključaj stablo prije dodavanja dopune.");
  }
  const nodes = normalizeEditorExport(draft.nodes);
  if (sameNodes(state.currentNodes, nodes)) return false;
  state.currentNodes = nodes;
  state.isEditing = true;
  state.openEditorOnRender = false;
  renderTree();
  adminReviewWorkspace.onCanonicalDirtyChanged();
  syncToolbar("Dopuna je u nacrtu. Pregledaj osobe i veze pa pritisni Save za trajno spremanje.");
}

function stagePhotoDraft(draft) {
  if (!reviewOptions.canStagePhotos() || !sameNodes(state.currentNodes, draft.expectedNodes)
    || draft.baseSnapshotId !== state.localSnapshot?.snapshotId) throw new Error("Nacrt se promijenio. Dovrši polja i ponovno dodaj fotografije; postojeće izmjene su zadržane.");
  if (sameNodes(state.currentNodes, draft.nodes)) {
    syncToolbar("Odabrane fotografije već su u tim galerijama.");
    return false;
  }
  state.currentNodes = normalizeEditorExport(draft.nodes);
  state.isEditing = true; state.openEditorOnRender = false;
  renderTree(); adminReviewWorkspace.onCanonicalDirtyChanged();
  syncToolbar("Fotografije su u privatnom nacrtu. Pregledaj galerije pa pritisni Save za trajno spremanje.");
  return true;
}

async function saveChanges() {
  if (state.isSaving || !state.currentPassword || !state.localSnapshot || !state.localSaveAvailable) return;
  if (!state.pendingSave && !captureCardDraft()) return;
  const generation = state.generation;
  const request = state.pendingSave ?? {
    nodes: cloneNodes(state.currentNodes), password: state.currentPassword,
    expectedRevision: state.localSnapshot.privateRevision, snapshotId: state.localSnapshot.snapshotId,
    operationId: crypto.randomUUID()
  };
  state.pendingSave = request;
  state.isSaving = true;
  renderTree(); syncToolbar("Saving and verifying the family files...");
  try {
    let result;
    // A receipt resolves a response lost after the disk commit without creating a second operation.
    try {
      const prior = await localApi.receipt(request.operationId);
      if (prior.state === "committed") result = prior.result;
      else if (["rolled-back", "aborted"].includes(prior.state)) {
        state.pendingSave = null;
        throw new Error("The previous save was rolled back. Your draft is kept; try Save again.");
      } else if (["preparing", "prepared", "replacing"].includes(prior.state)) {
        throw new LocalApiError("SAVE_IN_PROGRESS", "The original save is still running. Your draft is kept. Click Check save again.");
      } else if (prior.state === "recovery-required") {
        throw new LocalApiError("RECOVERY_REQUIRED", "The interrupted save needs local recovery.");
      }
    } catch (error) { if (error.status !== 404) throw error; }
    if (!result) result = await localApi.save(request);
    if (generation !== state.generation) return;
    if (result.code === "PUBLICATION_REVIEW") {
      if (!confirm(publicationMessage(result.publicationDiff))) {
        state.pendingSave = null;
        syncToolbar("Public changes were cancelled. Your draft is kept.");
        return;
      }
      request.publicationApprovalToken = result.approvalToken;
      result = await localApi.save(request);
    }
    if (result.ok !== true) {
      state.pendingSave = null;
      throw new Error("Publication review expired. Save again to review the current labels.");
    }
    state.savedNodes = cloneNodes(request.nodes);
    state.currentNodes = cloneNodes(request.nodes);
    state.localSnapshot = result;
    state.needsPreparation = false;
    state.pendingSave = null; state.isEditing = false;
    encryptedPayloadPromise = null;
    adminReviewWorkspace.onCanonicalSaved();
    if (result.siteRefreshRequired) state.localSaveAvailable = false;
    syncToolbar(result.siteRefreshRequired
      ? "Files saved. Restart the local app to rebuild the viewer before editing again."
      : "Saved and verified. Review the public changes in Git before publishing.");
  } catch (error) {
    if (generation !== state.generation) return;
    if (!["TRANSPORT_ERROR", "SAVE_IN_PROGRESS", "WRITER_BUSY"].includes(error.code)) state.pendingSave = null;
    const guidance = {
      STALE_SNAPSHOT: "A newer tree was saved elsewhere. Download your draft, then lock and unlock to load it.",
      INVALID_TOKEN: "The local server restarted. Download your draft, then reload and unlock.",
      INVALID_FAMILY: "Some relationships are invalid. Your draft is kept; correct them before saving.",
      RECOVERY_REQUIRED: "Save recovery needs attention. Your draft is kept; use the local recovery command.",
      WRITER_BUSY: "Another save is running. Your draft is kept. Click Check save when it finishes.",
      TRANSPORT_ERROR: "The response was interrupted. Your draft is kept. Click Check save to recover the result."
    };
    syncToolbar(guidance[error.code] ?? error.message ?? "Save failed. Your draft is kept.");
  } finally {
    if (generation === state.generation) {
      state.isSaving = false;
      renderTree();
      // Keep the outcome message while updating button state.
      syncToolbar(treeStatus.textContent);
    }
  }
}

function publicationMessage(diff) {
  const label = anchor => [anchor.displayLabel, anchor.lifespanLabel, anchor.branchLabel].filter(Boolean).join(" · ");
  const labelsFor = nodes => new Map(nodes.map(person => [person.id, person.privacy?.publicLabel || person.id]));
  const oldLabels = labelsFor(state.savedNodes);
  const newLabels = labelsFor(state.currentNodes);
  const relation = (edge, labels) => labels.get(edge.from) + (edge.type === "parentOf" ? " → dijete: " : " ↔ partner: ") + labels.get(edge.to);
  return ["These public labels and relationships will be visible to visitors before unlocking:",
    ...diff.added.map(value => "Add: " + label(value)),
    ...diff.removed.map(value => "Remove: " + label(value)),
    ...diff.changed.map(value => "Change: " + label(value.before) + " → " + label(value.after)),
    ...(diff.addedRelationships ?? []).map(edge => "Add relationship: " + relation(edge, newLabels)),
    ...(diff.removedRelationships ?? []).map(edge => "Remove relationship: " + relation(edge, oldLabels)),
    "", "Approve these public changes and save?"
  ].join("\n");
}

function exportDraft() {
  if (!captureCardDraft()) return;
  if (!hasUnsavedChanges() && !state.pendingSave) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.currentNodes, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "family-private-draft.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  syncToolbar("Private draft downloaded. Store it securely; it contains unencrypted family data.");
}

function syncToolbar(message = "") {
  const inTree = !treeShell.classList.contains("is-hidden");
  const dirty = hasUnsavedChanges();
  const canEdit = canEditPrivateTree();
  const pending = Boolean(state.pendingSave);
  editButton.classList.toggle("is-hidden", !inTree || !canEdit || state.isEditing || pending);
  discardButton.classList.toggle("is-hidden", !inTree || !canEdit || !state.isEditing);
  saveButton.classList.toggle("is-hidden", !inTree || !canEdit || (!state.isEditing && !state.needsPreparation && !pending));
  exportDraftButton.classList.toggle("is-hidden", !inTree || (!dirty && !pending));
  suggestButton.classList.toggle("is-hidden", !inTree || !suggestionsConfigured);
  adminReviewButton.classList.toggle("is-hidden", !inTree || state.mode !== "private" || !adminReviewWorkspace.configured);
  editButton.disabled = state.isSaving || pending;
  discardButton.disabled = state.isSaving || pending;
  saveButton.disabled = state.isSaving || (!dirty && !state.needsPreparation && !pending);
  saveButton.textContent = state.isSaving ? "Saving..." : pending ? "Check save" : "Save";
  clearSessionButton.disabled = state.isSaving;
  peopleButton.disabled = state.isSaving || pending;
  clearSessionButton.textContent = state.mode === "public" ? "Natrag" : "Lock";
  element("tree-session-label").textContent = (state.mode === "public" ? "· Javni pregled" : "· Privatni pregled") + " · Najbliža obitelj";
  exportDraftButton.disabled = state.isSaving;
  if (message) { treeStatus.textContent = message; return; }
  if (!inTree) { treeStatus.textContent = ""; return; }
  if (state.mode === "public") {
    treeStatus.textContent = publicCatalog?.relationships ? "Javni pregled. Prikazuju se samo odobrene osobe i njihove međusobne veze."
      : "Javni pregled. Javne rodbinske veze još nisu pripremljene.";
    return;
  }
  treeStatus.textContent = state.needsPreparation
    ? "Local artifacts need preparation. Click Save to review public changes and prepare the verified edition."
    : !canEdit
      ? (isLocalRuntime ? "Read only. Local editing needs the protected local app and a fresh unlock." : "Private viewing session. Refresh or Lock to close it.")
      : state.isEditing
        ? "Edit a card, then Save the whole tree. Drafts stay in this tab until saved."
        : "Local editing is ready. Click Edit to update the family tree.";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message; statusMessage.classList.toggle("is-error", isError);
}
function fromBase64(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
function canEditPrivateTree() { return state.mode === "private" && state.localSaveAvailable && Boolean(state.currentPassword); }
function hasUnsavedChanges() { return state.mode !== "public" && (!sameNodes(state.currentNodes, state.savedNodes) || hasCardDraft(chartRoot) || personBrowser.hasDraft()); }

function captureCardDraft() {
  try {
    if (!applyCardDraft(chartRoot, state.editor)) {
      syncToolbar("Finish the current card before saving or downloading the tree.");
      return false;
    }
    if (state.editor) state.currentNodes = normalizeEditorExport(state.editor.exportData());
    return true;
  } catch {
    syncToolbar("The current card could not be applied. Its fields are kept; check them before saving.");
    return false;
  }
}

function guardCardNavigation(event) {
  if (!hasCardDraft(chartRoot)) return;
  const form = activeCardForm(chartRoot);
  const close = event.target.closest(".f3-cancel-btn,.f3-close-btn");
  const navigate = !form.contains(event.target) && event.target.closest(".card,button");
  if (!close && !navigate) return;
  if (!confirm("Discard the unfinished changes to this card?")) {
    event.preventDefault(); event.stopImmediatePropagation();
    return;
  }
  form.reset();
  queueMicrotask(() => { adminReviewWorkspace.onCanonicalDirtyChanged(); syncToolbar(); });
}
function getEncryptedPayload() {
  if (!encryptedPayloadPromise) encryptedPayloadPromise = loadPayload().catch(error => {
    encryptedPayloadPromise = null; throw error;
  });
  return encryptedPayloadPromise;
}

function openSuggestionDialog(event) {
  suggestionPersonReturnId = null;
  resetProfileSuggestion();
  const opener = event?.currentTarget;
  suggestionDialogReturnFocusTarget = opener instanceof HTMLElement
    ? opener
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  suggestionForm.reset();
  setSuggestionStatus("");
  setSuggestionMode("simple", { focus: false });
  suggestionDialog.showModal();
  document.getElementById("suggestion-name").focus();
}

function resetProfileSuggestion() {
  profileChangeForm.clear();
  element("suggestion-message").required = true;
  element("suggestion-message-label").textContent = "Prijedlog";
  suggestionVisualTab.hidden = false;
  suggestionSimpleTab.textContent = "Poruka";
  element("suggestion-title").textContent = "Predloži dopunu ili ispravak";
}

function openPersonSuggestion(personId) {
  if (state.mode !== "public" || !supportsProfileSuggestions()) return false;
  const anchor = publicCatalog?.anchors.find(value => value.id === personId);
  if (!anchor) return false;
  peopleDialog.close(); openSuggestionDialog();
  suggestionPersonReturnId = personId;
  profileChangeForm.open(anchor, publicCatalog.catalogVersion);
  element("suggestion-message").required = false;
  element("suggestion-message-label").textContent = "Napomena uz ispravak (nije obvezno)";
  suggestionVisualTab.hidden = true;
  suggestionSimpleTab.textContent = "Ispravak profila";
  element("suggestion-title").textContent = "Predloži ispravak podataka";
  return true;
}

function mayDiscardSuggestionPhotos() {
  return (!textPhotos.hasFiles() && !profileChangeForm.hasDraft()) || confirm("Odbaciti neposlani prijedlog i odabrane priloge?");
}
function closeSuggestionDialog() {
  if (!suggestionSubmitButton.disabled && !mayDiscardSuggestionPhotos()) return;
  if (!suggestionSubmitButton.disabled && visualSuggestionEditor.requestDiscard()) {
    suggestionDialog.close();
  }
}

function finalizeSuggestionDialogClose() {
  const personId = suggestionPersonReturnId; suggestionPersonReturnId = null;
  resetProfileSuggestion();
  textPhotos.clear();
  suggestionForm.reset();
  setSuggestionStatus("");
  visualSuggestionEditor.reset();
  setSuggestionMode("simple", { focus: false });
  const returnFocusTarget = suggestionDialogReturnFocusTarget;
  suggestionDialogReturnFocusTarget = null;

  if (personId && state.mode === "public") { personBrowser.open(personId); return; }

  if (returnFocusTarget?.isConnected && !returnFocusTarget.classList.contains("is-hidden")) {
    returnFocusTarget.focus();
  }
}

function setSuggestionMode(mode, { focus = true } = {}) {
  const isVisual = mode === "visual";
  suggestionSimpleTab.classList.toggle("is-active", !isVisual);
  suggestionVisualTab.classList.toggle("is-active", isVisual);
  suggestionSimpleTab.setAttribute("aria-selected", String(!isVisual));
  suggestionVisualTab.setAttribute("aria-selected", String(isVisual));
  suggestionSimpleTab.tabIndex = isVisual ? -1 : 0;
  suggestionVisualTab.tabIndex = isVisual ? 0 : -1;
  suggestionSimplePanel.hidden = isVisual;
  suggestionVisualPanel.hidden = !isVisual;
  suggestionDialog.classList.toggle("is-visual-mode", isVisual);

  if (isVisual) {
    void visualSuggestionEditor.activate();
    if (focus) suggestionVisualTab.focus();
  } else if (focus) {
    document.getElementById("suggestion-name").focus();
  }
}

function handleSuggestionTabKeys(event) {
  if (profileChangeForm.active()) return;
  if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
  event.preventDefault();
  const visual = event.key === "ArrowRight" || event.key === "End";
  setSuggestionMode(visual ? "visual" : "simple");
  (visual ? suggestionVisualTab : suggestionSimpleTab).focus();
}

async function submitSuggestion(event) {
  event.preventDefault();
  if (!suggestionForm.reportValidity()) return;
  const formData = new FormData(suggestionForm);
  const payload = buildTextSuggestionRequest(Object.fromEntries(formData.entries()));
  const isProfileChange = profileChangeForm.active();
  suggestionSubmitButton.disabled = true;
  profileChangeForm.setBusy(true);
  setSuggestionStatus(isProfileChange ? "Šaljem prijedlog ispravka…" : "Sending suggestion...");

  try {
    if (isProfileChange) {
      const catalog = await loadPublicAnchorCatalog();
      profileChangeForm.refreshCatalog(catalog);
      payload.profileChange = profileChangeForm.value();
      if (!payload.message.trim()) payload.message = "Prijedlog ispravka podataka osobe.";
    }
    const tokens = await textPhotos.tokens(payload.accessCode);
    if (tokens.length) payload.photoTokens = tokens;
    const result = await submitSuggestionRequest(payload);
    textPhotos.clear();
    resetProfileSuggestion();
    suggestionForm.reset();
    setSuggestionStatus(isProfileChange ? `Prijedlog ispravka poslan je na pregled. Oznaka: ${result.id}`
      : `Thank you. Your suggestion was sent for review. Reference ID: ${result.id}`);
  } catch (error) {
    document.getElementById("suggestion-code").value = "";
    const profileErrors = { 400: "Provjeri označena polja i pokušaj ponovno.", 403: "Kod za slanje prijedloga nije valjan.",
      409: "Javni popis osoba promijenjen je. Uneseni podaci su zadržani; pokušaj ponovno.",
      413: "Prijedlog je prevelik za slanje.", 429: "Previše pokušaja. Pričekaj minutu pa pokušaj ponovno." };
    setSuggestionStatus(isProfileChange ? profileErrors[error.status] ?? (error.name === "SuggestionSubmissionError"
      ? "Slanje nije uspjelo. Uneseni podaci su zadržani za ponovni pokušaj." : error.message)
      : error.message || "Unable to send the suggestion. Try again later.", true);
  } finally {
    profileChangeForm.setBusy(false);
    suggestionSubmitButton.disabled = false;
  }
}

function setSuggestionStatus(message, isError = false) {
  suggestionStatus.textContent = message;
  suggestionStatus.classList.toggle("is-error", isError);
}
