import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildPublicAnchorArtifacts } from "./generate-public-anchors.mjs";
import {
  compareStrings,
  computeAnchorCatalogVersion,
  stableStringify,
  validateFamilyData
} from "./validate-family-data.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");
const privatePath = path.resolve("data/family.private.json");
const templatePath = path.resolve("data/family.template.json");
const catalogPath = path.resolve("data/family.anchors.public.json");
const allowlistPath = path.resolve("api/generated/public-anchor-allowlist.json");
const siteConfigPath = path.resolve("assets/site-config.js");
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CATALOG_KEYS = ["anchors", "catalogVersion", "schemaVersion", "sourceRevision"];
const ANCHOR_REQUIRED_KEYS = ["displayLabel", "id"];
const ANCHOR_OPTIONAL_KEYS = ["branchLabel", "lifespanLabel"];
const ALLOWLIST_KEYS = ["anchorIds", "catalogVersion"];

export function validateGeneratedArtifacts(catalog, allowlist) {
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

export function validatePublicRuntimeConfig(source) {
  const forbiddenProperty = /\b(?:accessCode|familyPassword|password|secret|submissionAccessCode|token)\s*:/i;
  if (forbiddenProperty.test(source)) {
    throw new Error("assets/site-config.js contains a forbidden secret-bearing configuration property.");
  }
}

async function runValidation() {
  await assertPrivateFileIsNotTracked();

  const catalog = await readJson(catalogPath, "public anchor catalog");
  const allowlist = await readJson(allowlistPath, "backend public-anchor allowlist");
  const artifactSummary = validateGeneratedArtifacts(catalog, allowlist);
  validatePublicRuntimeConfig(await readFile(siteConfigPath, "utf8"));

  const privateExists = await fileExists(privatePath);
  const canonicalPath = privateExists ? privatePath : templatePath;
  const canonicalNodes = await readJson(canonicalPath, "canonical family data");
  validateFamilyData(canonicalNodes);

  if (privateExists) {
    const expected = buildPublicAnchorArtifacts(canonicalNodes);
    if (stableStringify(expected.catalog) !== stableStringify(catalog)) {
      throw new Error("Public anchor catalog is stale. Run npm run generate:anchors from the current private family source.");
    }
    if (stableStringify(expected.allowlist) !== stableStringify(allowlist)) {
      throw new Error("Backend anchor allowlist is stale. Run npm run generate:anchors from the current private family source.");
    }
    await validatePlaintextLeaks(canonicalNodes);
  } else {
    console.log("Private family source is absent; CI-safe structural checks used data/family.template.json.");
    console.log("Private-name leak and generated-artifact freshness checks will run when data/family.private.json is present.");
  }

  console.log(`Validated public anchor catalog with ${artifactSummary.anchorCount} anchor${artifactSummary.anchorCount === 1 ? "" : "s"}.`);
  console.log(`Catalog version: ${artifactSummary.catalogVersion}`);
  console.log("Public catalog and backend allowlist match. No secret-bearing runtime config properties found.");
}

async function assertPrivateFileIsNotTracked() {
  const { stdout } = await execFileAsync("git", ["ls-files", "--", "data/family.private.json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (stdout.trim()) {
    throw new Error("data/family.private.json is tracked by Git. Remove it from the index before publishing.");
  }
}

async function validatePlaintextLeaks(privateNodes) {
  const tokens = collectSensitiveTokens(privateNodes);
  const ignored = new Set([
    ".git",
    ".aws-sam",
    "node_modules",
    "data/family.private.json",
    "data/family.anchors.public.json",
    "api/generated/public-anchor-allowlist.json"
  ]);
  const files = await collectFiles(repoRoot, ignored);
  const findings = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const token of tokens) {
      if (content.includes(token)) {
        findings.push({ filePath, token });
        break;
      }
    }
  }

  if (findings.length > 0) {
    const detail = findings
      .map((finding) => `- ${path.relative(repoRoot, finding.filePath)} contains "${finding.token}"`)
      .join("\n");
    throw new Error(`Sensitive plaintext found in published files:\n${detail}`);
  }

  console.log(`Validated ${files.length} files. No unapproved private-name plaintext found.`);
}

function collectSensitiveTokens(nodes) {
  const tokens = new Set();
  for (const node of nodes) {
    const data = node?.data ?? {};
    const firstName = normalizeToken(data["first name"]);
    const lastName = normalizeToken(data["last name"]);
    addToken(tokens, firstName);
    addToken(tokens, lastName);
    if (firstName && lastName) addToken(tokens, `${firstName} ${lastName}`);
  }
  return [...tokens];
}

function addToken(tokens, value) {
  const normalized = normalizeToken(value);
  if (normalized && normalized.length >= 3) tokens.add(normalized);
}

function normalizeToken(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  if (!normalized || normalized === "Name" || normalized === "Surname") return "";
  return normalized;
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

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read valid ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, ignored) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(repoRoot, fullPath).replaceAll("\\", "/");
    if (ignored.has(relative) || ignored.has(entry.name)) continue;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, ignored));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runValidation();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
