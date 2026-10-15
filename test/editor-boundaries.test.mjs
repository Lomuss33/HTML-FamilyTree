import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEditorExport, cloneNodes } from "../assets/viewer/editor-state.js";
import { createCanonicalCardHtml, safeAvatarUrl } from "../assets/viewer/card-format.js";
import { createLocalApiClient } from "../assets/editor/local-api.js";
import { fixture } from "./helpers/project.mjs";

test("editor normalization preserves privacy and extra data while repairing only missing relationship arrays", async () => {
  const original = await fixture("valid-public-anchor.json");
  const draft = cloneNodes(original);
  delete draft[0].rels.children;
  draft[0].main = true;
  const normalized = normalizeEditorExport(draft);
  assert.deepEqual(normalized[0].privacy, original[0].privacy);
  assert.deepEqual(normalized[0].data, original[0].data);
  assert.deepEqual(normalized[0].rels.children, []);
  assert.equal("main" in normalized[0], false);
  assert.equal(draft[0].main, true);
});

test("canonical cards treat names, dates, and avatar values as text", () => {
  const html = createCanonicalCardHtml({ data: { data: {
    "first name": '<img src=x onerror="bad()">', "last name": "& Family",
    birthday: "<script>bad()</script>", avatar: "javascript:bad()"
  } } });
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&amp; Family"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("javascript:"), false);
  assert.equal(safeAvatarUrl("data:image/svg+xml,bad"), "");
});

test("editor export rejects malformed relationships instead of silently emptying them", async () => {
  const original = await fixture("valid-simple.json");
  for (const value of [null, "parent", {}, 12]) {
    const draft = cloneNodes(original);
    draft[0].rels.parents = value;
    const before = cloneNodes(draft);
    assert.throws(() => normalizeEditorExport(draft), /relationship/i);
    assert.deepEqual(draft, before);
  }
  const draft = cloneNodes(original);
  draft[0].rels = null;
  assert.throws(() => normalizeEditorExport(draft), /relationship/i);
});

test("local API rejects unprotected discovery and confines the capability to the local requests", async () => {
  const requests = [];
  const capability = { protocolVersion: 2, localSave: true, csrfToken: "f".repeat(43),
    snapshotId: "sha256:" + "a".repeat(64), payloadDigest: "sha256:" + "b".repeat(64) };
  const api = createLocalApiClient({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url === "/api/status" ? capability : { ok: true }), {
      headers: { "content-type": "application/json" }
    });
  } });
  await api.discover();
  await api.save({ operationId: "fictional-operation" });
  assert.equal(requests[1].options.headers["X-Family-Local-Token"], capability.csrfToken);
  assert.equal(requests[1].options.credentials, "omit");
  const invalid = createLocalApiClient({ fetchImpl: async () => new Response('{"localSave":true}', { headers: { "content-type": "application/json" } }) });
  await assert.rejects(invalid.discover(), error => error.code === "LOCAL_UNAVAILABLE");
});
