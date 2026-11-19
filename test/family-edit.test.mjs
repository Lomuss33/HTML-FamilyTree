import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { applyFamilyEdit, findPossibleDuplicates } from "../assets/editor/family-edit.js";
import { validateFamilyData } from "../scripts/validate-family-data.mjs";

const fixture = () => readFile(new URL("./fixtures/family/valid-nearest-family.json", import.meta.url), "utf8").then(JSON.parse);
const data = { "first name": "New fictional", "last name": "Record", birthday: "oko 1980", gender: "F" };
const options = { createId: () => "person-fictional-new" };
const person = (nodes, id) => nodes.find(value => value.id === id);

test("standalone entry is private and preserves every existing id, field, permission and relationship", async () => {
  const nodes = await fixture(), before = structuredClone(nodes);
  nodes[0].privacy = { publicAnchor: true, publicLabel: "Fictional reviewed label" };
  before[0].privacy = structuredClone(nodes[0].privacy);
  const result = applyFamilyEdit(nodes, { type: "standalone", newPerson: data }, options);
  validateFamilyData(result.nodes);
  assert.deepEqual(result.nodes.slice(0, -1), before);
  assert.equal(result.personId, "person-fictional-new");
  assert.deepEqual(result.nodes.at(-1), { id: result.personId, data: { ...data, avatar: "" },
    rels: { parents: [], spouses: [], children: [] }, privacy: { publicAnchor: false } });
  assert.deepEqual(nodes, before);
});

test("new parents, partners and children use reciprocal edges without guessing other relationships", async () => {
  const nodes = await fixture(), before = structuredClone(nodes);
  for (const [type, forward, reverse] of [["parent", "parents", "children"], ["partner", "spouses", "spouses"], ["child", "children", "parents"]]) {
    const result = applyFamilyEdit(nodes, { type, anchorId: "near-disconnected", newPerson: data }, options);
    validateFamilyData(result.nodes);
    assert.deepEqual(person(result.nodes, "near-disconnected").rels[forward], [result.personId]);
    assert.deepEqual(person(result.nodes, result.personId).rels[reverse], ["near-disconnected"]);
    assert.deepEqual(person(result.nodes, result.personId).privacy, { publicAnchor: false });
  }
  const child = applyFamilyEdit(nodes, { type: "child", anchorId: "near-focus", newPerson: data }, options);
  assert.deepEqual(person(child.nodes, child.personId).rels.parents, ["near-focus"]);
  assert.deepEqual(person(child.nodes, "near-partner-one"), person(before, "near-partner-one"));
  assert.deepEqual(nodes, before);
});

test("explicit second parents can be existing nonpartners and never create a partnership", async () => {
  const nodes = await fixture();
  const result = applyFamilyEdit(nodes, { type: "child", anchorId: "near-focus", newPerson: data, otherParentId: "near-coparent" }, options);
  validateFamilyData(result.nodes);
  assert.deepEqual(person(result.nodes, result.personId).rels.parents, ["near-focus", "near-coparent"]);
  assert.deepEqual(person(result.nodes, "near-coparent").rels.spouses, []);
  assert.deepEqual(person(result.nodes, "near-focus").rels.spouses, person(nodes, "near-focus").rels.spouses);
});

test("existing people retain their data and privacy when linked, and duplicate links are no-ops", async () => {
  const nodes = await fixture(), target = person(nodes, "near-disconnected");
  target.data.notes = "Fictional source and history";
  target.privacy = { publicAnchor: true, publicLabel: "Reviewed fictional person" };
  const result = applyFamilyEdit(nodes, { type: "partner", anchorId: "near-focus", personId: target.id });
  validateFamilyData(result.nodes);
  assert.equal(result.nodes.length, nodes.length);
  assert.deepEqual(person(result.nodes, target.id).data, target.data);
  assert.deepEqual(person(result.nodes, target.id).privacy, target.privacy);
  assert.throws(() => applyFamilyEdit(result.nodes, { type: "partner", anchorId: "near-focus", personId: target.id }), { code: "NO_CHANGE" });
});

test("siblings share only explicitly selected existing parents; unknown parents are not invented", async () => {
  const nodes = await fixture();
  const half = applyFamilyEdit(nodes, { type: "sibling", anchorId: "near-focus", newPerson: data, sharedParentIds: ["near-father"] }, options);
  validateFamilyData(half.nodes);
  assert.deepEqual(person(half.nodes, half.personId).rels.parents, ["near-father"]);
  assert.deepEqual(person(half.nodes, "near-mother"), person(nodes, "near-mother"));
  const full = applyFamilyEdit(nodes, { type: "sibling", anchorId: "near-focus", personId: "near-disconnected", sharedParentIds: ["near-father", "near-mother"] });
  validateFamilyData(full.nodes);
  assert.deepEqual(person(full.nodes, "near-disconnected").rels.parents, ["near-father", "near-mother"]);
  for (const request of [
    { anchorId: "near-disconnected", sharedParentIds: [] }, { anchorId: "near-focus", sharedParentIds: [] },
    { anchorId: "near-focus", sharedParentIds: ["near-uncle"] }, { anchorId: "near-focus", sharedParentIds: ["near-father", "near-father"] }
  ]) assert.throws(() => applyFamilyEdit(nodes, { type: "sibling", newPerson: data, ...request }, options), { code: "SHARED_PARENT_REQUIRED" });
});

test("self links, third parents and ancestry cycles fail without a partial change", async () => {
  const nodes = await fixture(), before = structuredClone(nodes);
  for (const request of [
    { type: "partner", anchorId: "near-focus", personId: "near-focus" },
    { type: "parent", anchorId: "near-focus", personId: "near-disconnected" },
    { type: "parent", anchorId: "near-father", personId: "near-child-one" },
    { type: "child", anchorId: "near-child-one", personId: "near-grandparent" },
    { type: "child", anchorId: "near-focus", newPerson: data, otherParentId: "near-focus" }
  ]) {
    assert.throws(() => applyFamilyEdit(nodes, request, options));
    assert.deepEqual(nodes, before);
  }
});

test("same-name warnings require explicit confirmation and never merge records automatically", async () => {
  const nodes = await fixture();
  nodes[0].data["first name"] = "Đuro"; nodes[0].data["last name"] = "Čović";
  const duplicate = { ...data, "first name": "duro", "last name": "covic", birthday: "different fictional year" };
  assert.deepEqual(findPossibleDuplicates(nodes, duplicate).map(value => value.id), ["near-focus"]);
  assert.throws(() => applyFamilyEdit(nodes, { type: "standalone", newPerson: duplicate }, options), { code: "POSSIBLE_DUPLICATE" });
  const confirmed = applyFamilyEdit(nodes, { type: "standalone", newPerson: duplicate, allowDuplicate: true }, options);
  assert.equal(confirmed.nodes.length, nodes.length + 1);
  assert.deepEqual(confirmed.nodes.slice(0, -1), nodes);
});

test("invalid new fields, ids, missing endpoints and malformed source arrays cannot stage edits", async () => {
  const nodes = await fixture();
  for (const newPerson of [{ ...data, gender: "" }, { ...data, "first name": "", "last name": "" },
    { ...data, privacy: { publicAnchor: true } }, { ...data, birthday: "x".repeat(81) }, { ...data, "first name": "bad\0name" }]) {
    assert.throws(() => applyFamilyEdit(nodes, { type: "standalone", newPerson }, options));
  }
  for (const id of ["near-focus", "tmp_fake", "", " spaced "]) assert.throws(() => applyFamilyEdit(nodes, { type: "standalone", newPerson: data }, { createId: () => id }));
  assert.throws(() => applyFamilyEdit(nodes, { type: "parent", anchorId: "missing", personId: "near-focus" }));
  assert.throws(() => applyFamilyEdit(nodes, { type: "child", anchorId: "near-focus", personId: "missing" }));
  assert.throws(() => applyFamilyEdit(nodes, { type: "standalone", personId: "near-focus" }));
  const broken = structuredClone(nodes); broken[0].rels.children = null;
  assert.throws(() => applyFamilyEdit(broken, { type: "standalone", newPerson: data }, options), { code: "INVALID_TREE" });
  assert.equal(broken[0].rels.children, null);
});
