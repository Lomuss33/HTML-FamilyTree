import { compareStrings, computeAnchorCatalogVersion, stableStringify } from "../validate-family-data.mjs";

const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CATALOG_KEYS = ["anchors", "catalogVersion", "schemaVersion", "sourceRevision"];
const ANCHOR_REQUIRED_KEYS = ["displayLabel", "id"];
const ANCHOR_OPTIONAL_KEYS = ["branchLabel", "lifespanLabel"];
const ALLOWLIST_KEYS = ["anchorIds", "catalogVersion"];
const REVISION_KEYS = ["catalogVersion", "schemaVersion", "sourceRevision"];

export function validateGeneratedArtifacts(catalog, allowlist, revision) {
  const issues = [];

  requireExactKeys(catalog, CATALOG_KEYS, "Public anchor catalog", issues);
  if (catalog?.schemaVersion !== 1) {
    issues.push("Public anchor catalog schemaVersion must be 1.");
  }
  validateRevision(catalog?.catalogVersion, "Public anchor catalog catalogVersion", issues);
  validateRevision(catalog?.sourceRevision, "Public anchor catalog sourceRevision", issues);

  if (!Array.isArray(catalog?.anchors)) {
    issues.push("Public anchor catalog anchors must be an array.");
  } else {
    const seen = new Set();
    let previousId = null;
    catalog.anchors.forEach((anchor, index) => {
      const label = `Public anchor at index ${index}`;
      requireAllowedKeys(anchor, ANCHOR_REQUIRED_KEYS, ANCHOR_OPTIONAL_KEYS, label, issues);
      validateNonEmptyString(anchor?.id, `${label} id`, issues);
      validateNonEmptyString(anchor?.displayLabel, `${label} displayLabel`, issues);

      for (const key of ANCHOR_OPTIONAL_KEYS) {
        if (key in (anchor ?? {}) && (typeof anchor[key] !== "string" || !anchor[key].trim())) {
          issues.push(`${label} ${key} must be a non-empty string when present.`);
        }
      }

      if (typeof anchor?.id === "string") {
        if (/^tmp_/i.test(anchor.id)) {
          issues.push(`${label} uses the reserved temporary id namespace.`);
        }
        if (seen.has(anchor.id)) {
          issues.push(`Public anchor catalog contains duplicate id "${anchor.id}".`);
        }
        seen.add(anchor.id);
        if (previousId !== null && compareStrings(previousId, anchor.id) >= 0) {
          issues.push("Public anchor catalog must be deterministically sorted by id.");
        }
        previousId = anchor.id;
      }
    });
  }

  requireExactKeys(allowlist, ALLOWLIST_KEYS, "Backend public-anchor allowlist", issues);
  validateRevision(allowlist?.catalogVersion, "Backend allowlist catalogVersion", issues);
  if (!Array.isArray(allowlist?.anchorIds)) {
    issues.push("Backend allowlist anchorIds must be an array.");
  } else {
    const seen = new Set();
    let previousId = null;
    allowlist.anchorIds.forEach((id, index) => {
      validateNonEmptyString(id, `Backend allowlist anchorIds[${index}]`, issues);
      if (typeof id === "string") {
        if (/^tmp_/i.test(id)) {
          issues.push(`Backend allowlist id "${id}" uses the reserved temporary namespace.`);
        }
        if (seen.has(id)) {
          issues.push(`Backend allowlist contains duplicate id "${id}".`);
        }
        seen.add(id);
        if (previousId !== null && compareStrings(previousId, id) >= 0) {
          issues.push("Backend allowlist anchorIds must be deterministically sorted.");
        }
        previousId = id;
      }
    });
  }

  if (catalog?.catalogVersion !== allowlist?.catalogVersion) {
    issues.push("Public catalog and backend allowlist catalogVersion values do not match.");
  }

  requireExactKeys(revision, REVISION_KEYS, "Backend canonical revision", issues);
  if (revision?.schemaVersion !== 1) {
    issues.push("Backend canonical revision schemaVersion must be 1.");
  }
  validateRevision(revision?.catalogVersion, "Backend canonical revision catalogVersion", issues);
  validateRevision(revision?.sourceRevision, "Backend canonical revision sourceRevision", issues);
  if (catalog?.catalogVersion !== revision?.catalogVersion) {
    issues.push("Public catalog and backend canonical revision catalogVersion values do not match.");
  }
  if (catalog?.sourceRevision !== revision?.sourceRevision) {
    issues.push("Public catalog and backend canonical revision sourceRevision values do not match.");
  }

  const catalogIds = Array.isArray(catalog?.anchors) ? catalog.anchors.map((anchor) => anchor.id) : [];
  const allowlistIds = Array.isArray(allowlist?.anchorIds) ? allowlist.anchorIds : [];
  if (Array.isArray(catalog?.anchors)) {
    const expectedCatalogVersion = computeAnchorCatalogVersion(catalog.anchors);
    if (catalog.catalogVersion !== expectedCatalogVersion) {
      issues.push("Public catalog catalogVersion does not match its normalized anchor content.");
    }
  }
  if (stableStringify(catalogIds) !== stableStringify(allowlistIds)) {
    issues.push("Public catalog anchor ids do not exactly match backend allowlist ids.");
  }

  if (issues.length > 0) {
    throw new Error(`Generated public artifacts are invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`);
  }

  return {
    anchorCount: catalogIds.length,
    catalogVersion: catalog.catalogVersion,
    sourceRevision: catalog.sourceRevision
  };
}

function requireExactKeys(value, expectedKeys, label, issues) {
  if (!isPlainObject(value)) {
    issues.push(`${label} must be an object.`);
    return;
  }
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  if (stableStringify(actual) !== stableStringify(expected)) {
    issues.push(`${label} must contain only keys: ${expected.join(", ")}.`);
  }
}

function requireAllowedKeys(value, requiredKeys, optionalKeys, label, issues) {
  if (!isPlainObject(value)) {
    issues.push(`${label} must be an object.`);
    return;
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${label} contains forbidden field "${key}".`);
  }
  for (const key of requiredKeys) {
    if (!(key in value)) issues.push(`${label} is missing required field "${key}".`);
  }
}

function validateRevision(value, label, issues) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    issues.push(`${label} must use the form sha256:<64 lowercase hex characters>.`);
  }
}

function validateNonEmptyString(value, label, issues) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label} must be a non-empty string.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
