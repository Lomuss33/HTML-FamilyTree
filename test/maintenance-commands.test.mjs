import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProject, PASSWORD, hashes } from "./helpers/project.mjs";
import { REPOSITORY_ROOT, projectPaths } from "../scripts/lib/project-paths.mjs";
import { createFamilyAdditionsPatch } from "../assets/admin/patch-model.js";
import { decryptFamily, familyRevision } from "../scripts/lib/family-crypto.mjs";
import { PUBLIC_FILES } from "../scripts/lib/publication.mjs";

const exec = promisify(execFile);
async function cli(script, root, args = [], environment = {}) {
  const result = await exec(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", script), "--root", root, ...args], {
    cwd: REPOSITORY_ROOT, env: { ...process.env, FAMILY_TREE_PASSWORD: PASSWORD, ...environment }, timeout: 30000
  });
  return JSON.parse(result.stdout);
}

test("encrypted backup restores into an empty isolated project and refuses to overwrite it on initialization", async t => {
  const { paths, nodes } = await createProject(t);
  const backup = await cli("backup-family.mjs", paths.root);
  const file = path.join(paths.root, backup.backup);
  const isolated = path.join(paths.root, "restore-rehearsal");
  await mkdir(isolated);
  const restored = projectPaths(isolated);
  const result = await cli("restore-family.mjs", isolated, ["--backup", file, "--initialize", "--approve-publication"]);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(await readFile(restored.canonical, "utf8")), nodes);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(restored.encrypted, "utf8")), PASSWORD), nodes);
  const before = await hashes(restored);
  await assert.rejects(cli("restore-family.mjs", isolated, ["--backup", file, "--initialize", "--approve-publication"]));
  assert.deepEqual(await hashes(restored), before);
  await assert.rejects(cli("restore-family.mjs", paths.root, ["--backup", file, "--dry-run"], { FAMILY_TREE_BACKUP_PASSWORD: "wrong-fictional-password" }));
});

test("password rotation preserves the canonical tree and rejects the previous password", async t => {
  const { paths, nodes } = await createProject(t);
  const before = familyRevision(nodes);
  await cli("prepare-family.mjs", paths.root, ["--rotate-password"], { FAMILY_TREE_NEW_PASSWORD: "new-fictional-password" });
  const payload = JSON.parse(await readFile(paths.encrypted, "utf8"));
  assert.equal(familyRevision(await decryptFamily(payload, "new-fictional-password")), before);
  await assert.rejects(decryptFamily(payload, PASSWORD));
});

test("applying an accepted patch twice returns the original receipt and never duplicates people", async t => {
  const { paths, nodes, artifacts } = await createProject(t);
  const suggestion = {
    id: "11111111-1111-4111-8111-111111111111", schemaVersion: 1, type: "graph", status: "accepted",
    payload: { anchorPersonId: nodes[0].id, anchorCatalogVersion: artifacts.catalog.catalogVersion,
      sourceRevision: artifacts.catalog.sourceRevision,
      people: [{ id: "tmp_1", firstName: "Invented", lastName: "Relative", birthday: "", gender: "F" }],
      relationships: [{ from: nodes[0].id, to: "tmp_1", type: "parentOf" }], comment: "" }
  };
  const patch = structuredClone(createFamilyAdditionsPatch(suggestion, artifacts.revision));
  const file = path.join(paths.privateDir, "fictional-patch.json");
  await writeFile(file, JSON.stringify(patch));
  assert.equal((await cli("apply-family-additions.mjs", paths.root, ["--patch", file])).ok, true);
  const committed = await hashes(paths);
  assert.equal((await cli("apply-family-additions.mjs", paths.root, ["--patch", file])).alreadyApplied, true);
  assert.deepEqual(await hashes(paths), committed);
  patch.addPeople[0].data["first name"] = "Different patch";
  await writeFile(file, JSON.stringify(patch));
  await assert.rejects(cli("apply-family-additions.mjs", paths.root, ["--patch", file]));
  assert.deepEqual(await hashes(paths), committed);
});

test("release receipt requires decryption and binds the exact public artifact", async t => {
  const { paths } = await createProject(t, { site: true });
  await cli("build-site.mjs", paths.root, ["--environment", "production"]);
  await assert.rejects(cli("verify-release.mjs", paths.root));
  await assert.rejects(cli("prepare-release.mjs", paths.root, [], { FAMILY_TREE_PASSWORD: "" }));
  const receipt = await cli("prepare-release.mjs", paths.root);
  assert.equal(receipt.decryption, "verified");
  assert.equal((await cli("verify-release.mjs", paths.root)).siteDigest, receipt.siteDigest);
  // Simulate a Windows checkout of the same approved text. Its Linux/public
  // artifact must still match the receipt created after real local decryption.
  for (const relative of PUBLIC_FILES) {
    const file = path.join(paths.root, relative);
    await writeFile(file, (await readFile(file, "utf8")).replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n"));
  }
  await cli("build-site.mjs", paths.root, ["--environment", "production"]);
  assert.equal((await cli("verify-release.mjs", paths.root)).siteDigest, receipt.siteDigest);
  await writeFile(path.join(paths.dist, "assets/app.css"), "changed after release");
  await assert.rejects(cli("verify-release.mjs", paths.root));
});
