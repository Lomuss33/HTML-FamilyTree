import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProject, PASSWORD, hashes } from "./helpers/project.mjs";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import test from "node:test";
import { enableAllPublicAnchors } from "../scripts/enable-all-public-anchors.mjs";

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

test("bulk opt-in requires review before the shared transaction replaces any live output", async t => {
  const { paths, nodes } = await createProject(t, { nodes: validFamily() });
  const workflow = createFamilyWorkflow(paths);
  const snapshot = await workflow.snapshot();
  const before = await hashes(paths);
  const request = { nodes: enableAllPublicAnchors(nodes), password: PASSWORD, operation: "prepare",
    operationId: "bulk-anchor-test", expectedRevision: snapshot.privateRevision, snapshotId: snapshot.snapshotId };
  const review = await workflow.save(request);
  assert.equal(review.code, "PUBLICATION_REVIEW");
  assert.deepEqual(await hashes(paths), before);
  const result = await workflow.save({ ...request, publicationApprovalToken: review.approvalToken });
  assert.equal(result.ok, true);
  const saved = JSON.parse(await readFile(paths.canonical, "utf8"));
  assert.equal(saved.every(person => person.privacy.publicAnchor), true);
  assert.equal(JSON.parse(await readFile(paths.catalog, "utf8")).anchors.length, 2);
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
