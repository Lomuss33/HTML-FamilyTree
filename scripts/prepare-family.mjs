import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { projectPaths, parseArgs, FamilyWorkflowError, assertSafePath, readJson, safeErrorMessage } from "./lib/project-paths.mjs";
import { createFamilyWorkflow, publicationDiff } from "./lib/family-workflow.mjs";
import { buildPublicAnchorArtifacts } from "./generate-public-anchors.mjs";
import { jsonText } from "./lib/family-crypto.mjs";

export async function runPreparation(args = process.argv.slice(2), { transform, operation: selectedOperation } = {}) {
  const options = parseArgs(args);
  const supported = new Set(["root", "dry-run", "review-publication", "approve-publication", "initialize", "rotate-password"]);
  if (Object.keys(options).some(key => !supported.has(key))) throw new FamilyWorkflowError("INVALID_ARGUMENT", "Use the shared preparation options. Separate input/output paths and password arguments are no longer supported.");
  if (options.password) throw new FamilyWorkflowError("SECRET_ARGUMENT", "Supply the password locally through FAMILY_TREE_PASSWORD, never a command argument.");
  const paths = projectPaths(options.root);
  const workflow = createFamilyWorkflow(paths);
  const snapshot = await workflow.snapshot();
  const nodes = transform ? transform(snapshot.nodes) : snapshot.nodes;
  const expected = buildPublicAnchorArtifacts(nodes);
  const diff = publicationDiff(await readJson(paths.catalog), expected.catalog);
  if (options["review-publication"]) {
    const directory = await assertSafePath(paths.root, path.join(paths.privateDir, "reviews"));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "publication-" + randomUUID() + ".json");
    await writeFile(file, jsonText(diff), { mode: 0o600 });
    console.log("Publication details saved to ignored private/reviews/.");
  }
  if (options["dry-run"]) {
    const report = { dryRun: true, personCount: nodes.length, publicAnchors: expected.catalog.anchors.length,
      addedPublicLabels: diff.added.length, removedPublicLabels: diff.removed.length, changedPublicLabels: diff.changed.length,
      decryption: "not-checked-dry-run" };
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  const password = process.env.FAMILY_TREE_PASSWORD;
  if (!password) throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Supply the family password locally through FAMILY_TREE_PASSWORD or unlock and Save in the local app.");
  const operation = selectedOperation ?? (options.initialize ? "initialize" : options["rotate-password"] ? "rotate" : "prepare");
  const result = await workflow.save({ nodes, password, operation, newPassword: process.env.FAMILY_TREE_NEW_PASSWORD,
    expectedRevision: snapshot.privateRevision, snapshotId: snapshot.snapshotId, operationId: randomUUID(),
    approvePublication: options["approve-publication"] === true });
  if (!result.ok) throw new FamilyWorkflowError("PUBLICATION_REVIEW", "Public labels changed. Inspect --review-publication --dry-run, then explicitly use --approve-publication.", 409);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runPreparation().catch(error => { console.error(error.code ?? "PREPARATION_FAILED", safeErrorMessage(error)); process.exitCode = 1; });
}
