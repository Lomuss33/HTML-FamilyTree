import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPublicAnchorArtifacts } from "../scripts/generate-public-anchors.mjs";
import {
  validateGeneratedArtifacts,
  validatePublicRuntimeConfig
} from "../scripts/validate-public-build.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "family");

test("accepts matching structurally minimal generated artifacts", async () => {
  const artifacts = buildPublicAnchorArtifacts(await fixture("valid-public-anchor.json"));
  const result = validateGeneratedArtifacts(artifacts.catalog, artifacts.allowlist);
  assert.equal(result.anchorCount, 1);
  assert.equal(result.catalogVersion, artifacts.catalog.catalogVersion);
});

test("rejects catalog fields that could expose canonical person structures", async () => {
  const artifacts = buildPublicAnchorArtifacts(await fixture("valid-public-anchor.json"));
  artifacts.catalog.anchors[0].data = { birthday: "private" };
  artifacts.catalog.anchors[0].rels = { parents: [] };
  assert.throws(
    () => validateGeneratedArtifacts(artifacts.catalog, artifacts.allowlist),
    /forbidden field "data"/
  );
});

test("rejects catalog/backend version mismatch", async () => {
  const artifacts = buildPublicAnchorArtifacts(await fixture("valid-public-anchor.json"));
  artifacts.allowlist.catalogVersion = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => validateGeneratedArtifacts(artifacts.catalog, artifacts.allowlist),
    /catalogVersion values do not match/
  );
});

test("rejects catalog content changed without a new deterministic version", async () => {
  const artifacts = buildPublicAnchorArtifacts(await fixture("valid-public-anchor.json"));
  artifacts.catalog.anchors[0].displayLabel = "Changed reviewed label";
  assert.throws(
    () => validateGeneratedArtifacts(artifacts.catalog, artifacts.allowlist),
    /catalogVersion does not match its normalized anchor content/
  );
});

test("rejects catalog/backend id mismatch", async () => {
  const artifacts = buildPublicAnchorArtifacts(await fixture("valid-public-anchor.json"));
  artifacts.allowlist.anchorIds = ["different-anchor"];
  assert.throws(
    () => validateGeneratedArtifacts(artifacts.catalog, artifacts.allowlist),
    /anchor ids do not exactly match/
  );
});

test("rejects secret-bearing public runtime configuration properties", () => {
  assert.doesNotThrow(() => validatePublicRuntimeConfig(
    "window.FAMILY_TREE_CONFIG = { suggestionsApiUrl: 'https://example.invalid' };"
  ));
  assert.throws(
    () => validatePublicRuntimeConfig("window.FAMILY_TREE_CONFIG = { accessCode: 'not-public' }"),
    /forbidden secret-bearing/
  );
  assert.throws(
    () => validatePublicRuntimeConfig("window.FAMILY_TREE_CONFIG = { familyPassword: 'not-public' }"),
    /forbidden secret-bearing/
  );
});

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
}
