import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, FamilyWorkflowError, fileExists, readJson } from "./project-paths.mjs";
import { digest, jsonText } from "./family-crypto.mjs";

export const artifactTargets = (paths) => ({
  canonical: paths.canonical, encrypted: paths.encrypted, catalog: paths.catalog,
  allowlist: paths.allowlist, revision: paths.revision
});
const finalStates = new Set(["committed", "rolled-back", "aborted"]);
const journalStates = new Set([...finalStates, "preparing", "prepared", "replacing", "recovery-required"]);
export const validOperationId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(id);

async function durableWrite(file, content, flag = "w") {
  const handle = await open(file, flag, 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
}

async function writeJournal(directory, journal) {
  const temporary = path.join(directory, "journal-" + randomUUID() + ".tmp");
  await durableWrite(temporary, jsonText(journal), "wx");
  await rename(temporary, path.join(directory, "journal.json"));
}

export async function withWriterLock(paths, work) {
  await assertSafePath(paths.root, paths.privateDir);
  await mkdir(paths.privateDir, { recursive: true, mode: 0o700 });
  await assertSafePath(paths.root, paths.lock);
  const owner = { pid: process.pid, token: randomUUID() };
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(paths.lock, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try { previous = await readJson(paths.lock); } catch { /* Uncertain locks are never removed. */ }
      if (!Number.isInteger(previous?.pid) || previous.pid < 1) throw new FamilyWorkflowError("WRITER_BUSY", "The writer lock needs local inspection.", 409);
      try { process.kill(previous.pid, 0); }
      catch (probe) {
        if (probe.code === "ESRCH" && attempt === 0) { await unlink(paths.lock); continue; }
      }
      throw new FamilyWorkflowError("WRITER_BUSY", "Another family operation is running. Try again after it finishes.", 409);
    }
  }
  if (!handle) throw new FamilyWorkflowError("WRITER_BUSY", "The writer lock could not be acquired.", 409);
  try {
    await handle.writeFile(jsonText(owner));
    await handle.sync();
    return await work();
  } finally {
    await handle.close();
    try { if ((await readJson(paths.lock)).token === owner.token) await unlink(paths.lock); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function readJournal(paths, directory) {
  await assertSafePath(paths.root, directory);
  const journal = await readJson(path.join(directory, "journal.json"));
  const allowed = artifactTargets(paths);
  if (journal.schemaVersion !== 1 || !validOperationId(journal.operationId)
    || !journalStates.has(journal.state) || !/^sha256:[a-f0-9]{64}$/.test(journal.requestDigest ?? "")
    || path.basename(directory) !== journal.operationId || !Array.isArray(journal.entries)
    || new Set(journal.entries.map(e => e.key)).size !== journal.entries.length
    || journal.entries.some(e => !Object.hasOwn(allowed, e.key) || typeof e.existed !== "boolean"
      || !/^sha256:[a-f0-9]{64}$/.test(e.after ?? "")
      || (e.existed && !/^sha256:[a-f0-9]{64}$/.test(e.before ?? "")))
    || (!["preparing", "aborted"].includes(journal.state) && journal.entries.length !== Object.keys(allowed).length)
    || (journal.state === "committed" && (journal.receipt?.ok !== true || journal.receipt.operationId !== journal.operationId))) {
    throw new FamilyWorkflowError("RECOVERY_REQUIRED", "An invalid recovery journal needs local inspection.", 503);
  }
  return journal;
}

export async function inspectTransactions(paths) {
  if (!await fileExists(paths.transactions)) return [];
  await assertSafePath(paths.root, paths.transactions);
  const found = [];
  for (const item of await readdir(paths.transactions, { withFileTypes: true })) {
    if (!item.isDirectory() || !validOperationId(item.name)) {
      throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Unexpected recovery storage needs local inspection.", 503);
    }
    const directory = path.join(paths.transactions, item.name);
    const journal = await readJournal(paths, directory);
    found.push({ directory, journal });
  }
  return found;
}

async function restoreTransaction(paths, directory, journal, fault = async () => {}) {
  const targets = artifactTargets(paths);
  const recovery = [];
  // Verify the entire recovery set before replacing anything. Unknown current
  // bytes may be a manual rescue edit; keep them for an explicit local decision.
  for (const entry of journal.entries) {
    const target = await assertSafePath(paths.root, targets[entry.key]);
    let before;
    if (entry.existed) {
      const beforeFile = await assertSafePath(paths.root, path.join(directory, entry.key + ".before"));
      before = await readFile(beforeFile);
      if (digest(before) !== entry.before) throw new Error("Recovery snapshot verification failed.");
    }
    const exists = await fileExists(target);
    if (exists) {
      const current = digest(await readFile(target));
      if (current !== entry.after && (!entry.existed || current !== entry.before)) {
        throw new FamilyWorkflowError("RECOVERY_REQUIRED", "A file changed outside the interrupted operation. Preserve it and review the recovery copies.", 503);
      }
    }
    recovery.push({ entry, target, before, exists });
  }
  for (const { entry, target, before, exists } of recovery) {
    await fault("rollback:" + entry.key);
    if (entry.existed) {
      const temporary = target + ".restore-" + randomUUID();
      await durableWrite(temporary, before, "wx");
      await rename(temporary, target);
      if (digest(await readFile(target)) !== entry.before) throw new Error("Restoration verification failed.");
    } else if (exists) { await unlink(target); }
  }
  journal.state = "rolled-back";
  await writeJournal(directory, journal);
}

export async function recoverTransactions(paths) {
  return withWriterLock(paths, async () => {
    const results = [];
    for (const { directory, journal } of await inspectTransactions(paths)) {
      if (finalStates.has(journal.state)) continue;
      try {
        if (journal.state === "preparing") {
          journal.state = "aborted";
          await writeJournal(directory, journal);
        } else { await restoreTransaction(paths, directory, journal); }
        results.push({ operationId: journal.operationId, state: journal.state });
      } catch {
        journal.state = "recovery-required";
        await writeJournal(directory, journal);
        throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Recovery could not be verified. Writes remain disabled.", 503);
      }
    }
    return results;
  });
}

export async function operationReceipt(paths, operationId) {
  if (!validOperationId(operationId)) throw new FamilyWorkflowError("INVALID_OPERATION", "Invalid operation identifier.");
  const directory = path.join(paths.transactions, operationId);
  if (!await fileExists(directory)) return null;
  const journal = await readJournal(paths, directory);
  return { state: journal.state, requestDigest: journal.requestDigest,
    result: journal.state === "committed" ? journal.receipt : null };
}

// Caller holds the writer lock. All file targets are fixed by artifact ID.
export async function commitArtifactSet(paths, contents, { operationId, requestDigest, receipt, fault = async () => {} }) {
  if (!validOperationId(operationId)) throw new FamilyWorkflowError("INVALID_OPERATION", "Invalid operation identifier.");
  const targets = artifactTargets(paths);
  if (Object.keys(contents).sort().join() !== Object.keys(targets).sort().join()) throw new Error("Incomplete artifact set.");
  for (const { journal } of await inspectTransactions(paths)) {
    if (!finalStates.has(journal.state)) throw new FamilyWorkflowError("RECOVERY_REQUIRED", "An interrupted operation must be recovered first.", 503);
  }
  const previous = await operationReceipt(paths, operationId);
  if (previous) {
    if (previous.state === "committed" && previous.requestDigest === requestDigest) return previous.result;
    throw new FamilyWorkflowError("OPERATION_CONFLICT", "Use a new identifier for this operation.", 409);
  }
  await assertSafePath(paths.root, paths.transactions);
  await mkdir(paths.transactions, { recursive: true, mode: 0o700 });
  const directory = path.join(paths.transactions, operationId);
  await mkdir(directory, { mode: 0o700 });
  const journal = { schemaVersion: 1, operationId, requestDigest, state: "preparing", entries: [], receipt };
  await writeJournal(directory, journal);
  try {
    for (const [key, target] of Object.entries(targets)) {
      await assertSafePath(paths.root, target);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const existed = await fileExists(target);
      const before = existed ? await readFile(target) : null;
      if (existed) {
        await durableWrite(path.join(directory, key + ".before"), before, "wx");
        if (digest(await readFile(path.join(directory, key + ".before"))) !== digest(before)) throw new Error("Backup verification failed.");
      }
      await durableWrite(path.join(directory, key + ".next"), contents[key], "wx");
      journal.entries.push({ key, existed, before: existed ? digest(before) : null, after: digest(contents[key]) });
      await fault("stage:" + key);
    }
    journal.state = "prepared";
    await writeJournal(directory, journal);
    await fault("prepared");
    journal.state = "replacing";
    await writeJournal(directory, journal);
    for (const entry of journal.entries) {
      await fault("before:" + entry.key);
      await rename(path.join(directory, entry.key + ".next"), targets[entry.key]);
      await fault("after:" + entry.key);
    }
    for (const entry of journal.entries) {
      if (digest(await readFile(targets[entry.key])) !== entry.after) throw new Error("Commit verification failed.");
    }
    await fault("verify");
    journal.state = "committed";
    await writeJournal(directory, journal);
    return receipt;
  } catch (error) {
    if (journal.state === "preparing") {
      journal.state = "aborted";
      await writeJournal(directory, journal);
    } else {
      try { await restoreTransaction(paths, directory, journal, fault); }
      catch {
        journal.state = "recovery-required";
        await writeJournal(directory, journal);
        throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Restoration needs local inspection. Further writes are blocked.", 503);
      }
    }
    throw new FamilyWorkflowError("SAVE_FAILED", "The operation failed. The previous family files were preserved.", 500);
  }
}
