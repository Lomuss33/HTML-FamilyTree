import os from "node:os";
import path from "node:path";
import { projectPaths, assertContained } from "../../scripts/lib/project-paths.mjs";
import { createFamilyWorkflow } from "../../scripts/lib/family-workflow.mjs";
import { PASSWORD } from "./project.mjs";

const [root, stopAt] = process.argv.slice(2);
assertContained(os.tmpdir(), root);
if (!path.basename(root).startsWith("family-repair-")
  || !["prepared", "after:canonical", "after:encrypted", "after:catalog", "after:allowlist", "after:revision"].includes(stopAt)) {
  throw new Error("Interrupted-save tests require an isolated fictional project.");
}
const workflow = createFamilyWorkflow(projectPaths(root), { fault: async point => {
  // Exit the process, bypassing rollback and lock cleanup, to exercise restart recovery.
  if (point === stopAt) process.exit(86);
} });
const snapshot = await workflow.snapshot();
snapshot.nodes[0].data.birthday = "Fictional interrupted update";
await workflow.save({ nodes: snapshot.nodes, password: PASSWORD, expectedRevision: snapshot.privateRevision,
  snapshotId: snapshot.snapshotId, operationId: "fictional-interrupted-save" });
throw new Error("The requested interruption was not reached.");
