import assert from "node:assert/strict";
import test from "node:test";
import { validateProfileChange, validateProfileSelection, applyProfileChange } from "../assets/suggestions/profile-change.js";

const catalogVersion = "sha256:" + "a".repeat(64);
const proposal = changes => ({ personId: "fictional-public", catalogVersion, changes });
const nodes = () => [{ id: "fictional-public", data: { "first name": "Fictional", "last name": "Example", birthday: "1901",
  notes: "Fictional original source", residences: [{ place: "Fictional Old Town", from: "1901", to: "1910" }],
  avatar: "private-original.jpg", gallery: [{ id: "fictional-photo" }], "private note": "Keep this fictional detail" },
  privacy: { publicAnchor: true, publicLabel: "Approved fictional label" }, rels: { parents: [], children: [], spouses: [] } },
  { id: "fictional-private", data: { "first name": "Fictional relative" }, rels: { parents: [], children: [], spouses: [] } }];

test("profile corrections accept only explicit nonempty profile fields and public targets", () => {
  const allowed = { catalogVersion, anchorIds: ["fictional-public"] };
  const valid = proposal({ birthday: "oko 1902", "previous names": "Fictional previous name\nAnother name" });
  assert.deepEqual(validateProfileChange(valid, allowed), valid);
  for (const key of ["privacy", "publicLabel", "rels", "avatar", "gallery", "id", "unknown"]) {
    assert.throws(() => validateProfileChange(proposal({ [key]: "fictional" }), allowed));
  }
  for (const changes of [{}, { birthday: "" }, { birthday: "   " }, { birthday: null }, { birthday: 1900 },
    { notes: "x".repeat(2001) }, { "first name": "x".repeat(201) }, { notes: "fictional\0note" }]) {
    assert.throws(() => validateProfileChange(proposal(changes), allowed));
  }
  assert.throws(() => validateProfileChange({ ...valid, personId: "fictional-private" }, allowed));
  assert.throws(() => validateProfileChange({ ...valid, catalogVersion: "sha256:" + "b".repeat(64) }, allowed), { statusCode: 409 });
  assert.throws(() => validateProfileChange({ ...valid, status: "accepted" }, allowed));
});

test("profile corrections require an explicit subset and preserve unselected and unrelated data", () => {
  const original = nodes(), before = structuredClone(original);
  const change = proposal({ birthday: "1902", "first name": "Unselected fictional name" });
  for (const selected of [undefined, [], ["birthday", "birthday"], ["privacy"], ["last name"]]) {
    assert.throws(() => validateProfileSelection(change, selected));
  }
  const updated = applyProfileChange(original, change, ["birthday"]);
  assert.equal(updated[0].data.birthday, "1902");
  const expected = structuredClone(before); expected[0].data.birthday = "1902";
  assert.deepEqual(updated, expected);
  assert.deepEqual(original, before);
  assert.throws(() => applyProfileChange(original, { ...change, personId: "missing-fictional" }, ["birthday"]), { statusCode: 409 });
});

test("notes and residence corrections append without removing existing history or duplicating it", () => {
  const original = nodes();
  const change = proposal({ notes: "Fictional additional source", residences: [
    { place: "Fictional Old Town", from: "1901", to: "1910" }, { place: "Fictional New Town", from: "1911", to: "" }
  ] });
  const updated = applyProfileChange(original, change, ["notes", "residences"]);
  assert.equal(updated[0].data.notes, "Fictional original source\n\nFictional additional source");
  assert.deepEqual(updated[0].data.residences, change.changes.residences);
  assert.deepEqual(applyProfileChange(updated, change, ["notes", "residences"]), updated);
  assert.equal(original[0].data.residences.length, 1);
  for (const residences of [[], [{ place: "", from: "", to: "" }], [{ place: "Town", from: 1900, to: "" }],
    [{ place: "Town", from: "", to: "", private: true }], [change.changes.residences[0], change.changes.residences[0]]]) {
    assert.throws(() => validateProfileChange(proposal({ residences })));
  }
});
