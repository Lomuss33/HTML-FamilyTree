import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  enableAllPublicAnchors,
  migrateAllPublicAnchorsFile
} from "../scripts/enable-all-public-anchors.mjs";

test("opts every canonical person in using only existing display fields", () => {
  const family = validFamily();
  const before = structuredClone(family);
  const migrated = enableAllPublicAnchors(family);

  assert.deepEqual(family, before, "pure migration must not mutate its input");
  assert.equal(migrated.every((person) => person.privacy.publicAnchor === true), true);
  assert.equal(migrated[0].privacy.publicLabel, "First Example");
  assert.equal(migrated[0].privacy.publicLifespan, "1970");
  assert.equal(migrated[0].privacy.publicBranchLabel, "");
  assert.equal(migrated[1].privacy.publicLabel, "OnlyName");
  assert.equal(migrated[1].privacy.publicLifespan, "Reviewed lifespan");
  assert.equal(migrated[1].privacy.publicBranchLabel, "Reviewed branch");
  assert.deepEqual(migrated.map((person) => person.id), before.map((person) => person.id));
  assert.deepEqual(migrated.map((person) => person.rels), before.map((person) => person.rels));
  assert.deepEqual(migrated.map((person) => person.data), before.map((person) => person.data));
});

test("refuses a person without a usable canonical display name", () => {
  const family = validFamily();
  family[0].data["first name"] = " ";
  family[0].data["last name"] = "";
  assert.throws(() => enableAllPublicAnchors(family), /first-name and last-name|first name and last name/i);
});

test("atomically writes a validated migrated private file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "family-anchor-migration-"));
  const filePath = path.join(directory, "family.private.json");
  await writeFile(filePath, `${JSON.stringify(validFamily(), null, 2)}\n`, "utf8");
  const result = await migrateAllPublicAnchorsFile(filePath);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(result.personCount, 2);
  assert.equal(result.optedInCount, 2);
  assert.equal(saved.every((person) => person.privacy.publicAnchor), true);
});

test("leaves an invalid private source unchanged", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "family-anchor-invalid-"));
  const filePath = path.join(directory, "family.private.json");
  const invalidText = `${JSON.stringify([{ id: "broken" }], null, 2)}\n`;
  await writeFile(filePath, invalidText, "utf8");
  await assert.rejects(migrateAllPublicAnchorsFile(filePath), /Canonical family data is invalid/);
  assert.equal(await readFile(filePath, "utf8"), invalidText);
});

function validFamily() {
  return [
    {
      id: "person-one",
      data: {
        "first name": " First ",
        "last name": "Example",
        birthday: "1970",
        avatar: "private.jpg",
        gender: "M",
        note: "preserve"
      },
      rels: { parents: [], children: [], spouses: ["person-two"] },
      custom: { retained: true }
    },
    {
      id: "person-two",
      data: {
        "first name": "OnlyName",
        "last name": "",
        birthday: "",
        avatar: "",
        gender: "F"
      },
      rels: { parents: [], children: [], spouses: ["person-one"] },
      privacy: {
        publicAnchor: false,
        publicLabel: "Old label",
        publicLifespan: "Reviewed lifespan",
        publicBranchLabel: "Reviewed branch"
      }
    }
  ];
}
