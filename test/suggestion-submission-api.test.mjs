import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { VisualSuggestionDraft } from "../assets/suggestions/draft-model.js";
import {
  SuggestionSubmissionError,
  buildGraphSuggestionRequest,
  buildTextSuggestionRequest,
  getSuggestionsApiUrl,
  submitSuggestionRequest,
  submitVisualDraft
} from "../assets/suggestions/submission-api.js";

const API_URL = "https://example.execute-api.eu-central-1.amazonaws.com/suggestions";
const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;

function populatedDraft() {
  const draft = new VisualSuggestionDraft();
  draft.selectAnchor({ id: "anchor_1" }, {
    anchorCatalogVersion: CATALOG_VERSION,
    sourceRevision: SOURCE_REVISION
  });
  draft.addChild("anchor_1", {
    firstName: "Marko",
    lastName: "Example",
    birthday: "1970",
    gender: "M"
  });
  return draft;
}

function okResponse(id = "suggestion-123") {
  return {
    ok: true,
    status: 201,
    json: async () => ({ ok: true, id })
  };
}

test("configured API URL is the only endpoint source", () => {
  assert.equal(getSuggestionsApiUrl({ suggestionsApiUrl: `${API_URL}/` }), API_URL);
  assert.equal(getSuggestionsApiUrl({ suggestionsApiUrl: "http://unsafe.example/suggestions" }), "");
  assert.equal(getSuggestionsApiUrl({}), "");
});

test("constructs schema-v1 text requests with the entered access code", () => {
  assert.deepEqual(buildTextSuggestionRequest({
    submitterName: "Guest",
    email: "",
    relationship: "Relative",
    message: "Text suggestion",
    accessCode: "entered-at-submit"
  }), {
    schemaVersion: 1,
    type: "text",
    submitterName: "Guest",
    email: "",
    relationship: "Relative",
    message: "Text suggestion",
    accessCode: "entered-at-submit"
  });
});

test("constructs graph requests only from authoritative serialized fields", () => {
  const serialized = {
    ...populatedDraft().serialize(),
    familyPassword: "never-send",
    canonicalGraph: [{ private: true }],
    familyChartInternalState: { cards: [] },
    sessionStorage: { secret: true }
  };
  const request = buildGraphSuggestionRequest(serialized, {
    submitterName: "Guest",
    email: "guest@example.com",
    relationship: "Relative",
    comment: "Context",
    accessCode: "entered-at-submit"
  });

  assert.deepEqual(Object.keys(request).sort(), [
    "accessCode",
    "anchorCatalogVersion",
    "anchorPersonId",
    "comment",
    "email",
    "people",
    "relationship",
    "relationships",
    "schemaVersion",
    "sourceRevision",
    "submitterName",
    "type"
  ]);
  const body = JSON.stringify(request);
  for (const forbidden of ["familyPassword", "canonicalGraph", "familyChart", "sessionStorage", "never-send"]) {
    assert.equal(body.includes(forbidden), false);
  }
});

test("no network request occurs until submit is explicitly called", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okResponse();
  };
  const request = buildGraphSuggestionRequest(populatedDraft().serialize(), {
    submitterName: "Guest",
    accessCode: "entered-at-submit"
  });
  assert.equal(calls, 0);
  await submitSuggestionRequest(request, { apiUrl: API_URL, fetchImpl });
  assert.equal(calls, 1);
});

test("rejects an oversized request before fetch", async () => {
  let calls = 0;
  await assert.rejects(
    () => submitSuggestionRequest({ value: "x".repeat(70 * 1024) }, {
      apiUrl: API_URL,
      fetchImpl: async () => {
        calls += 1;
        return okResponse();
      }
    }),
    (error) => error instanceof SuggestionSubmissionError && error.status === 413
  );
  assert.equal(calls, 0);
});

test("successful visual submission resets only after the server confirms success", async () => {
  const draft = populatedDraft();
  let draftWasPopulatedDuringRequest = false;
  const result = await submitVisualDraft(draft, {
    submitterName: "Guest",
    accessCode: "entered-at-submit"
  }, {
    apiUrl: API_URL,
    fetchImpl: async (_url, options) => {
      draftWasPopulatedDuringRequest = draft.hasProposedPeople();
      assert.equal(JSON.parse(options.body).accessCode, "entered-at-submit");
      return okResponse("graph-id");
    }
  });
  assert.equal(draftWasPopulatedDuringRequest, true);
  assert.deepEqual(result, { ok: true, id: "graph-id" });
  assert.equal(draft.hasContent(), false);
});

test("failed visual submission preserves the draft for retry", async () => {
  const draft = populatedDraft();
  await assert.rejects(
    () => submitVisualDraft(draft, {
      submitterName: "Guest",
      accessCode: "wrong"
    }, {
      apiUrl: API_URL,
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "server detail is ignored" })
      })
    }),
    (error) => error instanceof SuggestionSubmissionError && error.status === 403
  );
  assert.equal(draft.hasProposedPeople(), true);
  assert.equal(draft.getSnapshot().anchorPersonId, "anchor_1");
});

test("simple and visual requests use the same configured URL and safe fetch options", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return okResponse(`id-${calls.length}`);
  };
  const config = { suggestionsApiUrl: API_URL };
  await submitSuggestionRequest(buildTextSuggestionRequest({
    submitterName: "Guest",
    message: "Text",
    accessCode: "code"
  }), { apiUrl: getSuggestionsApiUrl(config), fetchImpl });
  await submitSuggestionRequest(buildGraphSuggestionRequest(populatedDraft().serialize(), {
    submitterName: "Guest",
    accessCode: "code"
  }), { apiUrl: getSuggestionsApiUrl(config), fetchImpl });

  assert.deepEqual(calls.map(({ url }) => url), [API_URL, API_URL]);
  assert.ok(calls.every(({ options }) => options.credentials === "omit" && options.method === "POST"));
});

test("submission module never persists codes or calls the local canonical save endpoint", async () => {
  const source = await readFile(new URL("../assets/suggestions/submission-api.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /\/api\/save/);
  assert.doesNotMatch(source, /family\.private\.json|family\.enc\.json/);
});

test("disabled local suggestions cannot fall back to a configured production service", async () => {
  const local = await import("../assets/suggestions/submission-api.js?local-mode-test");
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return okResponse(); };
  const config = { suggestionsApiUrl: API_URL };
  local.setLocalSuggestionsEnabled(false);
  assert.equal(local.getSuggestionsApiUrl(config), "");
  await assert.rejects(local.submitSuggestionRequest({}, { fetchImpl }), { code: "NOT_CONFIGURED" });
  assert.deepEqual(calls, []);
  local.setLocalSuggestionsEnabled(true);
  assert.equal(local.getSuggestionsApiUrl(config), "/api/suggestions");
  await local.submitSuggestionRequest(buildTextSuggestionRequest({ submitterName: "Fictional visitor", message: "Example", accessCode: "fictional-code" }), { fetchImpl });
  assert.deepEqual(calls, ["/api/suggestions"]);
});

test("photo upload stays disabled for cloud-only configuration and uses the local code boundary when enabled", async () => {
  const local = await import("../assets/suggestions/submission-api.js?photo-local-mode-test");
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, token: "a".repeat(64) }) }; };
  await assert.rejects(local.uploadSuggestionPhoto({ accessCode: "fictional-code" }, fetchImpl), { code: "NOT_CONFIGURED" });
  local.setSuggestionPhotosEnabled(true);
  await assert.rejects(local.uploadSuggestionPhoto({ accessCode: "fictional-code" }, fetchImpl), { code: "NOT_CONFIGURED" });
  assert.equal(calls.length, 0);
  local.setLocalSuggestionsEnabled(true);
  await local.uploadSuggestionPhoto({ accessCode: "fictional-code", content: "fictional-bytes" }, fetchImpl);
  assert.equal(calls[0].url, "/api/suggestions/photos");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.parse(calls[0].options.body).accessCode, "fictional-code");
  assert.equal(calls[0].options.body.includes("password"), false);
});
