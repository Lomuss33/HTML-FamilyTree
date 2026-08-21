import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPublicAnchorArtifacts } from "../scripts/generate-public-anchors.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "family");

test("generates a minimal public catalog and matching backend allowlist", async () => {
  const family = await fixture("valid-public-anchor.json");
  const { catalog, allowlist, revision } = buildPublicAnchorArtifacts(family);

  assert.equal(catalog.schemaVersion, 1);
  assert.match(catalog.catalogVersion, /^sha256:[a-f0-9]{64}$/);
  assert.match(catalog.sourceRevision, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(catalog.anchors, [{
    id: "approved-anchor",
    displayLabel: "Reviewed Public Label",
    lifespanLabel: "1901–1999",
    branchLabel: "Example branch"
  }]);
  assert.deepEqual(allowlist, {
    catalogVersion: catalog.catalogVersion,
    anchorIds: ["approved-anchor"]
  });
  assert.deepEqual(revision, {
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    sourceRevision: catalog.sourceRevision
  });
});

test("never copies private person fields, relationships, avatars, or unapproved people", async () => {
  const family = await fixture("valid-public-anchor.json");
  const serialized = JSON.stringify(buildPublicAnchorArtifacts(family).catalog);

  for (const forbidden of [
    "PrivateOnlyFirst",
    "PrivateOnlyLast",
    "1901-02-03",
    "private.invalid",
    "private note",
    "NeverPublic",
    "parents",
    "children",
    "spouses",
    "avatar",
    "gender"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public output leaked ${forbidden}`);
  }
});

test("omits empty optional reviewed labels", async () => {
  const family = await fixture("valid-simple.json");
  family[0].privacy = {
    publicAnchor: true,
    publicLabel: "  Reviewed anchor  ",
    publicLifespan: "  ",
    publicBranchLabel: ""
  };
  const { catalog } = buildPublicAnchorArtifacts(family);
  assert.deepEqual(catalog.anchors, [{ id: "parent", displayLabel: "Reviewed anchor" }]);
});

test("catalog ordering and version are deterministic", async () => {
  const family = await fixture("valid-spouses.json");
  family[0].privacy = { publicAnchor: true, publicLabel: "A" };
  family[1].privacy = { publicAnchor: true, publicLabel: "B" };

  const first = buildPublicAnchorArtifacts(family);
  const reordered = [family[1], family[0]];
  reordered[0].data.birthday = "private change";
  const second = buildPublicAnchorArtifacts(reordered);

  assert.equal(first.catalog.catalogVersion, second.catalog.catalogVersion);
  assert.deepEqual(first.catalog.anchors.map((anchor) => anchor.id), ["spouse-a", "spouse-b"]);

  reordered[0].privacy.publicLabel = "Changed reviewed label";
  const changed = buildPublicAnchorArtifacts(reordered);
  assert.notEqual(changed.catalog.catalogVersion, first.catalog.catalogVersion);
});

test("rejects an opted-in anchor without a reviewed public label", async () => {
  const family = await fixture("invalid-public-anchor-label.json");
  assert.throws(() => buildPublicAnchorArtifacts(family), /privacy\.publicLabel is missing or empty/);
});

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
}
