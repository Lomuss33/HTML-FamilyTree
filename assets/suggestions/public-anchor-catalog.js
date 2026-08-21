const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ROOT_KEYS = Object.freeze(["anchors", "catalogVersion", "schemaVersion", "sourceRevision"]);
const REQUIRED_ANCHOR_KEYS = Object.freeze(["displayLabel", "id"]);
const OPTIONAL_ANCHOR_KEYS = Object.freeze(["branchLabel", "lifespanLabel"]);

export async function loadPublicAnchorCatalog(
  url = "./data/family.anchors.public.json",
  fetchImpl = globalThis.fetch
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Public anchor catalog loading is unavailable.");
  }
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error(`Unable to load the public anchor catalog (${response.status}).`);
  }
  return validatePublicAnchorCatalog(await response.json());
}

export function validatePublicAnchorCatalog(value) {
  const issues = [];
  if (!isPlainObject(value)) {
    throw new Error("Public anchor catalog must be an object.");
  }
  requireExactKeys(value, ROOT_KEYS, "Public anchor catalog", issues);
  if (value.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  validateRevision(value.catalogVersion, "catalogVersion", issues);
  validateRevision(value.sourceRevision, "sourceRevision", issues);

  if (!Array.isArray(value.anchors)) {
    issues.push("anchors must be an array.");
  } else {
    const seen = new Set();
    let previousId = null;
    value.anchors.forEach((anchor, index) => {
      const label = `Anchor at index ${index}`;
      if (!isPlainObject(anchor)) {
        issues.push(`${label} must be an object.`);
        return;
      }
      requireAllowedKeys(anchor, REQUIRED_ANCHOR_KEYS, OPTIONAL_ANCHOR_KEYS, label, issues);
      validateReviewedText(anchor.id, `${label} id`, issues);
      validateReviewedText(anchor.displayLabel, `${label} displayLabel`, issues);
      for (const key of OPTIONAL_ANCHOR_KEYS) {
        if (key in anchor) validateReviewedText(anchor[key], `${label} ${key}`, issues);
      }
      if (typeof anchor.id === "string") {
        if (/^tmp_/i.test(anchor.id)) issues.push(`${label} may not use the tmp_* namespace.`);
        if (seen.has(anchor.id)) issues.push(`Duplicate anchor id "${anchor.id}".`);
        if (previousId !== null && previousId >= anchor.id) {
          issues.push("Anchors must be strictly sorted by id.");
        }
        seen.add(anchor.id);
        previousId = anchor.id;
      }
    });
  }

  if (issues.length > 0) {
    throw new Error(`Public anchor catalog is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${issues.join("\n")}`);
  }

  return deepFreeze({
    schemaVersion: 1,
    catalogVersion: value.catalogVersion,
    sourceRevision: value.sourceRevision,
    anchors: value.anchors.map((anchor) => ({ ...anchor }))
  });
}

export function filterPublicAnchors(anchors, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...anchors];
  return anchors.filter((anchor) => [
    anchor.displayLabel,
    anchor.lifespanLabel,
    anchor.branchLabel
  ].some((value) => normalizeSearchText(value).includes(normalizedQuery)));
}

function normalizeSearchText(value) {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim()
    : "";
}

function requireExactKeys(value, expectedKeys, label, issues) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`${label} must contain only: ${expected.join(", ")}.`);
  }
}

function requireAllowedKeys(value, requiredKeys, optionalKeys, label, issues) {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${label} contains forbidden field "${key}".`);
  }
  for (const key of requiredKeys) {
    if (!(key in value)) issues.push(`${label} is missing ${key}.`);
  }
}

function validateReviewedText(value, label, issues) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    issues.push(`${label} must be a non-empty trimmed string.`);
  }
}

function validateRevision(value, label, issues) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    issues.push(`${label} must use sha256:<64 lowercase hex characters>.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
