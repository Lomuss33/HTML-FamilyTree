import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs, projectPaths, readJson, FamilyWorkflowError } from "./lib/project-paths.mjs";
import { decryptFamily } from "./lib/family-crypto.mjs";
import { createFamilyWorkflow } from "./lib/family-workflow.mjs";
import { validateFamilyData } from "./validate-family-data.mjs";

const options = parseArgs(process.argv.slice(2));
try {
  if (typeof options.backup !== "string") throw new FamilyWorkflowError("BACKUP_REQUIRED", "Use --backup <encrypted-file>.");
  const password = process.env.FAMILY_TREE_PASSWORD;
  const nodes = await decryptFamily(await readJson(path.resolve(options.backup)), process.env.FAMILY_TREE_BACKUP_PASSWORD ?? password);
  validateFamilyData(nodes);
  if (options["dry-run"]) console.log(JSON.stringify({ dryRun: true, personCount: nodes.length, decryption: "verified", liveFilesChanged: false }));
  else {
    const workflow = createFamilyWorkflow(projectPaths(options.root));
    const snapshot = options.initialize ? { privateRevision: null, snapshotId: null } : await workflow.snapshot();
    const result = await workflow.save({ nodes, password, operation: options.initialize ? "initialize" : "prepare", operationId: randomUUID(),
      expectedRevision: snapshot.privateRevision, snapshotId: snapshot.snapshotId, approvePublication: options["approve-publication"] === true });
    if (!result.ok) throw new FamilyWorkflowError("PUBLICATION_REVIEW", "Restore changes public labels. Review the backup before explicitly approving publication.", 409);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(error.code ?? "RESTORE_FAILED", "Restore stopped. Existing family files were preserved."); process.exitCode = 1; }
