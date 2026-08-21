import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BODY_BYTES, createHandler } from "../src/submit-suggestion.mjs";

const ACCESS_CODE = "a-long-private-submission-code";
const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;
const ALLOWLIST = { catalogVersion: CATALOG_VERSION, anchorIds: ["anchor_1"] };

function event(payload, overrides = {}) {
  return {
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    isBase64Encoded: false,
    requestContext: { requestId: "request-123" },
    ...overrides
  };
}

function legacyText(overrides = {}) {
  return {
    accessCode: ACCESS_CODE,
    submitterName: "Ada Lovelace",
    email: "ada@example.com",
    relationship: "Great-grandchild",
    message: "Please add the 1910 census record.",
    ...overrides
  };
}

function graph(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "graph",
    anchorPersonId: "anchor_1",
    anchorCatalogVersion: CATALOG_VERSION,
    sourceRevision: SOURCE_REVISION,
    people: [{
      id: "tmp_1",
      firstName: "Marko",
      lastName: "Example",
      birthday: "1970",
      gender: "M"
    }],
    relationships: [{ from: "anchor_1", to: "tmp_1", type: "parentOf" }],
    comment: "Fictional context",
    submitterName: "Guest",
    email: "",
    relationship: "Relative",
    accessCode: ACCESS_CODE,
    ...overrides
  };
}

function harness(overrides = {}) {
  const stored = [];
  const logs = [];
  const logger = {
    info: (...args) => logs.push(["info", ...args]),
    error: (...args) => logs.push(["error", ...args])
  };
  const handler = createHandler({
    accessCode: ACCESS_CODE,
    retentionDays: 365,
    anchorAllowlist: ALLOWLIST,
    putSuggestion: async (item) => stored.push(item),
    logger,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    createId: () => "suggestion-id",
    ...overrides
  });
  return { handler, stored, logs };
}

test("stores legacy text in the schema-v1 envelope without secrets", async () => {
  const { handler, stored } = harness();
  const result = await handler(event(legacyText()));

  assert.equal(result.statusCode, 201);
  assert.deepEqual(JSON.parse(result.body), { ok: true, id: "suggestion-id" });
  assert.deepEqual(stored[0], {
    id: "suggestion-id",
    schemaVersion: 1,
    type: "text",
    status: "pending",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    expiresAt: 1798859045,
    submitter: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      relationship: "Great-grandchild"
    },
    payload: { message: "Please add the 1910 census record." }
  });
  assert.equal(JSON.stringify(stored).includes(ACCESS_CODE), false);
});

test("accepts explicit schema-v1 text", async () => {
  const { handler, stored } = harness();
  const result = await handler(event(legacyText({ schemaVersion: 1, type: "text" })));
  assert.equal(result.statusCode, 201);
  assert.equal(stored[0].type, "text");
});

test("stores graph suggestions as pending additive payloads", async () => {
  const { handler, stored } = harness();
  const result = await handler(event(graph()));
  assert.equal(result.statusCode, 201);
  assert.equal(stored[0].type, "graph");
  assert.equal(stored[0].status, "pending");
  assert.deepEqual(stored[0].payload.relationships, [
    { from: "anchor_1", to: "tmp_1", type: "parentOf" }
  ]);
  assert.equal(stored[0].payload.anchorCatalogVersion, CATALOG_VERSION);
  assert.equal(stored[0].accessCode, undefined);
  assert.equal(JSON.stringify(stored).includes(ACCESS_CODE), false);
});

test("rejects missing and wrong access codes before writing", async () => {
  for (const accessCode of [undefined, "wrong-code"]) {
    const { handler, stored } = harness();
    const payload = graph();
    if (accessCode === undefined) delete payload.accessCode;
    else payload.accessCode = accessCode;
    const result = await handler(event(payload));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(JSON.parse(result.body), { error: "Invalid access code" });
    assert.equal(stored.length, 0);
  }
});

test("returns 409 for a stale catalog without revealing anchor membership", async () => {
  const { handler, stored } = harness();
  const result = await handler(event(graph({
    anchorCatalogVersion: `sha256:${"c".repeat(64)}`
  })));
  assert.equal(result.statusCode, 409);
  assert.deepEqual(JSON.parse(result.body), { error: "Stale anchor catalog" });
  assert.equal(stored.length, 0);
});

test("rejects unknown anchors with a generic request error", async () => {
  const { handler } = harness();
  const result = await handler(event(graph({ anchorPersonId: "private_person" })));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(result.body), { error: "Invalid request" });
});

test("rejects oversized bodies before parsing or storage", async () => {
  const { handler, stored } = harness();
  const result = await handler(event("x".repeat(MAX_BODY_BYTES + 1)));
  assert.equal(result.statusCode, 413);
  assert.deepEqual(JSON.parse(result.body), { error: "Payload too large" });
  assert.equal(stored.length, 0);
});

test("rejects malformed input, client state, timestamps, and family password", async () => {
  const requests = [
    "not-json",
    legacyText({ status: "approved" }),
    legacyText({ createdAt: "client-time" }),
    legacyText({ familyPassword: "must-not-be-accepted" }),
    graph({ updatedAt: "client-time" })
  ];
  for (const payload of requests) {
    const { handler, stored } = harness();
    const result = await handler(event(payload));
    assert.equal(result.statusCode, 400);
    assert.equal(stored.length, 0);
  }
});

test("operational logs contain metadata only and never request content", async () => {
  const privateValues = [ACCESS_CODE, "Sensitive Name", "private@example.com", "Sensitive comment"];
  const { handler, logs } = harness();
  const result = await handler(event(graph({
    submitterName: privateValues[1],
    email: privateValues[2],
    comment: privateValues[3]
  })));
  assert.equal(result.statusCode, 201);
  const serializedLogs = JSON.stringify(logs);
  for (const privateValue of privateValues) assert.equal(serializedLogs.includes(privateValue), false);
  assert.match(serializedLogs, /request-123/);
  assert.match(serializedLogs, /graph/);
});

test("storage failures return a generic 500 and log no exception details", async () => {
  const secretError = "database failed with secret-sensitive-value";
  const { handler, logs } = harness({
    putSuggestion: async () => { throw new Error(secretError); }
  });
  const result = await handler(event(graph()));
  assert.equal(result.statusCode, 500);
  assert.deepEqual(JSON.parse(result.body), { error: "Submission failed" });
  assert.equal(JSON.stringify(logs).includes(secretError), false);
});
