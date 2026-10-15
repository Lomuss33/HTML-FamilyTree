import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLegacyFamily, reconcileExistingAnchors, migrateFamily } from "../scripts/lib/migrate-family.mjs";
import { canonicalPath, fileExists } from "../scripts/lib/project-paths.mjs";
import { familyRevision, jsonText } from "../scripts/lib/family-crypto.mjs";
import { createProject, fixture } from "./helpers/project.mjs";

test("migration adds only missing empty arrays and preserves IDs, fields, privacy and order", async () => {
  const original = await fixture("valid-public-anchor.json");
  const legacy = structuredClone(original);
  let missing = 0;
  for (const person of legacy) for (const field of ["parents", "children", "spouses"]) {
    if (person.rels[field].length === 0) { delete person.rels[field]; missing++; }
  }
  const result = normalizeLegacyFamily(legacy);
  assert.deepEqual(result.nodes, original);
  assert.equal(Object.values(result.added).reduce((a, b) => a + b, 0), missing);
  assert.deepEqual(normalizeLegacyFamily(result.nodes).nodes, original);
  assert.notDeepEqual(legacy, original, "input was not mutated");
});

test("migration rejects malformed populated values and invalid topology", async () => {
  const family = await fixture("valid-simple.json");
  family[0].rels.parents = null;
  assert.throws(() => normalizeLegacyFamily(family), /must be an array/);
  for (const name of ["invalid-ancestry-cycle.json", "invalid-parent-reciprocity.json", "invalid-duplicate-id.json"]) {
    const invalid = await fixture(name);
    assert.throws(() => normalizeLegacyFamily(invalid), /invalid/);
  }
});

test("dry-run never replaces files; real migration verifies backups and retires legacy source", async t => {
  const { paths, nodes } = await createProject(t, { legacy: true });
  const raw = structuredClone(nodes);
  for (const person of raw) for (const key of ["parents", "children", "spouses"]) if (!person.rels[key].length) delete person.rels[key];
  await writeFile(paths.legacy, jsonText(raw));
  const before = await readFile(paths.legacy, "utf8");
  const dry = await migrateFamily(paths, { dryRun: true, keepExistingAnchors: true });
  assert.equal(dry.pathChanged, true);
  assert.equal(await fileExists(paths.canonical), false);
  assert.equal(await readFile(paths.legacy, "utf8"), before);
  const result = await migrateFamily(paths, { keepExistingAnchors: true });
  assert.equal(result.backupCreated, true);
  assert.equal(await fileExists(paths.legacy), false);
  const saved = JSON.parse(await readFile(paths.canonical, "utf8"));
  assert.equal(saved.length, nodes.length);
  assert.equal((await migrateFamily(paths, { keepExistingAnchors: true })).sourceChanged, false);
  assert.equal(JSON.parse(await readFile(path.join(paths.privateDir, "migration-receipt.json"))).privateRevision, familyRevision(saved));
});

test("both source paths fail explicitly and public labels are copied only from the chosen catalog", async t => {
  const { paths, nodes, artifacts } = await createProject(t);
  await writeFile(paths.legacy, jsonText(nodes));
  await assert.rejects(canonicalPath(paths), { code: "SOURCE_CONFLICT" });
  const copied = reconcileExistingAnchors(nodes, artifacts.catalog);
  assert.equal(copied.filter(node => node.privacy?.publicAnchor).length, artifacts.catalog.anchors.length);
  assert.throws(() => reconcileExistingAnchors(nodes, { anchors: [{ id: "unknown", displayLabel: "Never infer" }] }), { code: "ANCHOR_CONFLICT" });
});
