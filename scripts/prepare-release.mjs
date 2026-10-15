import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectPaths, parseArgs, assertSafePath, fileExists } from "./lib/project-paths.mjs";
import { buildSite } from "./lib/publication.mjs";
import { withWriterLock } from "./lib/file-transaction.mjs";
import { releaseInventory } from "./lib/release.mjs";
import { digest, jsonText } from "./lib/family-crypto.mjs";
import { validateProject } from "./validate-public-build.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const paths = projectPaths(options.root);
  // Fail before building if the private source/password is unavailable or stale.
  await validateProject({ root: paths.root, requirePassword: true });
  await buildSite(paths, { environment: "production" });
  const receipt = await withWriterLock(paths, async () => {
    await validateProject({ root: paths.root, outputDirectory: paths.dist, requirePassword: true });
    const inventory = await releaseInventory(paths);
    const value = { schemaVersion: 1, environment: "production", decryption: "verified",
      siteDigest: digest(JSON.stringify(inventory)), files: inventory.length };
    const target = await assertSafePath(paths.root, path.join(paths.root, "config/publication.json"));
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = await assertSafePath(paths.root, path.join(paths.privateDir, "release-" + randomUUID() + ".tmp"));
    try { await writeFile(temporary, jsonText(value), { flag: "wx", mode: 0o600 }); await rename(temporary, target); }
    finally { if (await fileExists(temporary)) await unlink(temporary); }
    return value;
  });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) { console.error(error.code ?? "RELEASE_FAILED", "Release stopped. Prepare and verify the local family files before publishing."); process.exitCode = 1; }
