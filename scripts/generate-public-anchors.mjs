import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareStrings,
  computeAnchorCatalogVersion,
  computeCanonicalSourceRevision,
  validateFamilyData
} from "./validate-family-data.mjs";

export const PUBLIC_CATALOG_SCHEMA_VERSION = 1;

export function buildPublicAnchorArtifacts(family, options = {}) {
  validateFamilyData(family, options);

  const anchors = family
    .filter((person) => person.privacy?.publicAnchor === true)
    .map((person) => buildPublicAnchor(person))
    .sort((left, right) => compareStrings(left.id, right.id));

  const anchorIds = anchors.map((anchor) => anchor.id);
  if (new Set(anchorIds).size !== anchorIds.length) {
    throw new Error("Public anchor generation produced duplicate canonical ids.");
  }

  const catalogVersion = computeAnchorCatalogVersion(anchors);
  const sourceRevision = computeCanonicalSourceRevision(family, options);

  return {
    catalog: {
      schemaVersion: PUBLIC_CATALOG_SCHEMA_VERSION,
      catalogVersion,
      sourceRevision,
      anchors
    },
    allowlist: {
      catalogVersion,
      anchorIds
    },
    revision: {
      schemaVersion: PUBLIC_CATALOG_SCHEMA_VERSION,
      catalogVersion,
      sourceRevision
    }
  };
}

export async function generatePublicAnchorFiles({
  inputPath = "data/family.private.json",
  catalogOutputPath = "data/family.anchors.public.json",
  allowlistOutputPath = "api/generated/public-anchor-allowlist.json",
  revisionOutputPath = "api/generated/canonical-revision.json",
  mainPersonId
} = {}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedCatalogOutput = path.resolve(catalogOutputPath);
  const resolvedAllowlistOutput = path.resolve(allowlistOutputPath);
  const resolvedRevisionOutput = path.resolve(revisionOutputPath);
  const family = JSON.parse(await readFile(resolvedInput, "utf8"));
  const artifacts = buildPublicAnchorArtifacts(family, { mainPersonId });

  await writeJsonPairFailBeforeReplace([
    [resolvedCatalogOutput, artifacts.catalog],
    [resolvedAllowlistOutput, artifacts.allowlist],
    [resolvedRevisionOutput, artifacts.revision]
  ]);

  return {
    ...artifacts,
    inputPath: resolvedInput,
    catalogOutputPath: resolvedCatalogOutput,
    allowlistOutputPath: resolvedAllowlistOutput,
    revisionOutputPath: resolvedRevisionOutput
  };
}

function buildPublicAnchor(person) {
  const privacy = person.privacy;
  const displayLabel = privacy.publicLabel.trim();
  if (!displayLabel) {
    throw new Error(`Public anchor "${person.id}" requires a reviewed privacy.publicLabel.`);
  }

  const anchor = {
    id: person.id,
    displayLabel
  };
  addOptionalReviewedLabel(anchor, "lifespanLabel", privacy.publicLifespan);
  addOptionalReviewedLabel(anchor, "branchLabel", privacy.publicBranchLabel);
  return anchor;
}

function addOptionalReviewedLabel(target, key, value) {
  if (typeof value !== "string") return;
  const cleaned = value.trim();
  if (cleaned) target[key] = cleaned;
}

async function writeJsonPairFailBeforeReplace(entries) {
  const temporaryFiles = [];
  try {
    for (const [targetPath, value] of entries) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.${randomUUID()}.tmp`
      );
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      temporaryFiles.push([temporaryPath, targetPath]);
    }

    for (const [temporaryPath, targetPath] of temporaryFiles) {
      await rename(temporaryPath, targetPath);
    }
  } finally {
    await Promise.all(temporaryFiles.map(([temporaryPath]) => rm(temporaryPath, { force: true })));
  }
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await generatePublicAnchorFiles({
      inputPath: options.input,
      catalogOutputPath: options["catalog-output"],
      allowlistOutputPath: options["allowlist-output"],
      revisionOutputPath: options["revision-output"],
      mainPersonId: options["main-person-id"]
    });
    console.log(`Generated ${result.catalog.anchors.length} public anchor${result.catalog.anchors.length === 1 ? "" : "s"}.`);
    console.log(`Catalog version: ${result.catalog.catalogVersion}`);
    console.log(`Source revision: ${result.catalog.sourceRevision}`);
    console.log(`Public catalog: ${result.catalogOutputPath}`);
    console.log(`Backend allowlist: ${result.allowlistOutputPath}`);
    console.log(`Backend canonical revision: ${result.revisionOutputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
