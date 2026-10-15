import { mkdir, readFile, writeFile, rename, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateFamilyData, stableStringify } from "../validate-family-data.mjs";
import { assertSafePath, canonicalPath, FamilyWorkflowError, fileExists, readJson } from "./project-paths.mjs";
import { digest, jsonText, familyRevision } from "./family-crypto.mjs";
import { withWriterLock, inspectTransactions } from "./file-transaction.mjs";

export function normalizeLegacyFamily(family) {
  if (!Array.isArray(family)) throw new FamilyWorkflowError("INVALID_FAMILY", "The family source must be an array.");
  const candidate = structuredClone(family);
  const added = { parents: 0, children: 0, spouses: 0 };
  for (const node of candidate) {
    if (!node || !node.rels || typeof node.rels !== "object" || Array.isArray(node.rels)) {
      throw new FamilyWorkflowError("INVALID_FAMILY", "A person has a malformed relationship object.");
    }
    for (const key of Object.keys(added)) {
      if (!Object.hasOwn(node.rels, key)) { node.rels[key] = []; added[key]++; }
    }
  }
  validateFamilyData(candidate);
  return { nodes: candidate, added };
}

export function reconcileExistingAnchors(family, catalog) {
  const candidate = structuredClone(family);
  const byId = new Map(candidate.map(node => [node.id, node]));
  const seen = new Set();
  if (!Array.isArray(catalog?.anchors)) throw new FamilyWorkflowError("INVALID_CATALOG", "The public catalog is invalid.");
  for (const anchor of catalog.anchors) {
    const node = byId.get(anchor.id);
    if (!node || seen.has(anchor.id) || typeof anchor.displayLabel !== "string" || !anchor.displayLabel.trim()) {
      throw new FamilyWorkflowError("ANCHOR_CONFLICT", "The approved existing catalog does not match the canonical people.", 409);
    }
    seen.add(anchor.id);
    node.privacy = { ...node.privacy, publicAnchor: true, publicLabel: anchor.displayLabel,
      publicLifespan: anchor.lifespanLabel ?? "", publicBranchLabel: anchor.branchLabel ?? "" };
  }
  // Only already-approved entries are opted in by this explicit operation.
  for (const node of candidate) {
    if (!seen.has(node.id) && node.privacy?.publicAnchor === true) {
      throw new FamilyWorkflowError("ANCHOR_CONFLICT", "The source contains additional opt-ins. Review them separately.", 409);
    }
  }
  validateFamilyData(candidate);
  return candidate;
}

export async function captureBaseline(paths, label = "baseline") {
  await assertSafePath(paths.root, paths.backups);
  const directory = path.join(paths.backups, label + "-" + randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [paths.canonical, paths.legacy, paths.encrypted, paths.catalog, paths.allowlist, paths.revision];
  const inventory = [];
  for (const file of files) {
    if (!await fileExists(file)) continue;
    await assertSafePath(paths.root, file);
    const content = await readFile(file);
    const relative = path.relative(paths.root, file);
    const destination = path.join(directory, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(file, destination);
    if (digest(await readFile(destination)) !== digest(content)) throw new Error("Recovery copy verification failed.");
    inventory.push({ path: relative.replaceAll("\\", "/"), bytes: content.length, digest: digest(content) });
  }
  await writeFile(path.join(directory, "inventory.json"), jsonText({ schemaVersion: 1, files: inventory }), { mode: 0o600 });
  return { directory, fileCount: inventory.length };
}

export async function migrateFamily(paths, options = {}) {
  if (options.dryRun) return migrateUnlocked(paths, options);
  return withWriterLock(paths, async () => {
    if ((await inspectTransactions(paths)).some(({ journal }) => !["committed", "rolled-back", "aborted"].includes(journal.state))) {
      throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Recover the interrupted operation before migrating.", 503);
    }
    return migrateUnlocked(paths, options);
  });
}

async function migrateUnlocked(paths, { dryRun = false, keepExistingAnchors = false } = {}) {
  const source = await canonicalPath(paths);
  const originalText = await readFile(source, "utf8");
  const original = JSON.parse(originalText);
  const normalized = normalizeLegacyFamily(original);
  const nodes = keepExistingAnchors ? reconcileExistingAnchors(normalized.nodes, await readJson(paths.catalog)) : normalized.nodes;
  const summary = { personCount: nodes.length, addedArrays: normalized.added,
    publicAnchors: nodes.filter(node => node.privacy?.publicAnchor === true).length,
    sourceChanged: stableStringify(nodes) !== stableStringify(original), pathChanged: source !== paths.canonical, dryRun };
  if (dryRun || (!summary.sourceChanged && !summary.pathChanged)) return summary;
  const backup = await captureBaseline(paths, "migration");
  await assertSafePath(paths.root, paths.canonical);
  const receiptFile = await assertSafePath(paths.root, path.join(paths.privateDir, "migration-receipt.json"));
  const previousReceipt = await fileExists(receiptFile) ? await readFile(receiptFile) : null;
  const temporary = paths.canonical + "." + randomUUID() + ".tmp";
  const temporaryReceipt = receiptFile + "." + randomUUID() + ".tmp";
  let replaced = false;
  try {
    await writeFile(temporary, jsonText(nodes), { mode: 0o600, flag: "wx" });
    validateFamilyData(await readJson(temporary));
    await writeFile(temporaryReceipt, jsonText({
      schemaVersion: 1, previousSemanticRevision: familyRevision(normalized.nodes), privateRevision: familyRevision(nodes),
      payloadDigest: await fileExists(paths.encrypted) ? digest(await readFile(paths.encrypted)) : null
    }), { mode: 0o600, flag: "wx" });
    await rename(temporary, paths.canonical); replaced = true;
    if (stableStringify(await readJson(paths.canonical)) !== stableStringify(nodes)) throw new Error("Migration verification failed.");
    await rename(temporaryReceipt, receiptFile);
    if (source === paths.legacy) await unlink(paths.legacy);
  } catch (error) {
    if (replaced) {
      if (source === paths.canonical) await writeFile(paths.canonical, originalText, { mode: 0o600 });
      else if (await fileExists(paths.legacy) && await fileExists(paths.canonical)) await unlink(paths.canonical);
      if (previousReceipt) await writeFile(receiptFile, previousReceipt, { mode: 0o600 });
      else if (await fileExists(receiptFile)) await unlink(receiptFile);
    }
    throw error;
  } finally {
    for (const file of [temporary, temporaryReceipt]) if (await fileExists(file)) await unlink(file);
  }
  return { ...summary, backupCreated: backup.fileCount > 0 };
}
