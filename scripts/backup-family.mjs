import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs, projectPaths, assertSafePath, readJson, FamilyWorkflowError } from "./lib/project-paths.mjs";
import { withWriterLock } from "./lib/file-transaction.mjs";
import { readFamilySnapshot } from "./lib/family-workflow.mjs";
import { decryptFamily, encryptFamily, familyRevision, jsonText, digest } from "./lib/family-crypto.mjs";

const options = parseArgs(process.argv.slice(2));
try {
  const paths = projectPaths(options.root);
  const password = process.env.FAMILY_TREE_PASSWORD;
  if (!password) throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Supply the backup password locally through FAMILY_TREE_PASSWORD.");
  const result = await withWriterLock(paths, async () => {
    const snapshot = await readFamilySnapshot(paths);
    const envelope = await encryptFamily(snapshot.nodes, password);
    await assertSafePath(paths.root, paths.backups);
    await mkdir(paths.backups, { recursive: true, mode: 0o700 });
    const file = path.join(paths.backups, "family-" + randomUUID() + ".enc.json");
    await writeFile(file, jsonText(envelope), { flag: "wx", mode: 0o600 });
    if (familyRevision(await decryptFamily(await readJson(file), password)) !== snapshot.privateRevision) throw new Error("Backup verification failed.");
    return { backup: path.relative(paths.root, file).replaceAll("\\", "/"), digest: digest(await readFile(file)), decryption: "verified" };
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.code ?? "BACKUP_FAILED", "Backup could not be verified. Existing files were preserved."); process.exitCode = 1; }
