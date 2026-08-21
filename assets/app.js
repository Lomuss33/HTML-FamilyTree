import { createVisualSuggestionEditor } from "./suggestions/visual-editor.js";
import {
  buildTextSuggestionRequest,
  submitSuggestionRequest
} from "./suggestions/submission-api.js";
import { createAdminReviewWorkspace } from "./admin/review-workspace.js";

const SESSION_KEY = "family-tree-session-v1";
const PAYLOAD_URL = "./data/family.enc.json";

const lockScreen = document.getElementById("lock-screen");
const treeShell = document.getElementById("tree-shell");
const unlockForm = document.getElementById("unlock-form");
const passwordInput = document.getElementById("password");
const unlockButton = document.getElementById("unlock-button");
const statusMessage = document.getElementById("status-message");
const clearSessionButton = document.getElementById("clear-session");
const chartRoot = document.getElementById("family-chart");
const treeStatus = document.getElementById("tree-status");
const editButton = document.getElementById("edit-button");
const discardButton = document.getElementById("discard-button");
const saveButton = document.getElementById("save-button");
const suggestButton = document.getElementById("suggest-button");
const guestSuggestButton = document.getElementById("guest-suggest-button");
const suggestionDialog = document.getElementById("suggestion-dialog");
const suggestionForm = document.getElementById("suggestion-form");
const suggestionCancelButton = document.getElementById("suggestion-cancel");
const suggestionCloseButton = document.getElementById("suggestion-close");
const suggestionSubmitButton = document.getElementById("suggestion-submit");
const suggestionStatus = document.getElementById("suggestion-status");
const suggestionSimpleTab = document.getElementById("suggestion-simple-tab");
const suggestionVisualTab = document.getElementById("suggestion-visual-tab");
const suggestionSimplePanel = document.getElementById("suggestion-simple-panel");
const suggestionVisualPanel = document.getElementById("suggestion-visual-panel");
const visualSuggestionRoot = document.getElementById("visual-suggestion-root");
const adminReviewButton = document.getElementById("admin-review-button");
const adminPendingCount = document.getElementById("admin-pending-count");
const adminDialog = document.getElementById("admin-dialog");

const visualSuggestionEditor = createVisualSuggestionEditor({
  root: visualSuggestionRoot,
  getFamilyChart: () => window.f3,
  onRequestClose: closeSuggestionDialog
});

const state = {
  currentNodes: [],
  savedNodes: [],
  currentPassword: null,
  isEditing: false,
  isSaving: false,
  localSaveAvailable: false,
  localSaveChecked: false,
  payloadConfig: {
    iterations: 250000,
    hash: "SHA-256"
  },
  editor: null,
  openEditorOnRender: false
};

const adminReviewWorkspace = createAdminReviewWorkspace({
  root: adminDialog,
  openButton: adminReviewButton,
  countBadge: adminPendingCount,
  getCanonicalNodes: () => cloneNodes(state.currentNodes),
  getFamilyChart: () => window.f3
});

const isLocalRuntime = isLocalEditingRuntime();

let encryptedPayloadPromise;
let suggestionDialogReturnFocusTarget = null;

window.addEventListener("DOMContentLoaded", async () => {
  void detectLocalSaveSupport();
  await adminReviewWorkspace.initialize();
  attemptSessionRestore();

  unlockForm.addEventListener("submit", handleUnlock);
  clearSessionButton.addEventListener("click", clearSession);
  editButton.addEventListener("click", enterEditMode);
  discardButton.addEventListener("click", discardChanges);
  saveButton.addEventListener("click", saveChanges);
  suggestButton.addEventListener("click", openSuggestionDialog);
  guestSuggestButton.addEventListener("click", openSuggestionDialog);
  suggestionForm.addEventListener("submit", submitSuggestion);
  suggestionCancelButton.addEventListener("click", closeSuggestionDialog);
  suggestionCloseButton.addEventListener("click", closeSuggestionDialog);
  suggestionSimpleTab.addEventListener("click", () => setSuggestionMode("simple"));
  suggestionVisualTab.addEventListener("click", () => setSuggestionMode("visual"));
  suggestionSimpleTab.parentElement.addEventListener("keydown", handleSuggestionTabKeys);
  suggestionDialog.addEventListener("close", finalizeSuggestionDialogClose);
  suggestionDialog.addEventListener("cancel", (event) => {
    if (suggestionSubmitButton.disabled || !visualSuggestionEditor.requestDiscard()) {
      event.preventDefault();
    }
  });
  guestSuggestButton.classList.remove("is-hidden");
  syncToolbar();
});

async function loadPayload() {
  const response = await fetch(PAYLOAD_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load encrypted family data.");
  }
  const payload = await response.json();
  state.payloadConfig = {
    iterations: payload.iterations ?? state.payloadConfig.iterations,
    hash: payload.hash ?? state.payloadConfig.hash
  };
  return payload;
}

async function detectLocalSaveSupport() {
  if (!isLocalRuntime || location.protocol === "file:") {
    state.localSaveChecked = true;
    syncToolbar();
    return;
  }

  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    state.localSaveAvailable = response.ok;
  } catch (error) {
    console.error(error);
    state.localSaveAvailable = false;
  } finally {
    state.localSaveChecked = true;
    syncToolbar();
  }
}

async function handleUnlock(event) {
  event.preventDefault();

  const password = passwordInput.value;
  if (!password) {
    setStatus("Enter the shared password to continue.", true);
    return;
  }

  unlockButton.disabled = true;
  setStatus("Decrypting in your browser...");

  try {
    const nodes = await unlock(password);
    state.currentPassword = password;
    setNodes(nodes);
    passwordInput.value = "";
    showTree();
    renderTree(state.currentNodes);
    setStatus("");
    syncToolbar();
  } catch (error) {
    console.error(error);
    setStatus("Unable to unlock. Check the password and try again.", true);
  } finally {
    unlockButton.disabled = false;
  }
}

function attemptSessionRestore() {
  const cached = sessionStorage.getItem(SESSION_KEY);
  if (!cached) {
    return;
  }

  try {
    const nodes = JSON.parse(cached);
    setNodes(nodes);
    showTree();
    renderTree(state.currentNodes);
    syncToolbar();
  } catch (error) {
    console.error(error);
    clearSession();
  }
}

async function unlock(password) {
  const payload = await getEncryptedPayload();
  const textEncoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(payload.salt),
      iterations: payload.iterations,
      hash: payload.hash
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(payload.iv)
    },
    key,
    fromBase64(payload.ciphertext)
  );

  const json = new TextDecoder().decode(decrypted);
  const nodes = JSON.parse(json);
  if (!Array.isArray(nodes)) {
    throw new Error("Decrypted payload is not a family node array.");
  }
  return nodes;
}

function renderTree(nodes) {
  chartRoot.innerHTML = "";
  state.editor = null;

  const chart = f3.createChart("#family-chart", nodes)
    .setTransitionTime(600)
    .setCardXSpacing(240)
    .setCardYSpacing(140)
    .setShowSiblingsOfMain(false)
    .setOrientationVertical();

  const card = chart.setCardHtml()
    .setCardDisplay([
      ["first name", "last name"],
      ["birthday"]
    ])
    .setMiniTree(true)
    .setStyle("imageRect")
    .setCardDim(null)
    .setOnHoverPathToMain();

  if (state.isEditing && isLocalRuntime) {
    const editor = chart.editTree()
      .fixed(true)
      .setFields(["first name", "last name", "birthday", "avatar"])
      .setCardClickOpen(card)
      .setEditFirst(true)
      .setOnChange(() => {
        state.currentNodes = normalizeEditorExport(editor.exportData());
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.currentNodes));
        syncToolbar("Editing locally. Save when you are ready.");
      })
      .setEdit();

    state.editor = editor;
  }

  chart.updateTree({ initial: true });

  if (state.editor && state.openEditorOnRender) {
    state.openEditorOnRender = false;
    state.editor.openFormWithId();
  }
}

function showTree() {
  document.body.classList.add("is-tree-mode");
  lockScreen.classList.add("is-hidden");
  treeShell.classList.remove("is-hidden");
  adminReviewWorkspace.onFamilyUnlocked();
  syncToolbar();
}

function showLock() {
  document.body.classList.remove("is-tree-mode");
  treeShell.classList.add("is-hidden");
  lockScreen.classList.remove("is-hidden");
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function clearSession() {
  adminReviewWorkspace.onFamilyLocked();
  sessionStorage.removeItem(SESSION_KEY);
  state.currentNodes = [];
  state.savedNodes = [];
  state.currentPassword = null;
  state.isEditing = false;
  state.editor = null;
  state.openEditorOnRender = false;
  chartRoot.innerHTML = "";
  showLock();
  setStatus("Session cleared.");
  passwordInput.focus();
}

function setNodes(nodes) {
  state.currentNodes = cloneNodes(nodes);
  state.savedNodes = cloneNodes(nodes);
  state.isEditing = false;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.currentNodes));
}

function enterEditMode() {
  if (!state.localSaveAvailable) {
    return;
  }

  if (!state.currentPassword) {
    syncToolbar("Unlock again in this tab before editing so the app can save your local changes.");
    return;
  }

  state.isEditing = true;
  state.openEditorOnRender = true;
  renderTree(state.currentNodes);
  syncToolbar();
}

function discardChanges() {
  state.currentNodes = cloneNodes(state.savedNodes);
  state.isEditing = false;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.currentNodes));
  renderTree(state.currentNodes);
  syncToolbar("Unsaved edits were discarded.");
}

async function saveChanges() {
  if (!state.currentPassword) {
    syncToolbar("Unlock again in this tab before saving so the app can re-encrypt the files.");
    return;
  }

  if (!state.localSaveAvailable) {
    syncToolbar("Local save is unavailable. Run the project with `npm run local`.");
    return;
  }

  state.isSaving = true;
  syncToolbar("Saving local files...");

  try {
    const privateJson = stringifyNodes(state.currentNodes);
    const encryptedPayload = await encryptNodes(state.currentNodes, state.currentPassword);
    const encryptedJson = `${JSON.stringify(encryptedPayload, null, 2)}\n`;
    await persistFiles(privateJson, encryptedJson);

    state.savedNodes = cloneNodes(state.currentNodes);
    state.isEditing = false;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.currentNodes));
    renderTree(state.currentNodes);
    state.isSaving = false;
    syncToolbar("Saved directly into the repo. Review and push with GitHub Desktop.");
  } catch (error) {
    state.isSaving = false;
    console.error(error);
    syncToolbar("Save failed. Start the app with `npm run local` and try again.");
  }
}

async function persistFiles(privateJson, encryptedJson) {
  const response = await fetch("/api/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      privateJson,
      encryptedJson
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || "Local save endpoint failed.");
  }
}

async function encryptNodes(nodes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(stringifyNodes(nodes));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    plaintext
  ));

  return {
    version: 1,
    kdf: "PBKDF2",
    hash: state.payloadConfig.hash,
    iterations: state.payloadConfig.iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

async function deriveKey(password, salt, usages) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: state.payloadConfig.iterations,
      hash: state.payloadConfig.hash
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    usages
  );
}

function syncToolbar(message = "") {
  const inTree = !treeShell.classList.contains("is-hidden");
  const canEdit = state.localSaveAvailable;
  const dirty = hasUnsavedChanges();

  editButton.classList.toggle("is-hidden", !inTree || !canEdit || state.isEditing);
  discardButton.classList.toggle("is-hidden", !inTree || !canEdit || !state.isEditing);
  saveButton.classList.toggle("is-hidden", !inTree || !canEdit || !state.isEditing);
  suggestButton.classList.toggle("is-hidden", !inTree);
  adminReviewButton.classList.toggle("is-hidden", !inTree || !adminReviewWorkspace.configured);

  editButton.disabled = !state.currentPassword || state.isSaving;
  discardButton.disabled = state.isSaving;
  saveButton.disabled = state.isSaving || !dirty || !state.currentPassword;

  if (message) {
    treeStatus.textContent = message;
    return;
  }

  if (!inTree) {
    treeStatus.textContent = "";
    return;
  }

  if (!canEdit) {
    if (isLocalRuntime && !state.localSaveChecked) {
      treeStatus.textContent = "Checking local editing support...";
      return;
    }

    if (isLocalRuntime) {
      treeStatus.textContent = "Read-only here. Start the project with `npm run local` for direct save into the repo.";
      return;
    }

    treeStatus.textContent = "Published mode is read-only.";
    return;
  }

  if (!state.currentPassword) {
    treeStatus.textContent = "Local edit mode is available after a fresh unlock in this tab.";
    return;
  }

  if (state.isEditing) {
    treeStatus.textContent = "Editing locally. Save card changes in the modal, then click Save once for the whole tree.";
    return;
  }

  treeStatus.textContent = "Local server detected. Click Edit to make changes.";
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

function getEncryptedPayload() {
  if (!encryptedPayloadPromise) {
    encryptedPayloadPromise = loadPayload().catch((error) => {
      encryptedPayloadPromise = null;
      throw error;
    });
  }
  return encryptedPayloadPromise;
}

function hasUnsavedChanges() {
  return stringifyNodes(state.currentNodes) !== stringifyNodes(state.savedNodes);
}

function stringifyNodes(nodes) {
  return `${JSON.stringify(nodes, null, 2)}\n`;
}

function cloneNodes(nodes) {
  return JSON.parse(JSON.stringify(nodes));
}

function normalizeEditorExport(nodes) {
  return nodes.map((node) => ({
    ...node,
    rels: {
      parents: [...(node.rels?.parents ?? [])],
      children: [...(node.rels?.children ?? [])],
      spouses: [...(node.rels?.spouses ?? [])]
    }
  }));
}

function isLocalEditingRuntime() {
  return location.protocol === "file:"
    || location.hostname === "localhost"
    || location.hostname === "127.0.0.1"
    || location.hostname === "::1"
    || location.hostname === "[::1]";
}

function toBase64(value) {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

window.unlock = unlock;
window.renderTree = renderTree;
window.clearSession = clearSession;
