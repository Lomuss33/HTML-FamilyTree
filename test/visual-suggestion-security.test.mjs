import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const visualModulePaths = [
  "assets/suggestions/draft-model.js",
  "assets/suggestions/graph-adapter.js",
  "assets/suggestions/public-anchor-catalog.js",
  "assets/suggestions/visual-editor.js",
  "assets/suggestions/submission-api.js"
];

test("visual suggestion modules cannot access protected data, passwords, or canonical save APIs", async () => {
  const source = (await Promise.all(visualModulePaths.map((filePath) => (
    readFile(path.join(repoRoot, filePath), "utf8")
  )))).join("\n");

  for (const forbidden of [
    "family.private.json",
    "family.enc.json",
    "/api/save",
    "currentPassword",
    "familyPassword",
    "localStorage",
    "sessionStorage"
  ]) {
    assert.equal(source.includes(forbidden), false, `visual modules contain forbidden capability: ${forbidden}`);
  }
});

test("access code is confined to the submission boundary and never enters the draft model", async () => {
  const draftSources = (await Promise.all([
    "assets/suggestions/draft-model.js",
    "assets/suggestions/graph-adapter.js",
    "assets/suggestions/public-anchor-catalog.js"
  ].map((filePath) => readFile(path.join(repoRoot, filePath), "utf8")))).join("\n");
  assert.doesNotMatch(draftSources, /accessCode|submissionAccessCode/);

  const submissionSource = await readFile(
    path.join(repoRoot, "assets/suggestions/submission-api.js"),
    "utf8"
  );
  assert.match(submissionSource, /accessCode/);
  assert.doesNotMatch(submissionSource, /localStorage|sessionStorage/);
});

test("visual catalog loader uses only the generated public anchor path", async () => {
  const source = await readFile(
    path.join(repoRoot, "assets/suggestions/visual-editor.js"),
    "utf8"
  );
  assert.match(source, /\.\/data\/family\.anchors\.public\.json/);
});
