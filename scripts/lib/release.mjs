import path from "node:path";
import { readFile } from "node:fs/promises";
import { digest } from "./family-crypto.mjs";
import { PUBLIC_OUTPUT_FILES } from "./publication.mjs";
import { assertSafePath, readJson, FamilyWorkflowError } from "./project-paths.mjs";

export async function releaseInventory(paths) {
  const inventory = [];
  for (const relative of [...PUBLIC_OUTPUT_FILES].sort()) {
    const file = await assertSafePath(paths.root, path.join(paths.dist, relative));
    const content = await readFile(file);
    inventory.push({ path: relative, bytes: content.length, digest: digest(content) });
  }
  return inventory;
}

export async function verifyRelease(paths) {
  let receipt;
  try { receipt = await readJson(path.join(paths.root, "config/publication.json")); }
  catch { throw new FamilyWorkflowError("RELEASE_NOT_PREPARED", "Run release:prepare locally with the family password before publishing this edition."); }
  const inventory = await releaseInventory(paths);
  if (receipt.schemaVersion !== 1 || receipt.decryption !== "verified" || receipt.environment !== "production"
    || receipt.siteDigest !== digest(JSON.stringify(inventory))) {
    throw new FamilyWorkflowError("RELEASE_CHANGED", "The public output changed since its local decryption check. Prepare the release again.");
  }
  return { publication: "matches-locally-verified-release", siteDigest: receipt.siteDigest, files: inventory.length };
}
