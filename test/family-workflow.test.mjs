import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import { decryptFamily, encryptFamily, familyRevision, validateEncryptedPayload } from "../scripts/lib/family-crypto.mjs";
import { validateGeneratedArtifacts } from "../scripts/validate-public-build.mjs";
import { recoverTransactions } from "../scripts/lib/file-transaction.mjs";
import { createProject, hashes, PASSWORD, fixture } from "./helpers/project.mjs";

async function saveRequest(workflow, nodes, extra = {}) {
  const snapshot = await workflow.snapshot();
  return { nodes, password: PASSWORD, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: randomUUID(), ...extra };
}

test("save commits five corresponding outputs, supports idempotent retry and detects display-only stale edits", async t => {
  const { paths, nodes } = await createProject(t);
  const workflow = createFamilyWorkflow(paths);
  const changed = structuredClone(nodes);
  changed[0].data["first name"] += " Edited";
  const request = await saveRequest(workflow, changed);
  const stale = { ...request, operationId: randomUUID(), nodes };
  const result = await workflow.save(request);
  assert.equal(result.ok, true);
  assert.equal(result.privateRevision, familyRevision(changed));
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(paths.encrypted)), PASSWORD), changed);
  validateGeneratedArtifacts(...await Promise.all([paths.catalog, paths.allowlist, paths.revision].map(async file => JSON.parse(await readFile(file)))));
  assert.deepEqual(await workflow.save(request), result);
  await assert.rejects(workflow.save(stale), { code: "STALE_SNAPSHOT" });
  assert.equal((await workflow.receipt(request.operationId)).state, "committed");
});

test("wrong credentials and invalid candidates preserve every output", async t => {
  const { paths, nodes } = await createProject(t);
  const workflow = createFamilyWorkflow(paths);
  const before = await hashes(paths);
  await assert.rejects(workflow.save(await saveRequest(workflow, nodes, { password: "incorrect" })), { code: "UNLOCK_FAILED" });
  await assert.rejects(workflow.save(await saveRequest(workflow, await fixture("invalid-ancestry-cycle.json"))), { code: "INVALID_FAMILY" });
  assert.deepEqual(await hashes(paths), before);
});

test("publication approval binds to the exact candidate and supports expiry", async t => {
  const { paths, nodes } = await createProject(t);
  let clock = 100;
  const workflow = createFamilyWorkflow(paths, { now: () => clock, approvalLifetimeMs: 20 });
  const changed = structuredClone(nodes);
  changed[0].privacy.publicLabel = "New deliberately reviewed label";
  const request = await saveRequest(workflow, changed);
  const before = await hashes(paths);
  const review = await workflow.save(request);
  assert.equal(review.code, "PUBLICATION_REVIEW");
  assert.deepEqual(await hashes(paths), before);
  const other = structuredClone(changed);
  other[0].data.birthday = "A different candidate";
  const mismatched = await workflow.save({ ...request, nodes: other, publicationApprovalToken: review.approvalToken });
  assert.equal(mismatched.code, "PUBLICATION_REVIEW");
  clock += 21;
  const expired = await workflow.save({ ...request, publicationApprovalToken: review.approvalToken });
  assert.equal(expired.code, "PUBLICATION_REVIEW");
  assert.equal((await workflow.save({ ...request, publicationApprovalToken: expired.approvalToken })).ok, true);
});

test("Node and Web Crypto share the existing format and reject corruption", async () => {
  const nodes = await fixture("valid-simple.json");
  nodes[0].data["first name"] = "Fictional čćžšđ <text>";
  const payload = await encryptFamily(nodes, PASSWORD, { iterations: 100000 });
  const subtle = webcrypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode(PASSWORD), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt: Buffer.from(payload.salt, "base64"), iterations: payload.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const decoded = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(payload.iv, "base64") }, key, Buffer.from(payload.ciphertext, "base64"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decoded)), nodes);
  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv: Buffer.from(payload.iv, "base64") }, key, new TextEncoder().encode(JSON.stringify(nodes)));
  assert.deepEqual(await decryptFamily({ ...payload, ciphertext: Buffer.from(encrypted).toString("base64") }, PASSWORD), nodes);
  await assert.rejects(decryptFamily(payload, "wrong"), { code: "UNLOCK_FAILED" });
  assert.throws(() => validateEncryptedPayload({ ...payload, iv: "invalid" }), { code: "INVALID_ENVELOPE" });
  const corrupt = Buffer.from(payload.ciphertext, "base64"); corrupt[0] ^= 1;
  await assert.rejects(decryptFamily({ ...payload, ciphertext: corrupt.toString("base64") }, PASSWORD), { code: "UNLOCK_FAILED" });
});

for (const point of ["stage:canonical", "prepared", "before:canonical", "after:canonical", "after:encrypted", "after:catalog", "after:allowlist", "after:revision", "verify"]) {
  test("failure at " + point + " preserves the complete old artifact set", async t => {
    const { paths, nodes } = await createProject(t);
    const before = await hashes(paths);
    const workflow = createFamilyWorkflow(paths, { fault: async value => { if (value === point) throw new Error("Injected fictional failure"); } });
    const changed = structuredClone(nodes); changed[0].data.birthday = "changed";
    await assert.rejects(workflow.save(await saveRequest(workflow, changed)), { code: "SAVE_FAILED" });
    assert.deepEqual(await hashes(paths), before);
  });
}

test("failed rollback blocks writes and restart recovery restores the coherent snapshot", async t => {
  const { paths, nodes } = await createProject(t);
  const before = await hashes(paths);
  const workflow = createFamilyWorkflow(paths, { fault: async point => {
    if (point === "after:encrypted" || point === "rollback:canonical") throw new Error("Injected failure");
  } });
  const changed = structuredClone(nodes); changed[0].data.birthday = "changed";
  await assert.rejects(workflow.save(await saveRequest(workflow, changed)), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(createFamilyWorkflow(paths).snapshot(), { code: "RECOVERY_REQUIRED" });
  assert.equal((await recoverTransactions(paths)).length, 1);
  assert.deepEqual(await hashes(paths), before);
});
