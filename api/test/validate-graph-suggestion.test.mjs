import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphSuggestionValidationError,
  validateGraphSuggestion
} from "../src/validate-graph-suggestion.mjs";

const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;
const ALLOWLIST = Object.freeze({ catalogVersion: CATALOG_VERSION, anchorIds: ["anchor_1", "anchor_2"] });

function person(id, overrides = {}) {
  return {
    id,
    firstName: "Example",
    lastName: "Person",
    birthday: "1970",
    gender: "M",
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
    people: [person("tmp_1")],
    relationships: [{ from: "anchor_1", to: "tmp_1", type: "parentOf" }],
    comment: "Context",
    submitterName: "Guest",
    email: "guest@example.com",
    relationship: "Relative",
    accessCode: "not-validated-here",
    ...overrides
  };
}

function expectInvalid(payload, category, statusCode = 400) {
  assert.throws(
    () => validateGraphSuggestion(payload, ALLOWLIST),
    (error) => error instanceof GraphSuggestionValidationError
      && error.category === category
      && error.statusCode === statusCode
  );
}

test("accepts one-person parent, child, and spouse graphs", () => {
  const child = validateGraphSuggestion(graph(), ALLOWLIST);
  assert.equal(child.payload.people.length, 1);

  const parent = validateGraphSuggestion(graph({
    relationships: [{ from: "tmp_1", to: "anchor_1", type: "parentOf" }]
  }), ALLOWLIST);
  assert.equal(parent.payload.relationships[0].from, "tmp_1");

  const spouse = validateGraphSuggestion(graph({
    relationships: [{ from: "tmp_1", to: "anchor_1", type: "spouseOf" }]
  }), ALLOWLIST);
  assert.deepEqual(spouse.payload.relationships, [
    { from: "anchor_1", to: "tmp_1", type: "spouseOf" }
  ]);
});

test("accepts connected multi-generation and multi-node graphs", () => {
  const result = validateGraphSuggestion(graph({
    people: [person("tmp_1"), person("tmp_2"), person("tmp_3", { gender: "F" })],
    relationships: [
      { from: "anchor_1", to: "tmp_1", type: "parentOf" },
      { from: "tmp_1", to: "tmp_2", type: "parentOf" },
      { from: "tmp_1", to: "tmp_3", type: "spouseOf" }
    ]
  }), ALLOWLIST);
  assert.equal(result.payload.people.length, 3);
  assert.equal(result.payload.relationships.length, 3);
});

test("normalizes safe text fields and returns only the storage model", () => {
  const result = validateGraphSuggestion(graph({
    submitterName: "  Guest\nName  ",
    comment: "  useful\tcontext "
  }), ALLOWLIST);
  assert.deepEqual(result.submitter, {
    name: "Guest Name",
    email: "guest@example.com",
    relationship: "Relative"
  });
  assert.equal(result.payload.comment, "useful context");
  assert.equal(result.payload.accessCode, undefined);
});

test("rejects invalid revisions and anchors", () => {
  expectInvalid(graph({ anchorPersonId: "tmp_1" }), "temporary_anchor");
  expectInvalid(graph({ anchorPersonId: "private_person" }), "unknown_anchor");
  expectInvalid(graph({ anchorCatalogVersion: "bad" }), "invalid_catalog_version");
  expectInvalid(graph({ anchorCatalogVersion: `sha256:${"c".repeat(64)}` }), "stale_anchor_catalog", 409);
  expectInvalid(graph({ sourceRevision: "SHA256:ABC" }), "invalid_source_revision");
});

test("rejects malformed, duplicate, canonical, and arbitrary person ids", () => {
  expectInvalid(graph({ people: [person("anchor_1")] }), "invalid_temporary_id");
  expectInvalid(graph({ people: [person("tmp_0")] }), "invalid_temporary_id");
  expectInvalid(graph({ people: [person("tmp_1"), person("tmp_1")] }), "duplicate_temporary_id");
  expectInvalid(graph({ people: [{ ...person("tmp_1"), avatar: "https://example.com/a.jpg" }] }), "unknown_person_key");
  expectInvalid(graph({ people: [{ ...person("tmp_1"), url: "https://example.com" }] }), "unknown_person_key");
  expectInvalid(graph({ people: [{ ...person("tmp_1"), gender: "X" }] }), "invalid_gender");
});

test("rejects unsupported, self, duplicate, dangling, and canonical-only edges", () => {
  expectInvalid(graph({ relationships: [{ from: "anchor_1", to: "tmp_1", type: "siblingOf" }] }), "unsupported_relationship");
  expectInvalid(graph({ relationships: [{ from: "tmp_1", to: "tmp_1", type: "parentOf" }] }), "self_relationship");
  expectInvalid(graph({ relationships: [
    { from: "anchor_1", to: "tmp_1", type: "parentOf" },
    { from: "anchor_1", to: "tmp_1", type: "parentOf" }
  ] }), "duplicate_relationship");
  expectInvalid(graph({ relationships: [
    { from: "anchor_1", to: "tmp_1", type: "spouseOf" },
    { from: "tmp_1", to: "anchor_1", type: "spouseOf" }
  ] }), "duplicate_relationship");
  expectInvalid(graph({ relationships: [{ from: "anchor_1", to: "tmp_9", type: "parentOf" }] }), "dangling_endpoint");
  expectInvalid(graph({ relationships: [{ from: "anchor_1", to: "anchor_2", type: "spouseOf" }] }), "dangling_endpoint");
});

test("rejects disconnected people, ancestry cycles, and a third parent", () => {
  expectInvalid(graph({
    people: [person("tmp_1"), person("tmp_2")],
    relationships: [{ from: "anchor_1", to: "tmp_1", type: "parentOf" }]
  }), "disconnected_person");

  expectInvalid(graph({
    people: [person("tmp_1"), person("tmp_2")],
    relationships: [
      { from: "anchor_1", to: "tmp_1", type: "parentOf" },
      { from: "tmp_1", to: "tmp_2", type: "parentOf" },
      { from: "tmp_2", to: "anchor_1", type: "parentOf" }
    ]
  }), "ancestry_cycle");

  expectInvalid(graph({
    people: [person("tmp_1"), person("tmp_2"), person("tmp_3")],
    relationships: [
      { from: "tmp_1", to: "anchor_1", type: "parentOf" },
      { from: "tmp_2", to: "anchor_1", type: "parentOf" },
      { from: "tmp_3", to: "anchor_1", type: "parentOf" }
    ]
  }), "too_many_parents");
});

test("rejects unknown and mutation-like keys", () => {
  for (const key of [
    "deletePeople",
    "removePeople",
    "updatePeople",
    "replacePeople",
    "removeRelationships",
    "replaceRelationships",
    "patch",
    "status",
    "createdAt",
    "updatedAt",
    "familyPassword"
  ]) {
    expectInvalid(graph({ [key]: [] }), "unknown_top_level_key");
  }
});

test("enforces people and relationship bounds", () => {
  expectInvalid(graph({ people: [] }), "people_required");
  expectInvalid(graph({ people: Array.from({ length: 51 }, (_, index) => person(`tmp_${index + 1}`)) }), "too_many_people");
  expectInvalid(graph({ relationships: Array.from({ length: 101 }, () => ({
    from: "anchor_1",
    to: "tmp_1",
    type: "parentOf"
  })) }), "too_many_relationships");
});
