import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateFamilyData, stableStringify } from "../validate-family-data.mjs";
import { buildPublicAnchorArtifacts } from "../generate-public-anchors.mjs";
import { FamilyWorkflowError, canonicalPath, fileExists, readJson, assertSafePath } from "./project-paths.mjs";
import { decryptFamily, digest, encryptFamily, familyRevision, jsonText, validateEncryptedPayload } from "./family-crypto.mjs";
import { artifactTargets, commitArtifactSet, inspectTransactions, operationReceipt, validOperationId, withWriterLock } from "./file-transaction.mjs";
import { normalizeLegacyFamily } from "./migrate-family.mjs";
import { encryptedPayloadDigest } from "./public-bytes.mjs";

export function publicationDiff(before, after) {
  const old = new Map((before?.anchors ?? []).map(value => [value.id, value]));
  const next = new Map(after.anchors.map(value => [value.id, value]));
  return {
    added: after.anchors.filter(value => !old.has(value.id)),
    removed: [...old.values()].filter(value => !next.has(value.id)),
    changed: after.anchors.filter(value => old.has(value.id) && stableStringify(value) !== stableStringify(old.get(value.id)))
      .map(value => ({ before: old.get(value.id), after: value }))
  };
}

const changedPublication = (diff) => diff.added.length + diff.removed.length + diff.changed.length > 0;

async function assertNoInterruptedTransaction(paths) {
  for (const { journal } of await inspectTransactions(paths)) {
    if (!["committed", "rolled-back", "aborted"].includes(journal.state)) {
      throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Run the local recovery command before making further changes.", 503);
    }
  }
}

export async function readFamilySnapshot(paths) {
  await assertNoInterruptedTransaction(paths);
  const source = await canonicalPath(paths);
  if (source !== paths.canonical) throw new FamilyWorkflowError("MIGRATION_REQUIRED", "Run the reviewed family migration before editing.", 409);
  const nodes = await readJson(source);
  validateFamilyData(nodes);
  for (const file of Object.values(artifactTargets(paths))) await assertSafePath(paths.root, file);
  const encryptedText = await readFile(paths.encrypted, "utf8");
  validateEncryptedPayload(JSON.parse(encryptedText));
  const privateRevision = familyRevision(nodes);
  const payloadDigest = encryptedPayloadDigest(encryptedText);
  return { nodes, privateRevision, payloadDigest, snapshotId: digest(privateRevision + "\n" + payloadDigest) };
}

async function verifySnapshotPassword(paths, snapshot, password, { allowManualSource = false } = {}) {
  const decrypted = normalizeLegacyFamily(await decryptFamily(await readJson(paths.encrypted), password)).nodes;
  if (familyRevision(decrypted) === snapshot.privateRevision) return;
  const migrationFile = path.join(paths.privateDir, "migration-receipt.json");
  if (await fileExists(migrationFile)) {
    const migration = await readJson(migrationFile);
    if (migration.previousSemanticRevision === familyRevision(decrypted)
      && migration.privateRevision === snapshot.privateRevision
      && migration.payloadDigest === digest(await readFile(paths.encrypted))) return;
  }
  if (allowManualSource) return;
  throw new FamilyWorkflowError("SOURCE_DIVERGED", "The local source and encrypted tree differ. Review them with the preparation command before editing.", 409);
}

export function createFamilyWorkflow(paths, { fault, approvalLifetimeMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const approvals = new Map();
  return {
    snapshot: () => readFamilySnapshot(paths),
    async openSnapshot({ password, payloadDigest }) {
      const snapshot = await readFamilySnapshot(paths);
      if (snapshot.payloadDigest !== payloadDigest) throw new FamilyWorkflowError("STALE_SNAPSHOT", "The encrypted tree changed. Reload and unlock again.", 409);
      await verifySnapshotPassword(paths, snapshot, password);
      const actual = normalizeLegacyFamily(await decryptFamily(await readJson(paths.encrypted), password)).nodes;
      return { ...snapshot, needsPreparation: familyRevision(actual) !== snapshot.privateRevision };
    },
    receipt: (operationId) => operationReceipt(paths, operationId),
    async save(request) {
      const { nodes, password, newPassword, expectedRevision, snapshotId, operationId,
        publicationApprovalToken, operation = "save", approvePublication = false, dryRun = false, inputDigest = null } = request ?? {};
      if (!validOperationId(operationId)) throw new FamilyWorkflowError("INVALID_OPERATION", "A valid save operation identifier is required.");
      if (!["save", "prepare", "patch", "rotate", "initialize"].includes(operation)) throw new FamilyWorkflowError("INVALID_OPERATION", "Unsupported family operation.");
      if (typeof password !== "string" || !password || password.length > 1024) throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Enter the family password locally.");
      const candidate = structuredClone(nodes);
      try { validateFamilyData(candidate); } catch (error) {
        throw new FamilyWorkflowError("INVALID_FAMILY", "The tree contains invalid data or relationships.", 400, { issueCount: error.issues?.length ?? 1 });
      }
      if (Buffer.byteLength(jsonText(candidate)) > 1024 * 1024) throw new FamilyWorkflowError("PAYLOAD_TOO_LARGE", "The canonical tree exceeds the supported local size.", 413);
      if (inputDigest !== null && (operation !== "patch" || !/^sha256:[a-f0-9]{64}$/.test(inputDigest))) {
        throw new FamilyWorkflowError("INVALID_OPERATION", "Invalid patch fingerprint.");
      }
      const requestDigest = digest(stableStringify({ operation, nodes: candidate, expectedRevision, snapshotId, inputDigest }));
      return withWriterLock(paths, async () => {
        await assertNoInterruptedTransaction(paths);
        const prior = await operationReceipt(paths, operationId);
        if (prior) {
          if (prior.state === "committed" && prior.requestDigest === requestDigest) return prior.result;
          throw new FamilyWorkflowError("OPERATION_CONFLICT", "This operation identifier has already been used. Start a new save.", 409);
        }
        let current;
        const emptyInitialization = operation === "initialize" && expectedRevision === null && snapshotId === null;
        if (emptyInitialization) {
          for (const file of [...Object.values(artifactTargets(paths)), paths.legacy]) {
            await assertSafePath(paths.root, file);
            if (await fileExists(file)) throw new FamilyWorkflowError("SOURCE_CONFLICT", "An empty restore target must not contain existing family artifacts.", 409);
          }
          current = { privateRevision: null, snapshotId: null };
        } else current = await readFamilySnapshot(paths);
        if (expectedRevision !== current.privateRevision || snapshotId !== current.snapshotId) {
          throw new FamilyWorkflowError("STALE_SNAPSHOT", "The saved tree changed. Your draft has been kept.", 409);
        }
        if (operation !== "initialize") await verifySnapshotPassword(paths, current, password, { allowManualSource: operation === "prepare" || operation === "rotate" });
        const artifacts = buildPublicAnchorArtifacts(candidate);
        const previousCatalog = emptyInitialization ? { anchors: [] } : await readJson(paths.catalog);
        const diff = publicationDiff(previousCatalog, artifacts.catalog);
        const approvalDigest = digest(requestDigest + stableStringify(diff));
        for (const [token, entry] of approvals) if (entry.expires <= now()) approvals.delete(token);
        if (changedPublication(diff) && !approvePublication) {
          const approval = approvals.get(publicationApprovalToken);
          const received = Buffer.from(approval?.digest ?? "");
          const expected = Buffer.from(approvalDigest);
          if (!approval || received.length !== expected.length || !timingSafeEqual(received, expected)) {
            const token = randomUUID();
            approvals.set(token, { digest: approvalDigest, expires: now() + approvalLifetimeMs });
            return { ok: false, code: "PUBLICATION_REVIEW", operationId, publicationDiff: diff, approvalToken: token };
          }
        }
        if (dryRun) return { ok: true, dryRun: true, operationId, personCount: candidate.length,
          publicationChanged: changedPublication(diff), publicationDiff: diff, ...artifacts.revision };
        const currentEnvelope = emptyInitialization ? { iterations: 250000 } : await readJson(paths.encrypted);
        const encrypted = await encryptFamily(candidate, operation === "rotate" ? newPassword : password, { iterations: currentEnvelope.iterations });
        if (stableStringify(await decryptFamily(encrypted, operation === "rotate" ? newPassword : password)) !== stableStringify(candidate)) {
          throw new FamilyWorkflowError("ENCRYPTION_FAILED", "The prepared encryption could not be verified.", 500);
        }
        const encryptedText = jsonText(encrypted);
        const privateRevision = familyRevision(candidate);
        const payloadDigest = encryptedPayloadDigest(encryptedText);
        const receipt = { ok: true, operationId, personCount: candidate.length, privateRevision, payloadDigest,
          snapshotId: digest(privateRevision + "\n" + payloadDigest), ...artifacts.revision,
          publicAnchorCount: artifacts.catalog.anchors.length };
        if (inputDigest) receipt.inputDigest = inputDigest;
        const result = await commitArtifactSet(paths, {
          canonical: jsonText(candidate), encrypted: encryptedText, catalog: jsonText(artifacts.catalog),
          allowlist: jsonText(artifacts.allowlist), revision: jsonText(artifacts.revision)
        }, { operationId, requestDigest, receipt, fault });
        if (publicationApprovalToken) approvals.delete(publicationApprovalToken);
        return result;
      });
    }
  };
}
