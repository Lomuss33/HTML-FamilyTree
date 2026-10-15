import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createProject, PASSWORD, hashes, fixture } from "./helpers/project.mjs";
import { REPOSITORY_ROOT } from "../scripts/lib/project-paths.mjs";
import { decryptFamily } from "../scripts/lib/family-crypto.mjs";

const exec = promisify(execFile);
function cli(script, paths, args = [], password = PASSWORD) {
  return exec(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", script), "--root", paths.root, ...args], {
    cwd: REPOSITORY_ROOT, env: { ...process.env, FAMILY_TREE_PASSWORD: password }, timeout: 30000
  });
}

test("encryption alias rejects invalid canonical data without replacing any artifact", async t => {
  const { paths } = await createProject(t);
  await writeFile(paths.canonical, JSON.stringify(await fixture("invalid-ancestry-cycle.json")));
  const before = await hashes(paths);
  await assert.rejects(cli("encrypt-family.mjs", paths), error => /Canonical family data is invalid/.test(error.stderr));
  assert.deepEqual(await hashes(paths), before);
});

test("all preparation aliases use the complete five-file workflow with real encryption", async t => {
  const { paths, nodes } = await createProject(t);
  nodes[0].data.birthday = "Fictional manual correction";
  await writeFile(paths.canonical, JSON.stringify(nodes));
  await cli("encrypt-family.mjs", paths);
  await cli("generate-public-anchors.mjs", paths);
  const payload = JSON.parse(await readFile(paths.encrypted, "utf8"));
  assert.deepEqual(await decryptFamily(payload, PASSWORD), nodes);
  assert.equal(JSON.parse(await readFile(paths.catalog, "utf8")).sourceRevision,
    JSON.parse(await readFile(paths.revision, "utf8")).sourceRevision);
});

test("password arguments and obsolete independent-output options are rejected", async t => {
  const { paths } = await createProject(t);
  const before = await hashes(paths);
  await assert.rejects(cli("encrypt-family.mjs", paths, ["--password", "fictional-secret"]));
  await assert.rejects(cli("generate-public-anchors.mjs", paths, ["--catalog-output", "somewhere.json"]));
  assert.deepEqual(await hashes(paths), before);
});

test("maintenance failures never print private identifiers or malformed JSON values", async t => {
  const { paths, nodes } = await createProject(t, { site: true });
  const canary = "fictional-private-diagnostic-canary";
  nodes[0].id = canary;
  nodes[0].rels.parents = null;
  for (const source of [JSON.stringify(nodes), '["' + canary + '" invalid JSON]']) {
    await writeFile(paths.canonical, source);
    const before = await hashes(paths);
    for (const script of ["validate-family-data.mjs", "validate-public-build.mjs", "encrypt-family.mjs",
      "prepare-family.mjs", "generate-public-anchors.mjs", "enable-all-public-anchors.mjs", "apply-family-additions.mjs"]) {
      await assert.rejects(cli(script, paths, script === "apply-family-additions.mjs" ? ["--patch", "fictional.json"] : []), error => {
        assert.equal(error.code, 1);
        assert.ok(error.stderr.length > 0);
        assert.equal((error.stdout + error.stderr).includes(canary), false);
        assert.equal((error.stdout + error.stderr).includes(PASSWORD), false);
        return true;
      });
    }
    assert.deepEqual(await hashes(paths), before);
  }
});

test("a dry run reports public/private disagreement without inferring consent or changing artifacts", async t => {
  const { paths, nodes } = await createProject(t);
  delete nodes[0].privacy;
  await writeFile(paths.canonical, JSON.stringify(nodes));
  const before = await hashes(paths);
  const result = await cli("prepare-family.mjs", paths, ["--dry-run"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.publicAnchors, 0);
  assert.equal(report.removedPublicLabels, 1);
  assert.equal(report.addedPublicLabels, 0);
  for (const value of [nodes[0].id, nodes[0].data["first name"], "Reviewed Public Label"]) {
    assert.equal(result.stdout.includes(value), false);
  }
  assert.deepEqual(await hashes(paths), before);
});
