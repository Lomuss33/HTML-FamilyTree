import assert from "node:assert/strict";
import test from "node:test";
import {
  DraftMutationError,
  VisualSuggestionDraft,
  validateVisualDraft
} from "../assets/suggestions/draft-model.js";

const CATALOG_VERSION = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;
const ANCHOR = Object.freeze({ id: "anchor-person", displayLabel: "Fictional Anchor" });
const PERSON = Object.freeze({
  firstName: "Alex",
  lastName: "Example",
  birthday: "1970",
  gender: "M"
});

test("creates an empty versioned visual draft", () => {
  const draft = new VisualSuggestionDraft();
  assert.deepEqual(draft.getSnapshot(), {
    schemaVersion: 1,
    anchorPersonId: null,
    anchorCatalogVersion: null,
    sourceRevision: null,
    people: [],
    relationships: []
  });
});

test("selects one canonical anchor and preserves both revisions", () => {
  const draft = selectedDraft();
  const snapshot = draft.getSnapshot();
  assert.equal(snapshot.anchorPersonId, ANCHOR.id);
  assert.equal(snapshot.anchorCatalogVersion, CATALOG_VERSION);
  assert.equal(snapshot.sourceRevision, SOURCE_REVISION);
  assert.throws(() => draft.selectAnchor({ id: "another" }, versions()), /Reset the current visual draft/);
});

test("adds a child connected by parentOf", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  assert.equal(child.id, "tmp_1");
  assert.deepEqual(draft.getSnapshot().relationships, [{
    from: ANCHOR.id,
    to: "tmp_1",
    type: "parentOf"
  }]);
});

test("adds a parent connected toward the selected person", () => {
  const draft = selectedDraft();
  const parent = draft.addParent(ANCHOR.id, { ...PERSON, firstName: "Parent", gender: "F" });
  assert.deepEqual(draft.getSnapshot().relationships, [{
    from: parent.id,
    to: ANCHOR.id,
    type: "parentOf"
  }]);
});

test("adds and normalizes a spouse relationship", () => {
  const draft = selectedDraft();
  const spouse = draft.addSpouse(ANCHOR.id, { ...PERSON, firstName: "Spouse", gender: "F" });
  assert.deepEqual(draft.getSnapshot().relationships, [{
    from: ANCHOR.id,
    to: spouse.id,
    type: "spouseOf"
  }]);
});

test("supports grandchildren and multiple generations", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  const grandchild = draft.addChild(child.id, { ...PERSON, firstName: "Grandchild", birthday: "2000" });
  const greatGrandchild = draft.addChild(grandchild.id, { ...PERSON, firstName: "Great", birthday: "2025" });
  assert.equal(draft.getSnapshot().people.length, 3);
  assert.deepEqual(draft.getSnapshot().relationships.at(-1), {
    from: grandchild.id,
    to: greatGrandchild.id,
    type: "parentOf"
  });
});

test("edits only supported proposed-person fields", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  const edited = draft.editPerson(child.id, {
    firstName: "  Jordan  ",
    birthday: "1971"
  });
  assert.equal(edited.firstName, "Jordan");
  assert.equal(edited.birthday, "1971");
  assert.equal(edited.lastName, PERSON.lastName);
  assert.throws(() => draft.editPerson(child.id, { avatar: "https://invalid" }), /unsupported field "avatar"/);
  assert.throws(() => draft.editPerson(child.id, { id: "canonical-looking" }), /unsupported field "id"/);
});

test("cannot edit the immutable anchor", () => {
  const draft = selectedDraft();
  assert.throws(
    () => draft.editPerson(ANCHOR.id, { firstName: "Changed" }),
    (error) => error instanceof DraftMutationError && error.code === "ANCHOR_IMMUTABLE"
  );
});

test("removes a proposed person and its dependent relationships", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  draft.removePerson(child.id);
  assert.deepEqual(draft.getSnapshot().people, []);
  assert.deepEqual(draft.getSnapshot().relationships, []);
});

test("requires explicit cascade when removal disconnects a proposed subgraph", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  const grandchild = draft.addChild(child.id, { ...PERSON, firstName: "Grandchild" });
  assert.deepEqual(draft.analyzeRemoval(child.id).disconnectedPersonIds, [grandchild.id]);
  assert.throws(
    () => draft.removePerson(child.id),
    (error) => error instanceof DraftMutationError && error.code === "DISCONNECTED_AFTER_REMOVE"
  );
  const result = draft.removePerson(child.id, { cascade: true });
  assert.deepEqual(result.removedPersonIds, [child.id, grandchild.id]);
  assert.deepEqual(draft.getSnapshot().people, []);
});

test("cannot remove the anchor", () => {
  const draft = selectedDraft();
  assert.throws(
    () => draft.removePerson(ANCHOR.id),
    (error) => error instanceof DraftMutationError && error.code === "ANCHOR_IMMUTABLE"
  );
});

test("rejects duplicate relationships independent of spouse endpoint order", () => {
  const draft = selectedDraft();
  const spouse = draft.addSpouse(ANCHOR.id, { ...PERSON, gender: "F" });
  assert.throws(
    () => draft.addRelationship(spouse.id, ANCHOR.id, "spouseOf"),
    /duplicates relationship/
  );
});

test("rejects self relationships", () => {
  const draft = selectedDraft();
  assert.throws(
    () => draft.addRelationship(ANCHOR.id, ANCHOR.id, "parentOf"),
    (error) => error instanceof DraftMutationError && error.code === "SELF_RELATIONSHIP"
  );
});

test("allocates deterministic unique temporary ids and resets the allocator", () => {
  const draft = selectedDraft();
  assert.equal(draft.addChild(ANCHOR.id, PERSON).id, "tmp_1");
  assert.equal(draft.addChild(ANCHOR.id, { ...PERSON, firstName: "Second" }).id, "tmp_2");
  draft.reset();
  draft.selectAnchor(ANCHOR, versions());
  assert.equal(draft.addChild(ANCHOR.id, PERSON).id, "tmp_1");
});

test("rejects parent/child ancestry cycles", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  const grandchild = draft.addChild(child.id, { ...PERSON, firstName: "Grandchild" });
  assert.throws(
    () => draft.addRelationship(grandchild.id, ANCHOR.id, "parentOf"),
    /ancestry cycle/
  );
});

test("rejects a third proposed parent", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  draft.addParent(child.id, { ...PERSON, firstName: "Second parent", gender: "F" });
  assert.throws(
    () => draft.addParent(child.id, { ...PERSON, firstName: "Third parent" }),
    /maximum is 2/
  );
});

test("rejects disconnected proposals and unknown canonical endpoints", () => {
  const draft = selectedDraft().getSnapshot();
  const disconnected = structuredClone(draft);
  disconnected.people.push({ id: "tmp_1", ...PERSON });
  assert.throws(() => validateVisualDraft(disconnected), /disconnected: tmp_1/);

  const unknownCanonical = structuredClone(draft);
  unknownCanonical.relationships.push({ from: ANCHOR.id, to: "other-canonical", type: "parentOf" });
  assert.throws(() => validateVisualDraft(unknownCanonical), /only canonical id allowed/);
});

test("serializes the exact Phase 3 graph envelope", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, PERSON);
  assert.deepEqual(draft.serialize(), {
    schemaVersion: 1,
    type: "graph",
    anchorPersonId: ANCHOR.id,
    anchorCatalogVersion: CATALOG_VERSION,
    sourceRevision: SOURCE_REVISION,
    people: [{ id: child.id, ...PERSON }],
    relationships: [{ from: ANCHOR.id, to: child.id, type: "parentOf" }]
  });
});

test("requires a proposed person before serialization", () => {
  assert.throws(
    () => selectedDraft().serialize(),
    (error) => error instanceof DraftMutationError && error.code === "PERSON_REQUIRED"
  );
});

test("mirrors the server people and relationship limits", () => {
  const draft = selectedDraft();
  const ids = [];
  for (let index = 0; index < 50; index += 1) {
    ids.push(draft.addChild(ANCHOR.id, { ...PERSON, firstName: `Person ${index + 1}` }).id);
  }
  assert.throws(
    () => draft.addChild(ANCHOR.id, { ...PERSON, firstName: "Person 51" }),
    (error) => error instanceof DraftMutationError && error.code === "PEOPLE_LIMIT"
  );

  const spousePairs = [];
  for (let left = 0; left < ids.length && spousePairs.length < 51; left += 1) {
    for (let right = left + 1; right < ids.length && spousePairs.length < 51; right += 1) {
      spousePairs.push([ids[left], ids[right]]);
    }
  }
  for (const [from, to] of spousePairs.slice(0, 50)) {
    draft.addRelationship(from, to, "spouseOf");
  }
  assert.equal(draft.getSnapshot().relationships.length, 100);
  assert.throws(
    () => draft.addRelationship(...spousePairs[50], "spouseOf"),
    /at most 100 relationships/
  );
});

test("reset clears anchor, proposal, relationships, and revisions", () => {
  const draft = selectedDraft();
  draft.addChild(ANCHOR.id, PERSON);
  assert.deepEqual(draft.reset(), {
    schemaVersion: 1,
    anchorPersonId: null,
    anchorCatalogVersion: null,
    sourceRevision: null,
    people: [],
    relationships: []
  });
});

function selectedDraft() {
  const draft = new VisualSuggestionDraft();
  draft.selectAnchor(ANCHOR, versions());
  return draft;
}

function versions() {
  return {
    anchorCatalogVersion: CATALOG_VERSION,
    sourceRevision: SOURCE_REVISION
  };
}
