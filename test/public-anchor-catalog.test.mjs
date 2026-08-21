import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPublicAnchors,
  loadPublicAnchorCatalog,
  validatePublicAnchorCatalog
} from "../assets/suggestions/public-anchor-catalog.js";

const VERSION = `sha256:${"c".repeat(64)}`;
const REVISION = `sha256:${"d".repeat(64)}`;

test("accepts a zero-anchor catalog", () => {
  const catalog = validatePublicAnchorCatalog(catalogWith([]));
  assert.deepEqual(catalog.anchors, []);
  assert.equal(Object.isFrozen(catalog), true);
});

test("accepts populated approved fields and filters all searchable labels", () => {
  const anchors = [
    { id: "anchor-a", displayLabel: "Iván Example", lifespanLabel: "1920–1998", branchLabel: "North branch" },
    { id: "anchor-b", displayLabel: "Mira Example", branchLabel: "Coastal family" }
  ];
  const catalog = validatePublicAnchorCatalog(catalogWith(anchors));
  assert.deepEqual(filterPublicAnchors(catalog.anchors, "ivan").map((anchor) => anchor.id), ["anchor-a"]);
  assert.deepEqual(filterPublicAnchors(catalog.anchors, "1998").map((anchor) => anchor.id), ["anchor-a"]);
  assert.deepEqual(filterPublicAnchors(catalog.anchors, "coastal").map((anchor) => anchor.id), ["anchor-b"]);
});

test("rejects public-field leakage and temporary anchor ids", () => {
  const leaked = catalogWith([{ id: "anchor", displayLabel: "Reviewed", birthday: "private" }]);
  assert.throws(() => validatePublicAnchorCatalog(leaked), /forbidden field "birthday"/);
  const temporary = catalogWith([{ id: "tmp_1", displayLabel: "Reviewed" }]);
  assert.throws(() => validatePublicAnchorCatalog(temporary), /tmp_\*/);
});

test("loads only the requested public catalog with no-store semantics", async () => {
  const calls = [];
  const expected = catalogWith([]);
  const catalog = await loadPublicAnchorCatalog("/public-anchors.json", async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, json: async () => expected };
  });
  assert.deepEqual(calls, [["/public-anchors.json", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin"
  }]]);
  assert.deepEqual(catalog.anchors, []);
});

function catalogWith(anchors) {
  return {
    schemaVersion: 1,
    catalogVersion: VERSION,
    sourceRevision: REVISION,
    anchors
  };
}
