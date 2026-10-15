import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPOSITORY_ROOT } from "../scripts/lib/project-paths.mjs";
import { recoverTransactions, operationReceipt } from "../scripts/lib/file-transaction.mjs";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import { createProject, hashes } from "./helpers/project.mjs";

const exec = promisify(execFile);
async function interrupt(paths, point) {
  await assert.rejects(exec(process.execPath,
    [path.join(REPOSITORY_ROOT, "test/helpers/interrupted-save.mjs"), paths.root, point],
    { timeout: 15000 }), error => error.code === 86);
}

for (const point of ["prepared", "after:canonical", "after:encrypted", "after:catalog", "after:allowlist", "after:revision"]) {
  test("restart after process exit at " + point + " restores all five original files", async t => {
    const { paths } = await createProject(t);
    const before = await hashes(paths);
    await interrupt(paths, point);
    await assert.rejects(createFamilyWorkflow(paths).snapshot(), { code: "RECOVERY_REQUIRED" });
    assert.equal((await recoverTransactions(paths))[0].state, "rolled-back");
    assert.deepEqual(await hashes(paths), before);
    assert.equal((await operationReceipt(paths, "fictional-interrupted-save")).state, "rolled-back");
    assert.deepEqual(await recoverTransactions(paths), []);
  });
}

test("recovery verifies every backup before replacing any file, then succeeds after repair", async t => {
  const { paths } = await createProject(t);
  const original = await hashes(paths);
  await interrupt(paths, "after:encrypted");
  const partial = await hashes(paths);
  const backup = path.join(paths.transactions, "fictional-interrupted-save", "allowlist.before");
  const validBackup = await readFile(backup);
  await writeFile(backup, "Corrupted fictional recovery copy");
  await assert.rejects(recoverTransactions(paths), { code: "RECOVERY_REQUIRED" });
  assert.deepEqual(await hashes(paths), partial);
  await writeFile(backup, validBackup);
  await recoverTransactions(paths);
  assert.deepEqual(await hashes(paths), original);
});

test("recovery preserves manual changes made after an interruption instead of overwriting them", async t => {
  const { paths, nodes } = await createProject(t);
  const original = await hashes(paths);
  await interrupt(paths, "after:encrypted");
  const stagedCanonical = await readFile(paths.canonical);
  nodes[0].data.birthday = "Fictional manual rescue";
  await writeFile(paths.canonical, JSON.stringify(nodes));
  const manual = await hashes(paths);
  await assert.rejects(recoverTransactions(paths), { code: "RECOVERY_REQUIRED" });
  assert.deepEqual(await hashes(paths), manual);
  // A deliberate fixture-only resolution restores the known interrupted bytes.
  await writeFile(paths.canonical, stagedCanonical);
  await recoverTransactions(paths);
  assert.deepEqual(await hashes(paths), original);
});
