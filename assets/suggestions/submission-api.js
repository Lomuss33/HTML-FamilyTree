const FRIENDLY_ERRORS = Object.freeze({
  400: "Check the suggestion details and try again.",
  403: "The submission access code is invalid.",
  409: "The public anchor catalog has changed. Start a new visual suggestion and try again.",
  413: "This suggestion is too large to submit. Reduce the proposed branch and try again."
});
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
  accessCode
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
    accessCode
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
