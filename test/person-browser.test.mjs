import assert from "node:assert/strict";
import test from "node:test";
import { findPeople, personName } from "../assets/viewer/person-browser.js";

const person = (id, first, last, birthday = "") => ({ id,
  data: { "first name": first, "last name": last, birthday },
  rels: { parents: [], spouses: [], children: [] } });

test("people search finds disconnected people, Croatian spellings and reversed name/year terms", () => {
  const nodes = [person("one", "Željka", "Čović", "1950"), person("two", "Đuro", "Šarić", "oko 1952"),
    person("three", "Željka", "Čović", "1980")];
  const before = structuredClone(nodes);
  assert.deepEqual(findPeople(nodes, "  COVIC, zeljka 1950 ").map(value => value.id), ["one"]);
  assert.deepEqual(findPeople(nodes, "saric duro").map(value => value.id), ["two"]);
  assert.deepEqual(findPeople(nodes, "željka čović").map(value => value.id), ["one", "three"]);
  assert.deepEqual(findPeople(nodes, "not recorded"), []);
  assert.equal(findPeople(nodes).length, nodes.length);
  assert.deepEqual(nodes, before);
});

test("person labels preserve recorded text, incomplete names and unknown birth dates", () => {
  const nodes = [person("one", "", "Surname"), person("two", "<img onerror=bad()>", "Family", "oko 1900"),
    person("three", "", "")];
  assert.equal(personName(nodes[0]), "Surname");
  assert.equal(personName(nodes[1]), "<img onerror=bad()> Family");
  assert.equal(personName(nodes[2]), "Osoba bez imena");
  assert.deepEqual(findPeople(nodes, "oko 1900").map(value => value.id), ["two"]);
  assert.equal(nodes[0].data.birthday, "");
});
