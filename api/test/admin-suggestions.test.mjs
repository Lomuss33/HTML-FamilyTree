import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSuggestionsHandler } from "../src/admin-suggestions.mjs";

const CLIENT_ID = "public-spa-client";
const SUGGESTION_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";
const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;
const revision = {
  schemaVersion: 1,
  catalogVersion: CATALOG_VERSION,
  sourceRevision: SOURCE_REVISION
};

test("rejects unauthenticated and wrong-client admin requests", async () => {
  const { handler } = setup();
  assert.equal((await handler(event("GET /admin/suggestions", { claims: null }))).statusCode, 401);
  assert.equal((await handler(event("GET /admin/suggestions", {
    claims: { sub: "admin", token_use: "access", client_id: "another-client" }
  }))).statusCode, 403);
});

test("authenticated list returns safe summaries with pagination", async () => {
  const { handler } = setup({
    queryResult: {
      items: [textSuggestion()],
      lastEvaluatedKey: { id: SUGGESTION_ID, status: "pending", createdAt: "2026-08-21T10:00:00.000Z" }
    }
  });
  const response = await handler(event("GET /admin/suggestions", {
    query: { status: "pending", type: "text", limit: "10" }
  }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, SUGGESTION_ID);
  assert.equal("payload" in body.items[0], false);
  assert.match(body.nextToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(body).includes("submission-secret"), false);
});

test("authenticated detail returns explicit fields and redacts secrets", async () => {
  const { handler } = setup();
  const response = await handler(event("GET /admin/suggestions/{id}", { id: SUGGESTION_ID }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.suggestion.payload.message, "Review this correction");
  assert.equal(body.suggestion.submitter.name, "Reviewer fixture");
  for (const forbidden of ["accessCode", "familyPassword", "Authorization", "submission-secret", "family-secret"]) {
    assert.equal(JSON.stringify(body).includes(forbidden), false);
  }
});

test("authenticated review updates pending, accepted, and rejected statuses", async () => {
  for (const status of ["pending", "accepted", "rejected"]) {
    const { handler, store } = setup();
    const response = await handler(event("PATCH /admin/suggestions/{id}", {
      id: SUGGESTION_ID,
      body: { status, reviewerNote: "Reviewed safely" }
    }));
    assert.equal(response.statusCode, 200);
    assert.equal(store.items.get(SUGGESTION_ID).status, status);
    assert.equal(store.items.get(SUGGESTION_ID).review.reviewerId, "admin-subject");
    assert.equal(store.items.get(SUGGESTION_ID).review.note, "Reviewed safely");
  }
});

test("rejects invalid status and unknown review fields", async () => {
  const { handler } = setup();
  const invalidStatus = await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "approved" }
  }));
  assert.equal(invalidStatus.statusCode, 400);

  const unknownField = await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "accepted", deletePeople: ["person"] }
  }));
  assert.equal(unknownField.statusCode, 400);
});

test("returns 404 for a missing suggestion", async () => {
  const { handler } = setup();
  const response = await handler(event("GET /admin/suggestions/{id}", { id: MISSING_ID }));
  assert.equal(response.statusCode, 404);
});

test("blocks accepting a stale graph suggestion but permits rejection", async () => {
  const stale = graphSuggestion();
  stale.payload.sourceRevision = `sha256:${"c".repeat(64)}`;
  const { handler } = setup({ item: stale });
  const accepted = await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "accepted" }
  }));
  assert.equal(accepted.statusCode, 409);
  assert.match(JSON.parse(accepted.body).error, /stale family revision/);

  const rejected = await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "rejected" }
  }));
  assert.equal(rejected.statusCode, 200);
});

test("accepts a current graph suggestion", async () => {
  const { handler, store } = setup({ item: graphSuggestion() });
  const response = await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "accepted" }
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(store.items.get(SUGGESTION_ID).status, "accepted");
});

test("safe operational logs never contain suggestion content or credentials", async () => {
  const entries = [];
  const logger = {
    info: (...values) => entries.push(values),
    error: (...values) => entries.push(values)
  };
  const { handler } = setup({ logger });
  await handler(event("PATCH /admin/suggestions/{id}", {
    id: SUGGESTION_ID,
    body: { status: "accepted", reviewerNote: "private-review-note" }
  }));
  const serialized = JSON.stringify(entries);
  for (const forbidden of ["private-review-note", "Review this correction", "submission-secret", "family-secret", "Reviewer fixture"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function setup({ item = textSuggestion(), queryResult, logger } = {}) {
  const items = new Map([[item.id, structuredClone(item)]]);
  const store = {
    items,
    async query() {
      return queryResult ?? { items: [...items.values()], lastEvaluatedKey: null };
    },
    async get(id) {
      return items.has(id) ? structuredClone(items.get(id)) : null;
    },
    async update(update) {
      const current = items.get(update.id);
      if (!current || current.status !== update.expectedStatus || current.updatedAt !== update.expectedUpdatedAt) return null;
      const next = { ...current, status: update.status, updatedAt: update.updatedAt, review: update.review };
      items.set(update.id, next);
      return structuredClone(next);
    }
  };
  return {
    store,
    handler: createAdminSuggestionsHandler({
      expectedClientId: CLIENT_ID,
      revision,
      store,
      logger: logger ?? { info() {}, error() {} },
      now: () => new Date("2026-08-21T12:00:00.000Z")
    })
  };
}

function event(routeKey, { claims = authClaims(), id, query, body } = {}) {
  return {
    routeKey,
    pathParameters: id ? { id } : undefined,
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      requestId: "safe-request-id",
      authorizer: claims ? { jwt: { claims } } : undefined
    }
  };
}

function authClaims() {
  return { sub: "admin-subject", token_use: "access", client_id: CLIENT_ID, scope: "openid email" };
}

function textSuggestion() {
  return {
    id: SUGGESTION_ID,
    schemaVersion: 1,
    type: "text",
    status: "pending",
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    submitter: {
      name: "Reviewer fixture",
      email: "fixture@example.test",
      relationship: "Relative"
    },
    payload: { message: "Review this correction" },
    accessCode: "submission-secret",
    familyPassword: "family-secret",
    Authorization: "Bearer should-never-return"
  };
}

function graphSuggestion() {
  return {
    ...textSuggestion(),
    type: "graph",
    payload: {
      anchorPersonId: "anchor-1",
      anchorCatalogVersion: CATALOG_VERSION,
      sourceRevision: SOURCE_REVISION,
      people: [{ id: "tmp_1", firstName: "New", lastName: "Person", birthday: "1970", gender: "M" }],
      relationships: [{ from: "anchor-1", to: "tmp_1", type: "parentOf" }],
      comment: "Graph context"
    }
  };
}
