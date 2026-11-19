const FRIENDLY_ERRORS = Object.freeze({
  400: "Check the suggestion details and try again.",
  403: "The submission access code is invalid.",
  409: "The public anchor catalog has changed. Start a new visual suggestion and try again.",
  413: "This suggestion is too large to submit. Reduce the proposed branch and try again.",
  429: "Too many attempts. Wait a minute before trying again."
});
let localSuggestionsEnabled = null;
let localPhotosEnabled = false;
let localProfilesEnabled = false;
export function setProfileSuggestionsEnabled(value) { localProfilesEnabled = value === true; }
export function supportsProfileSuggestions() { return localProfilesEnabled && localSuggestionsEnabled === true; }
export function setLocalSuggestionsEnabled(value) { localSuggestionsEnabled = value === true; }
export function setSuggestionPhotosEnabled(value) { localPhotosEnabled = value === true; }
export function supportsSuggestionPhotos() { return localPhotosEnabled && localSuggestionsEnabled === true; }
export async function loadPublicSuggestionStatus(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/public-status", { cache: "no-store", credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Suggestion status unavailable.");
  const text = await response.text();
  if (text.length > 4096) throw new Error("Invalid suggestion status.");
  const status = JSON.parse(text);
  if (status?.protocolVersion !== 2 || ["submissionCodeConfigured", "localSuggestionPhotos", "localProfileSuggestions"]
    .some(key => typeof status[key] !== "boolean")) throw new Error("Invalid suggestion status.");
  return status;
}
export async function uploadSuggestionPhoto(payload, fetchImpl = globalThis.fetch) {
  if (!supportsSuggestionPhotos()) throw new SuggestionSubmissionError("Prilaganje fotografija trenutačno nije dostupno.", { code: "NOT_CONFIGURED" });
  let response;
  try { response = await fetchImpl("/api/suggestions/photos", { method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
  catch { throw new SuggestionSubmissionError("Slanje fotografije je prekinuto. Odabir je zadržan za ponovni pokušaj."); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new SuggestionSubmissionError(FRIENDLY_ERRORS[response.status] ?? "Fotografija se ne može poslati. Pokušaj ponovno.", { status: response.status });
  if (result.ok !== true || !/^[a-f0-9]{64}$/.test(result.token ?? "")) throw new SuggestionSubmissionError("Odgovor za fotografiju nije valjan.");
  return result;
}
export const MAX_SUBMISSION_BODY_BYTES = 64 * 1024;

export class SuggestionSubmissionError extends Error {
  constructor(message, { status = 0, code = "SUBMISSION_FAILED" } = {}) {
    super(message);
    this.name = "SuggestionSubmissionError";
    this.status = status;
    this.code = code;
  }
}

export function getSuggestionsApiUrl(config = globalThis.window?.FAMILY_TREE_CONFIG) {
  if (localSuggestionsEnabled !== null) return localSuggestionsEnabled ? "/api/suggestions" : "";
  const value = config?.suggestionsApiUrl;
  if (typeof value !== "string" || !/^https:\/\/[^\s]+$/i.test(value)) return "";
  return value.replace(/\/+$/, "");
}

export function buildTextSuggestionRequest({
  submitterName,
  email = "",
  relationship = "",
  message,
  accessCode
}) {
  return {
    schemaVersion: 1,
    type: "text",
    submitterName,
    email,
    relationship,
    message,
    accessCode
  };
}

export function buildGraphSuggestionRequest(serializedDraft, {
  submitterName,
  email = "",
  relationship = "",
  comment = "",
  accessCode,
  photoTokens
}) {
  if (!serializedDraft || serializedDraft.schemaVersion !== 1 || serializedDraft.type !== "graph") {
    throw new SuggestionSubmissionError("The visual draft is invalid.", { code: "INVALID_DRAFT" });
  }

  // Explicit projection is intentional. Family Chart state, canonical data,
  // session state, and arbitrary caller keys can never enter the request.
  return {
    schemaVersion: 1,
    type: "graph",
    anchorPersonId: serializedDraft.anchorPersonId,
    anchorCatalogVersion: serializedDraft.anchorCatalogVersion,
    sourceRevision: serializedDraft.sourceRevision,
    people: serializedDraft.people.map(({ id, firstName, lastName, birthday, gender }) => ({
      id,
      firstName,
      lastName,
      birthday,
      gender
    })),
    relationships: serializedDraft.relationships.map(({ from, to, type }) => ({ from, to, type })),
    comment,
    submitterName,
    email,
    relationship,
    accessCode,
    ...(photoTokens?.length ? { photoTokens: photoTokens.map(({ token, caption }) => ({ token, caption })) } : {})
  };
}

export async function submitSuggestionRequest(request, {
  apiUrl = getSuggestionsApiUrl(),
  fetchImpl = globalThis.fetch
} = {}) {
  if (!apiUrl) {
    throw new SuggestionSubmissionError("Suggestion submission is not configured.", {
      code: "NOT_CONFIGURED"
    });
  }
  if (typeof fetchImpl !== "function") {
    throw new SuggestionSubmissionError("Suggestion submission is unavailable.", {
      code: "NETWORK_UNAVAILABLE"
    });
  }

  let response;
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > MAX_SUBMISSION_BODY_BYTES) {
    throw new SuggestionSubmissionError(FRIENDLY_ERRORS[413], {
      status: 413,
      code: "PAYLOAD_TOO_LARGE"
    });
  }
  try {
    response = await fetchImpl(apiUrl, {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body
    });
  } catch {
    throw new SuggestionSubmissionError("Unable to reach the suggestion service. Try again.", {
      code: "NETWORK_ERROR"
    });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SuggestionSubmissionError(
      FRIENDLY_ERRORS[response.status] ?? "Unable to send the suggestion. Try again later.",
      { status: response.status }
    );
  }
  if (result?.ok !== true || typeof result.id !== "string" || !result.id) {
    throw new SuggestionSubmissionError("The suggestion service returned an invalid response.", {
      status: response.status,
      code: "INVALID_RESPONSE"
    });
  }
  return { ok: true, id: result.id };
}

export async function submitVisualDraft(draft, details, options = {}) {
  const request = buildGraphSuggestionRequest(draft.serialize(), details);
  const result = await submitSuggestionRequest(request, options);
  draft.reset();
  return result;
}
