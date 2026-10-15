import path from "node:path";
import { pathToFileURL } from "node:url";
import { safeErrorMessage } from "./lib/project-paths.mjs";
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

async function runCli() {
  try {
    const { runPreparation } = await import("./prepare-family.mjs");
    await runPreparation();
  } catch (error) {
    console.error(error.code ?? "GENERATION_FAILED", safeErrorMessage(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runCli();
}
