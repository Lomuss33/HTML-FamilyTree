import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FamilyDataValidationError,
  computeCanonicalSourceRevision,
  validateFamilyData
} from "../scripts/validate-family-data.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "family");

const validFixtures = [
  "valid-simple.json",
  "valid-spouses.json",
  "valid-multigeneration.json",
  "valid-public-anchor.json"
];

const invalidFixtures = new Map([
  ["invalid-duplicate-id.json", /Duplicate canonical person id "same-id"/],
  ["invalid-dangling-relation.json", /references missing person "missing-person"/],
  ["invalid-parent-reciprocity.json", /Parent\/child mismatch/],
  ["invalid-spouse-reciprocity.json", /Spouse mismatch/],
  ["invalid-self-parent.json", /may not reference itself in rels\.parents/],
  ["invalid-self-spouse.json", /may not reference itself in rels\.spouses/],
  ["invalid-ancestry-cycle.json", /Ancestry cycle detected/],
  ["invalid-third-parent.json", /supports at most 2/],
  ["invalid-temporary-id.json", /reserved visual-suggestion temporary id namespace/],
  ["invalid-duplicate-relation.json", /contains duplicate id "child"/],
  ["invalid-public-anchor-label.json", /privacy\.publicLabel is missing or empty/]
]);

for (const fixtureName of validFixtures) {
  test(`accepts canonical fixture ${fixtureName}`, async () => {
    const family = await fixture(fixtureName);
    const before = JSON.stringify(family);
    const result = validateFamilyData(family);
    assert.equal(result.personCount, family.length);
    assert.equal(result.mainPersonId, family[0].id);
    assert.equal(JSON.stringify(family), before, "validation must not mutate canonical data");
  });
}

for (const [fixtureName, expectedMessage] of invalidFixtures) {
  test(`rejects canonical fixture ${fixtureName}`, async () => {
    const family = await fixture(fixtureName);
    assert.throws(
      () => validateFamilyData(family),
      (error) => error instanceof FamilyDataValidationError && expectedMessage.test(error.message)
    );
  });
}

test("rejects an empty or non-array canonical root", () => {
  assert.throws(() => validateFamilyData([]), /non-empty array/);
  assert.throws(() => validateFamilyData({}), /non-empty array/);
});

test("requires explicit relationship arrays", () => {
  assert.throws(
    () => validateFamilyData([{ id: "person", data: { gender: "M" }, rels: {} }]),
    /rels\.parents must be an array/
  );
});

test("validates supported field and gender types", () => {
  const invalid = [{
    id: "person",
    data: { "first name": 123, gender: "unknown" },
    rels: { parents: [], children: [], spouses: [] }
  }];
  assert.throws(() => validateFamilyData(invalid), /first name.*must be a string/);
  assert.throws(() => validateFamilyData(invalid), /unsupported gender/);
});

test("validates an explicitly configured main person", async () => {
  const family = await fixture("valid-simple.json");
  assert.equal(validateFamilyData(family, { mainPersonId: "child" }).mainPersonId, "child");
  assert.throws(
    () => validateFamilyData(family, { mainPersonId: "missing" }),
    /main person "missing" does not exist/
  );
});

test("source revision is deterministic, topology-sensitive, and excludes private display fields", async () => {
  const family = await fixture("valid-multigeneration.json");
  const revision = computeCanonicalSourceRevision(family);
  const privateFieldChange = structuredClone(family);
  privateFieldChange[1].data["first name"] = "Changed private name";
  assert.equal(computeCanonicalSourceRevision(privateFieldChange), revision);

  const topologyChange = structuredClone(family);
  topologyChange.push({
    id: "unrelated",
    data: { gender: "M" },
    rels: { parents: [], children: [], spouses: [] }
  });
  assert.notEqual(computeCanonicalSourceRevision(topologyChange), revision);
  assert.match(revision, /^sha256:[a-f0-9]{64}$/);
});

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
}
