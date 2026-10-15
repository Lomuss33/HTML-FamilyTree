import { createVisualSuggestionEditor } from "./suggestions/visual-editor.js";
import { buildTextSuggestionRequest, submitSuggestionRequest, getSuggestionsApiUrl } from "./suggestions/submission-api.js";
import { createAdminReviewWorkspace } from "./admin/review-workspace.js";
import { createLocalApiClient, LocalApiError, hashPayloadText } from "./editor/local-api.js";
import { activeCardForm, hasCardDraft, applyCardDraft } from "./editor/card-draft.js";
import { cloneNodes, sameNodes, normalizeEditorExport } from "./viewer/editor-state.js";
import { createCanonicalCardHtml } from "./viewer/card-format.js";

const PAYLOAD_URL = "./data/family.enc.json";
const element = id => document.getElementById(id);
const lockScreen = element("lock-screen");
const treeShell = element("tree-shell");
const unlockForm = element("unlock-form");
const passwordInput = element("password");
const unlockButton = element("unlock-button");
const statusMessage = element("status-message");
const clearSessionButton = element("clear-session");
const chartRoot = element("family-chart");
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
const isLocalRuntime = ["http:", "https:"].includes(location.protocol)
  && ["localhost", "127.0.0.1"].includes(location.hostname);
const localApi = createLocalApiClient();
const suggestionsConfigured = Boolean(getSuggestionsApiUrl());

const visualSuggestionEditor = createVisualSuggestionEditor({
  root: visualSuggestionRoot, getFamilyChart: () => window.f3, onRequestClose: closeSuggestionDialog
});

const state = {
  currentNodes: [], savedNodes: [], currentPassword: null,
  isEditing: false, isSaving: false, localSaveAvailable: false, localSaveChecked: false,
  localSnapshot: null, needsPreparation: false, pendingSave: null, generation: 0,
  editor: null, openEditorOnRender: false
};
const adminReviewWorkspace = createAdminReviewWorkspace({
  root: adminDialog, openButton: adminReviewButton, countBadge: adminPendingCount,
  getCanonicalNodes: () => cloneNodes(state.savedNodes),
  isCanonicalDirty: () => hasUnsavedChanges() || state.needsPreparation || state.isSaving || Boolean(state.pendingSave),
  getFamilyChart: () => window.f3
});

let encryptedPayloadPromise;
let discoveryPromise;
let suggestionDialogReturnFocusTarget = null;

window.addEventListener("DOMContentLoaded", () => {
  // Remove plaintext left by the previous edition. New sessions exist only in memory.
  try { sessionStorage.removeItem("family-tree-session-v1"); } catch { /* Storage can be disabled. */ }
  unlockForm.addEventListener("submit", handleUnlock);
  clearSessionButton.addEventListener("click", clearSession);
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
    if (suggestionSubmitButton.disabled || !visualSuggestionEditor.requestDiscard()) event.preventDefault();
  });
  guestSuggestButton.classList.toggle("is-hidden", !suggestionsConfigured);
  document.querySelector(".unlock-divider").classList.toggle("is-hidden", !suggestionsConfigured);
  window.addEventListener("beforeunload", event => {
    if (hasUnsavedChanges() || state.isSaving || state.pendingSave) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  // Optional sign-in must never delay binding the family unlock controls.
  void adminReviewWorkspace.initialize();
  discoveryPromise = detectLocalSaveSupport();
  syncToolbar();
});

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
      await localApi.discover();
      state.localSaveAvailable = true;
    }
  } catch { state.localSaveAvailable = false; }
  finally { state.localSaveChecked = true; syncToolbar(); }
}

async function handleUnlock(event) {
  event.preventDefault();
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
  chartRoot.replaceChildren();
  state.editor = null;
  // The chart mutates its input while navigating. It never receives the saved snapshot.
  const chart = window.f3.createChart("#family-chart", cloneNodes(state.currentNodes))
    .setTransitionTime(300).setCardXSpacing(260).setCardYSpacing(150)
    .setShowSiblingsOfMain(false).setSingleParentEmptyCard(false).setOrientationVertical();
  const card = chart.setCardHtml().setStyle("rect").setMiniTree(true)
    .setCardDim({ width: 220, height: 108 })
    .setCardInnerHtmlCreator(createCanonicalCardHtml).setOnHoverPathToMain();
  if (state.isEditing && !state.isSaving && !state.pendingSave && state.localSaveAvailable) {
    const editor = chart.editTree().fixed(true)
      .setFields(["first name", "last name", "birthday", "avatar"])
      .setCardClickOpen(card).setEditFirst(true)
      .setOnChange(() => {
        state.currentNodes = normalizeEditorExport(editor.exportData());
        adminReviewWorkspace.onCanonicalDirtyChanged();
        syncToolbar("Draft updated. Save the whole tree when ready.");
      }).setEdit();
    state.editor = editor;
  }
  chart.updateTree({ initial: true });
  if (state.editor && state.openEditorOnRender) {
    state.openEditorOnRender = false; state.editor.openFormWithId();
  }
}

function showTree() {
  document.body.classList.add("is-tree-mode");
  lockScreen.classList.add("is-hidden");
  treeShell.classList.remove("is-hidden");
  adminReviewWorkspace.onFamilyUnlocked();
}

function clearSession() {
  if (state.isSaving) return;
  if ((hasUnsavedChanges() || state.pendingSave) && !confirm(
    state.pendingSave ? "The last save response is uncertain. Check the save or download your draft before locking. Lock anyway?"
      : "Discard your unsaved draft and lock the tree?"
  )) return;
  ++state.generation;
  adminReviewWorkspace.onFamilyLocked();
  state.currentNodes = []; state.savedNodes = []; state.currentPassword = null;
  state.localSnapshot = null; state.needsPreparation = false; state.pendingSave = null;
  state.isEditing = false; state.editor = null; state.openEditorOnRender = false;
  encryptedPayloadPromise = null;
  chartRoot.replaceChildren();
  if (suggestionDialog.open) suggestionDialog.close();
  document.body.classList.remove("is-tree-mode");
  treeShell.classList.add("is-hidden");
  lockScreen.classList.remove("is-hidden");
  setStatus("Tree locked. Refreshing also locks this session.");
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
        syncToolbar("Public label changes were cancelled. Your draft is kept.");
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
  return ["These labels will be visible to visitors before unlocking:",
    ...diff.added.map(value => "Add: " + label(value)),
    ...diff.removed.map(value => "Remove: " + label(value)),
    ...diff.changed.map(value => "Change: " + label(value.before) + " → " + label(value.after)),
    "", "Approve these public label changes and save?"
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
  const canEdit = state.localSaveAvailable && Boolean(state.currentPassword);
  const pending = Boolean(state.pendingSave);
  editButton.classList.toggle("is-hidden", !inTree || !canEdit || state.isEditing || pending);
  discardButton.classList.toggle("is-hidden", !inTree || !canEdit || !state.isEditing);
  saveButton.classList.toggle("is-hidden", !inTree || !canEdit || (!state.isEditing && !state.needsPreparation && !pending));
  exportDraftButton.classList.toggle("is-hidden", !inTree || (!dirty && !pending));
  suggestButton.classList.toggle("is-hidden", !inTree || !suggestionsConfigured);
  adminReviewButton.classList.toggle("is-hidden", !inTree || !adminReviewWorkspace.configured);
  editButton.disabled = state.isSaving || pending;
  discardButton.disabled = state.isSaving || pending;
  saveButton.disabled = state.isSaving || (!dirty && !state.needsPreparation && !pending);
  saveButton.textContent = state.isSaving ? "Saving..." : pending ? "Check save" : "Save";
  clearSessionButton.disabled = state.isSaving;
  exportDraftButton.disabled = state.isSaving;
  if (message) { treeStatus.textContent = message; return; }
  if (!inTree) { treeStatus.textContent = ""; return; }
  treeStatus.textContent = state.needsPreparation
    ? "The repaired source is ready. Click Save to prepare and verify the encrypted edition."
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
function hasUnsavedChanges() { return !sameNodes(state.currentNodes, state.savedNodes) || hasCardDraft(chartRoot); }

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

function closeSuggestionDialog() {
  if (!suggestionSubmitButton.disabled && visualSuggestionEditor.requestDiscard()) {
    suggestionDialog.close();
  }
}

function finalizeSuggestionDialogClose() {
  suggestionForm.reset();
  setSuggestionStatus("");
  visualSuggestionEditor.reset();
  setSuggestionMode("simple", { focus: false });
  const returnFocusTarget = suggestionDialogReturnFocusTarget;
  suggestionDialogReturnFocusTarget = null;

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
  if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
  event.preventDefault();
  const visual = event.key === "ArrowRight" || event.key === "End";
  setSuggestionMode(visual ? "visual" : "simple");
  (visual ? suggestionVisualTab : suggestionSimpleTab).focus();
}

async function submitSuggestion(event) {
  event.preventDefault();
  const formData = new FormData(suggestionForm);
  const payload = buildTextSuggestionRequest(Object.fromEntries(formData.entries()));
  suggestionSubmitButton.disabled = true;
  setSuggestionStatus("Sending suggestion...");

  try {
    const result = await submitSuggestionRequest(payload);
    suggestionForm.reset();
    setSuggestionStatus(`Thank you. Your suggestion was sent for review. Reference ID: ${result.id}`);
  } catch (error) {
    document.getElementById("suggestion-code").value = "";
    setSuggestionStatus(error.message || "Unable to send the suggestion. Try again later.", true);
  } finally {
    suggestionSubmitButton.disabled = false;
  }
}

function setSuggestionStatus(message, isError = false) {
  suggestionStatus.textContent = message;
  suggestionStatus.classList.toggle("is-error", isError);
}
