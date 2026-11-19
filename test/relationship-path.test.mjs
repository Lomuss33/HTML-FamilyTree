import assert from "node:assert/strict";
import test from "node:test";
import { findRelationshipPath, relationshipPathLabel } from "../assets/viewer/relationship-path.js";
import { buildPublicAnchorArtifacts } from "../scripts/generate-public-anchors.mjs";
import { createPublicTree } from "../assets/viewer/public-tree.js";

function family() {
  const nodes = ["grand", "parent", "aunt", "self", "sibling", "cousin", "partner", "inlaw", "other"].map(id => ({
    id, data: { "first name": "Fictional " + id, gender: "F" }, rels: { parents: [], children: [], spouses: [] }
  }));
  const byId = new Map(nodes.map(person => [person.id, person]));
  function child(from, to) { byId.get(from).rels.children.push(to); byId.get(to).rels.parents.push(from); }
  function partners(from, to) { byId.get(from).rels.spouses.push(to); byId.get(to).rels.spouses.push(from); }
  child("grand", "parent"); child("grand", "aunt"); child("parent", "self"); child("parent", "sibling");
  child("aunt", "cousin"); child("inlaw", "partner"); partners("self", "partner");
  return nodes;
}
const ids = path => path?.map(step => step.id) ?? null;
const relations = path => path.slice(1).map(step => step.relation);

test("direct parent, child, partner and self paths keep their direction and do not mutate a family", () => {
  const nodes = family(), before = structuredClone(nodes);
  assert.deepEqual(findRelationshipPath(nodes, "self", "self"), [{ id: "self", relation: null }]);
  assert.deepEqual(relations(findRelationshipPath(nodes, "self", "parent")), ["parent"]);
  assert.deepEqual(relations(findRelationshipPath(nodes, "parent", "self")), ["child"]);
  assert.deepEqual(relations(findRelationshipPath(nodes, "self", "partner")), ["partner"]);
  assert.equal(relationshipPathLabel(findRelationshipPath(nodes, "self", "parent")), "Roditelj početne osobe.");
  assert.equal(relationshipPathLabel(findRelationshipPath(nodes, "self", "self")), "Ovo je odabrana početna osoba.");
  assert.deepEqual(nodes, before);
});

test("ancestor, descendant, sibling and cousin explanations follow recorded parents without assuming full siblings", () => {
  const nodes = family();
  const ancestor = findRelationshipPath(nodes, "self", "grand");
  assert.deepEqual(relations(ancestor), ["parent", "parent"]);
  assert.equal(relationshipPathLabel(ancestor), "Predak početne osobe · broj generacija: 2.");
  assert.match(relationshipPathLabel(findRelationshipPath(nodes, "grand", "self")), /Potomak/);
  assert.deepEqual(ids(findRelationshipPath(nodes, "self", "sibling")), ["self", "parent", "sibling"]);
  assert.equal(relationshipPathLabel(findRelationshipPath(nodes, "self", "sibling")), "Osobe dijele upisanog roditelja.");
  assert.deepEqual(relations(findRelationshipPath(nodes, "self", "cousin")), ["parent", "parent", "child", "child"]);
  assert.equal(relationshipPathLabel(findRelationshipPath(nodes, "self", "cousin")), "Veza preko zajedničkog pretka.");
});

test("partner-family paths include an explicit partner step; sharing a child does not invent a partnership", () => {
  const nodes = family();
  assert.deepEqual(ids(findRelationshipPath(nodes, "self", "inlaw")), ["self", "partner", "inlaw"]);
  assert.deepEqual(relations(findRelationshipPath(nodes, "self", "inlaw")), ["partner", "parent"]);
  assert.equal(relationshipPathLabel(findRelationshipPath(nodes, "self", "inlaw")), "Put uključuje supružnika ili partnera.");
  nodes.find(person => person.id === "other").rels.children.push("sibling");
  nodes.find(person => person.id === "sibling").rels.parents.push("other");
  const coparents = findRelationshipPath(nodes, "parent", "other");
  assert.deepEqual(relations(coparents), ["child", "parent"]);
  assert.equal(relationshipPathLabel(coparents), "Put kroz upisane roditeljske veze.");
});

test("one shortest path is deterministic across reordered arrays, and a shorter partner route is allowed", () => {
  const nodes = family();
  // Two shared parents provide equally short alternatives.
  const self = nodes.find(person => person.id === "self"), sibling = nodes.find(person => person.id === "sibling");
  self.rels.parents.push("aunt"); sibling.rels.parents.push("aunt");
  nodes.find(person => person.id === "aunt").rels.children.push("self", "sibling");
  const path = findRelationshipPath(nodes, "self", "sibling");
  const reordered = structuredClone(nodes).reverse();
  for (const person of reordered) for (const values of Object.values(person.rels)) values.reverse();
  assert.deepEqual(findRelationshipPath(reordered, "self", "sibling"), path);
  assert.equal(path.length, 3);
  self.rels.spouses.push("cousin");
  nodes.find(person => person.id === "cousin").rels.spouses.push("self");
  assert.deepEqual(relations(findRelationshipPath(nodes, "self", "cousin")), ["partner"]);
});

test("disconnected and absent people have no path; cycles, missing endpoints and malformed arrays terminate safely", () => {
  const nodes = family();
  assert.equal(findRelationshipPath(nodes, "self", "other"), null);
  assert.equal(findRelationshipPath(nodes, "absent", "self"), null);
  assert.equal(findRelationshipPath(nodes, "self", "absent"), null);
  assert.equal(findRelationshipPath([], "self", "self"), null);
  nodes[0].rels.parents = ["missing", "grand", "self"];
  nodes.at(-1).rels = { parents: null, children: "self" };
  assert.equal(findRelationshipPath(nodes, "self", "other"), null);
  assert.deepEqual(ids(findRelationshipPath(nodes, "self", "grand")), ["self", "parent", "grand"]);
});

test("public paths use only approved endpoints and cannot cross a private intermediary", () => {
  const nodes = family();
  for (const id of ["grand", "self", "partner", "inlaw"]) nodes.find(person => person.id === id).privacy = {
    publicAnchor: true, publicLabel: "Reviewed " + id
  };
  const { catalog } = buildPublicAnchorArtifacts(nodes);
  const publicNodes = createPublicTree(catalog);
  assert.equal(findRelationshipPath(publicNodes, "self", "grand"), null);
  assert.notEqual(findRelationshipPath(nodes, "self", "grand"), null);
  assert.deepEqual(ids(findRelationshipPath(publicNodes, "self", "inlaw")), ["self", "partner", "inlaw"]);
  assert.equal(JSON.stringify(publicNodes).includes("Fictional parent"), false);
});
