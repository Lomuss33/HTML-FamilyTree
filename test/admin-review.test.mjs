import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAdminApiClient } from "../assets/admin/api-client.js";
import { createAdminAuthClient } from "../assets/admin/auth-client.js";
import { createFamilyAdditionsPatch, serializeFamilyAdditionsPatch } from "../assets/admin/patch-model.js";
import { suggestionToReviewNodes } from "../assets/admin/review-graph-adapter.js";
import { applyFamilyAdditions } from "../scripts/apply-family-additions.mjs";
import { computeCanonicalSourceRevision } from "../scripts/validate-family-data.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "family");
const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SUGGESTION_ID = "11111111-1111-4111-8111-111111111111";

test("graph review adapter renders Original, Suggestion, and Overlay without mutating canonical nodes", async () => {
  const canonical = await fixture("valid-simple.json");
  const before = structuredClone(canonical);
  const suggestion = graphSuggestion(canonical[0].id, computeCanonicalSourceRevision(canonical));
  const original = suggestionToReviewNodes({ mode: "original", canonicalNodes: canonical, suggestion });
  const proposed = suggestionToReviewNodes({ mode: "suggestion", canonicalNodes: canonical, suggestion });
  const overlay = suggestionToReviewNodes({ mode: "overlay", canonicalNodes: canonical, suggestion });

  assert.equal(original.some((node) => node.id === "tmp_1"), false);
  assert.deepEqual(proposed.map((node) => node.id), [canonical[0].id, "tmp_1"]);
  assert.equal(overlay.some((node) => node.id === canonical[1].id), true);
  assert.equal(overlay.some((node) => node.id === "tmp_1"), true);
  assert.deepEqual(canonical, before);
});

test("deterministic graph acceptance patch contains additions only and no temporary IDs", async () => {
  const canonical = await fixture("valid-simple.json");
  const sourceRevision = computeCanonicalSourceRevision(canonical);
  const suggestion = graphSuggestion(canonical[0].id, sourceRevision);
  const patchA = createFamilyAdditionsPatch(suggestion, { catalogVersion: CATALOG_VERSION, sourceRevision });
  const patchB = createFamilyAdditionsPatch(structuredClone(suggestion), { catalogVersion: CATALOG_VERSION, sourceRevision });
  assert.equal(serializeFamilyAdditionsPatch(patchA), serializeFamilyAdditionsPatch(patchB));
  assert.match(patchA.addPeople[0].id, /^sg_[0-9a-f]{32}_1$/);
  assert.equal(JSON.stringify(patchA).includes("tmp_1"), false);
  for (const forbidden of ["deletePeople", "updatePeople", "removeRelationships", "replacePeople"]) {
    assert.equal(forbidden in patchA, false);
  }
});

test("stale graph suggestions cannot produce an acceptance patch", async () => {
  const canonical = await fixture("valid-simple.json");
  const suggestion = graphSuggestion(canonical[0].id, `sha256:${"b".repeat(64)}`);
  assert.throws(
    () => createFamilyAdditionsPatch(suggestion, {
      catalogVersion: CATALOG_VERSION,
      sourceRevision: computeCanonicalSourceRevision(canonical)
    }),
    /stale family revision/
  );
});

test("local patch application adds reciprocal parent relationships and validates the final family", async () => {
  const canonical = await fixture("valid-simple.json");
  const sourceRevision = computeCanonicalSourceRevision(canonical);
  const patch = createFamilyAdditionsPatch(
    graphSuggestion(canonical[0].id, sourceRevision),
    { catalogVersion: CATALOG_VERSION, sourceRevision }
  );
  const result = applyFamilyAdditions(canonical, patch, { catalogVersion: CATALOG_VERSION });
  const added = result.find((person) => person.id === patch.addPeople[0].id);
  const anchor = result.find((person) => person.id === canonical[0].id);
  assert.deepEqual(added.rels.parents, [anchor.id]);
  assert.equal(anchor.rels.children.includes(added.id), true);
});

test("local patch application rejects temporary IDs and duplicate relationships", async () => {
  const canonical = await fixture("valid-simple.json");
  const sourceRevision = computeCanonicalSourceRevision(canonical);
  const patch = structuredClone(createFamilyAdditionsPatch(
    graphSuggestion(canonical[0].id, sourceRevision),
    { catalogVersion: CATALOG_VERSION, sourceRevision }
  ));
  patch.addPeople[0].id = "tmp_1";
  patch.addRelationships[0].to = "tmp_1";
  assert.throws(() => applyFamilyAdditions(canonical, patch, { catalogVersion: CATALOG_VERSION }), /generated suggestion id/);

  const duplicatePatch = structuredClone(createFamilyAdditionsPatch(
    graphSuggestion(canonical[0].id, sourceRevision),
    { catalogVersion: CATALOG_VERSION, sourceRevision }
  ));
  duplicatePatch.addRelationships.push(structuredClone(duplicatePatch.addRelationships[0]));
  assert.throws(() => applyFamilyAdditions(canonical, duplicatePatch, { catalogVersion: CATALOG_VERSION }), /duplicate relationship/);
});

test("admin OAuth uses authorization code with PKCE and stores no refresh credential", async () => {
  const store = memoryStorage();
  const locationObject = {
    href: "https://example.test/app/",
    assigned: "",
    assign(value) { this.assigned = String(value); }
  };
  const historyObject = { replaceState() {} };
  let exchangedBody = "";
  const now = Date.now();
  const config = authConfig();
  const client = createAdminAuthClient({
    config,
    sessionStore: store,
    cryptoApi: webcrypto,
    locationObject,
    historyObject,
    now: () => now,
    fetchImpl: async (_url, options) => {
      exchangedBody = options.body;
      const authorize = new URL(locationObject.assigned);
      const nonce = authorize.searchParams.get("nonce");
      return jsonResponse(200, {
        access_token: jwt({ sub: "admin", token_use: "access", client_id: config.clientId, exp: Math.floor(now / 1000) + 900 }),
        id_token: jwt({ sub: "admin", token_use: "id", aud: config.clientId, nonce, email: "admin@example.test", exp: Math.floor(now / 1000) + 900 }),
        refresh_token: "must-not-be-persisted"
      });
    }
  });
  await client.beginLogin();
  const authorize = new URL(locationObject.assigned);
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));
  locationObject.href = `${config.redirectUri}?code=authorization-code&state=${authorize.searchParams.get("state")}`;
  const result = await client.completeRedirect();
  assert.equal(result.authenticated, true);
  assert.match(exchangedBody, /code_verifier=/);
  assert.equal(JSON.stringify(store.values()).includes("must-not-be-persisted"), false);
  assert.ok(client.getAccessToken());
});

test("admin API always uses configured URL and never sends family or submission credentials", async () => {
  const requests = [];
  const api = createAdminApiClient({
    apiUrl: "https://api.example.test/admin/suggestions",
    getAccessToken: () => "admin-access-jwt",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(200, { items: [], nextToken: null });
    }
  });
  await api.list({ status: "pending" });
  assert.equal(requests[0].url.startsWith("https://api.example.test/admin/suggestions"), true);
  assert.equal(requests[0].options.headers.Authorization, "Bearer admin-access-jwt");
  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes("familyPassword"), false);
  assert.equal(serialized.includes("accessCode"), false);
  assert.equal(serialized.includes("/api/save"), false);
});

function graphSuggestion(anchorPersonId, sourceRevision) {
  return {
    id: SUGGESTION_ID,
    schemaVersion: 1,
    type: "graph",
    status: "pending",
    payload: {
      anchorPersonId,
      anchorCatalogVersion: CATALOG_VERSION,
      sourceRevision,
      people: [{ id: "tmp_1", firstName: "Fictional", lastName: "Person", birthday: "1970", gender: "M" }],
      relationships: [{ from: anchorPersonId, to: "tmp_1", type: "parentOf" }],
      comment: ""
    }
  };
}

function authConfig() {
  return {
    clientId: "browser-client-id",
    domain: "https://family-admin.auth.eu-north-1.amazoncognito.com",
    redirectUri: "https://example.test/app/",
    logoutUri: "https://example.test/app/"
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values: () => [...values.values()]
  };
}

function jwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
}
