import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/submit-suggestion.mjs";

function event(payload) {
  return { body: JSON.stringify(payload), isBase64Encoded: false };
}

test("stores a validated suggestion without storing the access code", async () => {
  const stored = [];
  const handler = createHandler({
    accessCode: "a-long-private-submission-code",
    retentionDays: 365,
    putSuggestion: async (item) => stored.push(item)
  });

  const result = await handler(event({
    accessCode: "a-long-private-submission-code",
    submitterName: "Ada Lovelace",
    email: "ada@example.com",
    relationship: "Great-grandchild",
    message: "Please add the 1910 census record."
  }));

  assert.equal(result.statusCode, 201);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "pending");
  assert.equal(stored[0].accessCode, undefined);
  assert.equal(stored[0].message, "Please add the 1910 census record.");
  assert.equal(typeof stored[0].expiresAt, "number");
});

test("rejects an invalid access code without writing", async () => {
  let writes = 0;
  const handler = createHandler({
    accessCode: "a-long-private-submission-code",
    putSuggestion: async () => { writes += 1; }
  });

  const result = await handler(event({
    accessCode: "wrong-code",
    submitterName: "Ada",
    message: "Please add a record."
  }));

  assert.equal(result.statusCode, 401);
  assert.equal(writes, 0);
});

test("rejects malformed input before accessing storage", async () => {
  let writes = 0;
  const handler = createHandler({
    accessCode: "a-long-private-submission-code",
    putSuggestion: async () => { writes += 1; }
  });

  const result = await handler(event({
    accessCode: "a-long-private-submission-code",
    submitterName: "Ada",
    email: "not-an-email",
    message: "Please add a record."
  }));

  assert.equal(result.statusCode, 400);
  assert.equal(writes, 0);
});
