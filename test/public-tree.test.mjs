import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildPublicAnchorArtifacts } from "../scripts/generate-public-anchors.mjs";
import { validateGeneratedArtifacts } from "../scripts/lib/public-artifacts.mjs";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import { buildSite } from "../scripts/lib/publication.mjs";
import { validatePublicAnchorCatalog, publicRelationshipKey } from "../assets/suggestions/public-anchor-catalog.js";
import { createPublicTree } from "../assets/viewer/public-tree.js";
import { findPeople, personDateLabel } from "../assets/viewer/person-browser.js";
import { createProject, fixture, hashes, PASSWORD } from "./helpers/project.mjs";
import { validateProject } from "../scripts/validate-public-build.mjs";
import path from "node:path";

function approve(person, label) { person.privacy = { publicAnchor: true, publicLabel: label }; }
const ordered = edges => [...edges].sort((a, b) => publicRelationshipKey(a) < publicRelationshipKey(b) ? -1 : 1);

test("public relationships include only direct links with two approved endpoints and never bridge a private person", async () => {
  const nodes = await fixture("valid-multigeneration.json");
  approve(nodes[0], "Reviewed elder");
  approve(nodes[2], "Reviewed descendant");
  const original = structuredClone(nodes);
  const { catalog } = buildPublicAnchorArtifacts(nodes);
  assert.deepEqual(catalog.relationships, []);
  assert.deepEqual(createPublicTree(catalog).map(person => person.rels),
    [{ parents: [], spouses: [], children: [] }, { parents: [], spouses: [], children: [] }]);
  for (const value of ['"parent"', "Parent Example", "1940", "1970", "2000"]) {
    assert.equal(JSON.stringify(catalog).includes(value), false, value);
  }
  assert.deepEqual(nodes, original);
  approve(nodes[1], "Reviewed middle");
  const prepared = buildPublicAnchorArtifacts(nodes);
  assert.deepEqual(prepared.catalog.relationships, [
    { from: "grandparent", to: "parent", type: "parentOf" },
    { from: "parent", to: "child", type: "parentOf" }
  ]);
  const publicNodes = createPublicTree(prepared.catalog);
  const middle = publicNodes.find(person => person.id === "parent");
  assert.deepEqual(middle.rels, { parents: ["grandparent"], spouses: [], children: ["child"] });
  assert.equal(middle.data.birthday, "");
  assert.equal(middle.data.avatar, "");
  assert.equal(personDateLabel(middle), "Godine nisu javno navedene.");
  assert.deepEqual(findPeople(publicNodes, "1970"), []);
});

test("public spouses are emitted once and displayed reciprocally without changing canonical ordering", async () => {
  const nodes = await fixture("valid-spouses.json");
  for (const [index, person] of nodes.entries()) approve(person, "Reviewed partner " + index);
  const before = structuredClone(nodes);
  const first = buildPublicAnchorArtifacts(nodes, { mainPersonId: "spouse-a" });
  assert.deepEqual(first.catalog.relationships, [{ from: "spouse-a", to: "spouse-b", type: "spouseOf" }]);
  assert.deepEqual(buildPublicAnchorArtifacts([...nodes].reverse(), { mainPersonId: "spouse-a" }).catalog, first.catalog);
  const publicNodes = createPublicTree(first.catalog);
  assert.deepEqual(publicNodes[0].rels.spouses, ["spouse-b"]);
  assert.deepEqual(publicNodes[1].rels.spouses, ["spouse-a"]);
  assert.deepEqual(nodes, before);
});

test("public validation rejects hidden endpoints, unsupported data, duplicate edges and ancestry cycles", async () => {
  const nodes = await fixture("valid-spouses.json");
  for (const [index, person] of nodes.entries()) approve(person, "Reviewed " + index);
  const { catalog, allowlist, revision } = buildPublicAnchorArtifacts(nodes);
  const valid = { from: "spouse-a", to: "spouse-b", type: "parentOf" };
  for (const edges of [null, [{ ...valid, to: "hidden-person" }], [{ ...valid, to: valid.from }],
    [{ ...valid, type: "siblingOf" }], [{ ...valid, privateNote: "not public" }], [valid, valid],
    [{ from: "spouse-b", to: "spouse-a", type: "spouseOf" }],
    ordered([valid, { from: "spouse-b", to: "spouse-a", type: "parentOf" }])]) {
    const bad = { ...catalog, relationships: edges };
    assert.throws(() => validatePublicAnchorCatalog(bad));
    assert.throws(() => validateGeneratedArtifacts(bad, allowlist, revision));
    assert.throws(() => createPublicTree(bad));
  }
});

test("a public link inconsistent with the canonical graph blocks building even when its endpoints are public", async t => {
  const nodes = await fixture("valid-simple.json");
  for (const person of nodes) approve(person, "Reviewed " + person.id);
  const { paths } = await createProject(t, { nodes, site: true });
  const catalog = JSON.parse(await readFile(paths.catalog, "utf8"));
  catalog.relationships = [{ from: "child", to: "parent", type: "parentOf" }];
  await writeFile(paths.catalog, JSON.stringify(catalog));
  await assert.rejects(buildSite(paths), { code: "STALE_ARTIFACTS" });
});

test("legacy catalogs keep building unchanged until a password-backed reviewed save prepares public links", async t => {
  const nodes = await fixture("valid-simple.json");
  for (const person of nodes) approve(person, "Reviewed " + person.id);
  const { paths } = await createProject(t, { nodes, site: true });
  const legacy = JSON.parse(await readFile(paths.catalog, "utf8"));
  delete legacy.relationships;
  await writeFile(paths.catalog, JSON.stringify(legacy));
  const before = await hashes(paths);
  await buildSite(paths);
  assert.deepEqual(await hashes(paths), before);
  assert.deepEqual(createPublicTree(legacy).map(person => person.rels.parents), [[], []]);
  const workflow = createFamilyWorkflow(paths);
  const snapshot = await workflow.snapshot();
  assert.equal((await workflow.openSnapshot({ password: PASSWORD, payloadDigest: snapshot.payloadDigest })).needsPreparation, true);
  const request = { nodes, password: PASSWORD, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: randomUUID() };
  const review = await workflow.save(request);
  assert.equal(review.code, "PUBLICATION_REVIEW");
  assert.deepEqual(review.publicationDiff.added, []);
  assert.deepEqual(review.publicationDiff.addedRelationships, [{ from: "parent", to: "child", type: "parentOf" }]);
  assert.deepEqual(await hashes(paths), before);
  const saved = await workflow.save({ ...request, publicationApprovalToken: review.approvalToken });
  assert.equal(saved.ok, true);
  const catalog = JSON.parse(await readFile(paths.catalog, "utf8"));
  assert.equal(catalog.catalogVersion, legacy.catalogVersion);
  assert.equal(catalog.sourceRevision, legacy.sourceRevision);
  assert.equal(catalog.relationships.length, 1);
  await buildSite(paths);
});

test("relationship-only publication changes require review and a failed save restores all five files", async t => {
  const nodes = await fixture("valid-simple.json");
  for (const person of nodes) approve(person, "Reviewed " + person.id);
  const { paths } = await createProject(t, { nodes });
  const before = await hashes(paths);
  const workflow = createFamilyWorkflow(paths, { fault: async point => {
    if (point === "after:catalog") throw new Error("Fictional public-link save failure");
  } });
  const snapshot = await workflow.snapshot();
  const candidate = structuredClone(nodes);
  candidate[0].rels.children = [];
  candidate[1].rels.parents = [];
  const request = { nodes: candidate, password: PASSWORD, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: randomUUID() };
  const review = await workflow.save(request);
  assert.equal(review.code, "PUBLICATION_REVIEW");
  assert.deepEqual(review.publicationDiff.removedRelationships, [{ from: "parent", to: "child", type: "parentOf" }]);
  assert.deepEqual(await hashes(paths), before);
  await assert.rejects(workflow.save({ ...request, publicationApprovalToken: review.approvalToken }), { code: "SAVE_FAILED" });
  assert.deepEqual(await hashes(paths), before);
});

test("a prepared public graph builds for static hosting without the private canonical source", async t => {
  const nodes = await fixture("valid-multigeneration.json");
  approve(nodes[0], "Reviewed elder");
  approve(nodes[1], "Reviewed middle");
  const { paths } = await createProject(t, { nodes, site: true });
  await unlink(paths.canonical); // Fictional fixture only: simulate public-only CI.
  const built = await buildSite(paths);
  const summary = await validateProject({ root: paths.root, outputDirectory: paths.dist });
  assert.equal(summary.privateSourcePresent, false);
  const catalog = JSON.parse(await readFile(path.join(paths.dist, "data/family.anchors.public.json"), "utf8"));
  assert.deepEqual(catalog.relationships, [{ from: "grandparent", to: "parent", type: "parentOf" }]);
  assert.equal(JSON.stringify(catalog).includes('"child"'), false);
  assert.equal(built.inventory.some(file => file.path === "assets/viewer/public-tree.js"), true);
  assert.equal(built.inventory.some(file => file.path.startsWith("private/")), false);
});
