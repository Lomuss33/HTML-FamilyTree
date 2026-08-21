import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { saveFamilyFiles } from "../scripts/local-server.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const fixturesDir = path.join(testDir, "fixtures", "family");
const encryptScript = path.join(repoRoot, "scripts", "encrypt-family.mjs");

test("encryption refuses invalid canonical data without replacing existing output", async () => {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), "family-encrypt-test-"));
  const inputPath = path.join(fixturesDir, "invalid-ancestry-cycle.json");
  const outputPath = path.join(temporaryDir, "family.enc.json");
  await writeFile(outputPath, "existing encrypted output\n", "utf8");

  const result = spawnSync(process.execPath, [
    encryptScript,
    "--input", inputPath,
    "--output", outputPath,
    "--password", "fictional-test-password"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Ancestry cycle detected/);
  assert.equal(await readFile(outputPath, "utf8"), "existing encrypted output\n");
});

test("local save refuses invalid canonical data before replacing either file", async () => {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), "family-save-test-"));
  const privatePath = path.join(temporaryDir, "family.private.json");
  const encryptedPath = path.join(temporaryDir, "family.enc.json");
  await writeFile(privatePath, "existing private output\n", "utf8");
  await writeFile(encryptedPath, "existing encrypted output\n", "utf8");

  const invalidPrivateJson = await readFile(
    path.join(fixturesDir, "invalid-parent-reciprocity.json"),
    "utf8"
  );

  await assert.rejects(
    saveFamilyFiles({
      privateJson: invalidPrivateJson,
      encryptedJson: JSON.stringify(validEncryptedPayload()),
      privatePath,
      encryptedPath
    }),
    /Parent\/child mismatch/
  );

  assert.equal(await readFile(privatePath, "utf8"), "existing private output\n");
  assert.equal(await readFile(encryptedPath, "utf8"), "existing encrypted output\n");
});

test("local save preserves the successful two-file workflow for valid data", async () => {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), "family-save-valid-test-"));
  const privatePath = path.join(temporaryDir, "family.private.json");
  const encryptedPath = path.join(temporaryDir, "family.enc.json");
  const privateJson = await readFile(path.join(fixturesDir, "valid-simple.json"), "utf8");
  const encryptedJson = `${JSON.stringify(validEncryptedPayload(), null, 2)}\n`;

  await saveFamilyFiles({ privateJson, encryptedJson, privatePath, encryptedPath });

  assert.equal(await readFile(privatePath, "utf8"), privateJson);
  assert.equal(await readFile(encryptedPath, "utf8"), encryptedJson);
});

function validEncryptedPayload() {
  return {
    version: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: 250000,
    salt: "fictional-salt",
    iv: "fictional-iv",
    ciphertext: "fictional-ciphertext"
  };
}
